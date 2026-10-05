[![CI (Node)](https://github.com/pandaGaume/3d-tiles-core/actions/workflows/ci-node.yml/badge.svg)](https://github.com/pandaGaume/3d-tiles-core/actions/workflows/ci-node.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

# @spacexr/3d-tiles-runtime

Renderer-neutral traversal and content lifecycle for OGC 3D Tiles.

The package owns explicit and implicit tileset traversal, sparse subtree availability, screen-space-error refinement, asynchronous content state, external tileset grafting and metadata resolution. Rendering-engine work is delegated to typed ports for camera events, spatial metrics, glTF or terrain content, glyphs and telemetry.

```ts
import { TileRuntime } from "@spacexr/3d-tiles-runtime";

const runtime = new TileRuntime({
    id: "mine",
    uri: "https://example.test/tileset.json",
    adapter,
    cache: {
        maxContentGpuBytes: 1024 * 1024 * 1024,
        maxSubtreeBytes: 64 * 1024 * 1024,
        unusedFrameRetention: 120,
    },
});

await runtime.start();

const stopStatistics = runtime.instrumentation.subscribe((statistics) => {
    console.log(statistics.contents.gpuBytes, statistics.pendingLoads);
});

runtime.instrumentation.setEnabled(false);
```

Standard JSON and binary subtrees are supported through `StandardImplicitSubtreeLoader`. For dense Web Map or DEM pyramids, `ITileDataSource` owns `ITileMetrics`, the root address, URL templates and source metadata. `ImplicitTilesetDecorator` exposes that source as standard implicit 3D Tiles and derives `availableLevels` from `metrics.minLOD` and `metrics.maxLOD`. `WebMapTileDataSource` and `WebMercatorTileMetrics` provide the XYZ or TMS implementation.

The runtime includes a bounded navigation cache for renderable handles, subtree payloads and materialized implicit branches. Content adapters report their CPU, GPU and network footprint in `ContentLoadResult.cost`. Cache evictions are visible through events and hooks. Real-time statistics can be subscribed to or disabled at runtime to remove collection and timer overhead.

## Pipeline API

New renderer integrations can replace the legacy combined content adapter with two focused ports:

- `ITileActivationAdapter` is notified when camera selection activates or deactivates a tile. Its readiness port returns each prepared resource to the runtime.
- `ITilePresentationAdapter` presents, hides and releases ready opaque renderer handles.

`Tile3D` stores selection, readiness, presentation and metadata states as numeric enums. Metadata is addressed with compact numeric handles, with `NO_METADATA = -1`. Applications push immutable camera frames and their frustum with `onCameraChanged`, then call `processFrame`.

The example `node/examples/babylon-implicit-geodesic-grid` proves the boundary without using the legacy content adapter. Babylon shares only normalized grid topology, then creates unique ECEF geometry for selected implicit tiles using their geographic regions and WGS84. The same boundary allows a later shader implementation to project instanced topology on the GPU.

## ECEF and geodetic systems

The built-in `EcefSpatialMetric` uses `@spacexr/geodesy` for ellipsoid and coordinate-system mathematics. WGS84 is the default, while another oblate body can be selected explicitly:

```ts
import { Ellipsoid, GeodeticSystem } from "@spacexr/geodesy";
import { EcefSpatialMetric } from "@spacexr/3d-tiles-runtime";

const mars = Ellipsoid.fromAxes("Mars", 3396190, 3376200);
const spatial = new EcefSpatialMetric({
    geodeticSystem: new GeodeticSystem(mars),
});
```

The geodesy package owns ellipsoids, geodetic to ECEF conversion and local ENU or NED frames. This runtime owns 3D Tiles transforms, bounding volumes, horizon and frustum culling, visibility, and screen-space error.

## UTM extents

`EcefSpatialMetric` places tiles whose bounding volume carries the `SPACEXR_bounding_volume_utm` extension. The UTM extent takes precedence over any standard fallback volume. It is inverted with the `@spacexr/geodesy` transverse Mercator projection on the ellipsoid of its datum, transformed to the metric geodetic system, then converted to ECEF.

Every approximation widens the bounds and is reported in `IEcefSpatialState.utmPlacement`:

- the datum transformation and its accuracy, by which the bounds are widened (`horizontalMargin`);
- the vertical origin, and whether orthometric heights used a geoid model or the `GEOID_UNDULATION_MARGIN` of 110 m (`verticalMargin`);
- the ellipsoidal height interval, including `UNKNOWN_GROUND_HEIGHT_RANGE` when the vertical origin is unknown;
- `unresolved-projection` or `unresolved-datum` when the extent cannot be placed. The standard volume is then used if present.

The default resolver targets WGS 84 with the published null transformations: NAD83 (EPSG:1188, 4 m), NAD83(CSRS) (2 m) and ETRS89 (EPSG:1149, 1 m). An extent without a recognized datum is not placed. Supply a resolver and a geoid model for precise placement:

```ts
const spatial = new EcefSpatialMetric({
    utm: {
        datumResolver: (projection) => myTransformations.get(projection.epsg),
        geoidUndulation: (latitude, longitude) => myGeoid.undulation(latitude, longitude),
    },
});
```

`boundsFromUtm` and `ellipsoidalHeightRange` expose the same computation to adapters, and implicit tiling subdivides UTM extents like regions.

See the repository document `docs/runtime-architecture.md` for lifecycle and metadata rules.
