# Raster draping

Rules shared by every implementation that drapes raster pyramids, such as satellite imagery, over terrain tiles. Terrain and imagery are two independent implicit quadtrees on the same Web Mercator pyramid, traversed by two runtimes on the same camera: terrain refines on geometric error, imagery on texel size, so a flat area can show a coarse mesh with fine imagery.

## Two engines

A renderer binds the pages of one pyramid to the tiles of the other. Two engines are specified; they share the page pyramid, the residency index and the GPU page pool, and differ in their render unit.

| Engine         | Render unit  | Bound pages                                                              | Geometry                                   |
| -------------- | ------------ | ------------------------------------------------------------------------ | ------------------------------------------ |
| Mesh draping   | terrain tile | `4^k` imagery pages, one per cell, `k` set per tile by the imagery cut   | CPU meshes, as built today                 |
| GPU instancing | imagery tile | one imagery page, and the elevation page of the terrain tile containing it | one shared grid instanced, displaced on the GPU |

Both engines remain available; the mesh draping engine is implemented first.

## Imagery tree

- Imagery tiles use the same addressing as terrain tiles, with their own `minLOD` and `maxLOD`.
- The geometric error of an imagery tile is the ground size of one texel at the equator, `groundResolution(0, lod)`, so that the screen-space error is the size of one texel in pixels.
- An imagery tile has no height of its own. Its bounding volume uses the height range prepared for the terrain tile at the same address, or for its deepest ancestor with a prepared range.

## Pages

- A page is the stitched raster of one imagery tile: `(w + 1) x (h + 1)` texels in `point` registration, following [Rasters](raster.md#stitching). Neighbouring pages then hold the same texels on their shared edge, and bilinear filtering shows no seam.
- When a neighbour arrives, the pages it completes, on its west, north and north-west, are uploaded again, or only their extra column, row or corner.
- A texel in point registration `t` in `[0, 1]` maps to the texture coordinate `(t * (size - 1) + 0.5) / size`, the centre of the texel.

## Residency and covers

The pages available to the renderer form a residency index. The cover of a tile is the deepest resident page containing it, with the area the tile occupies in that page: `west`, `north` and `size`, as for [tile pyramids](tiles.md#tile-pyramids). A binding therefore falls back to a coarser page while a finer one loads.

## Mesh draping

- The imagery cut is the set of imagery tiles its runtime presents. Its runtime refines on texel size, so the cut follows the camera distance.
- The drape depth `k` of a terrain tile at level `g` is the number of levels between the tile and the deepest tile of the cut inside it, clamped to `[0, maxDepth]`: `0` for a distant tile whose imagery is as coarse as the terrain or coarser, more for near tiles.
- The terrain tile is divided into `2^k x 2^k` cells, the tiles of level `g + k` inside it, row-major from the north-west cell. Each cell uses its cover among the resident pages of level `g + k` or coarser: its own page, or the page of a coarser tile. A cell without any cover keeps the base colour of the terrain.
- Cell `(i, j)` of a fragment at tile coordinates `(u, v)` is `(floor(u * 2^k), floor(v * 2^k))`, clamped to `[0, 2^k - 1]`; its cell coordinates are `(u * 2^k - i, v * 2^k - j)`. The page coordinates are `(west + s * size, north + t * size)`.
- Each terrain tile owns a table of `2^maxDepth x 2^maxDepth` entries, of which the first `2^k x 2^k` hold, per cell, the page and the area `west, north, size` of the cell in it.
- The binding of a terrain tile changes when the cut changes, or a page overlapping it at most `maxDepth` levels finer becomes resident or leaves.

## GPU instancing

- An imagery tile at level `l` is drawn as an instance of a shared grid, with the terrain junction variant of its edges. Its elevation is the cover of the imagery tile among the resident elevation pages, so its vertices sample the elevation page at `(west + u * size, north + v * size)`.
- Elevation pages store heights relative to the minimum of their tile when they use half floats, whose spacing reaches 4 m between 4096 and 8192 m.
