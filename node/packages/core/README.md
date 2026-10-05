[![CI (Node)](https://github.com/pandaGaume/3d-tiles-core/actions/workflows/ci-node.yml/badge.svg)](https://github.com/pandaGaume/3d-tiles-core/actions/workflows/ci-node.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

# @spacexr/3d-tiles-core

Implementation-neutral TypeScript interfaces, JSON codecs and validation for OGC 3D Tiles.

## Install

```bash
npm install @spacexr/3d-tiles-core
```

## Decode and encode a tileset

```ts
import { TilesetJsonCodec } from "@spacexr/3d-tiles-core";

const codec = new TilesetJsonCodec();
const tileset = codec.decode(jsonText);
const serialized = codec.encode(tileset, { pretty: true });
```

The codec performs structural validation by default and preserves extension, extras and application-defined JSON members.

## UTM extents

The `SPACEXR_bounding_volume_utm` extension locates a tile by a UTM extent and an explicit vertical extent, for example depths below ground. See the [extension specification](https://github.com/pandaGaume/3d-tiles-core/blob/main/docs/extensions/SPACEXR_bounding_volume_utm/README.md).

```ts
import { TilesetJsonCodec, createUtmTileset, getUtmBoundingVolume, resolveUtmProjection } from "@spacexr/3d-tiles-core";

const tileset = createUtmTileset({
    extent: {
        epsg: 26918, // NAD83 / UTM zone 18N
        minEasting: 438510.189,
        minNorthing: 5830109.72,
        maxEasting: 438900.189,
        maxNorthing: 5830499.72,
        vertical: { reference: "GROUND", direction: "DOWN", minimum: 0, maximum: 195, groundElevation: 254.085, epsg: 6647 },
    },
});

const codec = new TilesetJsonCodec();
const loaded = codec.decode(codec.encode(tileset, { pretty: true }));
const extent = getUtmBoundingVolume(loaded.root.boundingVolume);
const projection = extent && resolveUtmProjection(extent); // { zone: 18, hemisphere: "N", datum: "NAD83", epsg: 26918 }
```

`validateTileset` and the codec validate the extension object and its declaration in `extensionsUsed` and `extensionsRequired`.

## Boundaries

This package does not fetch resources, resolve URIs, traverse levels of detail or render content. Those responsibilities belong to the future runtime and host adapters.

