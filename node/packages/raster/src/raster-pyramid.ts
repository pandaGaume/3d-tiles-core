import { TileNeighbor, TilePyramid, type ITileAddress, type ITileAreaInAncestor, type ITilePyramidOptions } from "@spacexr/tiles";

import type { IRasterGrid } from "./raster-grid";
import { rasterRangeInArea, sampleRasterBilinear, type IRasterRange } from "./sampling";
import { StitchedRasterGrids, type RasterGridFactory } from "./stitched-raster-grids";

export interface IRasterPyramidOptions<TGrid extends IRasterGrid> extends Omit<ITilePyramidOptions<IRasterGrid<TGrid["data"]>>, "prefetch" | "onLoad" | "onEvict"> {
    /** Builds each stitched grid. Defaults to a plain {@link IRasterGrid}. */
    create?: RasterGridFactory<TGrid>;
}

/** Stitched raster serving one tile, at any level, with the part of it the tile covers. */
export interface IRasterTileRegion<TGrid extends IRasterGrid> extends ITileAreaInAncestor {
    /** Tile requested. */
    address: ITileAddress;
    /** Stitched grid of `ancestor`, the tile itself up to `maxLOD`, in `point` registration. */
    grid: TGrid;
    /** Value of a channel at normalized tile coordinates, `u` west to east and `v` north to south. */
    sample(u: number, v: number, channel?: number): number;
    /** Range of a channel over every sample the tile can interpolate in an area given in tile coordinates. */
    range(west: number, north: number, east: number, south: number, channel?: number): IRasterRange;
}

/**
 * Raster tile pyramid loaded on demand, as one continuous surface: elevation, imagery, masks.
 *
 * Each tile loads with its east, south and south-east neighbours and is stitched with them, so that neighbouring
 * tiles of one level share their edge samples. Tiles beyond `maxLOD` sample the sub-area of their ancestor. Points
 * are addressed over the whole pyramid, `x` eastward and `y` southward in `[0, 1]`, so values do not depend on the
 * tile asking.
 */
export class RasterPyramid<TGrid extends IRasterGrid = IRasterGrid> {
    private readonly tiles: TilePyramid<IRasterGrid<TGrid["data"]>>;
    private readonly stitched: StitchedRasterGrids<TGrid>;
    private readonly wrapX: boolean;

    public constructor(options: IRasterPyramidOptions<TGrid>) {
        const { create, ...pyramid } = options;
        this.wrapX = options.wrapX ?? false;
        this.stitched = new StitchedRasterGrids<TGrid>({ wrapX: this.wrapX, ...(create ? { create } : {}) });
        this.tiles = new TilePyramid({
            ...pyramid,
            prefetch: [TileNeighbor.E, TileNeighbor.S, TileNeighbor.SE],
            onLoad: (address, grid) => this.stitched.add(address, grid),
            onEvict: (address) => this.stitched.delete(address),
        });
    }

    public get maxLOD(): number {
        return this.tiles.maxLOD;
    }

    /** Number of raster tiles in memory, loaded or loading. */
    public get size(): number {
        return this.tiles.size;
    }

    /** Raster level sampled for a tile level: tiles beyond `maxLOD` share the deepest rasters. */
    public sourceLevel(lod: number): number {
        return this.tiles.sourceLevel(lod);
    }

    /** Stitched grid of a loaded raster tile, without loading it. */
    public stitchedGrid(address: ITileAddress): TGrid | undefined {
        return this.stitched.get(address);
    }

    /**
     * Loads the raster serving a tile, with the neighbours that complete it.
     *
     * @returns The stitched grid and the part of it the tile covers, or `undefined` when the pyramid has no raster
     *     there.
     */
    public async load(address: ITileAddress): Promise<IRasterTileRegion<TGrid> | undefined> {
        const region = await this.tiles.load(address);
        if (!region) return undefined;
        const { ancestor, west, north, size } = region;
        // Evicted again while its neighbours loaded: stitch it once more.
        if (!this.stitched.has(ancestor)) this.stitched.add(ancestor, region.content);
        const grid = this.stitched.get(ancestor)!;
        return {
            address: region.address,
            ancestor,
            west,
            north,
            size,
            grid,
            sample: (u, v, channel = 0) => sampleRasterBilinear(grid, west + u * size, north + v * size, channel, "point"),
            range: (areaWest, areaNorth, areaEast, areaSouth, channel = 0) =>
                rasterRangeInArea(grid, west + areaWest * size, north + areaNorth * size, west + areaEast * size, north + areaSouth * size, "point", channel),
        };
    }

    /**
     * Value at a point of the pyramid from the loaded rasters of a tile level, or `NaN` when no raster containing
     * the point is loaded. On a tile edge, either side gives the same value.
     */
    public sampleAt(x: number, y: number, lod: number, channel = 0): number {
        const sourceLod = this.sourceLevel(lod);
        const count = 2 ** sourceLod;
        const column = x * count;
        const row = y * count;
        const columns = Number.isInteger(column) ? [column, column - 1] : [Math.floor(column)];
        const rows = Number.isInteger(row) ? [row, row - 1] : [Math.floor(row)];
        for (const tileRow of rows) {
            if (tileRow < 0 || tileRow >= count) continue;
            for (const tileColumn of columns) {
                if (!this.wrapX && (tileColumn < 0 || tileColumn >= count)) continue;
                const grid = this.stitched.get({ lod: sourceLod, x: ((tileColumn % count) + count) % count, y: tileRow });
                if (grid) return sampleRasterBilinear(grid, column - tileColumn, row - tileRow, channel, "point");
            }
        }
        return Number.NaN;
    }
}
