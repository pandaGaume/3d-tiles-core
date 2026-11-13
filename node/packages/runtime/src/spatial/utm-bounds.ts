import { resolveUtmProjection, type IUtmBoundingVolume, type IUtmProjection, type IVerticalExtent } from "@spacexr/3d-tiles-core";
import { UtmProjection, type GeodeticSystem } from "@spacexr/geodesy";

import { boundsFromPoints, type EcefBounds } from "./bounding-volumes";
import type { IVector3 } from "./ecef-types";
import type { IHorizontalDatumTransformation, IUtmPlacement, IUtmPlacementOptions, UtmVerticalOrigin } from "./utm-types";

/** Horizontal sample count per axis. */
const SAMPLES_PER_AXIS = 3;

/** No datum transformation is assumed without an application policy. */
export function defaultHorizontalDatumResolver(_projection: IUtmProjection): IHorizontalDatumTransformation | undefined {
    return undefined;
}

function explicitGeoidMargin(options: IUtmPlacementOptions): number {
    const margin = options.geoidUndulationMargin;
    if (margin === undefined || !Number.isFinite(margin) || margin < 0)
        throw new RangeError("An explicit nonnegative geoid margin or geoid model is required.");
    return margin;
}

interface IVerticalModel {
    origin: UtmVerticalOrigin;
    /** Height interval in metres, ellipsoidal or orthometric depending on `orthometric`. */
    range: [number, number];
    orthometric: boolean;
}

/** Converts signed vertical values to an interval measured upward from the vertical origin. */
function upwardInterval(vertical: IVerticalExtent): [number, number] {
    return vertical.direction === "DOWN" ? [-vertical.maximum, -vertical.minimum] : [vertical.minimum, vertical.maximum];
}

function verticalModel(vertical: IVerticalExtent, options: IUtmPlacementOptions): IVerticalModel {
    const [lower, upper] = upwardInterval(vertical);
    switch (vertical.reference) {
        case "ELLIPSOID":
            return { origin: "ellipsoid", range: [lower, upper], orthometric: false };
        case "GEOID":
            return { origin: "geoid", range: [lower, upper], orthometric: true };
        case "GROUND":
            if (vertical.groundElevation !== undefined) {
                return {
                    origin: "ground-elevation",
                    range: [vertical.groundElevation + lower, vertical.groundElevation + upper],
                    orthometric: true,
                };
            }
            break;
    }
    return {
        origin: "assumed-terrain",
        range: (() => {
            const range = options.unknownGroundHeightRange;
            if (!range || !range.every(Number.isFinite) || range[0] > range[1])
                throw new RangeError("An explicit valid terrain height envelope is required.");
            return [range[0] + lower, range[1] + upper];
        })(),
        orthometric: false,
    };
}

/**
 * Derives the ellipsoidal height interval of a vertical extent without a geoid model.
 *
 * Orthometric and ground-anchored values use the caller-supplied margin. Ground values
 * without `groundElevation` and `LOCAL` values require an explicit height envelope.
 *
 * @param vertical - Vertical extent of a UTM bounding volume.
 * @returns Minimum and maximum ellipsoidal heights in metres.
 */
export function ellipsoidalHeightRange(vertical: IVerticalExtent, options: IUtmPlacementOptions): [number, number] {
    const model = verticalModel(vertical, options);
    return model.orthometric ? [model.range[0] - explicitGeoidMargin(options), model.range[1] + explicitGeoidMargin(options)] : model.range;
}

/** ECEF bounds of a UTM extent together with the report of how they were derived. */
export interface IUtmBounds extends EcefBounds {
    placement: IUtmPlacement;
}

function widen(bounds: EcefBounds, margin: number): EcefBounds {
    if (margin <= 0 || !bounds.boundingBox || !bounds.boundingSphere) return bounds;
    const { min, max } = bounds.boundingBox;
    return {
        boundingBox: {
            min: { x: min.x - margin, y: min.y - margin, z: min.z - margin },
            max: { x: max.x + margin, y: max.y + margin, z: max.z + margin },
        },
        boundingSphere: { center: bounds.boundingSphere.center, radius: bounds.boundingSphere.radius + margin },
    };
}

/**
 * Derives ECEF bounds from a `SPACEXR_bounding_volume_utm` extent.
 *
 * 1. The zone, hemisphere and datum are resolved from the EPSG code or the explicit zone.
 * 2. The UTM grid is inverted on the ellipsoid of the datum.
 * 3. The datum transformation is applied, and the bounds are widened by its accuracy.
 * 4. Heights are converted to ellipsoidal heights with the geoid model, or widened by a geoid margin.
 * 5. A 3 x 3 grid of the extent at both heights is converted to ECEF with `system`.
 *
 * Every step is reported in `placement`. When the projection or the datum cannot be resolved, no bounds are derived.
 *
 * @param extent - UTM extent.
 * @param system - Geodetic system of the ECEF frame.
 * @param options - Datum resolver and geoid model.
 * @returns ECEF bounds and the placement report.
 */
export function boundsFromUtm(extent: IUtmBoundingVolume, system: GeodeticSystem, options: IUtmPlacementOptions = {}): IUtmBounds {
    const projection = resolveUtmProjection(extent);
    if (!projection) return { placement: { status: "unresolved-projection", horizontalMargin: 0, verticalMargin: 0 } };

    const datumTransformation = (options.datumResolver ?? defaultHorizontalDatumResolver)(projection);
    if (!datumTransformation) return { placement: { status: "unresolved-datum", projection, horizontalMargin: 0, verticalMargin: 0 } };

    const vertical = verticalModel(extent.vertical, options);
    const geoid = vertical.orthometric ? (options.geoidUndulation ? "model" : "margin") : undefined;
    const verticalMargin = geoid === "margin" ? explicitGeoidMargin(options) : 0;
    const minimumHeight = vertical.range[0] - verticalMargin;
    const maximumHeight = vertical.range[1] + verticalMargin;

    const ellipsoid = datumTransformation.sourceEllipsoid ?? system.ellipsoid;
    const utm = new UtmProjection(projection.zone, projection.hemisphere, ellipsoid);
    const points: IVector3[] = [];
    const geodetic = { latitude: 0, longitude: 0, height: 0 };
    for (let i = 0; i < SAMPLES_PER_AXIS; i++) {
        const easting = extent.minEasting + ((extent.maxEasting - extent.minEasting) * i) / (SAMPLES_PER_AXIS - 1);
        for (let j = 0; j < SAMPLES_PER_AXIS; j++) {
            const northing = extent.minNorthing + ((extent.maxNorthing - extent.minNorthing) * j) / (SAMPLES_PER_AXIS - 1);
            utm.projectedToGeodeticRadians(easting, northing, 0, geodetic);
            datumTransformation.transform?.(geodetic);
            const undulation = geoid === "model" ? options.geoidUndulation!(geodetic.latitude, geodetic.longitude) : 0;
            points.push(system.geodeticRadiansToEcef(geodetic.latitude, geodetic.longitude, minimumHeight + undulation));
            points.push(system.geodeticRadiansToEcef(geodetic.latitude, geodetic.longitude, maximumHeight + undulation));
        }
    }

    const placement: IUtmPlacement = {
        status: "placed",
        projection,
        datumTransformation: { name: datumTransformation.name, accuracy: datumTransformation.accuracy },
        horizontalMargin: datumTransformation.accuracy,
        verticalOrigin: vertical.origin,
        verticalMargin,
        heightRange: [minimumHeight, maximumHeight],
    };
    if (geoid) placement.geoid = geoid;
    return { ...widen(boundsFromPoints(points), datumTransformation.accuracy), placement };
}
