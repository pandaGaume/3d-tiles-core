# @spacexr/tiles

Renderer-neutral building blocks for web tile pyramids: addressing, neighbours, on-demand tile pyramids and HTTP tile sources. The package depends neither on 3D Tiles nor on the tile content; `@spacexr/3d-tiles-runtime` uses it to expose web map and DEM pyramids as implicit tilesets, [`@spacexr/raster`](https://github.com/pandaGaume/3d-tiles-core/tree/main/node/packages/raster) builds raster pyramids on it and [`@spacexr/dem`](https://github.com/pandaGaume/3d-tiles-core/tree/main/node/packages/dem) elevation models.

## Install

```bash
npm install @spacexr/tiles
```

## Load tiles on demand

```ts
import { TileNeighbor, TilePyramid, WebMercatorTileMetrics, WebTileSource } from "@spacexr/tiles";

const source = new WebTileSource({ urlTemplate: "https://tile.example.com/{z}/{x}/{y}.png", metrics: new WebMercatorTileMetrics({ minLOD: 0, maxLOD: 19 }) });
const pyramid = new TilePyramid({
    load: async (address) => {
        const result = await source.fetchTile(address);
        return result.status === "absent" ? undefined : decode(result.bytes);
    },
    maxLOD: 19,
    wrapX: true,
    prefetch: [TileNeighbor.E, TileNeighbor.S, TileNeighbor.SE],
});

// Level 21 is served by its ancestor at level 19, in the area west, north, size of that ancestor.
const region = await pyramid.load({ lod: 21, x: 1200000, y: 800000 });
```

Each tile loads once and is shared by concurrent requests, its prefetched neighbours load with it, and the least recently used tiles leave the cache.

## Modules

| Import                         | Content                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `@spacexr/tiles/addressing`    | `ITileAddress` (XYZ rows), `ITile<T>` / `Tile<T>` with quadkey, key and bounds, XYZ and TMS rows, parents and children, `TileNeighbor`, `WebMercatorTileMetrics` |
| `@spacexr/tiles/pyramid`       | `TilePyramid<T>`, `tileAreaInAncestor`                                                                  |
| `@spacexr/tiles/sources`       | URL templates, `TileHttpClient`, `WebTileSource`                                                         |

## URL templates

| Variable                       | Value                                                                       |
| ------------------------------ | --------------------------------------------------------------------------- |
| `{z}`, `{lod}`, `{level}`      | Level of detail                                                             |
| `{x}`                          | Column, growing eastward                                                    |
| `{y}`                          | XYZ row, growing southward                                                  |
| `{-y}`                         | TMS row, growing northward                                                  |
| `{quadkey}`                    | Bing Maps quadkey                                                           |
| `{s}`                          | `subdomains[(x + y) % subdomains.length]`, so a tile always maps to one host |
| `{name}`                       | Application variable from `variables`, URI-encoded, for example an API key  |

Templates are validated when a source is created: an unknown variable, or `{s}` without subdomains, throws a `TileUrlTemplateError` instead of producing invalid URLs.

## HTTP behaviour

- `404` and `204` resolve to `{ status: "absent" }`: missing tiles of a sparse pyramid are not errors.
- Network errors and `408`, `425`, `429`, `500`, `502`, `503`, `504` are retried with exponential backoff and jitter, or after `Retry-After`.
- Other statuses fail immediately with a `TileHttpError`.
- Aborting the signal stops the request, including during a backoff delay.
- Headers such as `Authorization` are configured once on the client.

See the repository document `docs/tiles.md` for the cross-language rules.
