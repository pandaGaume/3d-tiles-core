import { describe, expect, it } from "vitest";

import { StitchedRasterGrids, createRasterGrid, rasterRangeInArea, sampleRasterBilinear, type IRasterGrid } from "../src";

/** 2 x 2 grid whose samples are `base + 0, 1, 10, 11`. */
function grid(base: number): IRasterGrid<Float32Array> {
    return createRasterGrid(2, 2, 1, new Float32Array([base, base + 1, base + 10, base + 11]));
}

function rows(stitched: IRasterGrid | undefined): number[][] {
    if (!stitched) throw new Error("Missing grid.");
    const length = stitched.width * stitched.channels;
    return Array.from({ length: stitched.height }, (_, row) => [...stitched.data.subarray(row * length, (row + 1) * length)]);
}

describe("StitchedRasterGrids", () => {
    it("repeats the tile edges until the neighbours arrive", () => {
        const grids = new StitchedRasterGrids();
        expect(grids.add({ lod: 2, x: 1, y: 1 }, grid(100)).map(({ x, y }) => `${x}/${y}`)).toEqual(["1/1"]);

        expect(rows(grids.get({ lod: 2, x: 1, y: 1 }))).toEqual([
            [100, 101, 101],
            [110, 111, 111],
            [110, 111, 111],
        ]);
    });

    it("pulls the east, south and south-east edges whatever the arrival order", () => {
        const grids = new StitchedRasterGrids();
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

    it("lets neighbouring tiles sample identical values on their shared edge", () => {
        const grids = new StitchedRasterGrids();
        grids.add({ lod: 2, x: 1, y: 1 }, grid(100));
        grids.add({ lod: 2, x: 2, y: 1 }, grid(200));
        const west = grids.get({ lod: 2, x: 1, y: 1 })!;
        const east = grids.get({ lod: 2, x: 2, y: 1 })!;

        for (const v of [0, 0.25, 0.5]) {
            expect(sampleRasterBilinear(west, 1, v, 0, "point")).toBe(sampleRasterBilinear(east, 0, v, 0, "point"));
        }
        expect(rasterRangeInArea(west, 0.5, 0, 1, 0.5, "point")).toEqual({ minimum: 101, maximum: 210 });
    });

    it("stitches every channel of colour rasters and keeps their array type", () => {
        const pixel = (value: number) => [value, value + 1, value + 2, 255];
        const rgba = (base: number) => createRasterGrid(1, 1, 4, new Uint8ClampedArray(pixel(base)));
        const grids = new StitchedRasterGrids();
        grids.add({ lod: 1, x: 0, y: 0 }, rgba(10));
        grids.add({ lod: 1, x: 1, y: 0 }, rgba(20));
        grids.add({ lod: 1, x: 0, y: 1 }, rgba(30));
        grids.add({ lod: 1, x: 1, y: 1 }, rgba(40));

        const stitched = grids.get({ lod: 1, x: 0, y: 0 })!;
        expect(stitched.data).toBeInstanceOf(Uint8ClampedArray);
        expect(rows(stitched)).toEqual([
            [...pixel(10), ...pixel(20)],
            [...pixel(30), ...pixel(40)],
        ]);
    });

    it("builds each stitched grid with the factory", () => {
        const grids = new StitchedRasterGrids({
            create: (width, height, channels, data: Float32Array) => ({ ...createRasterGrid(width, height, channels, data), first: data[0]! }),
        });
        grids.add({ lod: 1, x: 1, y: 0 }, grid(200));
        grids.add({ lod: 1, x: 0, y: 0 }, grid(100));

        expect(grids.get({ lod: 1, x: 0, y: 0 })?.first).toBe(100);
        expect(grids.get({ lod: 1, x: 0, y: 0 })?.width).toBe(3);
    });

    it("wraps around the antimeridian on request", () => {
        const grids = new StitchedRasterGrids({ wrapX: true });
        grids.add({ lod: 1, x: 0, y: 0 }, grid(100));
        grids.add({ lod: 1, x: 1, y: 0 }, grid(200));

        expect(rows(grids.get({ lod: 1, x: 1, y: 0 }))[0]).toEqual([200, 201, 100]);
    });

    it("rejects neighbours of another size or channel count", () => {
        const grids = new StitchedRasterGrids();
        grids.add({ lod: 2, x: 2, y: 1 }, createRasterGrid(3, 3, 1, new Float32Array(9)));
        grids.add({ lod: 2, x: 1, y: 2 }, createRasterGrid(2, 2, 2, new Float32Array(8)));

        expect(() => grids.add({ lod: 2, x: 1, y: 1 }, grid(100))).toThrow(RangeError);
        expect(() => grids.add({ lod: 2, x: 1, y: 3 }, grid(100))).toThrow(RangeError);
    });
});
