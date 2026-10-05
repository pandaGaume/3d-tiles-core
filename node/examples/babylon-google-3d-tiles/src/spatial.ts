import { Frustum, Matrix, type AbstractEngine, type Camera } from "@babylonjs/core";
import type { IEcefCameraFrame, IEcefSpatialState, IPlane } from "@spacexr/3d-tiles-runtime";

const GLTF_Y_UP_TO_3D_TILES_Z_UP = new Float64Array([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]);

function multiply(left: ArrayLike<number>, right: ArrayLike<number>): Float64Array {
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

/** Converts glTF Y-up content to 3D Tiles Z-up, then applies its local-to-ECEF transform. */
export function createBabylonTileMatrix(spatial: IEcefSpatialState): Matrix {
    return Matrix.FromArray(multiply(spatial.worldTransform, GLTF_Y_UP_TO_3D_TILES_Z_UP));
}

function planeToRuntimePlane(plane: { normal: { x: number; y: number; z: number }; d: number }): IPlane {
    return { x: plane.normal.x, y: plane.normal.y, z: plane.normal.z, w: plane.d };
}

/** Captures the Babylon camera as the renderer-neutral ECEF camera frame. */
export function createEcefCameraFrame(camera: Camera, engine: AbstractEngine): IEcefCameraFrame {
    const frustumPlanes = Frustum.GetPlanes(camera.getTransformationMatrix()).map(planeToRuntimePlane);
    return {
        id: camera.id,
        position: {
            x: camera.globalPosition.x,
            y: camera.globalPosition.y,
            z: camera.globalPosition.z,
        },
        viewportHeight: engine.getRenderHeight(),
        verticalFovRadians: camera.fov,
        frustumPlanes,
        timestamp: performance.now(),
    };
}
