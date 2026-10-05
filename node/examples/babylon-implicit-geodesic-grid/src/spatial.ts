import { Frustum, type AbstractEngine, type Camera } from "@babylonjs/core";
import type { IEcefCameraFrame, IPlane } from "@spacexr/3d-tiles-runtime";

function planeToRuntimePlane(plane: {
    normal: { x: number; y: number; z: number };
    d: number;
}): IPlane {
    return {
        x: plane.normal.x,
        y: plane.normal.y,
        z: plane.normal.z,
        w: plane.d,
    };
}

/** Captures the Babylon geographic camera and its frustum for the runtime. */
export function createEcefCameraFrame(
    camera: Camera,
    engine: AbstractEngine,
): IEcefCameraFrame {
    return {
        id: camera.id,
        position: {
            x: camera.globalPosition.x,
            y: camera.globalPosition.y,
            z: camera.globalPosition.z,
        },
        viewportHeight: engine.getRenderHeight() * camera.viewport.height,
        verticalFovRadians: camera.fov,
        frustumPlanes: Frustum.GetPlanes(camera.getTransformationMatrix()).map(
            planeToRuntimePlane,
        ),
        timestamp: performance.now(),
    };
}
