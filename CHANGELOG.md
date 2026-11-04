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
- `@spacexr/tiles` package: web tile addressing (XYZ, TMS, Bing quadkeys, Web Mercator metrics), URL templates with `{s}`, `{quadkey}`, `{-y}` and application variables, an HTTP tile client with exponential backoff and absent-tile results, and `Tile<T>` with quadkey, key and bounds.
- Runtime web map data sources accept subdomains, application variables and every `@spacexr/tiles` template variable; templates are validated at construction.
- Content-measured bounds: `tileBoundingVolume` in the renderable readiness result re-derives a tile spatial state, and implicit children are re-resolved when their parent content becomes ready, with a `tile-bounds-refined` event.
- The implicit grid example displaces its vertices with Mapzen Terrarium heights up to level 18 (overzoom beyond 15), with a live altitude scale, shaded rendering, tiles starting at 0/0 m and child ranges prepared from each parent DEM.
- `TileNeighbor` in `@spacexr/tiles`, the SpaceXR `NW, N, NE, W, C, E, SW, S, SE` neighbour layout, with `tileNeighborAddress` and `tileNeighborAddresses`, optionally wrapping columns around the antimeridian.
- `TilePyramid<T>` in `@spacexr/tiles`: tiles of any content loaded once on demand, overzoomed beyond `maxLOD` from the sub-area of their ancestor (`tileAreaInAncestor`), with prefetched neighbours and an LRU cache.
- `@spacexr/raster` package: multi-channel tile rasters (`IRasterGrid`), bilinear sampling and ranges in `area` or `point` registration, the `IImageDecoder` port with `BrowserImageDecoder`, `StitchedRasterGrids` extending each tile with the first column, row and sample of its east, south and south-east neighbours, as in SpaceXR, so that neighbouring rasters share their edge samples, and `RasterPyramid`, a stitched raster pyramid sampled as one continuous surface. The rules are specified in `docs/raster.md`.
- Raster draping, specified in `docs/draping.md` for two engines, mesh draping and GPU instancing: `ResidentTiles` in `@spacexr/tiles` covers a tile with the deepest resident tile containing it, `ResidentTiles.depthWithin`, and `drapeDepth`, `drapeCells` and `pageAffectsDrape` in `@spacexr/raster` drape a terrain tile with `4^k` imagery pages, one per cell, where the depth `k` follows the imagery cut, hence the camera distance, and `RasterPyramid` reports the stitched grids each arrival changes (`onStitched`).
- Generated raster levels: `RasterPyramid` and `DemPyramid` take a `generation` option to continue the pyramid below its source, generation by generation, down to the deepest level of the draped tile system, with `nearest`, `linear`, `bilinear` or `cubic` (Catmull-Rom) interpolation (`interpolateLattice`, `generateChildRaster`).
- `TilePyramid.retain` and `release`, relayed by `RasterPyramid` and `DemPyramid` with `DemPyramid.isResident`: tiles in use never leave the cache.
- `coarseningDelayFrames` runtime option: a refined tile coarsens only once nothing has required its refinement for that many frames, so that neighbours leaving the view and errors close to the threshold no longer make tiles flicker.
- `preloadSiblings` runtime option: the children of refined tiles that lie outside the view load in the background, so that turning the camera no longer falls back to coarser tiles while they load.
- `@spacexr/dem` package, on `@spacexr/raster`: DEM codecs for Terrarium, Mapbox Terrain-RGB and grayscale encodings, the `IDemDecoder` port with `WorkerDemDecoder`, `installDemDecoderWorker` and `LocalDemDecoder`, `DemInfos` statistics, quadrant ranges, views and surface normals, `loadDemTile`, the Mapzen Terrarium preset, `DemPyramid` with tile heights, child ranges (`ChildHeightRanges`), surface heights and gradients over several levels (`selectSurfaceLevels` with `coarsest`, `finest` or `average`), and `webMercatorSurfaceNormal`. The rules are specified in `docs/dem.md`.
- `quadtreeBalance` runtime option: displayed tiles of implicit QUADTREE tilesets stay within one level of detail of their edge neighbours (2:1 balance) in every frame, refining coarse neighbours within the frame, loading their children first, keeping finer tiles while they load and holding refinements their neighbours cannot follow yet; edges still unbalanced are reported in `IRuntimeFrameResult.unbalanced`, by a `quadtree-imbalance` event and in `nodes.unbalanced`, across implicit roots when the resolver implements the new optional `IImplicitTileResolver.addressOf`, which `ImplicitTilesetDecorator` provides.
- `@spacexr/grid` package: normalized terrain grid topologies with the alternating diagonals of the SpaceXR terrain grid and crack-free junctions to edge neighbours one level coarser or finer, as a single grid (81 variants, `JunctionGridTopologyCache`) or as nine instanceable pieces indexed by `TileNeighbor` (`GridJunctionPieces`), `gridEdgeLods` deriving the edge levels from the tile levels of detail, and `buildGridVertices`, ported from the SpaceXR `TerrainNormalizedGridBuilder`. The rules are specified in `docs/grid.md`.
- `DrapeInstanceCut` in `@spacexr/raster` computes the instance cut of GPU draping, specified in `docs/draping.md`: the leaves of the union of the terrain and imagery cuts, balanced across edges, with the levels of the neighbours across each edge, the terrain tile whose DEM gives the heights of each edge and corner, and a hold for coarsened levels. `RasterPyramid.observeStitched` reports stitched grid changes to renderers created after the pyramid.
- Registered implicit subtrees: `IImplicitTileResolver.subtreeAt` returns an `IImplicitSubtreeGraft`, an implicit subtree with its own tiling, availability, contents, resolver and subtree loader, which replaces the rules of the tileset from a tile down. Applications control the refinement region by region: stop it, make tiles unavailable, supply their own contents, or refine deeper.

### Changed

- Navigation defaults of `TileRuntime`, so that applications no longer need to tune them to turn the camera without reloading: `preloadSiblings` is enabled, `coarseningDelayFrames` is 20, the cache keeps inactive resources for `unusedRetentionMilliseconds`, 60 seconds, instead of 120 runtime frames, and keeps up to 4096 contents instead of 512 within its byte budgets. `unusedFrameRetention` is deprecated: runtime frames only run while the camera moves or loads settle, so a frame count was a few seconds while the camera turned. Turning the camera or zooming out no longer drops the finer tiles displayed for a coarser ancestor while the children entering the view load: the children of refined tiles are preloaded. `clock` injects the time of the cache retention.

- `@spacexr/geodesy` is installed from the npm registry instead of a vendored archive.
- Conformance tests compare the exact set of diagnostic codes reported for each fixture.
- Web Mercator tile metrics moved from the runtime to `@spacexr/tiles`; the runtime re-exports them. `getLatLonToTileXY` now keeps the east and south map edges inside the pyramid.

### Fixed

- Tiles seen before load again after zooming out and in: a cancelled load no longer counts against `maxLoadAttempts`, and the contents of an activation cancelled before it started return to the idle state instead of staying queued forever.
- The children of a refined tile are requested together instead of one after another.

- The quadtree balance no longer coarsens a refinement already displayed when a neighbour it cannot follow yet comes into view; the edge stays reported as unbalanced while the neighbour refines, instead of flickering.

### Removed

- The Babylon.js examples moved to [3d-tiles-babylon](https://github.com/pandaGaume/3d-tiles-babylon), together with the new `@spacexr/3d-tiles-babylon` package extracted from them.
