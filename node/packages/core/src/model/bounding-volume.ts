import type { RootProperty } from "./common";

export type Box = [number, number, number, number, number, number, number, number, number, number, number, number];

export type Region = [number, number, number, number, number, number];

export type Sphere = [number, number, number, number];

/** Exactly one of box, region or sphere is expected. */
export interface BoundingVolume extends RootProperty {
    box?: Box;
    region?: Region;
    sphere?: Sphere;
}
