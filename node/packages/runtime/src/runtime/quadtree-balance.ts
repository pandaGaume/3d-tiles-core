import {
    TILE_EDGE_NEIGHBORS,
    ancestorTileAddress,
    tileAddressKey,
    tileNeighborAddress,
    type ITileTopology,
    type TileEdgeNeighbor,
} from "@spacexr/tiles";

import type { ITileAddress } from "../implicit/tile-data-source";

/** Address of a quadtree tile within a namespace: one implicit tileset, or a pyramid shared by several. */
export interface IQuadtreeTileLocation {
    /** Prefix shared by the tiles that can be neighbours. */
    namespace: string;
    address: ITileAddress;
    /** Wraps columns around the antimeridian, for pyramids covering every longitude. */
    wrapX: boolean;
    /** How the tiles connect, for example across the faces of the cube index, in place of `wrapX`. */
    topology?: ITileTopology;
}

/** Neighbour of a located tile across an edge. */
function edgeNeighbor(location: IQuadtreeTileLocation, edge: TileEdgeNeighbor): ITileAddress | undefined {
    const { address, topology, wrapX } = location;
    return topology ? topology.neighbor(address, edge)?.address : tileNeighborAddress(address, edge, { wrapX });
}

export function quadtreeTileKey(namespace: string, address: ITileAddress): string {
    return `${namespace}${tileAddressKey(address)}`;
}

/** A displayed tile next to a displayed tile two or more levels coarser. */
export interface IQuadtreeImbalance<T> {
    fine: T;
    /** Level of the coarser neighbour. */
    coarseLod: number;
}

/**
 * Pairs of displayed tiles sharing an edge whose levels differ by two or more, reported from the finer tile.
 *
 * @param displayed - Displayed tiles with their location and a value returned in the result.
 */
export function quadtreeImbalances<T>(displayed: Iterable<{ location: IQuadtreeTileLocation; value: T }>): IQuadtreeImbalance<T>[] {
    const entries = [...displayed];
    const keys = new Set(entries.map(({ location }) => quadtreeTileKey(location.namespace, location.address)));
    const imbalances: IQuadtreeImbalance<T>[] = [];
    for (const { location, value } of entries) {
        const { namespace } = location;
        let coarseLod: number | undefined;
        for (const edge of TILE_EDGE_NEIGHBORS) {
            const neighbor = edgeNeighbor(location, edge);
            if (!neighbor) continue;
            for (let levels = 2; levels <= neighbor.lod; levels++) {
                const ancestor = ancestorTileAddress(neighbor, levels);
                if (!keys.has(quadtreeTileKey(namespace, ancestor))) continue;
                coarseLod = Math.min(coarseLod ?? ancestor.lod, ancestor.lod);
                break;
            }
        }
        if (coarseLod !== undefined) imbalances.push({ fine: value, coarseLod });
    }
    return imbalances;
}

/**
 * Tiles that must refine so that every displayed tile has its edge neighbours within one level of detail (2:1
 * balance). For each displayed tile of level `L` and each edge neighbour at level `L`, every ancestor of that
 * neighbour at level `L - 2` or coarser must refine: such an ancestor would otherwise be displayed next to the tile,
 * two or more levels apart. Diagonal neighbours do not matter, because tile corners exist at every level.
 *
 * @returns Keys built with {@link quadtreeTileKey}.
 */
export function quadtreeBalanceRefinements(displayed: Iterable<IQuadtreeTileLocation>): Set<string> {
    const refinements = new Set<string>();
    for (const location of displayed) {
        const { namespace, address } = location;
        if (address.lod < 2) continue;
        for (const edge of TILE_EDGE_NEIGHBORS) {
            const neighbor = edgeNeighbor(location, edge);
            if (!neighbor) continue;
            for (let levels = 2; levels <= neighbor.lod; levels++) {
                const key = quadtreeTileKey(namespace, ancestorTileAddress(neighbor, levels));
                // Coarser ancestors were added together with this one by an earlier tile.
                if (refinements.has(key)) break;
                refinements.add(key);
            }
        }
    }
    return refinements;
}
