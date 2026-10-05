import { describe, expect, it } from "vitest";

import {
    DemInfos,
    Tile,
    WebMercatorTileMetrics,
    computeGridNormals,
    createHeightGrid,
    createMapzenTerrariumSource,
    LocalDemDecoder,
    loadDemTile,
    heightRangeInArea,
    sampleHeightBilinear,
    type FetchFunction,
    type IImageDecoder,
} from "../src";

const metrics = new WebMercatorTileMetrics({ minLOD: 0, maxLOD: 15 });

describe("Tile", () => {
    it("derives its quadkey, key and bounds from the metrics", () => {
        const tile = new Tile({ lod: 1, x: 0, y: 0 }, metrics, "content", "imagery");
        expect(tile.quadkey).toBe("0");
        expect(tile.key).toBe("imagery:0");
        expect(tile.geoBounds.west).toBeCloseTo(-180, 9);
        expect(tile.geoBounds.east).toBeCloseTo(0, 9);
        expect(tile.geoBounds.south).toBeCloseTo(0, 9);
        expect(tile.geoBounds.north).toBeCloseTo(85.0511287798066, 9);
        expect(tile.pixelBounds).toEqual({ x: 0, y: 0, width: 256, height: 256 });
        expect(tile.content).toBe("content");
    });

    it("rejects addresses outside their level", () => {
        expect(() => new Tile({ lod: 1, x: 2, y: 0 }, metrics)).toThrow(RangeError);
    });
});

function grid(width: number, values: number[]): DemInfos {
    return new DemInfos(createHeightGrid(width, values.length / width, new Float32Array(values)));
}

describe("DemInfos", () => {
    it("computes statistics over valid samples, including a maximum in the first sample", () => {
        const infos = grid(3, [50, 10, Number.NaN, 20, 30, 0]);
        expect(infos.highest).toEqual({ column: 0, row: 0, height: 50 });
        expect(infos.lowest).toEqual({ column: 2, row: 1, height: 0 });
        expect(infos.minimum).toBe(0);
        expect(infos.maximum).toBe(50);
        expect(infos.mean).toBe(22);
        expect(infos.delta).toBe(50);
        expect(infos.noDataCount).toBe(1);
    });

    it("reports undefined extremes when every sample is missing", () => {
        const infos = grid(2, [Number.NaN, Number.NaN]);
        expect(infos.lowest).toBeUndefined();
        expect(infos.mean).toBeNaN();
        expect(infos.delta).toBeNaN();
    });

    it("copies a view with its normals and recomputes the statistics", () => {
        const heights = [0, 1, 2, 3, 4, 5, 6, 7, 8];
        const normals = new Float32Array(heights.flatMap((value) => [value, 0, 1]));
        const infos = new DemInfos(createHeightGrid(3, 3, new Float32Array(heights)), normals);
        const view = infos.view(1, 1, 2, 2);
        expect([...view.heights]).toEqual([4, 5, 7, 8]);
        expect([...view.normals!].filter((_, index) => index % 3 === 0)).toEqual([4, 5, 7, 8]);
        expect(view).toMatchObject({ minimum: 4, maximum: 8, mean: 6 });
        view.heights[0] = 99;
        expect(infos.heights[4]).toBe(4);
        expect(() => infos.view(2, 2, 2, 2)).toThrow(RangeError);
    });

    it("rejects normals that do not match the grid", () => {
        expect(() => new DemInfos(createHeightGrid(2, 1, new Float32Array(2)), new Float32Array(3))).toThrow(RangeError);
    });
});

describe("computeGridNormals", () => {
    const expectNormal = (normals: Float32Array, index: number, expected: [number, number, number]): void => {
        for (let axis = 0; axis < 3; axis++) expect(normals[index * 3 + axis]).toBeCloseTo(expected[axis]!, 6);
    };

    it("returns up on flat ground", () => {
        const normals = computeGridNormals(createHeightGrid(2, 2, new Float32Array(4)), 10);
        for (let index = 0; index < 4; index++) expectNormal(normals, index, [0, 0, 1]);
    });

    it("tilts away from slopes rising east and north, including at the edges", () => {
        const spacing = 10;
        // Height rises by one spacing per column eastward: a 45 degree slope.
        const east = computeGridNormals(createHeightGrid(3, 2, new Float32Array([0, 10, 20, 0, 10, 20])), spacing);
        for (let index = 0; index < 6; index++) expectNormal(east, index, [-Math.SQRT1_2, 0, Math.SQRT1_2]);
        // Rows grow southward, so heights decreasing with the row rise northward.
        const north = computeGridNormals(createHeightGrid(2, 3, new Float32Array([20, 20, 10, 10, 0, 0])), spacing);
        for (let index = 0; index < 6; index++) expectNormal(north, index, [0, -Math.SQRT1_2, Math.SQRT1_2]);
    });

    it("falls back to one-sided differences next to missing samples", () => {
        const normals = computeGridNormals(createHeightGrid(3, 1, new Float32Array([Number.NaN, 0, 10])), 10);
        expectNormal(normals, 1, [-Math.SQRT1_2, 0, Math.SQRT1_2]);
        expectNormal(normals, 0, [0, 0, 1]);
    });
});

