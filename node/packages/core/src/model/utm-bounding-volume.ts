import type { IRootProperty } from "./common";

/** Name of the bounding volume extension that describes a tile extent in Universal Transverse Mercator coordinates. */
export const SPACEXR_BOUNDING_VOLUME_UTM = "SPACEXR_bounding_volume_utm";

export type UtmHemisphere = "N" | "S";

/**
 * Surface from which vertical values are measured.
 *
 * - `ELLIPSOID`: ellipsoidal height of the horizontal datum.
 * - `GEOID`: orthometric height or elevation, optionally identified by a vertical EPSG code.
 * - `GROUND`: local terrain surface, for example depth below a drill hole collar.
 * - `LOCAL`: application-defined vertical reference.
 */
export type VerticalReference = "ELLIPSOID" | "GEOID" | "GROUND" | "LOCAL";

/** Direction in which vertical values increase. `DOWN` expresses depths. */
export type VerticalDirection = "UP" | "DOWN";

/** Vertical extent in metres. */
export interface IVerticalExtent extends IRootProperty {
    reference: VerticalReference;
    direction: VerticalDirection;
    minimum: number;
    maximum: number;
    /**
     * Vertical coordinate reference system, for example 6647 for CGVD2013 heights.
     * With the `GROUND` reference it identifies the datum of `groundElevation`.
     */
    epsg?: number;
    /**
     * Elevation in metres, positive upward, of the ground surface from which `GROUND` values are measured,
     * for example the mean drill hole collar elevation. Only valid with the `GROUND` reference.
     * Without it, consumers cannot place the extent absolutely and must use conservative bounds.
     */
    groundElevation?: number;
}

/**
 * Tile extent in UTM metres.
 *
 * The coordinate reference system is identified by an EPSG code, by a zone and hemisphere, or by both when they agree.
 */
export interface IUtmBoundingVolume extends IRootProperty {
    /** Projected coordinate reference system, for example 26918 for NAD83 / UTM zone 18N. */
    epsg?: number;
    zone?: number;
    hemisphere?: UtmHemisphere;
    minEasting: number;
    minNorthing: number;
    maxEasting: number;
    maxNorthing: number;
    vertical: IVerticalExtent;
}
