import type { ICartesian3 } from "@spacexr/geodesy";
import type { IGeographic2 } from "../addressing/metrics";
const DEGREES = 180 / Math.PI;
/** Unit Cartesian direction from planetocentric angles in degrees. */
export function planetocentricDirection(latitudeDegrees: number, longitudeDegrees: number, target: ICartesian3 = { x: 0, y: 0, z: 0 }): ICartesian3 {
    const latitude = latitudeDegrees / DEGREES;
    const longitude = longitudeDegrees / DEGREES;
    const cosLatitude = Math.cos(latitude);
    target.x = cosLatitude * Math.cos(longitude);
    target.y = cosLatitude * Math.sin(longitude);
    target.z = Math.sin(latitude);
    return target;
}

/**
 * Planetocentric latitude and east-positive longitude of a direction, in degrees, longitudes in `(-180, 180]`. A
 * planetocentric latitude is not a geodetic one on a non-spherical body.
 *
 * @throws RangeError When the direction is zero or not finite.
 */
export function directionToPlanetocentric(direction: Readonly<ICartesian3>): IGeographic2 {
    const { x, y, z } = direction;
    const horizontal = Math.hypot(x, y);
    if (!(horizontal + Math.abs(z) > 0) || !Number.isFinite(horizontal + z)) throw new RangeError("A direction must be finite and non-zero.");
    const longitude = Math.atan2(y, x) * DEGREES;
    return { latitude: Math.atan2(z, horizontal) * DEGREES, longitude: longitude === -180 ? 180 : longitude };
}
