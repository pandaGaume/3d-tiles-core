# Rasters

Rules shared by every implementation of the raster layer (`@spacexr/raster` for Node.js, future .NET and C++ equivalents). A raster is a regular grid of values attached to a tile: heights, colours, masks or normals. The rules below do not depend on what the values mean, so imagery and elevation share them.

## Layout

- A raster has `width x height` samples, row-major from the north-west corner, with `channels` interleaved values per sample: channel `c` of sample `(column, row)` is at index `(row * width + column) * channels + c`.
- Values are stored in a typed array: 32-bit floats for heights, 8-bit unsigned integers for colours. A missing floating-point value is `NaN`.
- A decoded image is a raster of four 8-bit channels, R, G, B and A. Image decoders must return the stored pixel values without colour space conversion and without alpha premultiplication, otherwise values encoded in the pixels, such as elevations, are corrupted.

## Sampling

A raster is sampled in normalized tile coordinates, `u` west to east and `v` north to south, with one of two registrations:

| Registration | Sample `i` of `size` lies at | Use                                                          |
| ------------ | ---------------------------- | ------------------------------------------------------------ |
| `area`       | `(i + 0.5) / size`           | a tile as published: each sample covers one pixel            |
| `point`      | `i / (size - 1)`             | a stitched raster: the first and last samples lie on the edges |

- Bilinear sampling reads one channel. It clamps the sample coordinate to `[0, size - 1]` and leaves missing samples out of the weighting; the result is `NaN` only when the four samples are missing.
- In `area` registration the last pixels lie half a pixel inside the tile, so two neighbouring tiles never share a sample. Interpolated heights show a crack and interpolated colours a seam along their shared edge.

The range of a channel over an area covers every sample a bilinear sample inside it can interpolate: columns `floor(west * size - 0.5)` to `ceil(east * size - 0.5)` in `area` registration, `floor(west * (size - 1))` to `ceil(east * (size - 1))` in `point` registration, and likewise for rows. Both bounds are `NaN` when no valid sample is covered.

## Stitching

A stitched raster, as in SpaceXR, adds one column and one row to a `w x h` tile, `(w + 1) x (h + 1)` samples in `point` registration, with the same channels and array type:

- the extra column is the first column of the east neighbour `E`, the extra row the first row of the south neighbour `S`, and the extra corner the first sample of the south-east neighbour `SE`, all at the same level of detail;
- until a neighbour is available, its part repeats the last column, the last row or the last sample of the tile itself;
- adding a tile also fills the extra column of its west neighbour `W`, the extra row of its north neighbour `N` and the extra corner of its north-west neighbour `NW`, so the result does not depend on the arrival order;
- neighbours must have the same size and number of channels;
- neighbouring stitched rasters then hold identical samples on their shared edge. A grid of `w` cells sampled in `point` registration places each vertex exactly on a sample.

## Generated levels

A raster pyramid can generate the levels below the deepest level of its source, typically down to the deepest level of the tile system the rasters are draped on. Each generated tile interpolates the level above, generation by generation.

- The tiles of one level form a single lattice: sample `i` of tile `x` lies at `x + i / w` in tile units, `w` samples per tile, and likewise for rows.
- Sample `i` of the child at column `c` (0 west, 1 east) of a parent lies at parent sample `(c * w + i) / 2`, and likewise for rows. Its value interpolates the lattice of the parent level at that position, using the parent and its eight neighbours; a missing neighbour repeats the edge samples of the parent.
- Children of neighbouring parents interpolate the same lattice, so generated tiles stitch like source tiles.
- Missing samples are left out of the weighting.

| Interpolation | Samples | Properties                                                                                    |
| ------------- | ------- | --------------------------------------------------------------------------------------------- |
| `nearest`     | 1       | sample `round(x), round(y)`                                                                     |
| `linear`      | 3       | linear on the two triangles of each cell, split from its north-west to its south-east corner |
| `bilinear`    | 4       | bilinear in each cell                                                                          |
| `cubic`       | 4 x 4   | Catmull-Rom spline: smooth (C1), interpolating, may overshoot; bilinear next to missing samples |

Catmull-Rom weights for `t = x - floor(x)` are `(-t^3 + 2t^2 - t) / 2`, `(3t^3 - 5t^2 + 2) / 2`, `(-3t^3 + 4t^2 + t) / 2` and `(t^3 - t^2) / 2`. Every interpolation passes through the samples, so generated levels keep the source heights, and reproduces constant values; all but `nearest` reproduce linear slopes. Approximating schemes such as a quadratic B-spline are excluded: applied generation after generation, they lower summits at each level, by 14 m from a 4808 m summit sampled every 30 m in one generation.

## Raster pyramids

A raster pyramid is a [tile pyramid](tiles.md#tile-pyramids) of rasters that prefetches the `E`, `S` and `SE` neighbours of every tile and stitches each raster as it arrives.

- A tile at any level samples the stitched raster of the tile serving it, its ancestor at `maxLOD` beyond that level, in `point` registration over the area it covers.
- A point of the pyramid is addressed by `x` eastward and `y` southward in `[0, 1]`. At level `l` it lies in tile `(l, floor(x * 2^l), floor(y * 2^l))`; a point on a tile edge may be read from either side, which return the same value. The value is `NaN` while no raster containing the point is loaded.
- Columns wrap around the antimeridian only when requested.
