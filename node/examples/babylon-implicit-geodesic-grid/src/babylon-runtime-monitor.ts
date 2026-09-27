import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import { SceneInstrumentation } from "@babylonjs/core/Instrumentation/sceneInstrumentation.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type {
    IRuntimeStatisticsSnapshot,
    RuntimeInstrumentation,
} from "@spacexr/3d-tiles-runtime";

export interface IBabylonTileResourceStatistics {
    handles: number;
    presented: number;
    created: number;
    released: number;
    cpuBytes: number;
    gpuBytes: number;
}

export interface IBabylonTileResourceStatisticsProvider {
    getStatistics(): IBabylonTileResourceStatistics;
}

export interface IBabylonRuntimeMonitorElements {
    tiles: HTMLElement;
    memory: HTMLElement;
    cleanup: HTMLElement;
    renderer: HTMLElement;
}

export interface IBabylonRuntimeMonitorOptions {
    enabled?: boolean;
    publishIntervalMilliseconds?: number;
}

export interface IBabylonBenchmarkSnapshot {
    renderer: "babylonjs";
    startupMilliseconds: number;
    framesPerSecond: number;
    drawCalls: number;
    selectedTiles: number;
    readyContents: number;
    cachedContents: number;
    retainedMeshes: number;
    presentedMeshes: number;
    cpuBytes: number;
    gpuBytes: number;
    jsHeapBytes?: number;
}

interface IHeapMemoryInformation {
    jsHeapSizeLimit: number;
    totalJSHeapSize: number;
    usedJSHeapSize: number;
}

declare global {
    interface Window {
        __SPACEXR_BENCHMARK__?: IBabylonBenchmarkSnapshot;
    }
}

const DEFAULT_PUBLISH_INTERVAL_MILLISECONDS = 250;

export function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    if (!Number.isFinite(bytes)) return "unbounded";

    const units = ["B", "KiB", "MiB", "GiB"] as const;
    const exponent = Math.min(
        Math.floor(Math.log(Math.max(1, bytes)) / Math.log(1024)),
        units.length - 1,
    );
    const value = bytes / 1024 ** exponent;
    const precision = value >= 100 || exponent === 0 ? 0 : 1;
    return `${value.toFixed(precision)} ${units[exponent]}`;
}

function heapMemory(): IHeapMemoryInformation | undefined {
    return (
        performance as Performance & {
            memory?: IHeapMemoryInformation;
        }
    ).memory;
}

/**
 * Joins renderer-neutral runtime statistics with Babylon render counters.
 *
 * Collection is throttled to keep the monitoring cost predictable. Disabling
 * the monitor avoids creating Babylon's SceneInstrumentation observers.
 */
export class BabylonRuntimeMonitor {
    private readonly enabled: boolean;
    private readonly publishIntervalMilliseconds: number;
    private readonly sceneInstrumentation?: SceneInstrumentation;
    private latestSnapshot?: IRuntimeStatisticsSnapshot;
    private nextPublicationAt = 0;
    private startupMilliseconds = 0;
    private unsubscribeRuntime: () => void = () => undefined;

    public constructor(
        private readonly engine: AbstractEngine,
        scene: Scene,
        private readonly runtime: RuntimeInstrumentation,
        private readonly resources: IBabylonTileResourceStatisticsProvider,
        private readonly elements: IBabylonRuntimeMonitorElements,
        options: IBabylonRuntimeMonitorOptions = {},
    ) {
        this.enabled = options.enabled ?? true;
        this.publishIntervalMilliseconds = Math.max(
            0,
            options.publishIntervalMilliseconds ??
                DEFAULT_PUBLISH_INTERVAL_MILLISECONDS,
        );

        if (!this.enabled) {
            this.elements.tiles.textContent = "Monitoring disabled";
            this.elements.memory.textContent = "";
            this.elements.cleanup.textContent = "";
            this.elements.renderer.textContent = "";
            return;
        }

        this.sceneInstrumentation = new SceneInstrumentation(scene);
        this.latestSnapshot = this.runtime.snapshot();
        this.unsubscribeRuntime = this.runtime.subscribe((snapshot) => {
            this.latestSnapshot = snapshot;
        });
    }

