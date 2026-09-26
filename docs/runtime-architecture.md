# Runtime architecture

## Purpose

`@spacexr/3d-tiles-runtime` extracts the reusable visualization logic from SpaceXR without retaining a dependency on Babylon, a browser scene, a proprietary event system or SpaceXR streaming classes.

The runtime owns the algorithm. The adaptation layer owns host integration.

## Responsibility split

| Responsibility | Runtime | Adaptation layer |
| --- | --- | --- |
| Tileset tree and runtime state | Yes | No |
| SSE traversal and ADD or REPLACE refinement | Yes | No |
| Hole-free REPLACE transition | Yes | No |
| Concurrent loading and retries | Yes | No |
| LRU navigation cache and memory budgets | Yes | Reports CPU, GPU and network costs |
| External tileset grafting | Yes | Decodes or identifies the external tileset |
| Implicit QUADTREE and OCTREE traversal | Yes | Loads subtree resources through `IImplicitSubtreeLoader` |
| Standard JSON and binary `.subtree` resources | Yes | Supplies bytes through `IByteResourceLoader` |
| XYZ or TMS Web Map and DEM pyramids | Yes | Selects the URL template and decodes tile payloads |
| URI identity and relative resolution | Yes, through `IRuntimeUriResolver` | May override resolution |
| glTF decoding | No | `ITileContentAdapter.load` |
| Scene attachment and placement | No | `ITileContentAdapter.attach` |
| Scene removal and disposal | No | `ITileContentAdapter.detach` and `dispose` |
| Camera events | No | `ICameraEventSource` |
| Visibility, placement and SSE metric | No | `ISpatialMetric` |
| Labels, anchors and glyphs | No | `IGlyphPublisher` |
| Real-time statistics and metric aggregation | Yes | May forward metrics through `IRuntimeTelemetry` |
| Monitoring backend | No | `IRuntimeTelemetry` |

The provided `EcefSpatialMetric` is a default implementation for raw ECEF coordinates. It delegates ellipsoid, geodetic conversion and local tangent frame mathematics to `@spacexr/geodesy`. The runtime retains 3D Tiles transform composition, bounding volume derivation, horizon and frustum culling, visibility, and screen-space error. A caller can inject a `GeodeticSystem` for WGS84 or another oblate body. An adapter may replace the complete metric when a scene uses a local origin, a floating origin, another reference frame or another unit.

## Content lifecycle

The content adapter returns one of three outcomes:

1. `renderable`, with an opaque host handle such as a Babylon `AssetContainer` or Three.js `Object3D`;
2. `external-tileset`, with a decoded `ITileset` that the runtime grafts into the tree;
3. `empty`, for valid content that produces no renderable resource.

The runtime does not infer content type from a filename extension. This preserves compatibility with extensionless 3D Tiles content URLs and signed endpoints.

For REPLACE refinement, the parent remains presented until every visible item on the replacement front is loaded. New children are attached before the parent is detached.

## Camera and frame processing

An `ICameraEventSource` may push camera placements. Applications may also call `TileRuntime.update` directly. Camera values are opaque to the traversal and interpreted only by `ISpatialMetric`.

The runtime serializes frame processing and coalesces refreshes caused by asynchronous loads. `whenIdle()` waits for both the loading scheduler and the resulting traversal refreshes.

## Navigation cache

Detaching content from the scene does not immediately destroy its renderer handle. The handle remains available for a fast return until the LRU cache reaches a configured age or budget. The runtime enforces independent limits for:

- materialized runtime tile nodes;
- renderable content entries;
- content CPU bytes;
- content GPU bytes;
- loaded subtree entries;
- loaded subtree bytes;
- the number of frames an inactive resource may be retained.

The adaptation layer reports `cpuBytes`, `gpuBytes` and `networkBytes` in the renderable `ContentLoadResult`. These values are authoritative because only the renderer integration knows the actual cost of decoded geometry, textures, buffers and engine objects. Missing values are treated as zero, so entry budgets still work even before an adapter can measure memory precisely.

Selected tiles, attached content, active replacement fronts, queued or running loads and subtrees touched by the current frame cannot be evicted. Inactive renderables are disposed in least-recently-used order. Inactive subtree payloads are released independently. Materialized implicit branches are pruned when stale or when the node budget is exceeded, and are generated again from subtree availability when navigation returns.

```ts
const runtime = new TileRuntime({
    id: "mine",
    uri: "https://example.test/tileset.json",
    adapter,
    cache: {
        maxMaterializedTiles: 4096,
        maxContentEntries: 512,
        maxContentCpuBytes: 512 * 1024 * 1024,
        maxContentGpuBytes: 1024 * 1024 * 1024,
        maxSubtreeEntries: 128,
        maxSubtreeBytes: 64 * 1024 * 1024,
        unusedFrameRetention: 120,
    },
});
```

`trimCache()` applies the budgets immediately. `trimCache(true)` releases every inactive cache entry and implicit branch, which is useful after a scene switch or when an application enters the background. Cache evictions are observable through `cache-eviction` events and the `beforeCacheEviction` and `afterCacheEviction` hooks.

## Real-time instrumentation

