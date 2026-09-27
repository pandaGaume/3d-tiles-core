import "./style.css";

import { GeospatialClippingBehavior } from "@babylonjs/core/Behaviors/Cameras/geospatialClippingBehavior.js";
import { GeospatialCamera } from "@babylonjs/core/Cameras/geospatialCamera.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Scene } from "@babylonjs/core/scene.js";
import {
    CameraChangeFlags,
    DenseImplicitSubtreeLoader,
    EcefSpatialMetric,
    TileRuntime,
    type IEcefCameraFrame,
    type IEcefSpatialState,
    type IRuntimeAdapter,
} from "@spacexr/3d-tiles-runtime";
import { GeodeticSystem } from "@spacexr/geodesy";

import {
    BabylonGeodesicGridPipeline,
    type IBabylonGeodesicGridHandle,
} from "./babylon-geodesic-grid-pipeline";
import { BabylonRuntimeMonitor } from "./babylon-runtime-monitor";
import { createGeodesicGridSource } from "./grid-source";
import { createEcefCameraFrame } from "./spatial";

function requiredElement<TElement extends HTMLElement>(
    id: string,
    constructor: { new (): TElement },
): TElement {
    const element = document.getElementById(id);
    if (!(element instanceof constructor))
        throw new Error(`Required element #${id} is missing.`);
    return element;
}

