import type { ITile } from "@spacexr/3d-tiles-core";
import { Ellipsoid, GeodeticSystem } from "@spacexr/geodesy";
import { describe, expect, it } from "vitest";

import { EcefSpatialMetric } from "../src";

describe("EcefSpatialMetric", () => {
    it("derives transformed bounds and transform-scaled geometric error", () => {
        const metric = new EcefSpatialMetric({ horizonCulling: false });
        const tile: ITile = {
            boundingVolume: { sphere: [1, 2, 3, 4] },
            geometricError: 5,
            transform: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 10, 20, 30, 1],
        };

        const spatial = metric.derive({ tile });

        expect(spatial.boundingSphere).toEqual({ center: { x: 12, y: 24, z: 36 }, radius: 8 });
        expect(spatial.boundingBox).toEqual({ min: { x: 4, y: 16, z: 28 }, max: { x: 20, y: 32, z: 44 } });
        expect(spatial.geometricError).toBe(10);
    });

    it("computes screen-space error and applies clip bounds", () => {
        const metric = new EcefSpatialMetric({ horizonCulling: false });
        const tile: ITile = { boundingVolume: { sphere: [0, 0, 0, 1] }, geometricError: 2 };
        const spatial = metric.derive({ tile });
        const camera = {
            position: { x: 11, y: 0, z: 0 },
            viewportHeight: 1000,
            tanHalfVerticalFov: 1,
            clipBounds: { min: { x: -2, y: -2, z: -2 }, max: { x: 2, y: 2, z: 2 } },
        };

        expect(metric.isVisible(spatial, camera)).toBe(true);
        expect(metric.screenSpaceError({ camera, spatial, tile, depth: 0 })).toBe(100);
        expect(
            metric.isVisible(spatial, {
                ...camera,
                clipBounds: { min: { x: 20, y: 20, z: 20 }, max: { x: 30, y: 30, z: 30 } },
            }),
        ).toBe(false);
    });

    it("derives region bounds with the injected geodetic system", () => {
        const mars = Ellipsoid.fromAxes("Mars", 3_396_190, 3_376_200);
        const system = new GeodeticSystem(mars);
        const metric = new EcefSpatialMetric({ geodeticSystem: system, horizonCulling: false });
        const tile: ITile = {
            boundingVolume: { region: [0, 0, 0, 0, 0, 0] },
            geometricError: 1,
        };

        const spatial = metric.derive({ tile });

        expect(metric.geodeticSystem).toBe(system);
        expect(spatial.boundingSphere).toEqual({
            center: { x: mars.semiMajorAxis, y: 0, z: 0 },
            radius: 0,
        });
    });
});
