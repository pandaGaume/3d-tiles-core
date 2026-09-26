import type { ITile } from "@spacexr/3d-tiles-core";

export interface ISpatialDerivationContext<TSpatial> {
    tile: ITile;
    parent?: TSpatial;
}

export interface IScreenSpaceErrorContext<TCamera, TSpatial> {
    camera: TCamera;
    spatial: TSpatial;
    tile: ITile;
    depth: number;
}

/**
 * Owns coordinate systems, placement, visibility and distance metrics. The
 * traversal never assumes Babylon, Three.js, ECEF or a particular unit.
 */
export interface ISpatialMetric<TCamera, TSpatial> {
    derive(context: ISpatialDerivationContext<TSpatial>): TSpatial;
    isVisible(spatial: TSpatial, camera: TCamera): boolean;
    screenSpaceError(context: IScreenSpaceErrorContext<TCamera, TSpatial>): number;
}
