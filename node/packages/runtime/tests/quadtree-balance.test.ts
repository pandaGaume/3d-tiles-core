import { describe, expect, it } from "vitest";

import type { IContentLoadContext, IRuntimeAdapter, ISpatialDerivationContext, ISpatialMetric } from "../src";
import { DenseImplicitSubtreeLoader, TileRuntime, createWebMapImplicitSource, quadtreeBalanceRefinements } from "../src";

describe("quadtreeBalanceRefinements", () => {
    it("refines every ancestor of an edge neighbour two or more levels coarser", () => {
        const refinements = quadtreeBalanceRefinements([{ namespace: "", address: { lod: 4, x: 7, y: 3 }, wrapX: false }]);

        // East neighbour 4/8/3: its ancestors at levels 2, 1 and 0.
        expect(refinements.has("2/2/0")).toBe(true);
        expect(refinements.has("1/1/0")).toBe(true);
        expect(refinements.has("0/0/0")).toBe(true);
        // The neighbour's parent, one level coarser, may stay displayed.
        expect(refinements.has("3/4/1")).toBe(false);
        // Diagonal neighbours do not constrain the tile.
        expect(refinements.has("2/2/1")).toBe(false);
    });

    it("stops at the pyramid edges unless columns wrap", () => {
        const corner = { namespace: "", address: { lod: 3, x: 0, y: 0 }, wrapX: false };

        expect(quadtreeBalanceRefinements([corner]).has("1/1/0")).toBe(false);
        expect(quadtreeBalanceRefinements([{ ...corner, wrapX: true }]).has("1/1/0")).toBe(true);
    });

    it("keeps namespaces apart", () => {
        const refinements = quadtreeBalanceRefinements([{ namespace: "a:", address: { lod: 2, x: 1, y: 1 }, wrapX: false }]);

        expect([...refinements].every((key) => key.startsWith("a:"))).toBe(true);
    });
});

interface ICamera {
    /** Longitude and latitude, in radians, where the screen-space error is high. */
    focus: readonly [number, number];
}

interface ISpatial {
    region: readonly number[];
}

/** Refines only the tiles containing the focus point, as a camera close to the ground would. */
class FocusMetric implements ISpatialMetric<ICamera, ISpatial> {
    public derive(context: ISpatialDerivationContext<ISpatial>): ISpatial {
        return { region: context.tile.boundingVolume.region ?? [] };
    }

    public isVisible(): boolean {
        return true;
    }

    public screenSpaceError({ camera, spatial }: { camera: ICamera; spatial: ISpatial }): number {
        const [west, south, east, north] = spatial.region;
        const [longitude, latitude] = camera.focus;
        return longitude >= west! && longitude <= east! && latitude >= south! && latitude <= north! ? 1000 : 0;
    }
}

async function selectedLevels(quadtreeBalance: boolean) {
    const source = createWebMapImplicitSource({ urlTemplates: "grid://{z}/{x}/{y}", maximumZoom: 3, subtreeLevels: 4 });
    const adapter: IRuntimeAdapter<ICamera, ISpatial, string, never> = {
        tilesets: { load: async () => ({ tileset: source.tileset }) },
        subtrees: new DenseImplicitSubtreeLoader(),
        implicitTiles: source.resolver,
        spatial: new FocusMetric(),
        content: {
            load: async (context: IContentLoadContext<ISpatial>) => ({ kind: "renderable", handle: context.uri }),
            attach: () => undefined,
            detach: () => undefined,
        },
    };
    const runtime = new TileRuntime({
        id: "balance",
        uri: "memory://balance/tileset.json",
        adapter,
        maxScreenSpaceError: 1,
        quadtreeBalance,
    });
    // Just west of the prime meridian: the deepest tiles touch the eastern half of the map.
    await runtime.update({ focus: [-0.01, 0.3] });
    await runtime.whenIdle();

    const tiles = runtime.selectedTiles.map((tile) => source.dataSource.addressOf(tile.implicit!.coordinates));
    let largestJump = 0;
    for (const tile of tiles) {
        for (const other of tiles) {
            const scale = 2 ** -tile.lod;
            const otherScale = 2 ** -other.lod;
            const [x0, y0, x1, y1] = [tile.x * scale, tile.y * scale, (tile.x + 1) * scale, (tile.y + 1) * scale];
            const [u0, v0, u1, v1] = [other.x * otherScale, other.y * otherScale, (other.x + 1) * otherScale, (other.y + 1) * otherScale];
            const overlapX = Math.min(x1, u1) - Math.max(x0, u0) > 0;
            const overlapY = Math.min(y1, v1) - Math.max(y0, v0) > 0;
            const sharesEdge = ((x1 === u0 || u1 === x0) && overlapY) || ((y1 === v0 || v1 === y0) && overlapX);
            if (sharesEdge) largestJump = Math.max(largestJump, Math.abs(tile.lod - other.lod));
        }
    }
    await runtime.dispose();
    return { levels: tiles.map((tile) => tile.lod), largestJump };
}

describe("TileRuntime quadtree balance", () => {
    it("lets independent branches differ by several levels without balancing", async () => {
        const { levels, largestJump } = await selectedLevels(false);

        expect(Math.max(...levels)).toBe(3);
        expect(largestJump).toBe(2);
    });

    it("refines coarse neighbours until every edge joins levels at most one apart", async () => {
        const { levels, largestJump } = await selectedLevels(true);

        expect(Math.max(...levels)).toBe(3);
        expect(largestJump).toBe(1);
    });
});
