import { TileNeighbor } from "@spacexr/tiles";

import { allocateLike, type IRasterGrid } from "./raster-grid";

/**
 * Interpolation between the samples of a raster level, used to generate the levels below the deepest level of a
 * pyramid:
 *
 * - `nearest`: the nearest sample;
 * - `linear`: linear on the two triangles of each cell, split from its north-west to its south-east corner;
 * - `bilinear`: bilinear in each cell;
 * - `cubic`: Catmull-Rom spline, smooth (C1) and interpolating: it passes through the samples and may overshoot.
 *
 * Every interpolation passes through the samples, so generated levels keep the heights of the source, summits included,
 * and reproduces constant values; all but `nearest` reproduce linear slopes.
 */
export type RasterInterpolation = "nearest" | "linear" | "bilinear" | "cubic";

/** Value of one channel at an integer position of a sample lattice, `NaN` where it is missing. */
export type LatticeSampler = (column: number, row: number) => number;

/** Weighted sum skipping missing samples; `NaN` when every weighted sample is missing. */
function weighted(samples: readonly number[], weights: readonly number[]): number {
    let sum = 0;
    let total = 0;
    for (let index = 0; index < samples.length; index++) {
        const value = samples[index]!;
        const weight = weights[index]!;
        if (weight === 0 || Number.isNaN(value)) continue;
        sum += value * weight;
        total += weight;
    }
    return total === 0 ? Number.NaN : sum / total;
}

function cubicWeights(t: number): [number, number, number, number] {
    const t2 = t * t;
    const t3 = t2 * t;
    return [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2];
}

/**
 * Interpolates a sample lattice at a continuous position, in sample units: `(x, y)` lies between samples
 * `floor(x)` and `floor(x) + 1`. Missing samples are left out of the weighting.
 */
export function interpolateLattice(sample: LatticeSampler, x: number, y: number, interpolation: RasterInterpolation): number {
    if (interpolation === "nearest") return sample(Math.round(x), Math.round(y));
    const column = Math.floor(x);
    const row = Math.floor(y);
    const fx = x - column;
    const fy = y - row;
    if (interpolation === "cubic") {
        const wx = cubicWeights(fx);
        const wy = cubicWeights(fy);
        const samples: number[] = [];
        const weights: number[] = [];
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) (samples.push(sample(column + i - 1, row + j - 1)), weights.push(wx[i]! * wy[j]!));
        const value = weighted(samples, weights);
        // Negative weights make a renormalized sum unreliable next to missing samples: fall back to bilinear there.
        return samples.some(Number.isNaN) ? interpolateLattice(sample, x, y, "bilinear") : value;
    }
    const corners = [sample(column, row), sample(column + 1, row), sample(column, row + 1), sample(column + 1, row + 1)];
    if (interpolation === "linear") {
        // North-west to south-east diagonal: the triangle above it holds the north-east corner.
        const weights = fx >= fy ? [1 - fx, fx - fy, 0, fy] : [1 - fy, 0, fy - fx, fx];
        return weighted(corners, weights);
    }
    return weighted(corners, [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy]);
}

/**
 * Generates one child of a raster tile, one level finer, by interpolating the samples of the tile and of its eight
 * neighbours.
 *
 * Tiles of one level form a single lattice: sample `i` of tile `x` lies at `x + i / w` in tile units. Child sample
 * `i` of the child at `column` (0 west, 1 east) therefore lies at parent sample `(column * w + i) / 2`, and children
 * of neighbouring parents interpolate the same lattice, so they agree along their shared edges. Missing neighbours
 * repeat the edge samples of the parent.
 *
 * @param neighborhood - The parent and its neighbours, indexed by {@link TileNeighbor}; the centre is required.
 * @param column - Column of the child in the parent, 0 or 1.
 * @param row - Row of the child in the parent, 0 or 1.
 */
export function generateChildRaster<TData extends IRasterGrid["data"]>(
    neighborhood: readonly (IRasterGrid<TData> | undefined)[],
    column: number,
    row: number,
    interpolation: RasterInterpolation
): IRasterGrid<TData> {
    const parent = neighborhood[TileNeighbor.C];
    if (!parent) throw new RangeError("The neighbourhood needs its centre tile.");
    const { width, height, channels } = parent;
    for (const tile of neighborhood) {
        if (tile && (tile.width !== width || tile.height !== height || tile.channels !== channels)) {
            throw new RangeError("Every tile of the neighbourhood must have the size and channels of its centre.");
        }
    }
    const data = allocateLike(parent.data, width * height * channels);
    for (let channel = 0; channel < channels; channel++) {
        const sample: LatticeSampler = (x, y) => {
            // Tile of the neighbourhood holding the lattice position, clamped to the parent where it is missing.
            const tileColumn = x < 0 ? 0 : x >= width ? 2 : 1;
            const tileRow = y < 0 ? 0 : y >= height ? 2 : 1;
            const tile = neighborhood[tileRow * 3 + tileColumn];
            if (!tile) return parent.data[(Math.min(Math.max(y, 0), height - 1) * width + Math.min(Math.max(x, 0), width - 1)) * channels + channel]!;
            const localX = x - (tileColumn - 1) * width;
            const localY = y - (tileRow - 1) * height;
            return tile.data[(localY * width + localX) * channels + channel]!;
        };
        for (let j = 0; j < height; j++) {
            for (let i = 0; i < width; i++) {
                data[(j * width + i) * channels + channel] = interpolateLattice(sample, (column * width + i) / 2, (row * height + j) / 2, interpolation);
            }
        }
    }
    return { width, height, channels, data };
}
