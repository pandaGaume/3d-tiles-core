# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [Unreleased]

### Added

- Elevation whose depth varies from place to place: `servingLevel` of `CelestialTileSource`, `TilePyramid` and `RasterPyramid`, and `terrainDataLevel` of `DrapeInstanceCut`. `cubeDemPyramid` reads a sub-area of the deepest tile at each place instead of interpolating the levels a dataset does not declare, and `isAvailable` no longer scans its subtrees.
- `completeTileCover` of `@spacexr/raster`: the tiles completing a cut into a cover of its roots, for a renderer to draw coarse terrain where a selection left no tile.
- `workingSetFactor` of the runtime cache: budgets of entries and tiles that grow with what the view uses, and fixed byte budgets. It defaults to fixed budgets.
- The normals of terrain on the cube read the samples of the source and the DEM across tile edges, turned across cube faces; see `docs/celestial-tiling.md`.
- `horizon: "tile-heights"` of `EcefSpatialMetric`: the true horizon formula on a spherical body, from its radius, its lowest terrain measured so far and the highest point of each tile, reported with `tileHeightRange` by the content and `heightRange` by an implicit resolver. The default test, a plane, culled terrain below the reference surface of a sphere from a camera above it, and summits still above the horizon. It stays the default: oblate bodies are unchanged.
- `RasterRegistration` is declared by every source where its data is imported, with no default: `registration` of `WebTileSource`, `RasterPyramid`, `DemPyramid`, `StitchedRasterGrids` and `ISourceTileMatrix`.
- `@spacexr/tiles/reprojection`: projections, WMTS capabilities, source levels and resampling, from raster sources to the cube index. `docs/cube-sources.md` is the brief of a tile service, for the Solar System Treks and WGS84 sources.
- `VerticalScale`, the vertical exaggeration shared by a scene: a `TileRuntime` given it derives its tiles again when it changes, and `EcefSpatialMetric` with a `vertical` placement moves objects with it. `tileBoundingVolume` may be a function, evaluated again.
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
- Terrarium elevation encoding in `@spacexr/dem`: `terrariumPixel` and `encodeTerrariumGrid` turn metre heights into raw RGBA pixels at a step of 1/256 metre, keep NoData distinct from the lowest height, and reject heights out of range.
- Cube index in `@spacexr/tiles/cube`: `CubeFace` and the equi-angular mapping, the tile of a direction, neighbours across faces with their quarter turns, the corners of 3 tiles, planetocentric directions, `ReferenceSurface` with triaxial radii and radial heights, and the geometric error of a tile. Tile addresses take an optional `face`, kept by parents and children, and URL templates the `{face}` variable, now a built-in name.
- Tile surfaces: `ITileSurface` places tiles on a body whatever the projection, with `WebMercatorTileSurface` and `CubeTileSurface`. `@spacexr/grid` builds on it `buildGridTileGeometry`, a topology on a tile with vertices relative to its centre, and `buildGridTileShape`, the lattice a renderer uploads and displaces on the GPU.
- Tile topologies: `ITileTopology` gives neighbours with their quarter turns and the area of a tile in another one, with `flatTileTopology` and `CUBE_TILE_TOPOLOGY`. `DrapeInstanceCut` takes a topology and joins instances across cube faces, with corners of 3 tiles. Pyramids, residency and stitching key tiles by face with `tileAddressKey`. `RasterPyramid` takes tiles in `point` registration, which already hold their shared edges.
- Cube DEMs: `parseCelestialDataset` and `CelestialTileSource` read the dataset of a tile service and its availability. `cubeDemPyramid` gives its radial heights as one surface per face, tiles it does not declare interpolating their parent. `tileSurfaceNormal` gives the normal of a displaced surface on any tile surface, and `radialHeightOnRay` converts sources with heights along a normal.
- Cube tilesets in the runtime: `createCubeImplicitSource` presents a whole body as an explicit root with the implicit quadtrees of the six faces, with oriented boxes from `cubeTileBoundingBox`, geometric errors following the distortion of the cube, measured height ranges and subtrees with their own levels. `quadtreeBalance` takes a `topology` and balances across cube faces.
- Reprojection in `@spacexr/tiles/reprojection`: geographic, polar stereographic and Web Mercator projections from the directions of the cube index, WMTS capabilities without an XML library, the source level of a cube level, the source tiles a cube tile reads, bilinear resampling, heights rebased on a reference surface and cap blends. Checked against the capabilities and the data of Moon Trek.
- Celestial tiling specification: an equi-angular cube index covering whole bodies, poles included, with its face edge table, triaxial reference surfaces, radial terrain heights, layers in other schemes and a dataset descriptor for tile services.
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

