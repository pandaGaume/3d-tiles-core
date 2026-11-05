import {
    CUBE_TILE_TOPOLOGY,
    CubeTileSurface,
    ReferenceSurface,
    TileNeighbor,
    cubeTileGeometricError,
    tileAddressKey,
} from "@spacexr/tiles";
import { describe, expect, it } from "vitest";

import {
    CubeTileDataSource,
    createCubeImplicitSource,
    cubeTileBoundingBox,
    quadtreeBalanceRefinements,
    quadtreeImbalances,
    quadtreeTileKey,
    type IImplicitTileAddressContext,
    type ITileAddress,
} from "../src";

const MOON = new CubeTileSurface(ReferenceSurface.sphere(1737400));
const BODY = new CubeTileSurface(new ReferenceSurface(13000, 11400, 9100));

/** Whether a point lies in a 3D Tiles box, with a tolerance in box units. */
function insideBox(box: readonly number[], point: { x: number; y: number; z: number }): boolean {
    const offset = { x: point.x - box[0]!, y: point.y - box[1]!, z: point.z - box[2]! };
    for (let axis = 0; axis < 3; axis++) {
        const x = box[3 + axis * 3]!;
        const y = box[4 + axis * 3]!;
        const z = box[5 + axis * 3]!;
        const lengthSquared = x * x + y * y + z * z;
        if (Math.abs((offset.x * x + offset.y * y + offset.z * z) / lengthSquared) > 1 + 1e-9) return false;
    }
    return true;
}

describe("cubeTileBoundingBox", () => {
    it("contains every point of the tile at both bounds of its height range", () => {
        for (const surface of [MOON, BODY]) {
            for (const lod of [0, 3, 9]) {
                for (let face = 0; face < 6; face++) {
                    const address = { face, lod, x: 2 ** lod - 1, y: 0 };
                    const box = cubeTileBoundingBox(address, surface, -300, 900);
                    for (let j = 0; j <= 16; j++) {
                        for (let i = 0; i <= 16; i++) {
                            expect(insideBox(box, surface.point(address, i / 16, j / 16, -300))).toBe(true);
                            expect(insideBox(box, surface.point(address, i / 16, j / 16, 900))).toBe(true);
                        }
                    }
                }
            }
        }
    });

    it("is thin along the up vector of a small tile", () => {
        const address = { face: 5, lod: 11, x: 1024, y: 1024 };
        const box = cubeTileBoundingBox(address, MOON, -100, 100);
        const up = MOON.up(address, 0.5, 0.5);
        const vertical = Math.hypot(box[9]!, box[10]!, box[11]!);
        expect(vertical).toBeGreaterThanOrEqual(100);
        expect(vertical).toBeLessThan(105);
        expect(Math.abs(box[9]! * up.x + box[10]! * up.y + box[11]! * up.z)).toBeCloseTo(vertical, 6);
        expect(Math.hypot(box[3]!, box[4]!, box[5]!)).toBeGreaterThan(600);
    });

    it("rejects an inverted height range", () => {
        expect(() => cubeTileBoundingBox({ face: 0, lod: 0, x: 0, y: 0 }, MOON, 1, 0)).toThrow(RangeError);
    });
});

describe("CubeTileDataSource", () => {
    const source = new CubeTileDataSource({
        surface: MOON,
        rootAddress: { face: 4, lod: 1, x: 1, y: 0 },
        maxLOD: 6,
        urlTemplates: "https://tiles.example.com/{face}/{z}/{x}/{y}.png",
        tileMetadata: (address) => ({ class: "Tile", properties: { face: address.face!, lod: address.lod } }),
    });

    it("addresses tiles under its root, on its face", () => {
        expect(source.addressOf({ level: 2, x: 3, y: 1 })).toEqual({ face: 4, lod: 3, x: 7, y: 1 });
        expect(() => source.addressOf({ level: 6, x: 0, y: 0 })).toThrow(RangeError);
        expect(source.urlTemplates).toEqual(["https://tiles.example.com/4/{z}/{x}/{y}.png"]);
    });

    it("resolves boxes, the error of the tile and its content", () => {
        const tile = source.resolve({ level: 1, x: 0, y: 1 });
        expect(tile.address).toEqual({ face: 4, lod: 2, x: 2, y: 1 });
        expect(tile.boundingVolume.box).toHaveLength(12);
        expect(tile.geometricError).toBe(cubeTileGeometricError({ face: 4, lod: 2, x: 2, y: 1 }, MOON.reference, 256));
        expect(tile.contents[0]?.uri).toBe("https://tiles.example.com/4/2/2/1.png");
        expect(tile.metadata?.properties).toEqual({ face: 4, lod: 2 });
    });

    it("rejects a pyramid ending above its root and unknown URL variables", () => {
        expect(
            () => new CubeTileDataSource({ surface: MOON, rootAddress: { face: 0, lod: 3, x: 0, y: 0 }, maxLOD: 2, urlTemplates: "x" }),
        ).toThrow(RangeError);
        expect(
            () =>
                new CubeTileDataSource({ surface: MOON, rootAddress: { face: 0, lod: 0, x: 0, y: 0 }, maxLOD: 2, urlTemplates: "{nope}" }),
        ).toThrow("nope");
    });
});

