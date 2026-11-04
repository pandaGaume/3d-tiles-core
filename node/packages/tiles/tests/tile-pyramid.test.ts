import { describe, expect, it } from "vitest";

import { TileNeighbor, TilePyramid, tileAreaInAncestor, type ITileAddress } from "../src";

const key = (address: ITileAddress) => `${address.lod}/${address.x}/${address.y}`;

function recordingLoader(missing: readonly string[] = []) {
    const loads: string[] = [];
    const load = (address: ITileAddress) => {
        loads.push(key(address));
        return Promise.resolve(missing.includes(key(address)) ? undefined : key(address));
    };
    return { loads, load };
}

describe("tileAreaInAncestor", () => {
    it("locates a tile in its ancestor", () => {
        expect(tileAreaInAncestor({ lod: 3, x: 5, y: 2 }, 2)).toEqual({ ancestor: { lod: 1, x: 1, y: 0 }, west: 0.25, north: 0.5, size: 0.25 });
        expect(tileAreaInAncestor({ lod: 3, x: 5, y: 2 }, 0)).toEqual({ ancestor: { lod: 3, x: 5, y: 2 }, west: 0, north: 0, size: 1 });
    });
});

describe("TilePyramid", () => {
    it("loads each tile once and serves deeper tiles from their ancestor", async () => {
        const { loads, load } = recordingLoader();
        const pyramid = new TilePyramid({ load, maxLOD: 2 });
        const [first, second] = await Promise.all([pyramid.load({ lod: 2, x: 1, y: 1 }), pyramid.load({ lod: 4, x: 5, y: 6 })]);
        expect(loads).toEqual(["2/1/1"]);
        expect(first).toMatchObject({ content: "2/1/1", west: 0, north: 0, size: 1 });
        expect(second).toMatchObject({ address: { lod: 4, x: 5, y: 6 }, ancestor: { lod: 2, x: 1, y: 1 }, west: 0.25, north: 0.5, size: 0.25 });
        expect(pyramid.get({ lod: 2, x: 1, y: 1 })).toBe("2/1/1");
    });

    it("prefetches neighbours, wrapping the antimeridian, and ignores missing or failing ones", async () => {
        const loads: string[] = [];
        const load = (address: ITileAddress) => {
            loads.push(key(address));
            if (key(address) === "1/0/1") return Promise.reject(new Error("offline"));
            return Promise.resolve(key(address));
        };
        const pyramid = new TilePyramid({ load, maxLOD: 3, wrapX: true, prefetch: [TileNeighbor.E, TileNeighbor.S, TileNeighbor.SE] });
        const region = await pyramid.load({ lod: 1, x: 1, y: 0 });
        expect(region?.content).toBe("1/1/0");
        expect(loads).toEqual(["1/1/0", "1/0/0", "1/1/1", "1/0/1"]);
        // A failed load leaves the cache so that it can be retried.
        expect(pyramid.size).toBe(3);
        // The south neighbour of the last row does not exist.
        loads.length = 0;
        await pyramid.load({ lod: 1, x: 1, y: 1 });
        expect(loads).toEqual(["1/0/1"]);
    });

    it("returns undefined for absent tiles", async () => {
        const { load } = recordingLoader(["0/0/0"]);
        const pyramid = new TilePyramid({ load, maxLOD: 0 });
        expect(await pyramid.load({ lod: 0, x: 0, y: 0 })).toBeUndefined();
        expect(pyramid.get({ lod: 0, x: 0, y: 0 })).toBeUndefined();
    });

    it("evicts the least recently used tiles and reports loads and evictions", async () => {
        const { loads, load } = recordingLoader();
        const loaded: string[] = [];
        const evicted: string[] = [];
        const pyramid = new TilePyramid({
            load,
            maxLOD: 5,
            cacheEntries: 2,
            onLoad: (address) => loaded.push(key(address)),
            onEvict: (address) => evicted.push(key(address)),
        });
        await pyramid.load({ lod: 1, x: 0, y: 0 });
        await pyramid.load({ lod: 1, x: 1, y: 0 });
        await pyramid.load({ lod: 1, x: 0, y: 0 });
        await pyramid.load({ lod: 1, x: 0, y: 1 });
        expect(evicted).toEqual(["1/1/0"]);
        expect(loaded).toEqual(["1/0/0", "1/1/0", "1/0/1"]);
        await pyramid.load({ lod: 1, x: 1, y: 0 });
        expect(loads).toEqual(["1/0/0", "1/1/0", "1/0/1", "1/1/0"]);
    });

    it("drops a tile evicted while it loads", async () => {
        let resolve!: (value: string) => void;
        const loaded: string[] = [];
        const pyramid = new TilePyramid<string>({
            load: () => new Promise((settle) => (resolve = settle)),
            maxLOD: 1,
            onLoad: (address) => loaded.push(key(address)),
        });
        const loading = pyramid.load({ lod: 0, x: 0, y: 0 });
        expect(pyramid.delete({ lod: 0, x: 0, y: 0 })).toBe(true);
        resolve("late");
        expect((await loading)?.content).toBe("late");
        expect(loaded).toEqual([]);
        expect(pyramid.get({ lod: 0, x: 0, y: 0 })).toBeUndefined();
    });

    it("rejects an invalid maxLOD", () => {
        expect(() => new TilePyramid({ load: () => Promise.resolve(undefined), maxLOD: -1 })).toThrow(RangeError);
    });
});

describe("TilePyramid retention", () => {
    it("never evicts retained tiles, and evicts them like others once released", async () => {
        const evicted: string[] = [];
        const pyramid = new TilePyramid<string>({
            load: (address) => Promise.resolve(`${address.lod}/${address.x}/${address.y}`),
            maxLOD: 4,
            cacheEntries: 2,
            onEvict: (address) => evicted.push(`${address.lod}/${address.x}/${address.y}`),
        });
        // Deeper tiles retain the pyramid tile serving them.
        pyramid.retain({ lod: 6, x: 0, y: 0 });
        await pyramid.load({ lod: 4, x: 0, y: 0 });
        await pyramid.load({ lod: 4, x: 1, y: 0 });
        await pyramid.load({ lod: 4, x: 2, y: 0 });
        await pyramid.load({ lod: 4, x: 3, y: 0 });

        expect(pyramid.get({ lod: 4, x: 0, y: 0 })).toBe("4/0/0");
        expect(evicted).toEqual(["4/1/0", "4/2/0"]);

        // Released, the least recently used tile is evicted first once the cache overflows.
        pyramid.release({ lod: 6, x: 0, y: 0 });
        expect(pyramid.size).toBe(2);
        await pyramid.load({ lod: 4, x: 4, y: 0 });
        expect(evicted).toEqual(["4/1/0", "4/2/0", "4/0/0"]);
    });
});