describe("loadDemTile", () => {
    const decoder: IImageDecoder = {
        decode: () =>
            Promise.resolve({
                width: 2,
                height: 2,
                // Terrarium heights 0, 1, 2 and 3 m.
                data: new Uint8ClampedArray([128, 0, 0, 255, 128, 1, 0, 255, 128, 2, 0, 255, 128, 3, 0, 255]),
            }),
    };

    it("returns a tile with its DEM infos and normals", async () => {
        const fetch: FetchFunction = () => Promise.resolve(new Response("png", { status: 200 }));
        const tile = await loadDemTile(createMapzenTerrariumSource({ client: { fetch } }), { lod: 3, x: 2, y: 3 }, new LocalDemDecoder(decoder), { normals: true });
        expect(tile?.key).toBe("mapzen-terrarium:" + tile?.quadkey);
        expect(tile?.content).toMatchObject({ minimum: 0, maximum: 3, mean: 1.5 });
        expect(tile?.content?.normals).toHaveLength(12);
    });

    it("returns undefined for an absent tile", async () => {
        const fetch: FetchFunction = () => Promise.resolve(new Response(null, { status: 404 }));
        await expect(loadDemTile(createMapzenTerrariumSource({ client: { fetch } }), { lod: 3, x: 2, y: 3 }, new LocalDemDecoder(decoder))).resolves.toBeUndefined();
    });
});

describe("sampleHeightBilinear", () => {
    // 2 x 2 grid: pixel centres at u, v = 0.25 and 0.75.
    const grid = createHeightGrid(2, 2, new Float32Array([0, 10, 20, 30]));

    it("returns pixel values at pixel centres and clamps to the edge samples", () => {
        expect(sampleHeightBilinear(grid, 0.25, 0.25)).toBe(0);
        expect(sampleHeightBilinear(grid, 0.75, 0.75)).toBe(30);
        expect(sampleHeightBilinear(grid, 0, 0)).toBe(0);
        expect(sampleHeightBilinear(grid, 1, 1)).toBe(30);
    });

    it("interpolates between pixel centres", () => {
        expect(sampleHeightBilinear(grid, 0.5, 0.25)).toBe(5);
        expect(sampleHeightBilinear(grid, 0.5, 0.5)).toBe(15);
    });

    it("ignores missing neighbours and returns NaN only when all are missing", () => {
        const gap = createHeightGrid(2, 2, new Float32Array([Number.NaN, 10, 20, 30]));
        expect(sampleHeightBilinear(gap, 0.5, 0.5)).toBe(20);
        // Exactly on the missing pixel: falls back to the nearest valid corner.
        expect(sampleHeightBilinear(gap, 0.25, 0.25)).toBe(10);
        expect(sampleHeightBilinear(createHeightGrid(1, 1, new Float32Array([Number.NaN])), 0.5, 0.5)).toBeNaN();
    });

    it("handles single-sample grids", () => {
        expect(sampleHeightBilinear(createHeightGrid(1, 1, new Float32Array([7])), 0.9, 0.1)).toBe(7);
    });
});

describe("quadrant height ranges", () => {
    // 4 x 4 grid; the samples of column 1 and 2, and of row 1 and 2, influence both halves.
    const heights = [
        [10, 11, 12, 13],
        [20, 21, 22, 23],
        [30, 31, 32, 99],
        [-5, 41, 42, 43],
    ];
    const infos = new DemInfos(createHeightGrid(4, 4, new Float32Array(heights.flat())));

    it("computes the four child ranges with the tile range", () => {
        expect(infos.minimum).toBe(-5);
        expect(infos.maximum).toBe(99);
        expect(infos.quadrants).toEqual([
            { minimum: 10, maximum: 32 },
            { minimum: 11, maximum: 99 },
            { minimum: -5, maximum: 42 },
            { minimum: 21, maximum: 99 },
        ]);
    });

    it("matches heightRangeInArea on the halves", () => {
        expect(heightRangeInArea(infos, 0, 0, 0.5, 0.5)).toEqual(infos.quadrants[0]);
        expect(heightRangeInArea(infos, 0.5, 0.5, 1, 1)).toEqual(infos.quadrants[3]);
        expect(heightRangeInArea(infos, 0, 0, 1, 1)).toEqual({ minimum: -5, maximum: 99 });
        expect(() => heightRangeInArea(infos, 0.6, 0, 0.4, 1)).toThrow(RangeError);
    });

    it("bounds every bilinear sample taken inside an area", () => {
        const random = (() => {
            let seed = 7;
            return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
        })();
        const values = Array.from({ length: 64 }, () => Math.round(random() * 4000));
        const grid = createHeightGrid(8, 8, new Float32Array(values));
        for (let trial = 0; trial < 200; trial++) {
            const [west, east] = [random(), random()].sort((a, b) => a - b) as [number, number];
            const [north, south] = [random(), random()].sort((a, b) => a - b) as [number, number];
            const range = heightRangeInArea(grid, west, north, east, south);
            for (let sample = 0; sample < 20; sample++) {
                const height = sampleHeightBilinear(grid, west + (east - west) * random(), north + (south - north) * random());
                expect(height).toBeGreaterThanOrEqual(range.minimum - 1e-3);
                expect(height).toBeLessThanOrEqual(range.maximum + 1e-3);
            }
        }
    });

    it("reports NaN bounds for quadrants without valid samples", () => {
        // Columns and rows 0 to 2 influence the north-west quadrant of a 4 x 4 grid.
        const N = Number.NaN;
        const sparse = new DemInfos(createHeightGrid(4, 4, new Float32Array([N, N, N, 1, N, N, N, 2, N, N, N, 3, 4, 5, 6, 7])));
        expect(sparse.quadrants[1]).toEqual({ minimum: 1, maximum: 3 });
        expect(sparse.quadrants[0]).toEqual({ minimum: Number.NaN, maximum: Number.NaN });
    });
});