- The reference renderer is stated as it is: Babylon.js renders with WebGL, every shader is written in GLSL, and none is written for WebGPU.
- Navigation defaults of `TileRuntime`, so that applications no longer need to tune them to turn the camera without reloading: `preloadSiblings` is enabled, `coarseningDelayFrames` is 20, the cache keeps inactive resources for `unusedRetentionMilliseconds`, 60 seconds, instead of 120 runtime frames, and keeps up to 4096 contents instead of 512 within its byte budgets. `unusedFrameRetention` is deprecated: runtime frames only run while the camera moves or loads settle, so a frame count was a few seconds while the camera turned. Turning the camera or zooming out no longer drops the finer tiles displayed for a coarser ancestor while the children entering the view load: the children of refined tiles are preloaded. `clock` injects the time of the cache retention.

- `@spacexr/geodesy` is installed from the npm registry instead of a vendored archive.
- Conformance tests compare the exact set of diagnostic codes reported for each fixture.
- Web Mercator tile metrics moved from the runtime to `@spacexr/tiles`; the runtime re-exports them. `getLatLonToTileXY` now keeps the east and south map edges inside the pyramid.
- **Breaking:** `registration` is required on `WebTileSource`, `RasterPyramid`, `DemPyramid`, `StitchedRasterGrids` and `ISourceTileMatrix`. Leaving it out does not compile, and a missing or unknown value throws a `TypeError`. Tiles that declared nothing were read as `area`: declare `registration: "area"`, or pass `source.registration` on. See [Declaring the registration](node/packages/raster/README.md#declaring-the-registration).

### Deprecated

- `prestitched` of `RasterPyramid`, `DemPyramid` and `StitchedRasterGrids`: declare `registration` alone, `prestitched: true` is `point` and `prestitched: false` is `area`. The option no longer decides anything: it does not replace `registration`, and a value that disagrees with it throws a `TypeError`.

### Fixed

- Tiles in `area` registration are moved to the corners of their pixels when stitched: their pixels were copied into a `point` grid, which moved terrain and imagery half a pixel to the north-west, 1.46 m at level 15 and 46.9 m at level 10 at a latitude of 52 degrees. Each tile now loads with its eight neighbours, and the surface is smoothed by half a pixel. Generated levels start from those corners.
- `quadtreeBalance.fillGaps`, used on the cube index, leaves no holes in the view: a tile the balance must refine, whose children were not ready, kept any displayed descendant, even one covering a corner of it, and the rest stayed empty until the children loaded. With the option it keeps them only when they cover the visible part of the tile, and falls back to a ready tile otherwise.
- Tiles seen before load again after zooming out and in: a cancelled load no longer counts against `maxLoadAttempts`, and the contents of an activation cancelled before it started return to the idle state instead of staying queued forever.
- The children of a refined tile are requested together instead of one after another.

- The quadtree balance no longer coarsens a refinement already displayed when a neighbour it cannot follow yet comes into view; the edge stays reported as unbalanced while the neighbour refines, instead of flickering.

### Removed

- The Babylon.js examples moved to [3d-tiles-babylon](https://github.com/pandaGaume/3d-tiles-babylon), together with the new `@spacexr/3d-tiles-babylon` package extracted from them.
