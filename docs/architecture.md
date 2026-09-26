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

## Future runtime

The runtime will depend on ports for resource resolution, camera state, scheduling, content decoding and rendering. Concrete adapters will bind those ports to Babylon, Three.js, Unreal or another host.

