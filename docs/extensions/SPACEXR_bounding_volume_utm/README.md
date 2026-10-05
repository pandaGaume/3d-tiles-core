# SPACEXR_bounding_volume_utm

## Status

Draft, vendor extension. Implemented by `@spacexr/3d-tiles-core` (wire model, codec, validation) and `@spacexr/3d-tiles-runtime` (spatial placement).

## Dependencies

Written against 3D Tiles 1.1.

## Overview

This extension describes the extent of a tile in Universal Transverse Mercator (UTM) coordinates, together with an explicit vertical extent. It targets subsurface and mining data, such as drill holes, whose source coordinates are projected easting, northing and elevation or depth.

The extension object is placed in `boundingVolume.extensions`, like `3DTILES_bounding_volume_S2`. It may appear on `tile.boundingVolume`, `tile.viewerRequestVolume` and `content.boundingVolume`.

```json
{
  "asset": { "version": "1.1" },
  "geometricError": 0,
  "root": {
    "boundingVolume": {
      "extensions": {
        "SPACEXR_bounding_volume_utm": {
          "epsg": 26918,
          "minEasting": 438510.189,
          "minNorthing": 5830109.72,
          "maxEasting": 438900.189,
          "maxNorthing": 5830499.72,
          "vertical": {
            "reference": "GROUND",
            "direction": "DOWN",
            "minimum": 0,
            "maximum": 195,
            "groundElevation": 254.085,
            "epsg": 6647
          }
        }
      }
    },
    "geometricError": 0,
    "refine": "REPLACE"
  },
  "extensionsUsed": ["SPACEXR_bounding_volume_utm"],
  "extensionsRequired": ["SPACEXR_bounding_volume_utm"]
}
```

## Declaration rules

- The extension must be listed in `extensionsUsed`.
- When a bounding volume has no `box`, `region` or `sphere`, the extension replaces them and must also be listed in `extensionsRequired`.
- A bounding volume may carry both a standard volume and the extension. Clients that support the extension use the UTM extent; the standard volume is a fallback for other clients.
- A UTM extent is absolute. Like `region`, it is not affected by tile transforms.

## Horizontal extent

| Property      | Type             | Description                                                   |
| ------------- | ---------------- | ------------------------------------------------------------- |
| `epsg`        | positive integer | Projected coordinate reference system. Recommended.           |
| `zone`        | integer 1 to 60  | UTM zone. Required with `hemisphere` when `epsg` is unknown.   |
| `hemisphere`  | `"N"` or `"S"`   | UTM hemisphere. Stated together with `zone`.                  |
| `minEasting`  | number, metres   | Western limit.                                                |
| `minNorthing` | number, metres   | Southern limit.                                               |
| `maxEasting`  | number, metres   | Eastern limit.                                                |
| `maxNorthing` | number, metres   | Northern limit.                                               |

Recognized EPSG codes, from which the zone and hemisphere are derived:

| Datum       | Codes                                    | Ellipsoid |
| ----------- | ---------------------------------------- | --------- |
| WGS 84      | 32601 to 32660 (N), 32701 to 32760 (S)   | WGS84     |
| NAD83       | 26901 to 26923 (N)                       | GRS80     |
| NAD83(CSRS) | 3154 to 3160, 2955 to 2962, 3761 (N)     | GRS80     |
| ETRS89      | 25828 to 25838 (N)                       | GRS80     |

Any other code is accepted when `zone` and `hemisphere` are present. When both an EPSG code and a zone are given for a recognized code, they must agree. Without an EPSG code the horizontal datum is unknown and validators emit a warning.

## Vertical extent

| Property          | Type                                          | Description                                                           |
| ----------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| `reference`       | `ELLIPSOID`, `GEOID`, `GROUND` or `LOCAL`     | Surface from which values are measured.                               |
| `direction`       | `UP` or `DOWN`                                | Direction in which values increase. `DOWN` expresses depths.          |
| `minimum`         | number, metres                                | Smallest value along `direction`.                                     |
| `maximum`         | number, metres                                | Largest value along `direction`.                                      |
| `epsg`            | positive integer, optional                    | Vertical CRS, for example 6647 (CGVD2013) or 5713 (CGVD28).           |
| `groundElevation` | number, metres, optional, `GROUND` only       | Elevation of the reference ground surface, positive upward, in `epsg`. |

`GROUND` with `direction: "DOWN"` describes depths below the ground surface. `groundElevation` anchors that surface, for example to the mean collar elevation of the drill holes in the tile. Without it, the extent cannot be placed absolutely.

