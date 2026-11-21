import type { IBoundingVolume, ITile, ITileset } from "@spacexr/3d-tiles-core";
import { describe, expect, it } from "vitest";

import type { IRuntimeAdapter, IRuntimeTile } from "../src";
import { TileContentKind, TileRuntime } from "../src";

interface ICamera {
    /** Screen-space error of a tile per unit of geometric error. */
    scale: number;
}

interface ISpatial {
    error: number;
}

type Strategy = "base" | "active";
type EmptyTileRefinement = "always" | "geometric-error";

const BASE_URI = "https://example.test/";
const box: IBoundingVolume = { sphere: [0, 0, 0, 1] };

const leaf = (uri: string): ITile => ({ boundingVolume: box, geometricError: 0, content: { uri } });

/** A tile with nothing to present, and a geometric error of 10: without content, or with a content that loads empty. */
const emptyTile = (gate: boolean, children: [ITile, ...ITile[]]): ITile => ({
    boundingVolume: box,
    geometricError: 10,
    ...(gate ? { content: { uri: "gate.glb" } } : {}),
    children,
});

const root = (refine: "ADD" | "REPLACE", children: [ITile, ...ITile[]]): ITile => ({
    boundingVolume: box,
    geometricError: 1000,
    refine,
    content: { uri: "root.glb" },
    children,
});

interface IRuntimeOptions {
    emptyTileRefinement?: EmptyTileRefinement;
    coarseningDelayMilliseconds?: number;
    clock?: () => number;
    quadtreeBalance?: boolean;
    subtree?: IRuntimeAdapter<ICamera, ISpatial, string, never>["subtrees"];
}

function createRuntime(strategy: Strategy, tile: ITile, options: IRuntimeOptions = {}) {
    const loads: string[] = [];
    const tileset: ITileset = { asset: { version: "1.1" }, geometricError: tile.geometricError, root: tile };
    const adapter: IRuntimeAdapter<ICamera, ISpatial, string, never> = {
        tilesets: { load: async () => ({ tileset, baseUri: BASE_URI }) },
        ...(options.subtree ? { subtrees: options.subtree } : {}),
        spatial: {
            derive: (context) => ({ error: context.tile.geometricError }),
            isVisible: () => true,
            screenSpaceError: ({ camera, spatial }) => spatial.error * camera.scale,
        },
        content: {
            load: async ({ uri }) => {
                const name = uri.replace(BASE_URI, "");
                loads.push(name);
                if (name === "gate.glb") return { kind: "empty" };
                if (name === "external.json")
                    return { kind: "external-tileset", tileset: { asset: { version: "1.1" }, geometricError: 0, root: leaf("ext.glb") } };
                return { kind: "renderable", handle: name };
            },
            attach: () => undefined,
            detach: () => undefined,
        },
    };
    const runtime = new TileRuntime({
        id: "empty-tiles",
        uri: `${BASE_URI}tileset.json`,
        adapter,
        selectionStrategy: strategy,
        maxConcurrentLoads: 8,
        coarseningDelayMilliseconds: options.coarseningDelayMilliseconds ?? 0,
        ...(options.emptyTileRefinement ? { emptyTileRefinement: options.emptyTileRefinement } : {}),
        ...(options.clock ? { clock: options.clock } : {}),
        ...(options.quadtreeBalance ? { quadtreeBalance: true } : {}),
    });
    /** Names of the selected contents that present something. */
    const shown = (tiles: readonly IRuntimeTile<ISpatial, string, never>[] = runtime.selectedTiles) =>
        tiles
            .flatMap((node) => node.contents.filter((content) => content.kind === TileContentKind.Renderable))
            .map((content) => content.uri.replace(BASE_URI, ""))
            .sort();
    const settle = async (camera: ICamera, frames = 4) => {
        for (let frame = 0; frame < frames; frame++) {
            await runtime.update(camera);
            await runtime.whenIdle();
        }
    };
    return { runtime, loads, shown, settle };
}

describe("TileRuntime emptyTileRefinement option", () => {
    it("rejects an unknown value", () => {
        expect(() => createRuntime("base", leaf("root.glb"), { emptyTileRefinement: "never" as EmptyTileRefinement })).toThrow(RangeError);
    });
});

