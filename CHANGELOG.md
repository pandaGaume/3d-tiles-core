# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [Unreleased]

### Added

- Multilanguage repository structure.
- Initial TypeScript wire model for 3D Tiles 1.1.
- Lossless JSON codecs and structural validation.
- Node.js CI and npm trusted publishing workflows.
- Renderer-neutral runtime package with camera, content, glyph, spatial metric and telemetry ports.
- Hole-free REPLACE traversal, ADD traversal, external tileset grafting and concurrent loading.
- Metadata scope resolution, validation, transformation and external schema loading.
- Uppercase `I` prefix convention for every TypeScript interface.
- Standard implicit QUADTREE and OCTREE traversal, sparse subtree availability, JSON and binary subtree codecs, and XYZ or TMS Web Map pyramid adaptation.
- Budgeted LRU navigation cache for renderables, subtree payloads and materialized implicit branches.
- Optional real-time runtime statistics, metric aggregation, cache events and eviction hooks.
- External `@spacexr/geodesy` integration for ellipsoid-aware ECEF regions and horizon culling.
