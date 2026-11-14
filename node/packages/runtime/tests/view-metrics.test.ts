import { GeodeticSystem } from "@spacexr/geodesy";
import { ReferenceSurface } from "@spacexr/tiles";
import { describe, expect, it } from "vitest";

import {
    EcefSpatialMetric,
    describeView,
    geodeticVerticalFrame,
    metresPerPixel,
    radialVerticalFrame,
    type IEcefCameraFrame,
    type IVector3,
} from "../src";

const R = 3396190;
const radial = radialVerticalFrame(ReferenceSurface.sphere(R));
const fallback = { viewportHeight: 1080, verticalFovRadians: Math.PI / 3 };
const FOV = Math.PI / 2;

function unit(x: number, y: number, z: number): IVector3 {
    const length = Math.hypot(x, y, z);
    return { x: x / length, y: y / length, z: z / length };
}

/** A camera at a height over the point of latitude 0 and longitude 90 E, looking along `forward`. */
function cameraAbove(height: number, forward?: IVector3): IEcefCameraFrame {
    return { position: { x: 0, y: R + height, z: 0 }, viewportHeight: 1000, verticalFovRadians: FOV, ...(forward ? { forward } : {}) };
}

describe("metresPerPixel", () => {
    it("is the ground length of one pixel: 2 d tan(fov / 2) / viewport height", () => {
        expect(metresPerPixel(cameraAbove(0), 500, fallback)).toBeCloseTo(1, 12);
    });

    it("uses the fallback without a viewport height or field of view", () => {
        const camera = { position: { x: 0, y: 0, z: 0 }, viewportHeight: 0 };
        expect(metresPerPixel(camera, 1080, fallback)).toBeCloseTo(2 * Math.tan(Math.PI / 6), 12);
    });

    it("is NaN for a field of view outside (0, PI)", () => {
        expect(metresPerPixel({ ...cameraAbove(0), verticalFovRadians: 0 }, 10, fallback)).toBeNaN();
    });

    it("is the factor of the screen-space error", () => {
        const metric = new EcefSpatialMetric();
        const camera = cameraAbove(0);
        const spatial = {
            worldTransform: new Float64Array(16),
            geometricError: 32,
            boundingSphere: { center: { x: 0, y: 0, z: 0 }, radius: R - 2000 },
        };
        const sse = metric.screenSpaceError({ camera, spatial } as never);
        expect(sse).toBeCloseTo(32 / metresPerPixel(camera, 2000, metric.projectionFallback), 9);
        expect(sse).toBeCloseTo(8, 9);
    });
});

describe("describeView", () => {
    it("gives the position, the height over the reference and the altitude over the ground", () => {
        const view = describeView(cameraAbove(5000), { vertical: radial, fallback, groundHeight: 1200 });
        expect(view.latitude).toBeCloseTo(0, 9);
        expect(view.longitude).toBeCloseTo(90, 9);
        expect(view.height).toBeCloseTo(5000, 6);
        expect(view.altitude).toBeCloseTo(3800, 6);
        expect(view.heading).toBeUndefined();
    });

    it("has no altitude without the ground height", () => {
        expect(describeView(cameraAbove(5000), { vertical: radial, fallback }).altitude).toBeUndefined();
    });

    it("looking straight down: pitch -90, no heading, the scale at the ground below", () => {
        const view = describeView(cameraAbove(5000, { x: 0, y: -1, z: 0 }), { vertical: radial, fallback, groundHeight: 1000 });
        expect(view.pitch).toBeCloseTo(-90, 9);
        expect(view.heading).toBeUndefined();
        expect(view.targetDistance).toBeCloseTo(4000, 6);
        expect(view.metresPerPixel).toBeCloseTo(8, 9);
    });

    it("measures the heading clockwise from north: north 0, east 90, south 180, west 270", () => {
        // At longitude 90 E, north is +Z and east is -X.
        const cases: [IVector3, number][] = [
            [unit(0, -1, 1), 0],
            [unit(-1, -1, 0), 90],
            [unit(0, -1, -1), 180],
            [unit(1, -1, 0), 270],
        ];
        for (const [forward, heading] of cases) {
            const view = describeView(cameraAbove(5000, forward), { vertical: radial, fallback });
            expect(view.heading).toBeCloseTo(heading, 9);
            expect(view.pitch).toBeCloseTo(-45, 9);
        }
    });

    it("prefers the target distance the renderer gives", () => {
        const view = describeView(cameraAbove(5000, { x: 0, y: -1, z: 0 }), { vertical: radial, fallback, targetDistance: 250 });
        expect(view.targetDistance).toBe(250);
        expect(view.metresPerPixel).toBeCloseTo(0.5, 9);
    });

    it("has no scale when the view misses the body", () => {
        const view = describeView(cameraAbove(5000, { x: 0, y: 1, z: 0 }), { vertical: radial, fallback });
        expect(view.pitch).toBeCloseTo(90, 9);
        expect(view.targetDistance).toBeUndefined();
        expect(view.metresPerPixel).toBeUndefined();
    });

    it("gives geodetic latitude and ellipsoidal height on an ellipsoid", () => {
        const system = GeodeticSystem.WGS84;
        const position = system.geodeticDegreesToEcef(45.8326, 6.8652, 4808 + 2000);
        const view = describeView(
            { position, viewportHeight: 1000, verticalFovRadians: FOV },
            { vertical: geodeticVerticalFrame(system), fallback, groundHeight: 4808 },
        );
        expect(view.latitude).toBeCloseTo(45.8326, 9);
        expect(view.longitude).toBeCloseTo(6.8652, 9);
        expect(view.height).toBeCloseTo(6808, 4);
        expect(view.altitude).toBeCloseTo(2000, 4);
    });
});