    /** Publishes at most once per configured interval. Call after scene.render(). */
    public update(timestamp = performance.now()): void {
        if (
            !this.enabled ||
            !this.sceneInstrumentation ||
            timestamp < this.nextPublicationAt
        )
            return;
        this.nextPublicationAt = timestamp + this.publishIntervalMilliseconds;

        const snapshot = this.latestSnapshot ?? this.runtime.snapshot();
        const resources = this.resources.getStatistics();
        const heap = heapMemory();
        const heapDescription = heap
            ? `${formatBytes(heap.usedJSHeapSize)}/${formatBytes(heap.jsHeapSizeLimit)}`
            : "unavailable";

        this.elements.tiles.textContent =
            `Tiles ${snapshot.nodes.selected}/${snapshot.nodes.total} selected` +
            ` | ${snapshot.contents.ready} ready` +
            ` | ${snapshot.contents.cached}/${snapshot.cache.limits.maxContentEntries} cached` +
            ` | ${snapshot.nodes.total}/${snapshot.cache.limits.maxMaterializedTiles} nodes` +
            ` | ${snapshot.pendingLoads} pending`;
        this.elements.memory.textContent =
            `Memory cache CPU ${formatBytes(snapshot.contents.cpuBytes)}/${formatBytes(snapshot.cache.limits.maxContentCpuBytes)}` +
            ` | GPU ${formatBytes(snapshot.contents.gpuBytes)}/${formatBytes(snapshot.cache.limits.maxContentGpuBytes)}` +
            ` | live meshes CPU ${formatBytes(resources.cpuBytes)} / GPU ${formatBytes(resources.gpuBytes)}` +
            ` | subtrees ${formatBytes(snapshot.subtrees.bytes)}/${formatBytes(snapshot.cache.limits.maxSubtreeBytes)}` +
            ` | JS heap ${heapDescription}`;
        this.elements.cleanup.textContent =
            `Cleanup ${snapshot.cache.contentEvictions} contents` +
            ` | ${snapshot.cache.subtreeEvictions} subtrees` +
            ` | ${snapshot.cache.implicitBranchPrunes} branches` +
            ` | ${snapshot.cache.prunedNodes} nodes` +
            ` | released ${formatBytes(snapshot.cache.releasedCpuBytes)} CPU / ${formatBytes(snapshot.cache.releasedGpuBytes)} GPU`;
        const framesPerSecond = this.engine.getFps();
        const drawCalls = Math.round(
            this.sceneInstrumentation.drawCallsCounter.current,
        );
        this.elements.renderer.textContent =
            `Babylon ${framesPerSecond.toFixed(0)} FPS` +
            ` | ${drawCalls} draw calls` +
            ` | ${resources.presented}/${resources.handles} meshes shown` +
            ` | ${resources.created} created / ${resources.released} released` +
            ` | startup ${this.startupMilliseconds.toFixed(0)} ms`;

        const benchmark: IBabylonBenchmarkSnapshot = {
            renderer: "babylonjs",
            startupMilliseconds: this.startupMilliseconds,
            framesPerSecond,
            drawCalls,
            selectedTiles: snapshot.nodes.selected,
            readyContents: snapshot.contents.ready,
            cachedContents: snapshot.contents.cached,
            retainedMeshes: resources.handles,
            presentedMeshes: resources.presented,
            cpuBytes: resources.cpuBytes,
            gpuBytes: resources.gpuBytes,
        };
        if (heap) benchmark.jsHeapBytes = heap.usedJSHeapSize;
        window.__SPACEXR_BENCHMARK__ = benchmark;
    }

    public setStartupMilliseconds(value: number): void {
        this.startupMilliseconds = Math.max(0, value);
    }

    public dispose(): void {
        this.unsubscribeRuntime();
        this.unsubscribeRuntime = () => undefined;
        this.sceneInstrumentation?.dispose();
    }
}
