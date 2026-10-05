# @spacexr/tiles

Renderer-neutral building blocks for web tile pyramids: addressing, HTTP tile sources and DEM codecs. The package does not depend on 3D Tiles; `@spacexr/3d-tiles-runtime` uses it to expose web map and DEM pyramids as implicit tilesets.

## Install

```bash
npm install @spacexr/tiles
```

## Load a Mapzen Terrarium elevation tile

```ts
import { WorkerDemDecoder, createMapzenTerrariumSource, loadDemTile } from "@spacexr/tiles";

const dem = createMapzenTerrariumSource();
const decoder = new WorkerDemDecoder([new Worker(new URL("./dem-decoder.worker.ts", import.meta.url), { type: "module" })]);
const tile = await loadDemTile(dem, { lod: 12, x: 1205, y: 1402 }, decoder, { normals: true, signal });

if (tile?.content) {
    const { minimum, maximum, mean, highest } = tile.content;
    const overzoomed = tile.content.view(0, 0, 128, 128); // north-west quarter
}
```

`loadDemTile` returns `undefined` when the tile does not exist. `DemInfos` statistics ignore missing samples, and `view` copies a part of the grid with its normals, which is the basis of overzoom beyond the source maximum level.

Display `source.attribution` with the data.

## Modules

| Import                         | Content                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `@spacexr/tiles/addressing`    | `ITileAddress` (XYZ rows), `ITile<T>` / `Tile<T>` with quadkey, key and bounds, XYZ and TMS rows, parents and children, `WebMercatorTileMetrics` |
| `@spacexr/tiles/sources`       | URL templates, `TileHttpClient`, `WebTileSource`, presets, `loadDemTile`                                 |
| `@spacexr/tiles/codecs`        | Terrarium, Mapbox Terrain-RGB and grayscale decoders, `IHeightGrid`, `IDemInfos` / `DemInfos`, `computeGridNormals`, the `IDemDecoder` port with `WorkerDemDecoder` and `LocalDemDecoder`, the `IImageDecoder` port |

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

## Decoding off the rendering thread

Decoding one 256 px PNG tile takes about 60 ms in a browser, which would stall rendering if it ran on the main thread. DEM tiles therefore go through the `IDemDecoder` port:

- `WorkerDemDecoder` sends each tile to the least busy worker of a pool. The tile bytes are transferred to the worker and the heights are transferred back, so neither is copied. Aborting a request settles it immediately.
- `installDemDecoderWorker(self)` serves those requests inside the worker. The package does not create workers itself, because each bundler has its own worker syntax; the application provides a one-line worker module:

```ts
// dem-decoder.worker.ts
import { installDemDecoderWorker } from "@spacexr/tiles";
installDemDecoderWorker(self);
```

- `LocalDemDecoder` decodes on the calling thread, for tests, Node.js or code already running in a worker.

Turning PNG or WebP bytes into pixels depends on the platform and goes through the `IImageDecoder` port. `BrowserImageDecoder` uses `createImageBitmap` and `OffscreenCanvas`, which are available in workers, and disables colour conversion and alpha premultiplication, which would otherwise alter encoded elevations. On Node.js, supply an image decoder based on a PNG library.

See the repository document `docs/tiles.md` for the cross-language rules.
