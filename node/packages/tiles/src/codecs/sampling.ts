import type { IHeightGrid } from "./dem";

/**
 * Samples a height grid with bilinear interpolation.
 *
 * `u` runs west to east and `v` north to south over the tile extent, both in `[0, 1]`. Each sample covers one
 * pixel, so sample `i` is centred at `(i + 0.5) / width`; positions closer to the edge than half a pixel use the
 * edge samples. Missing neighbours are left out of the weighting; the result is `NaN` only when all four are missing.
 */
export function sampleHeightBilinear(grid: IHeightGrid, u: number, v: number): number {
    const { width, height, heights } = grid;
    const x = Math.min(Math.max(u * width - 0.5, 0), width - 1);
    const y = Math.min(Math.max(v * height - 0.5, 0), height - 1);
    const column = Math.min(Math.floor(x), width - 2 < 0 ? 0 : width - 2);
    const row = Math.min(Math.floor(y), height - 2 < 0 ? 0 : height - 2);
    const nextColumn = Math.min(column + 1, width - 1);
    const nextRow = Math.min(row + 1, height - 1);
    const fx = x - column;
    const fy = y - row;

    let sum = 0;
    let weightSum = 0;
    const add = (sampleColumn: number, sampleRow: number, weight: number): void => {
        const value = heights[sampleRow * width + sampleColumn]!;
        if (weight === 0 || Number.isNaN(value)) return;
        sum += value * weight;
        weightSum += weight;
    };
    add(column, row, (1 - fx) * (1 - fy));
    add(nextColumn, row, fx * (1 - fy));
    add(column, nextRow, (1 - fx) * fy);
    add(nextColumn, nextRow, fx * fy);
    if (weightSum > 0) return sum / weightSum;

    // The point lies exactly on missing samples with zero-weight neighbours: use the nearest valid corner, if any.
    for (const [sampleColumn, sampleRow] of [
        [column, row],
        [nextColumn, row],
        [column, nextRow],
        [nextColumn, nextRow],
    ] as const) {
        const value = heights[sampleRow * width + sampleColumn]!;
        if (!Number.isNaN(value)) return value;
    }
    return Number.NaN;
}
