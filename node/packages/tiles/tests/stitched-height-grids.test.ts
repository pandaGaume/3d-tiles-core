import { describe, expect, it } from "vitest";

import { StitchedHeightGrids, createHeightGrid, heightRangeInArea, sampleHeightBilinear, type IHeightGrid } from "../src";

/** 2 x 2 grid whose samples are `base + 0, 1, 10, 11`. */
function grid(base: number): IHeightGrid {
    return createHeightGrid(2, 2, new Float32Array([base, base + 1, base + 10, base + 11]));
}

function rows(stitched: IHeightGrid | undefined): number[][] {
    if (!stitched) throw new Error("Missing grid.");
    return Array.from({ length: stitched.height }, (_, row) => [...stitched.heights.subarray(row * stitched.width, (row + 1) * stitched.width)]);
}

describe("StitchedHeightGrids", () => {
    it("repeats the tile edges until the neighbours arrive", () => {
        const grids = new StitchedHeightGrids();
        expect(grids.add({ lod: 2, x: 1, y: 1 }, grid(100)).map(({ x, y }) => `${x}/${y}`)).toEqual(["1/1"]);

        expect(rows(grids.get({ lod: 2, x: 1, y: 1 }))).toEqual([
            [100, 101, 101],
            [110, 111, 111],
            [110, 111, 111],
        ]);
    });

    it("pulls the east, south and south-east edges whatever the arrival order", () => {
        const grids = new StitchedHeightGrids();
        grids.add({ lod: 2, x: 2, y: 1 }, grid(200)); // east
        grids.add({ lod: 2, x: 2, y: 2 }, grid(400)); // south-east
        grids.add({ lod: 2, x: 1, y: 1 }, grid(100));
        const changed = grids.add({ lod: 2, x: 1, y: 2 }, grid(300)); // south, completes its northern neighbour

        expect(changed.map(({ x, y }) => `${x}/${y}`)).toEqual(["1/2", "1/1"]);
        expect(rows(grids.get({ lod: 2, x: 1, y: 1 }))).toEqual([
            [100, 101, 200],
            [110, 111, 210],
            [300, 301, 400],
        ]);
    });

    it("lets neighbouring tiles sample identical heights on their shared edge", () => {
        const grids = new StitchedHeightGrids();
        grids.add({ lod: 2, x: 1, y: 1 }, grid(100));
        grids.add({ lod: 2, x: 2, y: 1 }, grid(200));
        const west = grids.get({ lod: 2, x: 1, y: 1 })!;
        const east = grids.get({ lod: 2, x: 2, y: 1 })!;

        for (const v of [0, 0.25, 0.5]) {
            expect(sampleHeightBilinear(west, 1, v, "point")).toBe(sampleHeightBilinear(east, 0, v, "point"));
        }
        expect(heightRangeInArea(west, 0.5, 0, 1, 0.5, "point")).toEqual({ minimum: 101, maximum: 210 });
    });

    it("wraps around the antimeridian on request", () => {
        const grids = new StitchedHeightGrids({ wrapX: true });
        grids.add({ lod: 1, x: 0, y: 0 }, grid(100));
        grids.add({ lod: 1, x: 1, y: 0 }, grid(200));

        expect(rows(grids.get({ lod: 1, x: 1, y: 0 }))[0]).toEqual([200, 201, 100]);
    });

    it("rejects neighbours of another size", () => {
        const grids = new StitchedHeightGrids();
        grids.add({ lod: 2, x: 2, y: 1 }, createHeightGrid(3, 3, new Float32Array(9)));

        expect(() => grids.add({ lod: 2, x: 1, y: 1 }, grid(100))).toThrow(RangeError);
    });
});
