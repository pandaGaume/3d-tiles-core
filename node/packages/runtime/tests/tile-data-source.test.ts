import { describe, expect, it } from "vitest";

import { ImplicitTilesetDecorator, WebMapTileDataSource, WebMercatorTileMetrics } from "../src/implicit";

describe("tile data source metrics", () => {
    it("makes the source authoritative for LOD range, addressing and URLs", () => {
        const metrics = new WebMercatorTileMetrics({
            minLOD: 3,
            maxLOD: 12,
            tileSize: 256,
        });
        const dataSource = new WebMapTileDataSource({
            id: "terrain",
            metrics,
            rootAddress: { lod: 3, x: 4, y: 2 },
            urlTemplates: "https://terrain.test/{z}/{x}/{y}.png",
            minimumHeight: -500,
            maximumHeight: 9000,
        });
        const decorator = new ImplicitTilesetDecorator(dataSource, {
            subtreeLevels: 4,
        });

        expect(decorator.tileset.root.implicitTiling?.availableLevels).toBe(10);
        expect(dataSource.addressOf({ level: 9, x: 0, y: 0 })).toEqual({
            lod: 12,
            x: 2048,
            y: 1535,
        });
        expect(dataSource.resolve({ level: 9, x: 0, y: 0 }).contents[0]?.uri).toBe("https://terrain.test/12/2048/1535.png");
        expect(dataSource.resolve({ level: 0, x: 0, y: 0 }).geometricError).toBeCloseTo(metrics.groundResolution(0, 3));
        expect(dataSource.resolve({ level: 9, x: 0, y: 0 }).geometricError).toBeCloseTo(metrics.groundResolution(0, 12));
        expect(() => dataSource.addressOf({ level: 10, x: 0, y: 0 })).toThrow(/maxLOD 12/);
    });

    it("rejects an implicit root that disagrees with metrics.minLOD", () => {
        const metrics = new WebMercatorTileMetrics({ minLOD: 3, maxLOD: 12 });

        expect(
            () =>
                new WebMapTileDataSource({
                    metrics,
                    rootAddress: { lod: 4, x: 8, y: 4 },
                    urlTemplates: "https://terrain.test/{z}/{x}/{y}.png",
                }),
        ).toThrow(/metrics\.minLOD 3/);
    });
});