## Validation codes

Errors: `INVALID_UTM_BOUNDING_VOLUME`, `UTM_REFERENCE_MISSING`, `INVALID_UTM_EPSG`, `INVALID_UTM_ZONE`, `INVALID_UTM_HEMISPHERE`, `INCOMPLETE_UTM_ZONE`, `UTM_EPSG_ZONE_MISMATCH`, `UTM_ZONE_REQUIRED`, `INVALID_UTM_COORDINATE`, `INVALID_UTM_EXTENT_ORDER`, `INVALID_VERTICAL_EXTENT`, `INVALID_VERTICAL_REFERENCE`, `INVALID_VERTICAL_DIRECTION`, `INVALID_VERTICAL_BOUND`, `INVALID_VERTICAL_ORDER`, `INVALID_VERTICAL_EPSG`, `INVALID_GROUND_ELEVATION`, `GROUND_ELEVATION_REFERENCE_MISMATCH`, `EXTENSION_NOT_DECLARED`, `BOUNDING_VOLUME_EXTENSION_NOT_REQUIRED`.

Warnings: `UTM_EPSG_MISSING`, `UTM_EASTING_OUT_OF_RANGE`, `UTM_NORTHING_OUT_OF_RANGE`, `GROUND_ELEVATION_MISSING`.

The positive and negative cases are in [`conformance/SPACEXR_bounding_volume_utm`](../../../conformance/SPACEXR_bounding_volume_utm/manifest.json). Every implementation must report exactly the listed codes.

## Spatial placement

Runtimes derive ECEF bounds as follows. No approximation is silent: each one widens the bounds so that the true position stays inside them, and each one is reported with the derived bounds.

1. **Projection.** Resolve the zone, hemisphere and datum. Invert the UTM grid on the ellipsoid of the datum: WGS84 for WGS 84, GRS80 for NAD83, NAD83(CSRS) and ETRS89. If the zone cannot be resolved, the extent is not placed (`unresolved-projection`).
2. **Horizontal datum.** Transform geodetic coordinates from the source datum to the runtime geodetic system, then widen the bounds by the accuracy of the transformation. If no transformation is known, the extent is not placed (`unresolved-datum`). Applications may supply their own transformations.
3. **Vertical datum.** Convert the vertical extent to ellipsoidal heights:
    - `ELLIPSOID`: used directly.
    - `GEOID`, and `GROUND` anchored by `groundElevation`: orthometric heights. With a geoid model supplied by the application, the undulation of each sample is added. Without a model, the interval is widened by 110 m, which covers the EGM2008 undulation range of about -106 m to +86 m.
    - `GROUND` without `groundElevation`, and `LOCAL`: the vertical origin is unknown. The terrain surface is assumed to lie between -500 m and +9000 m ellipsoidal height, which encloses every land surface from the Dead Sea shore to Mount Everest.
4. **Sampling.** Sample a 3 x 3 grid of the horizontal extent at both heights, convert the samples to ECEF and take their bounding box and sphere.

When an extent is not placed and the bounding volume also carries a standard volume, runtimes use the standard volume. Otherwise the tile has no bounds and is never culled.

### Default datum transformations to WGS 84

Exact transformations between WGS 84, NAD83, NAD83(CSRS) and ETRS89 are time dependent. They require the coordinate epoch of the data and a 14-parameter Helmert transformation through ITRF, and this extension does not carry a coordinate epoch. The defaults therefore use the published null transformations and absorb their full error in the bounds:

| Source datum | Transformation                            | Accuracy |
| ------------ | ----------------------------------------- | -------- |
| WGS 84       | identity                                  | 0 m      |
| NAD83        | EPSG:1188 NAD83 to WGS 84 (1), null       | 4 m      |
| NAD83(CSRS)  | null, ITRF offset not modelled            | 2 m      |
| ETRS89       | EPSG:1149 ETRS89 to WGS 84 (1), null      | 1 m      |
| other        | none, the extent is not placed            |          |

Precise placement requires an application-supplied transformation, for example backed by PROJ, together with the coordinate epoch of the survey.

For implicit tiling, the horizontal extent is split like a `region`. For `OCTREE`, the `z` coordinate grows upward, so a `DOWN` extent is split from its maximum depth.

## Schema

- [boundingVolume.SPACEXR_bounding_volume_utm.schema.json](boundingVolume.SPACEXR_bounding_volume_utm.schema.json)
