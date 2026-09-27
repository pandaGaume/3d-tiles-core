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

See the repository document `docs/runtime-architecture.md` for lifecycle and metadata rules.
