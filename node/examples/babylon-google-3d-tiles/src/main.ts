import "./style.css";

import { GeospatialClippingBehavior } from "@babylonjs/core/Behaviors/Cameras/geospatialClippingBehavior.js";
import { GeospatialCamera } from "@babylonjs/core/Cameras/geospatialCamera.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Scene } from "@babylonjs/core/scene.js";
import {
    EcefSpatialMetric,
    TileRuntime,
    type IEcefCameraFrame,
    type IEcefSpatialState,
    type IRuntimeAdapter,
} from "@spacexr/3d-tiles-runtime";
import { GeodeticSystem } from "@spacexr/geodesy";

import { AttributionController } from "./attribution";
import { BabylonGoogleContentAdapter, type IBabylonTileHandle } from "./babylon-content-adapter";
import { loadExampleConfig } from "./config";
import { GoogleTilesetLoader, GoogleTilesUriResolver } from "./google-tiles";
import { createEcefCameraFrame } from "./spatial";

function requiredElement<TElement extends HTMLElement>(id: string, constructor: { new (): TElement }): TElement {
    const element = document.getElementById(id);
    if (!(element instanceof constructor)) throw new Error(`Required element #${id} is missing.`);
    return element;
}

function megabytes(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeErrorSummary(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 240);
}

async function run(): Promise<void> {
    const config = loadExampleConfig();
    const canvas = requiredElement("render-canvas", HTMLCanvasElement);
    const status = requiredElement("runtime-status", HTMLSpanElement);
    const statistics = requiredElement("runtime-statistics", HTMLSpanElement);
    const dataAttribution = requiredElement("data-attribution", HTMLSpanElement);

    const engine = new Engine(
        canvas,
        true,
        {
            preserveDrawingBuffer: false,
            stencil: true,
            useLargeWorldRendering: true,
        },
        true,
    );
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    scene.clearColor = new Color4(0.027, 0.082, 0.176, 1);
    scene.skipPointerMovePicking = true;

    const geodeticSystem = GeodeticSystem.WGS84;
    const initialCenter = geodeticSystem.geodeticDegreesToEcef(config.latitudeDegrees, config.longitudeDegrees, config.heightMeters);
    const initialNormal = geodeticSystem.geodeticSurfaceNormalDegrees(config.latitudeDegrees, config.longitudeDegrees);
    const light = new HemisphericLight("ambient-light", new Vector3(initialNormal.x, initialNormal.y, initialNormal.z), scene);
    light.intensity = 1.8;
    const camera = new GeospatialCamera("viewer-camera", scene, {
        planetRadius: geodeticSystem.ellipsoid.semiMajorAxis,
    });
    camera.movement.calculateUpVectorFromPointToRef = (point, result) => {
        const geodetic = geodeticSystem.ecefToGeodeticRadians(point);
        const normal = geodeticSystem.geodeticSurfaceNormalRadians(geodetic.latitude, geodetic.longitude);
        return result.set(normal.x, normal.y, normal.z);
    };
    camera.limits.radiusMin = 10;
    camera.limits.radiusMax = geodeticSystem.ellipsoid.semiMajorAxis * 2;
    camera.limits.pitchDisabledRadiusScale = new Vector2(0.5, 1.5);
    camera.center = new Vector3(initialCenter.x, initialCenter.y, initialCenter.z);
    camera.radius = config.cameraDistanceMeters;
    camera.pitch = Math.PI / 6;
    camera.yaw = 0;
    camera.addBehavior(new GeospatialClippingBehavior());
    camera.attachControl(true);

    const resolver = new GoogleTilesUriResolver();
    const attribution = new AttributionController(dataAttribution);
    const adapter: IRuntimeAdapter<IEcefCameraFrame, IEcefSpatialState, IBabylonTileHandle, never> = {
        tilesets: new GoogleTilesetLoader(resolver),
        content: new BabylonGoogleContentAdapter(scene, resolver, attribution),
        spatial: new EcefSpatialMetric({ geodeticSystem }),
        uri: resolver,
    };
    const runtime = new TileRuntime<IEcefCameraFrame, IEcefSpatialState, IBabylonTileHandle, never>({
        id: "google-photorealistic-3d-tiles",
        uri: resolver.rootTilesetUri,
        adapter,
        maxScreenSpaceError: 16,
        refinementHysteresisRatio: 0.2,
        maxConcurrentLoads: 8,
        cache: {
            maxContentEntries: 256,
            maxContentCpuBytes: 384 * 1024 * 1024,
            maxContentGpuBytes: 768 * 1024 * 1024,
            unusedFrameRetention: 120,
        },
        instrumentation: true,
    });

    const unsubscribeStatistics = runtime.instrumentation.subscribe((snapshot) => {
        statistics.textContent = `${snapshot.nodes.selected}/${snapshot.nodes.total} nodes | ${snapshot.contents.ready} ready | ${snapshot.contents.loading + snapshot.contents.queued} loading | ${snapshot.contents.error} errors | ${megabytes(snapshot.contents.gpuBytes)} GPU`;
    });
    const unsubscribeEvents = runtime.events.subscribe((event) => {
        if (event.type !== "error") return;
        status.textContent = `Runtime error during ${event.phase}: ${safeErrorSummary(event.error)}`;
        console.error("3D Tiles runtime error", event.error);
    });

    const cameraFrame = (): IEcefCameraFrame => createEcefCameraFrame(camera, engine);
    const lastCameraTransform = new Float64Array(16).fill(Number.NaN);
    let lastViewportHeight = Number.NaN;
    const cameraChanged = (): boolean => {
        const transform = camera.getTransformationMatrix().m;
        const viewportHeight = engine.getRenderHeight() * camera.viewport.height;
        if (viewportHeight !== lastViewportHeight) return true;
        for (let index = 0; index < 16; index++) {
            if (transform[index] !== lastCameraTransform[index]) return true;
        }
        return false;
    };
    const captureCameraState = (): void => {
        lastCameraTransform.set(camera.getTransformationMatrix().m);
        lastViewportHeight = engine.getRenderHeight() * camera.viewport.height;
    };
    status.textContent = "Loading Google Photorealistic 3D Tiles...";
    await runtime.start();
    await runtime.update(cameraFrame());
    captureCameraState();
    status.textContent = `${config.latitudeDegrees.toFixed(4)}, ${config.longitudeDegrees.toFixed(4)}`;

    let updatePending = false;
    engine.runRenderLoop(() => {
        scene.render();
        if (updatePending || (!cameraChanged() && !runtime.hasPendingWork)) return;
        captureCameraState();
        updatePending = true;
        void runtime
            .update(cameraFrame())
            .catch((error: unknown) => {
                status.textContent = "Runtime update failed";
                console.error("3D Tiles update failed", error);
            })
            .finally(() => {
                updatePending = false;
            });
    });

    const resize = (): void => engine.resize();
    window.addEventListener("resize", resize);
    window.addEventListener(
        "beforeunload",
        () => {
            window.removeEventListener("resize", resize);
            unsubscribeStatistics();
            unsubscribeEvents();
            attribution.clear();
            void runtime.dispose();
            scene.dispose();
            engine.dispose();
        },
        { once: true },
    );
}

void run().catch((error: unknown) => {
    const status = document.getElementById("runtime-status");
    if (status) status.textContent = error instanceof Error ? error.message : "The example could not start.";
    console.error("Babylon Google 3D Tiles example failed", error);
});
