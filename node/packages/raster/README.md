<img src="https://raw.githubusercontent.com/pandaGaume/3d-tiles-core/main/assets/brand/spacexr-component.png" alt="SpaceXR Component" height="56">

# @spacexr/raster

Renderer-neutral tile rasters: grids of values attached to web tiles, whatever they mean. Heights, colours, masks and normals share the same layout, bilinear sampling, image decoding, seamless stitching of neighbouring tiles and on-demand pyramids. Tiles, neighbours and pyramids are those of [`@spacexr/tiles`](https://github.com/pandaGaume/3d-tiles-core/tree/main/node/packages/tiles); [`@spacexr/dem`](https://github.com/pandaGaume/3d-tiles-core/tree/main/node/packages/dem) builds elevation models on this package.

## Install

```bash
npm install @spacexr/raster
```

## Rasters

```ts
import { createRasterGrid, rasterRangeInArea, sampleRasterBilinear } from "@spacexr/raster";

// width x height samples, row-major from the north-west corner, channels interleaved.
const colours = createRasterGrid(256, 256, 4, pixels); // Uint8ClampedArray
const green = sampleRasterBilinear(colours, 0.5, 0.25, 1); // u east, v south, channel 1
const range = rasterRangeInArea(colours, 0, 0, 0.5, 0.5, "area", 1);
```

`sampleRasterBilinear` and `rasterRangeInArea` take an `area` registration, for tiles as published, or a `point` registration, for stitched rasters whose first and last samples lie on the tile edges. Missing floating-point values are `NaN` and are left out of the interpolation.

## Seamless pyramids

The last pixels of a published tile lie half a pixel inside it, so two neighbouring tiles never share a sample: interpolated heights crack and interpolated colours show a seam. `StitchedRasterGrids` adds the first column of the east neighbour, the first row of the south neighbour and the first sample of the south-east neighbour to every tile, as SpaceXR does, whatever the arrival order. `RasterPyramid` loads those neighbours with every tile and stitches them:

```ts
import { BrowserImageDecoder, RasterPyramid } from "@spacexr/raster";

const images = new BrowserImageDecoder();
const imagery = new RasterPyramid({
    load: async (address) => {
        const result = await source.fetchTile(address);
        return result.status === "absent" ? undefined : images.decode(result.bytes);
    },
    maxLOD: 19,
    wrapX: true,
});

const region = await imagery.load({ lod: 21, x: 1200000, y: 800000 }); // overzoomed from level 19
const red = region?.sample(1, 0.5, 0); // identical on the west edge of the east neighbour
const value = imagery.sampleAt(0.5, 0.25, 19, 0); // point of the pyramid, x east and y south in [0, 1]
```

Pass `create` to build another grid type from each stitched raster, as `@spacexr/dem` does to compute height ranges.

## Image decoding

`IImageDecoder` turns PNG, WebP or JPEG bytes into an `IRgbaImage`, a raster of four 8-bit channels. `BrowserImageDecoder` uses `createImageBitmap` and `OffscreenCanvas`, which are available in workers, and disables colour conversion and alpha premultiplication, which would otherwise alter values encoded in the pixels. On Node.js, supply an image decoder based on a PNG library.

See the repository document `docs/raster.md` for the cross-language rules.

## License

Apache-2.0.