describe.each<Strategy>(["base", "active"])("TileRuntime empty tile refinement, %s strategy", (strategy) => {
    it.each([false, true])("leaves an empty tile under ADD unrefined below its threshold, with content=%s", async (gate) => {
        const { runtime, loads, shown, settle } = createRuntime(strategy, root("ADD", [emptyTile(gate, [leaf("child.glb")])]), {
            emptyTileRefinement: "geometric-error",
        });
        try {
            await settle({ scale: 1 });
            expect(shown()).toEqual(["root.glb"]);
            expect(loads).not.toContain("child.glb");
            await settle({ scale: 10 });
            expect(shown()).toEqual(["child.glb", "root.glb"]);
        } finally {
            await runtime.dispose();
        }
    });

    it.each([false, true])("still refines an empty tile at once by default, with content=%s", async (gate) => {
        const additive = createRuntime(strategy, root("ADD", [emptyTile(gate, [leaf("child.glb")])]));
        const replacing = createRuntime(strategy, root("REPLACE", [leaf("a.glb"), emptyTile(gate, [leaf("child.glb")])]), {
            emptyTileRefinement: "always",
        });
        try {
            await additive.settle({ scale: 1 });
            expect(additive.shown()).toEqual(["child.glb", "root.glb"]);
            await replacing.settle({ scale: 1 });
            expect(replacing.shown()).toEqual(["a.glb", "child.glb"]);
        } finally {
            await additive.runtime.dispose();
            await replacing.runtime.dispose();
        }
    });

    it.each([false, true])("replaces the parent beside an empty child under its threshold, with content=%s", async (gate) => {
        const { runtime, loads, shown, settle } = createRuntime(
            strategy,
            root("REPLACE", [leaf("a.glb"), emptyTile(gate, [leaf("child.glb")])]),
            { emptyTileRefinement: "geometric-error" },
        );
        try {
            await settle({ scale: 1 });
            expect(shown()).toEqual(["a.glb"]);
            expect(loads).not.toContain("child.glb");
        } finally {
            await runtime.dispose();
        }
    });

    it("coarsens an empty tile with the hysteresis and the delay, without a hole or the parent", async () => {
        let now = 0;
        const { runtime, shown, settle } = createRuntime(
            strategy,
            root("REPLACE", [leaf("a.glb"), emptyTile(false, [leaf("child.glb")])]),
            {
                emptyTileRefinement: "geometric-error",
                coarseningDelayMilliseconds: 300,
                clock: () => now,
            },
        );
        const frame = async (scale: number) => shown((await runtime.update({ scale })).selected);
        try {
            await settle({ scale: 10 });
            expect(shown()).toEqual(["a.glb", "child.glb"]);
            // 15 is under the threshold of 16, but above the 14.4 of the hysteresis.
            expect(await frame(1.5)).toEqual(["a.glb", "child.glb"]);
            // Under the hysteresis: the delay starts.
            expect(await frame(1)).toEqual(["a.glb", "child.glb"]);
            now += 299;
            expect(await frame(1)).toEqual(["a.glb", "child.glb"]);
            now += 2;
            expect(await frame(1)).toEqual(["a.glb"]);
            await runtime.whenIdle();
            expect(await frame(1)).toEqual(["a.glb"]);
        } finally {
            await runtime.dispose();
        }
    });

    it("always refines a tile whose content is an external tileset", async () => {
        const external: ITile = { boundingVolume: box, geometricError: 10, content: { uri: "external.json" } };
        const { runtime, shown, settle } = createRuntime(strategy, root("ADD", [external]), { emptyTileRefinement: "geometric-error" });
        try {
            await settle({ scale: 1 });
            expect(shown()).toEqual(["ext.glb", "root.glb"]);
        } finally {
            await runtime.dispose();
        }
    });

    it.each<EmptyTileRefinement>(["always", "geometric-error"])(
        "always refines an implicit tile without content, with the quadtree balance, in mode %s",
        async (emptyTileRefinement) => {
            const implicit: ITile = {
                boundingVolume: { region: [-1, -1, 1, 1, 0, 10] },
                geometricError: 10,
                refine: "REPLACE",
                content: { uri: "tiles/{level}/{x}/{y}.glb" },
                implicitTiling: {
                    subdivisionScheme: "QUADTREE",
                    subtreeLevels: 2,
                    availableLevels: 2,
                    subtrees: { uri: "subtrees/{level}/{x}/{y}.subtree" },
                },
            };
            const { runtime, shown } = createRuntime(strategy, implicit, {
                emptyTileRefinement,
                quadtreeBalance: true,
                subtree: {
                    // Every tile is available, and only the four children of the root have a content.
                    load: async () => ({
                        subtree: {
                            buffers: [{ byteLength: 1 }],
                            bufferViews: [{ buffer: 0, byteLength: 1 }],
                            tileAvailability: { constant: 1 },
                            contentAvailability: [{ bitstream: 0, availableCount: 4 }],
                            childSubtreeAvailability: { constant: 0 },
                        },
                        buffers: [new Uint8Array([0b00011110])],
                    }),
                },
            });
            try {
                let unbalanced: unknown[] = [];
                for (let frame = 0; frame < 4; frame++) {
                    unbalanced = [...(await runtime.update({ scale: 0.1 })).unbalanced];
                    await runtime.whenIdle();
                }
                expect(runtime.root?.contents).toEqual([]);
                expect(shown()).toEqual(["tiles/1/0/0.glb", "tiles/1/0/1.glb", "tiles/1/1/0.glb", "tiles/1/1/1.glb"]);
                expect(unbalanced).toEqual([]);
            } finally {
                await runtime.dispose();
            }
        },
    );
});
