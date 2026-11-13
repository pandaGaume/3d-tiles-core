# @spacexr/tiles

Renderer-neutral tile addressing, topology, URL templates, HTTP sources and on-demand pyramids. The package has no renderer, body catalogue, cube projection or provider preset.

## Configure a source

The application supplies its `GeodeticSystem`, normally constructed from the ellipsoid selected in `spacexr-celestial`. No reference body is selected implicitly.

```ts
import type { GeodeticSystem } from "@spacexr/geodesy";
import { WebMercatorTileMetrics, WebTileSource } from "@spacexr/tiles";

export function createSource(system: GeodeticSystem, urlTemplate: string) {
    return new WebTileSource({
        id: "application-source",
        urlTemplate,
        metrics: new WebMercatorTileMetrics({ minLOD: 0, maxLOD: 18 }, system),
        registration: "area",
    });
}
```

Tile addresses, parents/children, flat neighbours, residency and ancestor areas stay independent of content. An optional root identifier isolates independent pyramids; it does not install a particular projection. `ReferenceSurface`, direction conversions and edge rotations are generic mathematical helpers under the `surface` and `addressing` entries.

Web Mercator and source projections require explicit radii or geodetic systems. Raster registration is always declared: `area` describes pixel areas; `point` describes shared-edge samples. The single 3D Tiles runtime composes these primitives with its own wire model.

The former `./cube` export and cube reprojection were removed from the active package. Source-specific WMTS captures and body datasets are outside this framework delivery. See [the framework architecture](../../../../spacexr-rendering/docs/architecture.md).
