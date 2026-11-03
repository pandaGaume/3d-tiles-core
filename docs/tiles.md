# Web tiles

Rules shared by every implementation of the web tile layer (`@spacexr/tiles` for Node.js, future .NET and C++ equivalents). The layer is independent of 3D Tiles; runtimes adapt it into implicit tilesets.

## Addressing

- A tile address is `(lod, x, y)` in the XYZ convention: level 0 has one tile, `x` grows eastward and `y` grows southward from the north-west corner. Level `lod` has `2^lod` tiles per axis.
- TMS rows grow northward: `y_tms = 2^lod - 1 - y_xyz`. The conversion is its own inverse.
- A Bing Maps quadkey has one digit per level, from the coarsest: `digit = x_bit + 2 * y_bit`. Level 0 is the empty string.
- Children of `(lod, x, y)` are `(lod + 1, 2x + i, 2y + j)` for `i, j` in `{0, 1}`, ordered north-west, north-east, south-west, south-east.

## Neighbours

Positions around a tile follow the SpaceXR `NeighborsIndex`, a 3 x 3 layout numbered row-major from the north-west, with the tile itself at the centre:

```text
NW N NE      0 1 2
W  C  E      3 4 5
SW S SE      6 7 8
```

- Neighbour `n` at the same level is `(lod, x + n mod 3 - 1, y + floor(n / 3) - 1)`.
- `N`, `E`, `S` and `W` share an edge with the tile; `NW`, `NE`, `SE` and `SW` share only a corner. Each corner joins two edges: `NW` joins `N` and `W`, `NE` joins `N` and `E`, `SE` joins `S` and `E`, `SW` joins `S` and `W`.
- A neighbour beyond the pyramid does not exist. Rows never wrap; columns wrap around the antimeridian only when requested, for pyramids covering every longitude.

## Web Mercator metrics

EPSG:3857 with latitudes clamped to plus or minus 85.0511287798066 degrees.

- Normalized position: `u = (lon + 180) / 360`, `v = 0.5 - ln((1 + sin(lat)) / (1 - sin(lat))) / (4 * pi)`.
- Tile of a position: `floor(u * 2^lod)`, `floor(v * 2^lod)`, clamped to `2^lod - 1` so that the east and south edges belong to the last tile.
- Ground resolution in metres per pixel: `cos(lat) * 2 * pi * a / (tileSize * 2^lod)`, where `a` is the semi-major axis of the ellipsoid.

## URL templates

| Variable                  | Value                             |
| ------------------------- | --------------------------------- |
| `{z}`, `{lod}`, `{level}` | level of detail                   |
| `{x}`                     | column                            |
| `{y}`                     | XYZ row                           |
| `{-y}`                    | TMS row                           |
| `{quadkey}`               | Bing Maps quadkey                 |
| `{s}`                     | `subdomains[(x + y) mod n]`       |
| `{name}`                  | application variable, URI-encoded |

An unknown variable, `{s}` without subdomains, or an application variable named like a built-in one is an error raised when the source is created. The subdomain choice is deterministic so that a tile is always requested from the same host, which preserves HTTP caching.

## HTTP

| Response                                         | Outcome                                          |
| ------------------------------------------------ | ------------------------------------------------ |
| 2xx with a body                                  | tile bytes                                       |
| 204, 404                                         | the tile is absent; not an error                 |
| network error, 408, 425, 429, 500, 502, 503, 504 | retried                                          |
| any other status, or attempts exhausted          | error carrying the URL, status and attempt count |

The delay before attempt `n + 1` is `min(maxDelay, initialDelay * 2^(n - 1)) + random * initialDelay`, or the `Retry-After` value, capped by `maxDelay`. Defaults: 4 attempts, 500 ms initial delay, 30 s maximum delay. Cancellation interrupts both requests and delays.

## DEM encodings

Heights are in metres.

