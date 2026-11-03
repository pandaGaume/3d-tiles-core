import type { ITileAddress } from "@spacexr/tiles";
import { describe, expect, it } from "vitest";

import { RasterPyramid, createRasterGrid } from "../src";

/** 2 x 2 tiles whose values encode their column and row: `x * 100 + y * 10` plus `0, 1, 2, 3`. */
function load(address: ITileAddress) {
    const base = address.x * 100 + address.y * 10;
    return Promise.resolve(createRasterGrid(2, 2, 1, new Float32Array([base, base + 1, base + 2, base + 3])));
}

describe("RasterPyramid", () => {
    it("loads a tile with its east, south and south-east neighbours and stitches them", async () => {
        const loads: string[] = [];
        const pyramid = new RasterPyramid({
            load: (address) => {
                loads.push(`${address.x}/${address.y}`);
                return load(address);
            },
            maxLOD: 1,
        });
        const region = await pyramid.load({ lod: 1, x: 0, y: 0 });

        expect(loads).toEqual(["0/0", "1/0", "0/1", "1/1"]);
        expect([...region!.grid.data]).toEqual([0, 1, 100, 2, 3, 102, 10, 11, 110]);
        expect(region!.sample(1, 1)).toBe(110);
        expect(region!.range(0.5, 0, 1, 1)).toEqual({ minimum: 1, maximum: 110 });
    });

    it("samples deeper tiles from the sub-area of their ancestor", async () => {
        const pyramid = new RasterPyramid({ load, maxLOD: 1 });
        const region = await pyramid.load({ lod: 2, x: 1, y: 0 });

        expect(region).toMatchObject({ ancestor: { lod: 1, x: 0, y: 0 }, west: 0.5, north: 0, size: 0.5 });
        expect(region!.sample(0, 0)).toBe(1);
        expect(region!.sample(1, 1)).toBe(region!.grid.data[5]);
    });

    it("samples points of the pyramid identically on both sides of a tile edge", async () => {
        const pyramid = new RasterPyramid({ load, maxLOD: 1 });
        expect(pyramid.sampleAt(0.5, 0.25, 1)).toBeNaN();
        await Promise.all([pyramid.load({ lod: 1, x: 0, y: 0 }), pyramid.load({ lod: 1, x: 1, y: 0 })]);

        const edge = pyramid.sampleAt(0.5, 0.25, 1);
        expect(edge).toBe(102);
        expect(pyramid.sampleAt(0.5, 0.25, 3)).toBe(edge);
        expect(pyramid.sampleAt(-0.25, 0.25, 1)).toBeNaN();
    });

    it("wraps the antimeridian on request", async () => {
        const pyramid = new RasterPyramid({ load, maxLOD: 1, wrapX: true });
        await pyramid.load({ lod: 1, x: 1, y: 0 });

        expect(pyramid.stitchedGrid({ lod: 1, x: 1, y: 0 })?.data[2]).toBe(0);
        expect(pyramid.sampleAt(-0.25, 0, 1)).toBe(pyramid.sampleAt(0.75, 0, 1));
    });

    it("returns undefined where the pyramid has no raster", async () => {
        const pyramid = new RasterPyramid({ load: () => Promise.resolve(undefined), maxLOD: 1 });
        expect(await pyramid.load({ lod: 0, x: 0, y: 0 })).toBeUndefined();
    });
});
