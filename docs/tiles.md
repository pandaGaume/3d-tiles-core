# Generic tiles

`@spacexr/tiles` owns content-neutral addresses, neighbour topology, residency, pyramids, HTTP sources and source projections. A tile has a level and coordinates; an optional root identifier separates independent pyramids.

The application supplies a geodetic system or surface descriptor. `WebMercatorTileMetrics` and `WebMercatorTileSurface` require that system. Source projections and tile matrices require physical radii explicitly. No body catalogue or default Earth is embedded in these components.

The 3D Tiles runtime decorates configured sources as implicit tilesets and owns selection and streaming. Standard 3D Tiles wire semantics and CRS identifiers stay in the contracts; application datum transformations and vertical envelopes are explicit policies.

The active framework excludes cube implementations and body-specific source tools. See [terrain data](../../terrain-core/README.md) and [framework architecture](../../spacexr-rendering/docs/architecture.md).
