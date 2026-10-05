# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [Unreleased]

### Added

- Multilanguage repository structure.
- Initial TypeScript wire model for 3D Tiles 1.1.
- Lossless JSON codecs and structural validation.
- Node.js CI and npm trusted publishing workflows.
- Renderer-neutral runtime package with camera, content, glyph, spatial metric and telemetry ports.
- Hole-free REPLACE traversal, ADD traversal, external tileset grafting and concurrent loading.
- Metadata scope resolution, validation, transformation and external schema loading.
- Uppercase `I` prefix convention for every TypeScript interface.
- Standard implicit QUADTREE and OCTREE traversal, sparse subtree availability, JSON and binary subtree codecs, and XYZ or TMS Web Map pyramid adaptation.
- Budgeted LRU navigation cache for renderables, subtree payloads and materialized implicit branches.
- Optional real-time runtime statistics, metric aggregation, cache events and eviction hooks.
- External `@spacexr/geodesy` integration for ellipsoid-aware ECEF regions and horizon culling.
- Babylon.js 9 example for Google Photorealistic 3D Tiles with the native `GeospatialCamera`, large-world rendering, environment-based credentials and dynamic attribution.
- `SPACEXR_bounding_volume_utm` bounding volume extension: UTM extent identified by EPSG code or zone, with an explicit vertical extent supporting depths below ground. Includes the wire model, `createUtmTileset`, validation rules, conformance fixtures and a cross-language specification.
- Runtime placement of UTM extents in ECEF through the `@spacexr/geodesy` 0.2.0 transverse Mercator projection, including implicit tiling subdivision. Datum transformations and geoid models are injectable; default null transformations widen the bounds by their published accuracy, and every approximation is reported in `IEcefSpatialState.utmPlacement`.
- `@spacexr/tiles` package: web tile addressing (XYZ, TMS, Bing quadkeys, Web Mercator metrics), URL templates with `{s}`, `{quadkey}`, `{-y}` and application variables, an HTTP tile client with exponential backoff and absent-tile results, a Mapzen Terrarium preset, DEM codecs for Terrarium, Mapbox Terrain-RGB and grayscale encodings behind an image decoder port, `Tile<T>` with quadkey, key and bounds, `DemInfos` statistics, views and surface normals, and `loadDemTile`.
- Runtime web map data sources accept subdomains, application variables and every `@spacexr/tiles` template variable; templates are validated at construction.
- Content-measured bounds: `tileBoundingVolume` in the renderable readiness result re-derives a tile spatial state, and implicit children are re-resolved when their parent content becomes ready, with a `tile-bounds-refined` event.
- `DemInfos.quadrants`, `heightRangeInArea` and `sampleHeightBilinear` in `@spacexr/tiles`.
- `IDemDecoder` port with `WorkerDemDecoder`, `installDemDecoderWorker` and `LocalDemDecoder`, so that PNG and elevation decoding (about 60 ms per tile) run in a worker pool instead of the rendering thread. `loadDemTile` takes an `IDemDecoder`.
- The implicit geodesic grid example displaces its vertices with Mapzen Terrarium heights up to level 18 (overzoom beyond 15), with a live altitude scale, shaded rendering, tiles starting at 0/0 m and child ranges prepared from each parent DEM.

### Changed

- `@spacexr/geodesy` is installed from the npm registry instead of a vendored archive.
- Conformance tests compare the exact set of diagnostic codes reported for each fixture.
- Web Mercator tile metrics moved from the runtime to `@spacexr/tiles`; the runtime re-exports them. `getLatLonToTileXY` now keeps the east and south map edges inside the pyramid.
