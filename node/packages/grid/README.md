<img src="https://raw.githubusercontent.com/pandaGaume/3d-tiles-core/main/assets/brand/spacexr-component.png" alt="SpaceXR Component" height="56">

# @spacexr/grid

Renderer-neutral terrain grid topologies with crack-free junctions between neighbouring levels of detail. The package produces normalized `u, v` topologies that an adapter projects onto a region, an ellipsoid or a plane, on the CPU or in a vertex shader. Neighbours, levels of detail and axes are those of the tiles of [`@spacexr/tiles`](https://github.com/pandaGaume/3d-tiles-core/tree/main/node/packages/tiles).

## Install

```bash
npm install @spacexr/grid
```

## Regular grid

```ts
import { buildGridVertices, createGridTopology } from "@spacexr/grid";

const topology = createGridTopology(16); // 16 x 16 cells, u east, v south
const data = buildGridVertices(topology, {
    scaleX: 1000,
    zInitializer: ({ u, v }) => sampleHeight(u, v), // also receives column, row, columns and rows
    uvs: true,
    uvInitializer: ({ u, v }) => [u, 1 - v],
    normals: true,
});
```

## Junctions between levels of detail

Each edge neighbour `TileNeighbor.N`, `E`, `S` and `W` receives its level relative to the tile: `NeighborLod.Coarser` (`-1`), `Same` (`0`) or `Finer` (`+1`). `gridEdgeLods` derives them from the levels of detail displayed around the tile.

```ts
import { GridJunctionPieces, JunctionGridTopologyCache, gridEdgeLods } from "@spacexr/grid";
import { TileNeighbor, tileNeighborAddress } from "@spacexr/tiles";

const lods = gridEdgeLods(tile, (edge) => displayedLodAt(tileNeighborAddress(tile, edge)));

// One grid per tile: 81 variants, built on demand.
const grids = new JunctionGridTopologyCache(16);
const topology = grids.get(lods);

// Or nine pieces indexed like the neighbour layout, which can be instanced.
const pieces = new GridJunctionPieces(16).select(lods);
const interior = pieces[TileNeighbor.C];
const northBand = pieces[TileNeighbor.N];
const northWestCorner = pieces[TileNeighbor.NW];
```

Only one tile of a junction adapts: either the coarse tile uses `Finer`, or the fine tile uses `Coarser`. See [Terrain grids](https://github.com/pandaGaume/3d-tiles-core/blob/main/docs/grid.md) for the triangulation rules and illustrations.

## Vertex placement

`buildGridVertices` is the port of the SpaceXR `TerrainNormalizedGridBuilder`: centred positions with `scaleX`, `scaleY`, `offsetColumns` and `offsetRows`, Z and texture coordinates computed per vertex by `zInitializer` and `uvInitializer`, which receive `u`, `v`, `column`, `row`, `columns` and `rows`, optional normals, `invertYZ` for Y-up engines and `invertIndices` to reverse the winding.

## License

Apache-2.0.