| Encoding             | Formula                                    |
| -------------------- | ------------------------------------------ |
| `terrarium`          | `r * 256 + g + b / 256 - 32768`            |
| `mapbox-terrain-rgb` | `-10000 + (r * 65536 + g * 256 + b) * 0.1` |
| `grayscale`          | `minimum + r / 255 * (maximum - minimum)`  |

- Pixels must be read without colour conversion and without alpha premultiplication.
- A pixel whose alpha is 0 is missing by default and stored as `NaN`.
- A height grid is row-major from the north-west corner. Its minimum and maximum ignore missing samples and are `NaN` when every sample is missing.

## DEM statistics and normals

- `lowest` and `highest` locate the extreme valid samples by column and row; `mean` and `delta = maximum - minimum` ignore missing samples and are `NaN` when every sample is missing.
- A view copies a rectangle of the grid, and of its normals, and recomputes the statistics.
- Normals are unit vectors in local east, north, up axes, computed with central differences: `n = normalize(-dh/de, -dh/dn, 1)`. Rows grow southward, so `dh/dn` is the negated row gradient. Edges and samples next to missing values use one-sided differences; a sample without valid neighbours gets `(0, 0, 1)`.
- For Web Mercator tiles, the sample spacing is the ground resolution at the tile centre latitude multiplied by `tileSize / gridWidth`, identical along rows and columns because the projection is conformal.

## Sampling and stitched grids

A height grid is sampled in normalized tile coordinates, `u` west to east and `v` north to south, with one of two registrations:

| Registration | Sample `i` of `size` lies at | Use                                                          |
| ------------ | ---------------------------- | ------------------------------------------------------------ |
| `area`       | `(i + 0.5) / size`           | a DEM tile as published: each sample covers one pixel        |
| `point`      | `i / (size - 1)`             | a stitched grid: the first and last samples lie on the edges |

- Bilinear sampling clamps the sample coordinate to `[0, size - 1]` and leaves missing samples out of the weighting; the result is `NaN` only when the four samples are missing.
- In `area` registration the last pixels lie half a pixel inside the tile, so two neighbouring DEM tiles never share a sample and their edges disagree by one pixel of terrain.

A stitched grid, as in SpaceXR, adds one column and one row to a `w x h` DEM tile, `(w + 1) x (h + 1)` samples in `point` registration:

- the extra column is the first column of the east neighbour `E`, the extra row the first row of the south neighbour `S`, and the extra corner the first sample of the south-east neighbour `SE`, all at the same level of detail;
- until a neighbour is available, its part repeats the last column, the last row or the last sample of the tile itself;
- adding a tile also fills the extra column of its west neighbour `W`, the extra row of its north neighbour `N` and the extra corner of its north-west neighbour `NW`, so the result does not depend on the arrival order;
- neighbouring stitched grids then hold identical samples on their shared edge. A grid of `w` cells sampled in `point` registration places each vertex exactly on a sample.

The height range of an area covers every sample a bilinear sample inside it can interpolate: columns `floor(west * size - 0.5)` to `ceil(east * size - 0.5)` in `area` registration, `floor(west * (size - 1))` to `ceil(east * (size - 1))` in `point` registration, and likewise for rows.

## Worker decoding protocol

Implementations that decode DEM tiles in workers exchange two messages:

- request `{ id, bytes, encoding, transparentAsNoData? }`, with the buffer of `bytes` transferred;
- response `{ id, width, height, heights }`, with the buffer of `heights` transferred, or `{ id, error }`.

`id` is unique per pending request. A client that abandons a request ignores its response.

## Presets

| Preset           | URL                                                                       | Levels  | Tile size | Encoding    |
| ---------------- | ------------------------------------------------------------------------- | ------- | --------- | ----------- |
| Mapzen Terrarium | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | 0 to 15 | 256       | `terrarium` |

Mapzen Terrain Tiles require attribution of their data sources, listed at https://github.com/tilezen/joerd/blob/master/docs/attribution.md.
