import { ancestorTileAddress, tileAddressKey as key, type ITileAddress } from "../addressing/tile-address";
import { tileNeighborAddress, type TileNeighbor } from "../addressing/tile-neighbors";

/** Loads the content of one tile, or `undefined` when the pyramid has no such tile. */
export type TileContentLoader<T> = (address: ITileAddress) => Promise<T | undefined>;

/** Part of an ancestor tile covered by a tile, in normalized ancestor coordinates, `west` and `north` from 0. */
export interface ITileAreaInAncestor {
    ancestor: ITileAddress;
    west: number;
    north: number;
    /** Width and height of the area, `1 / 2^levels`. */
    size: number;
}

/** The ancestor `levels` levels above a tile and the part of it the tile covers. */
export function tileAreaInAncestor(address: ITileAddress, levels: number): ITileAreaInAncestor {
    const ancestor = ancestorTileAddress(address, levels);
    const scale = 2 ** (address.lod - ancestor.lod);
    return {
        ancestor,
        west: (address.x - ancestor.x * scale) / scale,
        north: (address.y - ancestor.y * scale) / scale,
        size: 1 / scale,
    };
}

export interface ITilePyramidOptions<T> {
    load: TileContentLoader<T>;
    /** Deepest level of the pyramid; deeper tiles use the sub-area of their ancestor at this level (overzoom). */
    maxLOD: number;
    /**
     * Level of the pyramid tile serving a tile, for a sparse pyramid whose depth varies from place to place. A tile deeper
     * than the data at its place then uses the sub-area of its ancestor there. Defaults to the same level everywhere.
     */
    servingLevel?: (address: ITileAddress) => number;
    /** Tiles kept in memory. Defaults to 256. */
    cacheEntries?: number;
    /** Wraps columns around the antimeridian, for pyramids covering every longitude. Defaults to false. */
    wrapX?: boolean;
    /**
     * Neighbours loaded with every tile, or with a given tile, for contents that need them: `[E, S, SE]` to stitch the
     * extra column and row of a raster, or every position to prepare a move. A missing or failing neighbour is ignored.
     * Defaults to none.
     */
    prefetch?: readonly TileNeighbor[] | ((address: ITileAddress) => readonly TileNeighbor[]);
    /** Called when the content of a tile is loaded and still cached. */
    onLoad?: (address: ITileAddress, content: T) => void;
    /** Called when a tile leaves the cache. */
    onEvict?: (address: ITileAddress) => void;
}

/** Content of the pyramid tile serving a tile, with the part of it the tile covers. */
export interface ITilePyramidRegion<T> extends ITileAreaInAncestor {
    /** Tile requested. */
    address: ITileAddress;
    /** Content of `ancestor`, the tile itself up to `maxLOD`. */
    content: T;
}

interface ITilePyramidEntry<T> {
    readonly address: ITileAddress;
    readonly loading: Promise<T | undefined>;
    content: T | undefined;
}

/**
 * Tiles of a pyramid loaded on demand, whatever their content: rasters, meshes, vector data.
 *
 * Each tile loads once and is shared by every request, including the requests of deeper tiles beyond `maxLOD`, which
 * use a sub-area of their ancestor. The least recently used tiles leave the cache, except the tiles retained by their
 * users, which may exceed its capacity. Neighbours listed in `prefetch` load with every tile.
 */
export class TilePyramid<T> {
    public readonly maxLOD: number;
    private readonly options: ITilePyramidOptions<T>;
    private readonly cacheEntries: number;
    private readonly entries = new Map<string, ITilePyramidEntry<T>>();
    /** Retain counts of the pyramid tiles that must stay in the cache. */
    private readonly retained = new Map<string, number>();

    public constructor(options: ITilePyramidOptions<T>) {
        if (!Number.isInteger(options.maxLOD) || options.maxLOD < 0) throw new RangeError("maxLOD must be a non-negative integer.");
        this.options = options;
        this.maxLOD = options.maxLOD;
        this.cacheEntries = options.cacheEntries ?? 256;
    }

