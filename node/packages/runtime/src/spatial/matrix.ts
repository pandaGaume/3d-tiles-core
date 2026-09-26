import type { TileTransform } from "@spacexr/3d-tiles-core";

import type { IVector3 } from "./ecef-types";

const IDENTITY = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function matrixOf(transform: TileTransform | undefined): Float64Array {
    return transform ? new Float64Array(transform) : new Float64Array(IDENTITY);
}

export function multiplyTransforms(left: Float64Array, right: Float64Array): Float64Array {
    const result = new Float64Array(16);
    for (let column = 0; column < 4; column++) {
        for (let row = 0; row < 4; row++) {
            let value = 0;
            for (let index = 0; index < 4; index++) value += left[index * 4 + row]! * right[column * 4 + index]!;
            result[column * 4 + row] = value;
        }
    }
    return result;
}

export function transformPoint(matrix: Float64Array, point: IVector3): IVector3 {
    return {
        x: matrix[0]! * point.x + matrix[4]! * point.y + matrix[8]! * point.z + matrix[12]!,
        y: matrix[1]! * point.x + matrix[5]! * point.y + matrix[9]! * point.z + matrix[13]!,
        z: matrix[2]! * point.x + matrix[6]! * point.y + matrix[10]! * point.z + matrix[14]!,
    };
}

export function transformVector(matrix: Float64Array, vector: IVector3): IVector3 {
    return {
        x: matrix[0]! * vector.x + matrix[4]! * vector.y + matrix[8]! * vector.z,
        y: matrix[1]! * vector.x + matrix[5]! * vector.y + matrix[9]! * vector.z,
        z: matrix[2]! * vector.x + matrix[6]! * vector.y + matrix[10]! * vector.z,
    };
}

export function vectorLength(vector: IVector3): number {
    return Math.hypot(vector.x, vector.y, vector.z);
}

export function maximumScale(matrix: Float64Array): number {
    return Math.max(
        Math.hypot(matrix[0]!, matrix[1]!, matrix[2]!),
        Math.hypot(matrix[4]!, matrix[5]!, matrix[6]!),
        Math.hypot(matrix[8]!, matrix[9]!, matrix[10]!),
    );
}
