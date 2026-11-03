import { TILE_EDGE_NEIGHBORS, ancestorTileAddress, tileNeighborAddress } from "@spacexr/tiles";

import type { ITileAddress } from "../implicit/tile-data-source";

/** Address of a quadtree tile within a namespace: one implicit tileset, or a pyramid shared by several. */
export interface IQuadtreeTileLocation {
    /** Prefix shared by the tiles that can be neighbours. */
    namespace: string;
    address: ITileAddress;
    /** Wraps columns around the antimeridian, for pyramids covering every longitude. */
    wrapX: boolean;
}

export function quadtreeTileKey(namespace: string, address: ITileAddress): string {
    return `${namespace}${address.lod}/${address.x}/${address.y}`;
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
    for (const { namespace, address, wrapX } of displayed) {
        if (address.lod < 2) continue;
        for (const edge of TILE_EDGE_NEIGHBORS) {
            const neighbor = tileNeighborAddress(address, edge, { wrapX });
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
