# Architecture

## Language-neutral layers

The repository separates the standard contract from its implementations:

```text
3D Tiles resources
        |
        v
wire model -> codecs -> validation
        |
        v
generic runtime ports
        |
        +-> Babylon adapter
        +-> Three.js adapter
        +-> Unreal adapter
```

GeoModels is a consumer of these layers. GeoModels metadata, BUSINESS MODEL, VIEW and PROFILE contracts must remain in the GeoModels repository and integrate through future extension and metadata ports.

## Wire model

The wire model is a faithful in-memory representation of serialized 3D Tiles resources. It contains no loading state, parent pointers, scene objects, credentials or resolved URI cache.

## Codec

A codec converts between JSON text and the wire model. It does not fetch resources and it does not resolve URIs. A decode and encode cycle preserves extension, extras and application-defined members.

## Validation

Validation returns diagnostics independently from parsing. Structural validation is implemented first. Normative JSON Schema validation and cross-resource compatibility checks can be added without changing the codec contract.

## Generic runtime

The runtime is implemented in `@spacexr/3d-tiles-runtime`. It owns traversal, screen-space-error refinement, concurrent loading, external tileset grafting, metadata resolution and the presentation lifecycle.

It depends on interfaces for resource resolution, camera events, spatial metrics, content decoding, glyph publication and telemetry. Concrete adapters bind those interfaces to Babylon, Three.js, Unreal or another host.

Runtime state is stored in `IRuntimeTile` and `IRuntimeContent`. It is never written into `ITile`, `IContent` or `ITileset`.

See [Runtime architecture](runtime-architecture.md) for lifecycle and metadata behavior.