async function run(): Promise<void> {
    const startupStartedAt = performance.now();
    const canvas = requiredElement("render-canvas", HTMLCanvasElement);
    const status = requiredElement("runtime-status", HTMLSpanElement);
    const statistics = requiredElement("runtime-statistics", HTMLSpanElement);
    const memoryStatistics = requiredElement(
        "memory-statistics",
        HTMLSpanElement,
    );
    const cleanupStatistics = requiredElement(
        "cleanup-statistics",
        HTMLSpanElement,
    );
    const rendererStatistics = requiredElement(
        "renderer-statistics",
        HTMLSpanElement,
    );
    const tileLabels = requiredElement("tile-labels", HTMLDivElement);
    const engine = new Engine(
        canvas,
        true,
        { stencil: true, useLargeWorldRendering: true },
        true,
    );
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    scene.clearColor = new Color4(0.008, 0.035, 0.09, 1);
    scene.skipPointerMovePicking = true;

    const geodeticSystem = GeodeticSystem.WGS84;
    const source = createGeodesicGridSource();
    const monitoringEnabled =
        new URLSearchParams(window.location.search).get("monitor") !== "0";
    const solidRendering =
        new URLSearchParams(window.location.search).get("solid") === "1";
    const initialCenter = geodeticSystem.geodeticDegreesToEcef(48.25, 2.35, 0);
    const camera = new GeospatialCamera("geographic-camera", scene, {
        planetRadius: geodeticSystem.ellipsoid.semiMajorAxis,
    });
    camera.movement.calculateUpVectorFromPointToRef = (point, result) => {
        const geodetic = geodeticSystem.ecefToGeodeticRadians(point);
        const normal = geodeticSystem.geodeticSurfaceNormalRadians(
            geodetic.latitude,
            geodetic.longitude,
        );
        return result.set(normal.x, normal.y, normal.z);
    };
    camera.center = new Vector3(
        initialCenter.x,
        initialCenter.y,
        initialCenter.z,
    );
    camera.radius = 1_600_000;
    camera.pitch = Math.PI / 5;
    camera.yaw = 0;
    camera.limits.radiusMin = 500;
    camera.limits.radiusMax = geodeticSystem.ellipsoid.semiMajorAxis * 2;
    camera.limits.pitchDisabledRadiusScale = new Vector2(0.5, 1.5);
    camera.addBehavior(new GeospatialClippingBehavior());
    camera.attachControl(true);

    const pipeline = new BabylonGeodesicGridPipeline(scene, tileLabels, {
        wireframe: !solidRendering,
    });
    const adapter: IRuntimeAdapter<
        IEcefCameraFrame,
        IEcefSpatialState,
        IBabylonGeodesicGridHandle,
        never
    > = {
        tilesets: { load: async () => ({ tileset: source.tileset }) },
        subtrees: new DenseImplicitSubtreeLoader(),
        implicitTiles: source.resolver,
        spatial: new EcefSpatialMetric({ geodeticSystem }),
        activation: pipeline,
        presentation: pipeline,
    };
    const runtime = new TileRuntime({
        id: "implicit-geodesic-grid",
        uri: "memory://geodesic-grid/tileset.json",
        adapter,
        maxScreenSpaceError: 10,
        refinementHysteresisRatio: 0.2,
        maxConcurrentLoads: 12,
        instrumentation: { enabled: monitoringEnabled },
        cache: {
            maxContentEntries: 1024,
            maxMaterializedTiles: 4096,
            unusedFrameRetention: 180,
        },
    });

    const monitor = new BabylonRuntimeMonitor(
        engine,
        scene,
        runtime.instrumentation,
        pipeline,
        {
            tiles: statistics,
            memory: memoryStatistics,
            cleanup: cleanupStatistics,
            renderer: rendererStatistics,
        },
        { enabled: monitoringEnabled },
    );
    const unsubscribeEvents = runtime.events.subscribe((event) => {
        if (event.type !== "error") return;
        status.textContent = `Pipeline error: ${event.phase}`;
        console.error("3D Tiles pipeline error", event.error);
    });

    const cameraFrame = (): IEcefCameraFrame =>
        createEcefCameraFrame(camera, engine);
    const lastTransform = new Float64Array(16).fill(Number.NaN);
    let lastViewportHeight = Number.NaN;
    const captureCameraChanges = (): CameraChangeFlags => {
        const transform = camera.getTransformationMatrix().m;
        const viewportHeight =
            engine.getRenderHeight() * camera.viewport.height;
        let changes = CameraChangeFlags.None;
        if (viewportHeight !== lastViewportHeight)
            changes |= CameraChangeFlags.Viewport | CameraChangeFlags.Frustum;
        for (let index = 0; index < 16; index++) {
            if (transform[index] !== lastTransform[index]) {
                changes |= CameraChangeFlags.Pose | CameraChangeFlags.Frustum;
                break;
            }
        }
        if (changes !== CameraChangeFlags.None) {
            lastTransform.set(transform);
            lastViewportHeight = viewportHeight;
        }
        return changes;
    };

    status.textContent = "Loading the implicit quadtree...";
    await runtime.start();
    captureCameraChanges();
    runtime.onCameraChanged(cameraFrame(), CameraChangeFlags.All);
    await runtime.processFrame();
    monitor.setStartupMilliseconds(performance.now() - startupStartedAt);
    status.textContent = `Global WebMercator coverage, ${source.dataSources.length} roots, LOD ${source.metrics.minLOD}..${source.metrics.maxLOD}`;

    let updatePending = false;
    engine.runRenderLoop(() => {
        scene.render();
        monitor.update();
        pipeline.updateDebugLabels();
        const changes = captureCameraChanges();
        if (changes !== CameraChangeFlags.None)
            runtime.onCameraChanged(cameraFrame(), changes);
        if (updatePending || !runtime.hasPendingWork) return;
        updatePending = true;
        void runtime
            .processFrame()
            .catch((error: unknown) => {
                status.textContent = "Runtime frame failed";
                console.error("3D Tiles pipeline frame failed", error);
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
            unsubscribeEvents();
            void runtime.dispose();
            monitor.dispose();
            pipeline.dispose();
            scene.dispose();
            engine.dispose();
        },
        { once: true },
    );
}

void run().catch((error: unknown) => {
    const status = document.getElementById("runtime-status");
    if (status)
        status.textContent =
            error instanceof Error
                ? error.message
                : "The pipeline example could not start.";
    console.error("Babylon implicit geodesic grid example failed", error);
});
