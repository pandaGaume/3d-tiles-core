import { childTileAddresses, parentTileAddress, TileNeighbor, tileNeighborAddress, type ITileAddress, type TileEdgeNeighbor } from "@spacexr/tiles";

/** Edges of a drape instance, as bits of {@link IDrapeInstance.coarserEdges}. */
export const DrapeInstanceEdge = {
    N: 1,
    E: 2,
    S: 4,
    W: 8,
} as const;

/** One instance of the shared grid: a tile of the instance cut. */
export interface IDrapeInstance {
    /** Tile drawn by the instance. */
    address: ITileAddress;
    /** Presented terrain tile containing it, whose DEM tile gives its elevation. */
    terrain: ITileAddress;
    /**
     * Edges whose neighbour instance is one level coarser, a combination of {@link DrapeInstanceEdge} bits: the
     * instance draws the predefined grid variant whose edges drop their odd vertices there, so that both sides draw
     * the same segments.
     */
    coarserEdges: number;
}

export interface IDrapeInstanceCutOptions {
    /** Deepest instance, in levels below its terrain tile. Defaults to 6. */
    maxDepth?: number;
    /**
     * Time a level below a terrain tile stays in the cut after the imagery cut stopped reaching it, in milliseconds,
     * so that the transient cuts of a replacement, or a cut coarsening for a moment while the camera turns, do not
     * flash coarser imagery. Defaults to 500.
     */
    holdMilliseconds?: number;
    /** Wraps columns around the antimeridian. Defaults to true. */
    wrapX?: boolean;
}

/** Children of a neighbour that touch the tile, in `childTileAddresses` order NW, NE, SW, SE. */
const CHILDREN_FACING: Readonly<Record<TileEdgeNeighbor, readonly [number, number]>> = {
    [TileNeighbor.N]: [2, 3],
    [TileNeighbor.E]: [0, 2],
    [TileNeighbor.S]: [0, 1],
    [TileNeighbor.W]: [1, 3],
};

const EDGES: readonly [TileEdgeNeighbor, number][] = [
    [TileNeighbor.N, DrapeInstanceEdge.N],
    [TileNeighbor.E, DrapeInstanceEdge.E],
    [TileNeighbor.S, DrapeInstanceEdge.S],
    [TileNeighbor.W, DrapeInstanceEdge.W],
];

function key(address: ITileAddress): string {
    return `${address.lod}/${address.x}/${address.y}`;
}

/**
 * The instance cut of GPU draping: the leaves of the union of the terrain cut and the imagery cut, balanced so that
 * every edge joins instances at most one level apart.
 *
 * Inside each presented terrain tile, the imagery tiles of the cut below it become instances, completed with the
 * tiles needed to cover the terrain tile without overlap; a terrain tile without finer imagery is one instance. A
 * level below a terrain tile stays for `holdMilliseconds` after the imagery cut stopped reaching it. Leaves whose edge
 * neighbour is subdivided two levels deeper or more are split until the cut is balanced.
 */
export class DrapeInstanceCut {
    public readonly maxDepth: number;
    public readonly holdMilliseconds: number;
    private readonly wrapX: boolean;
    /** Tiles with imagery below them, by the last time the imagery cut reached below them. */
    private readonly subdivided = new Map<string, number>();
    private expiry: number | undefined;

    public constructor(options: IDrapeInstanceCutOptions = {}) {
        this.maxDepth = options.maxDepth ?? 6;
        if (!Number.isInteger(this.maxDepth) || this.maxDepth < 0) throw new RangeError("The maximum instance depth must be a non-negative integer.");
        this.holdMilliseconds = Math.max(0, options.holdMilliseconds ?? 500);
        this.wrapX = options.wrapX ?? true;
    }

    /** Time at which a held level leaves the cut, so that the cut must be computed again; `undefined` when none is held. */
    public get expiresAt(): number | undefined {
        return this.expiry;
    }

