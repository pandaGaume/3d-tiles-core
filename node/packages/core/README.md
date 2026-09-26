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

## Boundaries

This package does not fetch resources, resolve URIs, traverse levels of detail or render content. Those responsibilities belong to the future runtime and host adapters.