    /** Number of tiles in memory, loaded or loading. */
    public get size(): number {
        return this.entries.size;
    }

    /** Level of the pyramid tile serving a tile level. */
    public sourceLevel(lod: number): number {
        return Math.min(lod, this.maxLOD);
    }

    /** The pyramid tile serving a tile and the part of it the tile covers. */
    public areaOf(address: ITileAddress): ITileAreaInAncestor {
        const level = this.options.servingLevel ? Math.min(this.options.servingLevel(address), this.sourceLevel(address.lod)) : this.sourceLevel(address.lod);
        return tileAreaInAncestor(address, address.lod - level);
    }

    /** Loaded content of a pyramid tile, without loading it. */
    public get(address: ITileAddress): T | undefined {
        return this.entries.get(key(address))?.content;
    }

    /**
     * Loads the pyramid tile serving a tile, with its prefetched neighbours.
     *
     * @returns The content and the part of it the tile covers, or `undefined` when the pyramid has no tile there.
     */
    public async load(address: ITileAddress): Promise<ITilePyramidRegion<T> | undefined> {
        const area = this.areaOf(address);
        const { prefetch = [] } = this.options;
        const neighbors = (typeof prefetch === "function" ? prefetch(area.ancestor) : prefetch)
            .map((position) => tileNeighborAddress(area.ancestor, position, { wrapX: this.options.wrapX ?? false }))
            .filter((neighbor) => neighbor !== undefined);
        const [content] = await Promise.all([this.tile(area.ancestor), ...neighbors.map((neighbor) => this.tile(neighbor).catch(() => undefined))]);
        return content === undefined ? undefined : { ...area, address: { ...address }, content };
    }

    /**
     * Keeps the pyramid tile serving a tile in the cache until it is released as many times, for example while a
     * renderer displays data sampled from it. A retained tile still has to be loaded.
     */
    public retain(address: ITileAddress): void {
        const tileKey = key(this.areaOf(address).ancestor);
        this.retained.set(tileKey, (this.retained.get(tileKey) ?? 0) + 1);
    }

    /** Releases a tile retained with {@link retain}; the cache then evicts it like any other once it is full. */
    public release(address: ITileAddress): void {
        const tileKey = key(this.areaOf(address).ancestor);
        const count = (this.retained.get(tileKey) ?? 0) - 1;
        if (count > 0) this.retained.set(tileKey, count);
        else this.retained.delete(tileKey);
        this.evictOverflow();
    }

    /** Removes a tile from the cache. */
    public delete(address: ITileAddress): boolean {
        const deleted = this.entries.delete(key(address));
        if (deleted) this.options.onEvict?.(address);
        return deleted;
    }

    private tile(address: ITileAddress): Promise<T | undefined> {
        const tileKey = key(address);
        const cached = this.entries.get(tileKey);
        if (cached) {
            // Most recently used last.
            this.entries.delete(tileKey);
            this.entries.set(tileKey, cached);
            return cached.loading;
        }
        const loading = this.options.load(address).then((content) => {
            // A tile evicted while loading, or replaced since, is dropped.
            if (this.entries.get(tileKey) === entry) {
                entry.content = content;
                if (content !== undefined) this.options.onLoad?.(entry.address, content);
            }
            return content;
        });
        const entry: ITilePyramidEntry<T> = { address: { ...address }, loading, content: undefined };
        loading.catch(() => {
            if (this.entries.get(tileKey) === entry) this.entries.delete(tileKey);
        });
        this.entries.set(tileKey, entry);
        this.evictOverflow();
        return loading;
    }

    /** Evicts the least recently used tiles that are not retained while the cache exceeds its capacity. */
    private evictOverflow(): void {
        if (this.entries.size <= this.cacheEntries) return;
        for (const [tileKey, entry] of this.entries) {
            if (this.entries.size <= this.cacheEntries) return;
            if (!this.retained.has(tileKey)) this.delete(entry.address);
        }
    }
}
