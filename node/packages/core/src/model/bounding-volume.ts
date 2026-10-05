import type { IRootProperty } from "./common";

export type Box = [number, number, number, number, number, number, number, number, number, number, number, number];

export type Region = [number, number, number, number, number, number];

export type Sphere = [number, number, number, number];

/**
 * At most one of box, region or sphere is expected. A recognized bounding volume extension such as
 * `SPACEXR_bounding_volume_utm` may replace them when it is listed in `extensionsRequired`.
 */
export interface IBoundingVolume extends IRootProperty {
    box?: Box;
    region?: Region;
    sphere?: Sphere;
}