    /**
     * Computes the instances of the current cuts.
     *
     * @param terrainCut - Presented terrain tiles, which do not overlap.
     * @param imageryCut - Presented imagery tiles.
     * @param now - Current time in milliseconds, for the hold of coarsened levels.
     */
    public update(terrainCut: Iterable<ITileAddress>, imageryCut: Iterable<ITileAddress>, now: number): IDrapeInstance[] {
        this.recordImagery(imageryCut, now);
        const leaves = new Map<string, IDrapeInstance>();
        const split = (address: ITileAddress, terrain: ITileAddress): void => {
            if (address.lod - terrain.lod < this.maxDepth && this.subdivided.has(key(address))) {
                for (const child of childTileAddresses(address)) split(child, terrain);
                return;
            }
            leaves.set(key(address), { address, terrain, coarserEdges: 0 });
        };
        for (const terrain of terrainCut) split({ ...terrain }, { ...terrain });
        this.balance(leaves);
        for (const leaf of leaves.values()) leaf.coarserEdges = this.coarserEdges(leaf.address, leaves);
        return [...leaves.values()];
    }

    /** Records the tiles the imagery cut reaches below, and forgets those whose hold elapsed. */
    private recordImagery(imageryCut: Iterable<ITileAddress>, now: number): void {
        for (const tile of imageryCut) {
            for (let ancestor = parentTileAddress(tile); ancestor; ancestor = parentTileAddress(ancestor)) {
                const ancestorKey = key(ancestor);
                // Ancestors already refreshed by another tile of this cut are refreshed up to the root.
                if (this.subdivided.get(ancestorKey) === now) break;
                this.subdivided.set(ancestorKey, now);
            }
        }
        this.expiry = undefined;
        for (const [tileKey, seen] of this.subdivided) {
            if (seen === now) continue;
            const expires = seen + this.holdMilliseconds;
            if (expires <= now) this.subdivided.delete(tileKey);
            else this.expiry = Math.min(this.expiry ?? expires, expires);
        }
    }

    /** Splits the leaves whose edge neighbour is subdivided two levels deeper or more, until none is. */
    private balance(leaves: Map<string, IDrapeInstance>): void {
        // Strict ancestors of the leaves: the tiles subdivided below them.
        const inner = new Set<string>();
        const addAncestors = (address: ITileAddress): void => {
            for (let ancestor = parentTileAddress(address); ancestor; ancestor = parentTileAddress(ancestor)) {
                const ancestorKey = key(ancestor);
                if (inner.has(ancestorKey)) return;
                inner.add(ancestorKey);
            }
        };
        for (const leaf of leaves.values()) addAncestors(leaf.address);

        const queue = [...leaves.values()];
        while (queue.length > 0) {
            const leaf = queue.pop()!;
            if (leaves.get(key(leaf.address)) !== leaf) continue;
            const deeper = EDGES.some(([edge]) => {
                const neighbor = tileNeighborAddress(leaf.address, edge, { wrapX: this.wrapX });
                if (!neighbor) return false;
                const children = childTileAddresses(neighbor);
                return CHILDREN_FACING[edge].some((index) => inner.has(key(children[index]!)));
            });
            if (!deeper) continue;
            leaves.delete(key(leaf.address));
            inner.add(key(leaf.address));
            for (const child of childTileAddresses(leaf.address)) {
                const instance = { address: child, terrain: leaf.terrain, coarserEdges: 0 };
                leaves.set(key(child), instance);
                queue.push(instance);
            }
            // Coarser neighbours may now be two levels from the new children.
            for (const [edge] of EDGES) {
                const neighbor = tileNeighborAddress(leaf.address, edge, { wrapX: this.wrapX });
                for (let tile = neighbor; tile; tile = parentTileAddress(tile)) {
                    const coarser = leaves.get(key(tile));
                    if (coarser) {
                        queue.push(coarser);
                        break;
                    }
                }
            }
        }
    }

    /** Edges of a leaf whose neighbour leaf is one level coarser. */
    private coarserEdges(address: ITileAddress, leaves: ReadonlyMap<string, IDrapeInstance>): number {
        let edges = 0;
        for (const [edge, bit] of EDGES) {
            const neighbor = tileNeighborAddress(address, edge, { wrapX: this.wrapX });
            if (!neighbor || leaves.has(key(neighbor))) continue;
            const parent = parentTileAddress(neighbor);
            if (parent && leaves.has(key(parent))) edges |= bit;
        }
        return edges;
    }
}
