import { TileNeighbor, tileNeighborAddress, type ITileAddress, type ITileNeighborOptions } from "../addressing";
import { createHeightGrid, type IHeightGrid } from "../codecs";

function key(address: ITileAddress): string {
    return `${address.lod}/${address.x}/${address.y}`;
}

interface IStitchedEntry {
    readonly address: ITileAddress;
    /** `(width + 1) x (height + 1)` samples, row-major from the north-west corner. */
    readonly heights: Float32Array;
    readonly width: number;
    readonly height: number;
    grid: IHeightGrid;
}

/**
 * Height grids of neighbouring DEM tiles stitched together, as SpaceXR does for its elevation textures.
 *
 * A DEM tile of `w x h` pixels does not reach its east and south edges: its last pixels lie half a pixel inside the
 * tile, so two neighbouring tiles never share a sample. Each tile therefore receives one extra column and one extra
 * row, `(w + 1) x (h + 1)` samples in `point` registration:
 *
 * - the extra column is the first column of the east neighbour `E`;
 * - the extra row is the first row of the south neighbour `S`;
 * - the extra corner is the first sample of the south-east neighbour `SE`.
 *
 * Until a neighbour is added, its part repeats the edge of the tile itself. Adding a tile also completes the tiles
 * already present on its west, north and north-west, so that the arrival order does not matter. Shared edges then
 * hold the same samples on both sides, and grids sampled with `point` registration meet without cracks.
 */
export class StitchedHeightGrids {
    private readonly entries = new Map<string, IStitchedEntry>();

    /** @param options - Neighbour lookup; `wrapX` stitches the antimeridian of a global pyramid. */
    public constructor(private readonly options: ITileNeighborOptions = {}) {}

    public get size(): number {
        return this.entries.size;
    }

    public has(address: ITileAddress): boolean {
        return this.entries.has(key(address));
    }

    /** The stitched grid of a tile, to sample with `point` registration, or `undefined` when the tile is absent. */
    public get(address: ITileAddress): IHeightGrid | undefined {
        return this.entries.get(key(address))?.grid;
    }

    /**
     * Adds or replaces the grid of a tile.
     *
     * @returns The tiles whose stitched grid changed: the tile itself and the neighbours it completed.
     * @throws RangeError When a neighbour already present has a different size.
     */
    public add(address: ITileAddress, grid: IHeightGrid): ITileAddress[] {
        const { width, height } = grid;
        const stitchedWidth = width + 1;
        const heights = new Float32Array(stitchedWidth * (height + 1));
        for (let row = 0; row < height; row++) {
            heights.set(grid.heights.subarray(row * width, (row + 1) * width), row * stitchedWidth);
            heights[row * stitchedWidth + width] = grid.heights[row * width + width - 1]!;
        }
        heights.set(heights.subarray((height - 1) * stitchedWidth, height * stitchedWidth), height * stitchedWidth);
        const entry: IStitchedEntry = { address: { ...address }, heights, width, height, grid };
        this.entries.set(key(address), entry);

        const neighbor = (position: TileNeighbor): IStitchedEntry | undefined => {
            const neighborAddress = tileNeighborAddress(address, position, this.options);
            const found = neighborAddress ? this.entries.get(key(neighborAddress)) : undefined;
            if (found && found !== entry && (found.width !== width || found.height !== height)) {
                throw new RangeError(`Tile ${key(found.address)} has ${found.width} x ${found.height} samples, expected ${width} x ${height}.`);
            }
            return found === entry ? undefined : found;
        };

        // Pull the edges of the neighbours already present on the east, south and south-east.
        const east = neighbor(TileNeighbor.E);
        if (east) copyFirstColumn(east, entry);
        const south = neighbor(TileNeighbor.S);
        if (south) copyFirstRow(south, entry);
        const southEast = neighbor(TileNeighbor.SE);
        if (southEast) entry.heights[entry.heights.length - 1] = southEast.heights[0]!;
        entry.grid = createHeightGrid(stitchedWidth, height + 1, heights);

        // Push the edges of the tile into the neighbours already present on the west, north and north-west.
        const changed: ITileAddress[] = [entry.address];
        const west = neighbor(TileNeighbor.W);
        if (west) copyFirstColumn(entry, west);
        const north = neighbor(TileNeighbor.N);
        if (north) copyFirstRow(entry, north);
        const northWest = neighbor(TileNeighbor.NW);
        if (northWest) northWest.heights[northWest.heights.length - 1] = entry.heights[0]!;
        for (const completed of [west, north, northWest]) {
            if (!completed || changed.some((address) => key(address) === key(completed.address))) continue;
            completed.grid = createHeightGrid(completed.width + 1, completed.height + 1, completed.heights);
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
function copyFirstColumn(source: IStitchedEntry, target: IStitchedEntry): void {
    const sourceWidth = source.width + 1;
    const targetWidth = target.width + 1;
    for (let row = 0; row < target.height; row++) target.heights[row * targetWidth + target.width] = source.heights[row * sourceWidth]!;
}

/** Copies the first row of `source` into the extra row of `target`, the tile on its north. */
function copyFirstRow(source: IStitchedEntry, target: IStitchedEntry): void {
    target.heights.set(source.heights.subarray(0, source.width), target.height * (target.width + 1));
}
