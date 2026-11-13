import { TileNeighbor, type TileEdgeNeighbor } from "./tile-neighbors";
const EDGE_ORDER: readonly TileEdgeNeighbor[] = [TileNeighbor.N, TileNeighbor.E, TileNeighbor.S, TileNeighbor.W];
/** Rotate a tile edge in quarter turns within its local frame. */
export function turnTileEdge(edge: TileEdgeNeighbor, turns: number): TileEdgeNeighbor {
    const index = EDGE_ORDER.indexOf(edge);
    if (index < 0) throw new RangeError(`${TileNeighbor[edge] ?? edge} is not an edge.`);
    return EDGE_ORDER[(((index + turns) % 4) + 4) % 4]!;
}

/** Edge on the other side of a tile. */
export function oppositeTileEdge(edge: TileEdgeNeighbor): TileEdgeNeighbor {
    return turnTileEdge(edge, 2);
}