`runtime.instrumentation` aggregates runtime metrics and produces a current state snapshot. A snapshot includes tile-node counts, content lifecycle states, attached and cached handles, CPU, GPU and network byte estimates, subtree states, scheduler pressure, cache counters and aggregate values for load, frame, attach, detach, error and eviction metrics.

```ts
const unsubscribe = runtime.instrumentation.subscribe((statistics) => {
    dashboard.update(statistics);
});

const current = runtime.instrumentation.snapshot();

runtime.instrumentation.setEnabled(false);
runtime.instrumentation.setEnabled(true);

unsubscribe();
```

Disabling instrumentation stops timers, aggregate updates, subscriber publications and forwarding to `IRuntimeTelemetry`. Cache enforcement remains active. This switch allows production viewers to remove monitoring work from the frame path without changing traversal behavior. `reset()` clears metric aggregates while preserving the current runtime state.

## Implicit tiling

Implicit tiling is implemented as a native traversal path, not as a pre-generated explicit tree. Children are materialized only when traversal requires refinement. The implementation supports:

- QUADTREE and OCTREE coordinates;
- level-concatenated Morton indexing without 32-bit bitwise truncation;
- constant and bitstream tile, content and child-subtree availability;
- sparse child subtrees;
- multiple content templates;
- direct bounding-volume computation from the implicit root to avoid accumulated numerical error;
- standard JSON subtree files;
- standard binary `.subtree` headers and embedded binary chunks;
- external subtree buffers;
- subtree retries, scheduling, telemetry and lifecycle errors.

`StandardImplicitSubtreeLoader` combines a byte-resource loader with the core `SubtreeCodec`. `DenseImplicitSubtreeLoader` provides virtual constant availability for services that already expose a dense regular pyramid and do not publish physical subtree files.

### Web Map and DEM pyramids

`createWebMapImplicitSource` and `WebMercatorTileResolver` adapt an XYZ or TMS pyramid to the same implicit traversal. They handle the direction of the Web Map Y axis, compute exact Web Mercator latitude bounds for every tile and resolve `{z}/{x}/{y}` URLs.

This spatial override matters because standard 3D Tiles `region` subdivision is linear in latitude, while Web Mercator tile rows are not. The adapter keeps 3D Tiles availability and traversal semantics while supplying the exact per-tile `TILE_BOUNDING_REGION` equivalent at runtime.

The content port receives `implicitCoordinates`, the synthesized tile bounding volume and the derived spatial state. A Babylon terrain adapter can therefore use the content URI as a DEM texture, instance a shared grid mesh, bind a dedicated displacement shader and pool GPU resources across attach, detach and dispose operations. The generic runtime does not create Babylon meshes or shaders.

## Hooks and specialization

`IRuntimeHooks` exposes before and after hooks for tileset loading, frame traversal, content loading, attachment, detachment, metadata resolution, glyph publication and selection changes. Hook failures are reported as runtime errors without corrupting the traversal.

Core algorithm methods are protected, so a specialized runtime may override traversal, replacement-front collection, selection, loading, presentation or metadata resolution when hooks are not sufficient.

## Metadata

Metadata is resolved per tileset document. This is important for external tilesets because group indexes, schemas and schema URIs belong to the document that declares the tile.

The resolver preserves these scopes separately:

1. tileset metadata;
2. implicit subtree metadata;
3. ancestor tile metadata;
4. current tile metadata;
5. content group metadata;
6. content metadata;
7. feature metadata extracted by the content adapter, including glTF structural metadata.

The runtime does not silently merge these scopes. The 3D Tiles specification does not define inheritance between them. Applications can query a semantic with an explicit precedence order through `MetadataResolver.findBySemantic`.

Each resolved entity records its `documentUri`. Ancestor metadata keeps the schema of the tileset document that declared the ancestor, even when traversal has entered an external tileset. Feature metadata may provide its own schema and source URI when it originates from glTF `EXT_structural_metadata`; otherwise it uses the current tileset schema as a fallback.

Resolution supports:

- inline schemas and external schemas through `IMetadataSchemaLoader`;
- class and property lookup;
- required-property diagnostics;
- enum validation;
- scalar, vector, matrix and array shape validation;
- integer component validation;
- `noData` and `default` handling;
- normalized integer values;
- scale and offset transforms;
- unknown classes and properties without dropping their raw values;
- invalid content group diagnostics;
- metadata events, hooks and telemetry.

For implicit property tables, `IImplicitMetadataDecoder` is called with the loaded subtree, its buffers, availability, schema and local coordinates. Its tile and content entities enter the same metadata resolution pipeline. This keeps binary table decoding replaceable while preserving metadata scopes and schema ownership in the runtime.

The resolved `IMetadataSnapshot` is passed to content attachment and glyph publication. A GeoModels adapter can therefore derive BUSINESS MODEL entities, durable anchors, labels, styles or investor-view glyphs without putting those concepts in the generic 3D Tiles runtime.

## Current boundary

The generic runtime owns traversal, availability and resource lifecycle. Rendering, glTF decoding, image or DEM decoding, terrain grid creation, shader selection and engine-specific resource pooling remain responsibilities of an adaptation package such as a future `@spacexr/3d-tiles-babylon`.