describe("createCubeImplicitSource", () => {
    const context = (rootTile: unknown, level = 0, x = 0, y = 0): IImplicitTileAddressContext => ({
        documentUri: "",
        rootTile: rootTile as never,
        implicitTiling: undefined as never,
        coordinates: { level, x, y },
    });

    it("builds one implicit quadtree per face under a sphere", () => {
        const { tileset, dataSources, resolver } = createCubeImplicitSource({
            surface: MOON,
            maxLOD: 5,
            urlTemplates: "cube://{face}/{z}/{x}/{y}",
        });
        const children = tileset.root.children!;
        expect(children).toHaveLength(6);
        expect(dataSources.map(({ rootAddress }) => rootAddress.face)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(tileset.root.boundingVolume.sphere).toEqual([0, 0, 0, 1737400]);
        expect(children[0]!.implicitTiling?.availableLevels).toBe(6);
        expect(children[0]!.boundingVolume.box).toHaveLength(12);
        expect(resolver.addressOf?.(context(children[4], 2, 1, 3))).toEqual({ face: 4, lod: 2, x: 1, y: 3 });
    });

    it("starts from several roots per face", () => {
        const { tileset } = createCubeImplicitSource({ surface: MOON, minLOD: 1, maxLOD: 3, urlTemplates: "cube://{face}/{z}/{x}/{y}" });
        expect(tileset.root.children).toHaveLength(24);
    });

    it("registers subtrees with their own levels at their address", () => {
        const root = { face: 5, lod: 2, x: 1, y: 2 };
        const { tileset, resolver } = createCubeImplicitSource({
            surface: MOON,
            maxLOD: 7,
            urlTemplates: "cube://{face}/{z}/{x}/{y}",
            subtrees: [{ root, maxLOD: 11 }],
        });
        const south = tileset.root.children![5]!;
        const graft = resolver.subtreeAt?.(context(south, 2, 1, 2));
        expect(graft?.tile.implicitTiling?.availableLevels).toBe(10);
        expect(resolver.subtreeAt?.(context(south, 2, 2, 2))).toBeUndefined();
        expect(resolver.addressOf?.(context(graft!.tile, 1, 1, 0))).toEqual({ face: 5, lod: 3, x: 3, y: 4 });
    });

    it("bounds tiles with their measured height range", () => {
        const { tileset, resolver } = createCubeImplicitSource({
            surface: MOON,
            maxLOD: 5,
            urlTemplates: "cube://{face}/{z}/{x}/{y}",
            heightRange: (address) => (address.lod === 3 ? [-8000, 6000] : undefined),
        });
        const north = tileset.root.children![4]!;
        const resolved = (level: number): readonly number[] =>
            resolver.resolve({
                ...context(north, level, 0, 0),
                computedBoundingVolume: { sphere: [0, 0, 0, 1] },
                computedGeometricError: 1,
                computedContents: [],
            })!.boundingVolume!.box as never;
        const point = MOON.point({ face: 4, lod: 3, x: 0, y: 0 }, 0.5, 0.5, 5900);
        expect(insideBox(resolved(3), point)).toBe(true);
        expect(insideBox(cubeTileBoundingBox({ face: 4, lod: 3, x: 0, y: 0 }, MOON), point)).toBe(false);
    });
});

describe("quadtree balance on the cube", () => {
    const location = (address: ITileAddress) => ({ namespace: "", address, wrapX: false, topology: CUBE_TILE_TOPOLOGY });

    it("keeps the tiles of different faces apart", () => {
        expect(quadtreeTileKey("n:", { lod: 2, x: 1, y: 0 })).toBe("n:2/1/0");
        expect(quadtreeTileKey("n:", { face: 3, lod: 2, x: 1, y: 0 })).toBe("n:3/2/1/0");
    });

    it("refines ancestors across a turned face edge", () => {
        const address = { face: 1, lod: 4, x: 5, y: 0 };
        const refinements = quadtreeBalanceRefinements([location(address)]);
        // Across the north edge of face 1 lies the east edge of face 4, reversed.
        const neighbor = CUBE_TILE_TOPOLOGY.neighbor(address, TileNeighbor.N)!.address;
        expect(neighbor).toEqual({ face: 4, lod: 4, x: 15, y: 10 });
        expect(refinements.has(tileAddressKey({ face: 4, lod: 2, x: 3, y: 2 }))).toBe(true);
        expect(refinements.has(tileAddressKey({ face: 4, lod: 0, x: 0, y: 0 }))).toBe(true);
        expect(refinements.has(tileAddressKey({ face: 4, lod: 3, x: 7, y: 5 }))).toBe(false);
    });

    it("reports imbalances across a face edge, and none without a topology", () => {
        const fine = { face: 1, lod: 4, x: 5, y: 0 };
        const coarse = { face: 4, lod: 2, x: 3, y: 2 };
        const displayed = [
            { location: location(fine), value: "fine" },
            { location: location(coarse), value: "coarse" },
        ];
        expect(quadtreeImbalances(displayed)).toEqual([{ fine: "fine", coarseLod: 2 }]);
        const flat = displayed.map(({ location: { namespace, address, wrapX }, value }) => ({
            location: { namespace, address, wrapX },
            value,
        }));
        expect(quadtreeImbalances(flat)).toEqual([]);
    });
});
