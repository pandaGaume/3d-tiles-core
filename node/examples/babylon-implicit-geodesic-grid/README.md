# Babylon implicit geodesic grid

This example is the integration proof for the renderer-neutral runtime pipeline.

The 3D Tiles runtime owns camera traversal, implicit tiling, LOD selection, readiness, metadata handles and cache policy. The Babylon bundle only implements `ITileActivationAdapter` and `ITilePresentationAdapter`. It never imports `TileRuntime` internals.

The Babylon adapter shares one normalized grid topology, not a Cartesian mesh. Every ready 3D Tile receives unique ECEF vertices projected from its geographic region onto the WGS84 ellipsoid. Curvature and east-west pinching therefore follow both LOD and latitude.

This CPU implementation intentionally creates one geometry per tile. The topology and runtime contracts already support a later GPU path: normalized coordinates remain shared, while the tile region and ellipsoid parameters can become per-instance shader inputs.

Every presented tile is colored by absolute LOD and receives a screen-space `X/Y/LOD` label. Those identifiers are also published through the example's 3D Tiles metadata, making parent-child overlap and incorrect replacement cuts directly visible while debugging traversal.

The scene root covers the complete WebMercator domain and contains 64 independent sources, one for every `X/Y` address at LOD 3. Each `WebMapTileDataSource` owns the shared `WebMercatorTileMetrics` configuration with `minLOD = 3` and `maxLOD = 12`, its root address and its `grid://` URL template. Its `ImplicitTilesetDecorator` derives ten available levels and cannot request an address beyond LOD 12.

The explicit scene root has no renderable content. It lets the standard runtime select only the visible LOD 3 source roots. A routing resolver then delegates every implicit tile to the decorator that owns its root. The coverage is global within the WebMercator latitude limits of approximately 85.051 degrees north and south.

Run it from `node/`:

```bash
npm run example:implicit-grid
```

No API key or `.env` file is required.

## Runtime monitoring

The overlay joins the renderer-neutral runtime cache statistics with Babylon counters. It reports selected and cached tiles, tracked CPU/GPU/subtree memory, JavaScript heap usage when the browser exposes it, cumulative content and subtree evictions, implicit branch pruning, FPS, draw calls and the number of Babylon meshes created, shown and released.

Monitoring is throttled to four publications per second. Open the example with `?monitor=0` to disable both runtime metric collection and Babylon `SceneInstrumentation` observers when measuring the viewer without diagnostic overhead.
