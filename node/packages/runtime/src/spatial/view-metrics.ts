import type { IEcefCameraFrame, IVector3 } from "./ecef-types";
import type { IVerticalFrame } from "./vertical-scale";

/** Viewport height and field of view used when a camera frame does not give them. */
export interface IProjectionFallback {
    /** Viewport height in physical pixels. */
    viewportHeight: number;
    /** Vertical field of view in radians. */
    verticalFovRadians: number;
}

/**
 * Length on the ground covered by one pixel of the viewport, at a distance from the camera, along a direction facing it.
 * It is the factor of the screen-space error: a geometric error `e` at that distance spans `e / metresPerPixel` pixels.
 *
 * @param camera - Camera frame giving the viewport height and the vertical field of view.
 * @param distance - Distance from the camera, in metres.
 * @param fallback - Values used when the frame gives no viewport height or field of view.
 * @returns Metres per pixel, or `NaN` when the field of view is not in (0, PI).
 */
export function metresPerPixel(camera: Readonly<IEcefCameraFrame>, distance: number, fallback: Readonly<IProjectionFallback>): number {
    const viewportHeight = camera.viewportHeight > 0 ? camera.viewportHeight : fallback.viewportHeight;
    const tanHalfVerticalFov = camera.tanHalfVerticalFov ?? Math.tan((camera.verticalFovRadians ?? fallback.verticalFovRadians) / 2);
    if (!Number.isFinite(tanHalfVerticalFov) || tanHalfVerticalFov <= 0) return Number.NaN;
    return (2 * tanHalfVerticalFov * distance) / viewportHeight;
}

/** Inputs of {@link describeView} known to the renderer or the application rather than the camera frame. */
export interface IViewMetricsOptions {
    /** What a height means on the body: the frame of the terrain heights. */
    vertical: IVerticalFrame;
    /** Values used when the frame gives no viewport height or field of view. */
    fallback: Readonly<IProjectionFallback>;
    /**
     * Height of the drawn terrain below the camera, over the same surface, vertical scale included. Without it the altitude
     * over the ground is unknown and the view centre is sought on the reference surface.
     */
    groundHeight?: number;
    /**
     * Distance from the camera to the point at the centre of the view, when the renderer knows it, such as the radius of an
     * orbiting camera or a depth read. Otherwise the centre ray is intersected with the sphere through the ground below the
     * camera.
     */
    targetDistance?: number;
}

/** What a camera sees, for a scale and altitude display. Angles in degrees, lengths in metres. */
export interface IViewMetrics {
    /** Latitude of the camera, along the up direction of the vertical frame: geodetic or planetocentric. */
    latitude: number;
    /** East longitude of the camera, in (-180, 180]. */
    longitude: number;
    /** Height of the camera over the reference surface. */
    height: number;
    /** Height of the camera over the drawn terrain, when its height below the camera is known. */
    altitude?: number;
    /** Direction of the view from north, clockwise, in [0, 360). Undefined when the camera looks straight up or down. */
    heading?: number;
    /** Angle of the view over the horizon: 0 level, -90 straight down. Undefined without a forward direction. */
    pitch?: number;
    /** Distance from the camera to the point at the centre of the view. Undefined when the view misses the body. */
    targetDistance?: number;
    /** Ground length covered by one pixel at the centre of the view; the screen-space error factor there. */
    metresPerPixel?: number;
}

const DEGREES = 180 / Math.PI;

function dot(a: Readonly<IVector3>, b: Readonly<IVector3>): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalized(vector: Readonly<IVector3>): IVector3 | undefined {
    const length = Math.hypot(vector.x, vector.y, vector.z);
    return length > 0 ? { x: vector.x / length, y: vector.y / length, z: vector.z / length } : undefined;
}

/** Distance along a unit ray from `origin` to the near side of a sphere centred on the body, if the ray meets it. */
function raySphereDistance(origin: Readonly<IVector3>, direction: Readonly<IVector3>, radius: number): number | undefined {
    const b = dot(origin, direction);
    const c = dot(origin, origin) - radius * radius;
    const discriminant = b * b - c;
    if (discriminant < 0) return undefined;
    const root = Math.sqrt(discriminant);
    const near = -b - root;
    if (near >= 0) return near;
    const far = -b + root;
    return far >= 0 ? far : undefined;
}

/**
 * Position, orientation and scale of a camera over a body, from its renderer-neutral frame.
 *
 * North is the body axis, ECEF +Z, projected on the plane normal to the up direction of the vertical frame. The scale is
 * {@link metresPerPixel} at the distance of the view centre: the same factor the screen-space error divides by.
 */
export function describeView(camera: Readonly<IEcefCameraFrame>, options: Readonly<IViewMetricsOptions>): IViewMetrics {
    const position = camera.position;
    const up = options.vertical.up(position);
    const height = options.vertical.height(position);
    const metrics: IViewMetrics = {
        latitude: Math.asin(Math.max(-1, Math.min(1, up.z))) * DEGREES,
        longitude: Math.atan2(up.y, up.x) * DEGREES,
        height,
    };
    const ground = options.groundHeight;
    if (ground !== undefined && Number.isFinite(ground)) metrics.altitude = height - ground;

    const forward = camera.forward && normalized(camera.forward);
    if (!forward) return metrics;
    const vertical = dot(forward, up);
    metrics.pitch = Math.asin(Math.max(-1, Math.min(1, vertical))) * DEGREES;
    // At a pole, north is undefined: the heading is measured from the meridian of longitude 0.
    const north = normalized({ x: -up.z * up.x, y: -up.z * up.y, z: 1 - up.z * up.z }) ?? normalized({ x: -Math.sign(up.z), y: 0, z: 0 });
    const level = normalized({ x: forward.x - vertical * up.x, y: forward.y - vertical * up.y, z: forward.z - vertical * up.z });
    if (north && level) {
        const east = { x: north.y * up.z - north.z * up.y, y: north.z * up.x - north.x * up.z, z: north.x * up.y - north.y * up.x };
        const heading = Math.atan2(dot(level, east), dot(level, north)) * DEGREES;
        metrics.heading = heading < 0 ? heading + 360 : heading;
    }

    // The point of the ground below the camera, or of the reference surface without the ground height.
    const drop = metrics.altitude ?? height;
    const below = { x: position.x - drop * up.x, y: position.y - drop * up.y, z: position.z - drop * up.z };
    const distance = options.targetDistance ?? raySphereDistance(position, forward, Math.hypot(below.x, below.y, below.z));
    if (distance !== undefined && Number.isFinite(distance) && distance > 0) {
        metrics.targetDistance = distance;
        const perPixel = metresPerPixel(camera, distance, options.fallback);
        if (perPixel > 0) metrics.metresPerPixel = perPixel;
    }
    return metrics;
}
