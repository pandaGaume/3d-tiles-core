import type { GeodeticSystem } from "@spacexr/geodesy";

/** Mutable three-dimensional vector. ECEF values are expressed in metres. */
export interface IVector3 {
    /** X component. */
    x: number;
    /** Y component. */
    y: number;
    /** Z component. */
    z: number;
}

/** Plane equation `ax + by + cz + d = 0`. */
export interface IPlane {
    /** Plane-normal X component. */
    x: number;
    /** Plane-normal Y component. */
    y: number;
    /** Plane-normal Z component. */
    z: number;
    /** Signed plane offset. */
    w: number;
}

/** Axis-aligned ECEF bounding box. */
export interface IAxisAlignedBox {
    /** Minimum corner in ECEF metres. */
    min: IVector3;
    /** Maximum corner in ECEF metres. */
    max: IVector3;
}

/** Bounding sphere expressed in ECEF metres. */
export interface IBoundingSphere3 {
    /** Sphere centre. */
    center: IVector3;
    /** Sphere radius in metres. */
    radius: number;
}

/** Camera state consumed by {@link EcefSpatialMetric}. */
export interface IEcefCameraFrame {
    /** Optional application camera identifier. */
    id?: string;
    /** Camera position in ECEF metres. */
    position: IVector3;
    /** Viewport height in physical pixels. */
    viewportHeight: number;
    /** Vertical field of view in radians. */
    verticalFovRadians?: number;
    /** Precomputed tangent of half the vertical field of view. */
    tanHalfVerticalFov?: number;
    /** Optional normalized ECEF frustum planes. */
    frustumPlanes?: readonly IPlane[];
    /** Optional coarse ECEF clipping box. */
    clipBounds?: IAxisAlignedBox;
    /** Optional source timestamp in milliseconds. */
    timestamp?: number;
}

/** Derived renderer-neutral spatial state for one runtime tile. */
export interface IEcefSpatialState {
    /** Column-major local-to-ECEF transform. */
    worldTransform: Float64Array;
    /** Optional enclosing ECEF sphere. */
    boundingSphere?: IBoundingSphere3;
    /** Optional enclosing ECEF axis-aligned box. */
    boundingBox?: IAxisAlignedBox;
    /** World-space geometric error in metres. */
    geometricError: number;
}

/** Configuration for the renderer-neutral ECEF spatial metric. */
export interface IEcefSpatialMetricOptions {
    /** Geodetic reference system used by region volumes and horizon culling. Defaults to WGS84. */
    geodeticSystem?: GeodeticSystem;
    /** Enables conservative ellipsoid horizon culling. Defaults to `true`. */
    horizonCulling?: boolean;
    /** Viewport height fallback in pixels. Defaults to 1080. */
    defaultViewportHeight?: number;
    /** Vertical field-of-view fallback in radians. Defaults to 60 degrees. */
    defaultVerticalFovRadians?: number;
}
