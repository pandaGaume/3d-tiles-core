import type { ITile } from "@spacexr/3d-tiles-core";

export interface ISpatialDerivationContext<TSpatial> {
    tile: ITile;
    parent?: TSpatial;
    /** Lowest and highest heights of the terrain of the tile over the reference surface, in metres, vertical scale applied, when known. */
    heightRange?: readonly [number, number];
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
    /** Whether the tile is in the view of the camera. */
    isVisible(spatial: TSpatial, camera: TCamera): boolean;
    /** Whether the tile, outside the view, is close enough to it to stay active. Without this method, no tile is. */
    isInPeriphery?(spatial: TSpatial, camera: TCamera): boolean;
    screenSpaceError(context: IScreenSpaceErrorContext<TCamera, TSpatial>): number;
}
