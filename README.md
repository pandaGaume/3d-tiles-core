<p align="center">
  <img src="assets/brand/3d-tiles-core-logo.png" alt="3D Tiles Core" width="900">
</p>

# 3D Tiles Core

`3d-tiles-core` provides implementation-neutral building blocks for OGC 3D Tiles.

The repository is organized by target language so the same contracts can later be implemented for Node.js, .NET and C++ or Unreal Engine without coupling the standard model to a rendering engine.

## Repository layout

```text
node/packages/core/  TypeScript interfaces, codecs and validation
conformance/         Shared positive and negative conformance fixtures
dotnet/              Reserved for the future .NET implementation
cpp/                 Reserved for the future C++ and Unreal implementation
docs/                Cross-language architecture and compatibility rules
assets/brand/         Project logo and icon
```

The first deliverable deliberately excludes rendering and streaming state. It contains the serializable 3D Tiles 1.1 model, JSON codecs, structural validation and conformance-oriented tests.

## Node.js development

```bash
cd node
npm ci
npm run check
```

The published package is planned as `@spacexr/3d-tiles-core` under the `pandaGaume` GitHub organization.

## Architectural rule

Serialized 3D Tiles documents are immutable data contracts. A future runtime may build mutable runtime nodes from them, but it must not add execution state to the serialized interfaces.

## Brand assets

The pixel-art identity combines a tiled spatial hierarchy with geological layers. Both PNG assets use a transparent background and are ready for repository, package and application use.

<p align="center">
  <img src="assets/brand/3d-tiles-core-icon.png" alt="3D Tiles Core icon" width="180">
</p>

- [Horizontal logo](assets/brand/3d-tiles-core-logo.png)
- [Square icon](assets/brand/3d-tiles-core-icon.png)

## License

Apache-2.0. See [LICENSE](LICENSE).
