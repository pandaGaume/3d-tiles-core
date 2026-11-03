import { TileNeighbor, tileNeighborAddress, type ITileAddress, type ITileNeighborOptions } from "@spacexr/tiles";

import { allocateLike, createRasterGrid, type IRasterGrid } from "./raster-grid";

/** Builds the grid type of a stitched raster, for example a height grid with its range, from stitched values. */
export type RasterGridFactory<TGrid extends IRasterGrid> = (width: number, height: number, channels: number, data: TGrid["data"]) => TGrid;

export interface IStitchedRasterGridsOptions<TGrid extends IRasterGrid> extends ITileNeighborOptions {
    /** Builds each stitched grid. Defaults to a plain {@link IRasterGrid}. */
    create?: RasterGridFactory<TGrid>;
}

function key(address: ITileAddress): string {
    return `${address.lod}/${address.x}/${address.y}`;
}

interface IStitchedEntry<TGrid extends IRasterGrid> {
    readonly address: ITileAddress;
    /** `(width + 1) x (height + 1)` samples, row-major from the north-west corner. */
    readonly data: TGrid["data"];
    readonly width: number;
    readonly height: number;
    readonly channels: number;
    grid: TGrid;
}

/**
 * Rasters of neighbouring tiles stitched together, as SpaceXR does for its elevation textures.
 *
 * A tile of `w x h` pixels does not reach its east and south edges: its last pixels lie half a pixel inside the
 * tile, so two neighbouring tiles never share a sample. Heights and colours alike then show a seam once interpolated.
 * Each tile therefore receives one extra column and one extra row, `(w + 1) x (h + 1)` samples in `point`
 * registration:
 *
 * - the extra column is the first column of the east neighbour `E`;
 * - the extra row is the first row of the south neighbour `S`;
 * - the extra corner is the first sample of the south-east neighbour `SE`.
 *
 * Until a neighbour is added, its part repeats the edge of the tile itself. Adding a tile also completes the tiles
 * already present on its west, north and north-west, so that the arrival order does not matter. Shared edges then
 * hold the same samples on both sides, and grids sampled with `point` registration meet without seams.
 */
export class StitchedRasterGrids<TGrid extends IRasterGrid = IRasterGrid> {
    private readonly entries = new Map<string, IStitchedEntry<TGrid>>();
    private readonly create: RasterGridFactory<TGrid>;

    /** @param options - Neighbour lookup, where `wrapX` stitches the antimeridian of a global pyramid, and grid factory. */
    public constructor(private readonly options: IStitchedRasterGridsOptions<TGrid> = {}) {
        this.create = options.create ?? ((width, height, channels, data) => createRasterGrid(width, height, channels, data) as TGrid);
    }

    public get size(): number {
        return this.entries.size;
    }

    public has(address: ITileAddress): boolean {
        return this.entries.has(key(address));
    }

    /** The stitched grid of a tile, to sample with `point` registration, or `undefined` when the tile is absent. */
    public get(address: ITileAddress): TGrid | undefined {
        return this.entries.get(key(address))?.grid;
    }

    /**
     * Adds or replaces the raster of a tile.
     *
     * @returns The tiles whose stitched grid changed: the tile itself and the neighbours it completed.
     * @throws RangeError When a neighbour already present has a different size or number of channels.
     */
    public add(address: ITileAddress, grid: IRasterGrid<TGrid["data"]>): ITileAddress[] {
        const { width, height, channels } = grid;
        const rowLength = width * channels;
        const stitchedRowLength = (width + 1) * channels;
        const data = allocateLike(grid.data, stitchedRowLength * (height + 1));
        for (let row = 0; row < height; row++) {
            data.set(grid.data.subarray(row * rowLength, (row + 1) * rowLength), row * stitchedRowLength);
            data.set(grid.data.subarray((row + 1) * rowLength - channels, (row + 1) * rowLength), row * stitchedRowLength + rowLength);
        }
        data.copyWithin(height * stitchedRowLength, (height - 1) * stitchedRowLength, height * stitchedRowLength);
        const entry: IStitchedEntry<TGrid> = { address: { ...address }, data, width, height, channels, grid: undefined as unknown as TGrid };
        this.entries.set(key(address), entry);

        const neighbor = (position: TileNeighbor): IStitchedEntry<TGrid> | undefined => {
            const neighborAddress = tileNeighborAddress(address, position, this.options);
            const found = neighborAddress ? this.entries.get(key(neighborAddress)) : undefined;
            if (found && found !== entry && (found.width !== width || found.height !== height || found.channels !== channels)) {
                throw new RangeError(`Tile ${key(found.address)} has ${found.width} x ${found.height} x ${found.channels} values, expected ${width} x ${height} x ${channels}.`);
            }
            return found === entry ? undefined : found;
        };

        // Pull the edges of the neighbours already present on the east, south and south-east.
        const east = neighbor(TileNeighbor.E);
        if (east) copyFirstColumn(east, entry);
        const south = neighbor(TileNeighbor.S);
        if (south) copyFirstRow(south, entry);
        const southEast = neighbor(TileNeighbor.SE);
        if (southEast) copyFirstSample(southEast, entry);
        entry.grid = this.create(width + 1, height + 1, channels, data);

        // Push the edges of the tile into the neighbours already present on the west, north and north-west.
        const changed: ITileAddress[] = [entry.address];
        const west = neighbor(TileNeighbor.W);
        if (west) copyFirstColumn(entry, west);
        const north = neighbor(TileNeighbor.N);
        if (north) copyFirstRow(entry, north);
        const northWest = neighbor(TileNeighbor.NW);
        if (northWest) copyFirstSample(entry, northWest);
        for (const completed of [west, north, northWest]) {
            if (!completed || changed.some((address) => key(address) === key(completed.address))) continue;
            completed.grid = this.create(completed.width + 1, completed.height + 1, completed.channels, completed.data);
            changed.push(completed.address);
        }
        return changed;
    }

    /** Forgets a tile. The neighbours keep the edges it gave them. */
    public delete(address: ITileAddress): boolean {
        return this.entries.delete(key(address));
    }
}

/** Copies the first column of `source` into the extra column of `target`, the tile on its west. */
function copyFirstColumn<TGrid extends IRasterGrid>(source: IStitchedEntry<TGrid>, target: IStitchedEntry<TGrid>): void {
    const { channels } = target;
    const sourceRowLength = (source.width + 1) * channels;
    const targetRowLength = (target.width + 1) * channels;
    for (let row = 0; row < target.height; row++) {
        target.data.set(source.data.subarray(row * sourceRowLength, row * sourceRowLength + channels), row * targetRowLength + target.width * channels);
    }
}

/** Copies the first row of `source` into the extra row of `target`, the tile on its north. */
function copyFirstRow<TGrid extends IRasterGrid>(source: IStitchedEntry<TGrid>, target: IStitchedEntry<TGrid>): void {
    target.data.set(source.data.subarray(0, source.width * source.channels), target.height * (target.width + 1) * target.channels);
}

/** Copies the first sample of `source` into the extra corner of `target`, the tile on its north-west. */
function copyFirstSample<TGrid extends IRasterGrid>(source: IStitchedEntry<TGrid>, target: IStitchedEntry<TGrid>): void {
    target.data.set(source.data.subarray(0, source.channels), target.data.length - target.channels);
}
