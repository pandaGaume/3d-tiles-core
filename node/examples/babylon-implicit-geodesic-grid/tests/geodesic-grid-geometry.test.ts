import { describe, expect, it } from "vitest";

import {
    createGridTopology,
    projectGridTopologyToEllipsoid,
} from "../src/geodesic-grid-geometry";
import { createGeodesicGridSource, TILE_METRICS } from "../src/grid-source";

function distance(
    positions: readonly number[],
    firstVertex: number,
    secondVertex: number,
): number {
    const first = firstVertex * 3;
    const second = secondVertex * 3;
    return Math.hypot(
        positions[first]! - positions[second]!,
        positions[first + 1]! - positions[second + 1]!,
        positions[first + 2]! - positions[second + 2]!,
    );
}

describe("geodesic grid geometry", () => {
    function sourceAt(x: number, y: number) {
        const source = createGeodesicGridSource();
        const dataSource = source.dataSources.find(
            (candidate) =>
                candidate.rootAddress.x === x && candidate.rootAddress.y === y,
        );
        if (!dataSource) throw new Error(`Missing root source ${x}/${y}.`);
        return { source, dataSource };
    }

    it("derives the implicit range and addresses from source metrics", () => {
        const { source, dataSource } = sourceAt(4, 2);

        expect(source.metrics).toBe(TILE_METRICS);
        expect(dataSource.metrics).toBe(TILE_METRICS);
        expect(dataSource.metrics.minLOD).toBe(3);
        expect(dataSource.metrics.maxLOD).toBe(12);
        expect(
            source.tileset.root.children?.[20]?.implicitTiling?.availableLevels,
        ).toBe(10);
        expect(dataSource.addressOf({ level: 0, x: 0, y: 0 })).toEqual({
            lod: 3,
            x: 4,
            y: 2,
        });
        expect(dataSource.addressOf({ level: 1, x: 0, y: 0 })).toEqual({
            lod: 4,
            x: 8,
            y: 5,
        });
        expect(dataSource.addressOf({ level: 1, x: 1, y: 1 })).toEqual({
            lod: 4,
            x: 9,
            y: 4,
        });
        expect(() => dataSource.addressOf({ level: 10, x: 0, y: 0 })).toThrow(
            /maxLOD 12/,
        );
    });

    it("covers the complete WebMercator domain with independent LOD 3 roots", () => {
        const source = createGeodesicGridSource();
        const rootKeys = new Set(
            source.dataSources.map(
                ({ rootAddress }) => `${rootAddress.x}/${rootAddress.y}`,
            ),
        );
        const region = source.tileset.root.boundingVolume.region;

        expect(source.dataSources).toHaveLength(64);
        expect(source.tileset.root.children).toHaveLength(64);
        expect(rootKeys.size).toBe(64);
        expect(rootKeys.has("0/0")).toBe(true);
        expect(rootKeys.has("7/7")).toBe(true);
        expect(region?.[0]).toBeCloseTo(-Math.PI);
        expect(region?.[2]).toBeCloseTo(Math.PI);
        expect(region?.[1]).toBeCloseTo(
            (-TILE_METRICS.maxLatitude * Math.PI) / 180,
        );
        expect(region?.[3]).toBeCloseTo(
            (TILE_METRICS.maxLatitude * Math.PI) / 180,
        );
        expect(
            source.tileset.root.children?.every(
                (child) => child.implicitTiling?.availableLevels === 10,
            ),
        ).toBe(true);
    });

    it("maps implicit X to longitude and implicit Y to latitude without an axis rotation", () => {
        const { dataSource } = sourceAt(4, 2);
        const root = dataSource.resolve({ level: 0, x: 0, y: 0 }).boundingVolume
            .region!;
        const southWest = dataSource.resolve({ level: 1, x: 0, y: 0 })
            .boundingVolume.region!;
        const southEast = dataSource.resolve({ level: 1, x: 1, y: 0 })
            .boundingVolume.region!;
        const northWest = dataSource.resolve({ level: 1, x: 0, y: 1 })
            .boundingVolume.region!;

        expect(southWest[0]).toBeCloseTo(root[0]);
        expect(southEast[0]).toBeCloseTo(southWest[2]);
        expect(southWest[1]).toBeCloseTo(root[1]);
        expect(northWest[1]).toBeCloseTo(southWest[3]);
        expect(northWest[0]).toBeCloseTo(southWest[0]);
        expect(northWest[2]).toBeCloseTo(southWest[2]);
    });

    it("shares normalized topology without carrying Cartesian geometry", () => {
        const topology = createGridTopology(2);

        expect(topology.coordinates).toHaveLength(18);
        expect(topology.uvs).toHaveLength(18);
        expect(topology.indices).toHaveLength(24);
        expect([...topology.coordinates.slice(0, 6)]).toEqual([
            0, 0, 0.5, 0, 1, 0,
        ]);
    });

    it("projects unique ellipsoid geometry and preserves shared topology", () => {
        const topology = createGridTopology(2);
        const geometry = projectGridTopologyToEllipsoid(
            topology,
            [0, 0, 0.1, 0.1, 0, 500],
        );

        expect(geometry.positions).toHaveLength(27);
        expect(geometry.indices).toBe(topology.indices);
        expect(geometry.uvs).toBe(topology.uvs);
    });

    it("accounts for east-west pinching at high latitude", () => {
        const topology = createGridTopology(1);
        const longitudeSpan = 0.05;
        const latitudeSpan = 0.01;
        const equatorial = projectGridTopologyToEllipsoid(topology, [
            0,
            -latitudeSpan,
            longitudeSpan,
            0,
            0,
            0,
        ]);
        const highLatitude = projectGridTopologyToEllipsoid(topology, [
            0,
            Math.PI / 3 - latitudeSpan,
            longitudeSpan,
            Math.PI / 3,
            0,
            0,
        ]);

        expect(distance(highLatitude.positions, 0, 1)).toBeLessThan(
            distance(equatorial.positions, 0, 1) * 0.6,
        );
    });
});
