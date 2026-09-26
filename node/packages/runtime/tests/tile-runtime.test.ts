import type { IMetadataSchema, ITile, ITileset } from "@spacexr/3d-tiles-core";
import { describe, expect, it } from "vitest";

import type {
    ICameraEventSource,
    IContentLoadContext,
    ContentLoadResult,
    IContentPresentationContext,
    ILoadedTileset,
    IRuntimeAdapter,
    IRuntimeHooks,
    IRuntimeSubscription,
    ISpatialDerivationContext,
    ISpatialMetric,
    ITilesetLoadRequest,
} from "../src";
import { TileRuntime } from "../src";

interface IFakeCamera {
    multiplier: number;
}

interface IFakeSpatial {
    geometricError: number;
}

interface IRotationSpatial extends IFakeSpatial {
    branch: number;
}

interface IFakeHandle {
    uri: string;
}

interface IDeferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
}

function deferred<T>(): IDeferred<T> {
    let resolvePromise: ((value: T) => void) | undefined;
    const promise = new Promise<T>((resolve) => {
        resolvePromise = resolve;
    });
    return {
        promise,
        resolve: (value) => {
            if (!resolvePromise) throw new Error("Deferred resolver is unavailable.");
            resolvePromise(value);
        },
    };
}

class FakeSpatialMetric implements ISpatialMetric<IFakeCamera, IFakeSpatial> {
    public derive(context: ISpatialDerivationContext<IFakeSpatial>): IFakeSpatial {
        return { geometricError: context.tile.geometricError };
    }

    public isVisible(): boolean {
        return true;
    }

    public screenSpaceError(context: { camera: IFakeCamera; spatial: IFakeSpatial }): number {
        return context.spatial.geometricError * context.camera.multiplier;
    }
}

class RotationSpatialMetric implements ISpatialMetric<IFakeCamera, IRotationSpatial> {
    public derive(context: ISpatialDerivationContext<IRotationSpatial>): IRotationSpatial {
        return {
            geometricError: context.tile.geometricError,
            branch: context.tile.boundingVolume.sphere?.[0] ?? 0,
        };
    }

    public isVisible(spatial: IRotationSpatial, camera: IFakeCamera): boolean {
        return spatial.branch === 0 || spatial.branch === 1 || camera.multiplier < 0;
    }

    public screenSpaceError(context: { camera: IFakeCamera; spatial: IRotationSpatial }): number {
        return context.spatial.geometricError * Math.abs(context.camera.multiplier);
    }
}

class FakeCameraSource implements ICameraEventSource<IFakeCamera> {
    private listener?: (camera: IFakeCamera) => void;

    public constructor(private readonly initial: IFakeCamera) {}

    public subscribe(listener: (camera: IFakeCamera) => void): IRuntimeSubscription {
        this.listener = listener;
        return { unsubscribe: () => delete this.listener };
    }

    public current(): IFakeCamera {
        return this.initial;
    }

    public emit(camera: IFakeCamera): void {
        this.listener?.(camera);
    }
}

function tilesetLoader(tileset: ITileset): { load(request: ITilesetLoadRequest): Promise<ILoadedTileset> } {
    return {
        load: async () => ({ tileset }),
    };
}

function tile(uri: string, geometricError = 0): ITile {
    return {
        boundingVolume: { sphere: [0, 0, 0, 10] },
        geometricError,
        content: { uri },
    };
}

describe("TileRuntime", () => {
    it("applies completed loads on the next caller-driven frame", async () => {
        const loaded = deferred<ContentLoadResult<IFakeHandle>>();
        const attached: string[] = [];
        const adapter: IRuntimeAdapter<IFakeCamera, IFakeSpatial, IFakeHandle, string> = {
            tilesets: tilesetLoader({
                asset: { version: "1.1" },
                geometricError: 0,
                root: tile("root.glb"),
            }),
            spatial: new FakeSpatialMetric(),
            content: {
                load: () => loaded.promise,
                attach: (context) => {
                    attached.push(context.uri);
                },
                detach: () => undefined,
            },
        };
        const runtime = new TileRuntime({ id: "frame-driven", uri: "https://example.test/tileset.json", adapter });

        await runtime.update({ multiplier: 1 });
        expect(runtime.instrumentation.snapshot().frame).toBe(1);
        expect(runtime.pendingLoads).toBe(1);
        expect(runtime.hasPendingWork).toBe(false);
        expect(attached).toEqual([]);

        loaded.resolve({ kind: "renderable", handle: { uri: "https://example.test/root.glb" } });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(runtime.instrumentation.snapshot().frame).toBe(1);
        expect(runtime.hasPendingWork).toBe(true);
        expect(attached).toEqual([]);

        await runtime.update({ multiplier: 1 });
        expect(runtime.instrumentation.snapshot().frame).toBe(2);
        expect(runtime.hasPendingWork).toBe(false);
        expect(attached).toEqual(["https://example.test/root.glb"]);
        await runtime.dispose();
    });

    it("keeps a REPLACE parent visible until the complete child front is ready", async () => {
        const childB = deferred<ContentLoadResult<IFakeHandle>>();
        const operations: string[] = [];
        const tileset: ITileset = {
            asset: { version: "1.1" },
            geometricError: 100,
            root: {
                ...tile("root.glb", 100),
                refine: "REPLACE",
                children: [tile("child-a.glb"), tile("child-b.glb")],
            },
        };
        const adapter: IRuntimeAdapter<IFakeCamera, IFakeSpatial, IFakeHandle, string> = {
            tilesets: tilesetLoader(tileset),
            spatial: new FakeSpatialMetric(),
            content: {
                load: async (context) =>
                    context.uri.endsWith("child-b.glb") ? childB.promise : { kind: "renderable", handle: { uri: context.uri } },
                attach: (context) => {
                    operations.push(`attach:${context.uri}`);
                },
                detach: (context) => {
                    operations.push(`detach:${context.uri}`);
                },
            },
        };
        const runtime = new TileRuntime({ id: "mine", uri: "https://example.test/tileset.json", adapter, maxScreenSpaceError: 10 });

        await runtime.update({ multiplier: 1 });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        await runtime.update({ multiplier: 1 });
        expect(runtime.selectedTiles.map((node) => node.id)).toEqual(["mine/root"]);

        childB.resolve({ kind: "renderable", handle: { uri: "https://example.test/child-b.glb" } });
        await runtime.whenIdle();

        expect(runtime.selectedTiles.map((node) => node.id).sort()).toEqual(["mine/root/0", "mine/root/1"]);
        const detachParent = operations.indexOf("detach:https://example.test/root.glb");
        const lastChildAttach = Math.max(
            operations.indexOf("attach:https://example.test/child-a.glb"),
            operations.indexOf("attach:https://example.test/child-b.glb"),
        );
        expect(detachParent).toBeGreaterThan(lastChildAttach);
        await runtime.dispose();
    });

    it("uses SSE hysteresis to prevent refine and coarsen oscillation", async () => {
        const tileset: ITileset = {
            asset: { version: "1.1" },
            geometricError: 16,
            root: {
                ...tile("root.glb", 16),
                refine: "REPLACE",
                children: [tile("child.glb")],
            },
        };
        const adapter: IRuntimeAdapter<IFakeCamera, IFakeSpatial, IFakeHandle, string> = {
            tilesets: tilesetLoader(tileset),
            spatial: new FakeSpatialMetric(),
            content: {
                load: async (context) => ({ kind: "renderable", handle: { uri: context.uri } }),
                attach: () => undefined,
                detach: () => undefined,
            },
        };
        const runtime = new TileRuntime({
            id: "hysteresis",
            uri: "https://example.test/tileset.json",
            adapter,
            maxScreenSpaceError: 10,
            refinementHysteresisRatio: 0.2,
        });

        await runtime.update({ multiplier: 1 });
        await runtime.whenIdle();
        expect(runtime.selectedTiles.map((node) => node.id)).toEqual(["hysteresis/root/0"]);

        await runtime.update({ multiplier: 0.6 });
        expect(runtime.selectedTiles.map((node) => node.id)).toEqual(["hysteresis/root/0"]);

        await runtime.update({ multiplier: 0.49 });
        expect(runtime.selectedTiles.map((node) => node.id)).toEqual(["hysteresis/root"]);
        expect(runtime.instrumentation.snapshot().metrics["tile.refine"]?.count).toBe(1);
        expect(runtime.instrumentation.snapshot().metrics["tile.coarsen"]?.count).toBe(1);
        await runtime.dispose();
    });

    it("keeps children presented until an evicted parent is ready during zoom out", async () => {
        const parentReload = deferred<ContentLoadResult<IFakeHandle>>();
        const operations: string[] = [];
        let parentLoads = 0;
        const tileset: ITileset = {
            asset: { version: "1.1" },
            geometricError: 100,
            root: {
                ...tile("root.glb", 100),
                refine: "REPLACE",
                children: [tile("child.glb")],
            },
        };
        const adapter: IRuntimeAdapter<IFakeCamera, IFakeSpatial, IFakeHandle, string> = {
            tilesets: tilesetLoader(tileset),
            spatial: new FakeSpatialMetric(),
            content: {
                load: async (context) => {
                    if (context.uri.endsWith("root.glb")) {
                        parentLoads++;
                        if (parentLoads > 1) return parentReload.promise;
                    }
                    return { kind: "renderable", handle: { uri: context.uri } };
                },
                attach: (context) => {
                    operations.push(`attach:${context.uri}`);
                },
                detach: (context) => {
                    operations.push(`detach:${context.uri}`);
                },
                dispose: () => undefined,
            },
        };
        const runtime = new TileRuntime({
            id: "zoom-out",
            uri: "https://example.test/tileset.json",
            adapter,
            maxScreenSpaceError: 10,
            cache: { maxContentEntries: 1, unusedFrameRetention: 1000 },
        });

        await runtime.update({ multiplier: 0 });
        await runtime.whenIdle();
        await runtime.update({ multiplier: 1 });
        await runtime.whenIdle();
        expect(runtime.selectedTiles.map((node) => node.id)).toEqual(["zoom-out/root/0"]);
        expect(parentLoads).toBe(1);

        operations.length = 0;
        await runtime.update({ multiplier: 0 });
        expect(parentLoads).toBe(2);
        expect(runtime.selectedTiles.map((node) => node.id)).toEqual(["zoom-out/root/0"]);
        expect(operations).not.toContain("detach:https://example.test/child.glb");

        parentReload.resolve({ kind: "renderable", handle: { uri: "https://example.test/root.glb" } });
        await runtime.whenIdle();
        expect(runtime.selectedTiles.map((node) => node.id)).toEqual(["zoom-out/root"]);
        expect(operations.indexOf("attach:https://example.test/root.glb")).toBeLessThan(
            operations.indexOf("detach:https://example.test/child.glb"),
        );
        await runtime.dispose();
    });

    it("uses a ready ancestor as complete coverage while a camera rotation reveals a loading branch", async () => {
        const loads: string[] = [];
        const operations: string[] = [];
        const childBLoad = deferred<ContentLoadResult<IFakeHandle>>();
        const childA = { ...tile("child-a.glb"), boundingVolume: { sphere: [1, 0, 0, 10] as [number, number, number, number] } };
        const childB = { ...tile("child-b.glb"), boundingVolume: { sphere: [-1, 0, 0, 10] as [number, number, number, number] } };
        const tileset: ITileset = {
            asset: { version: "1.1" },
            geometricError: 100,
            root: {
                ...tile("root.glb", 100),
                refine: "REPLACE",
                children: [childA, childB],
            },
        };
        const adapter: IRuntimeAdapter<IFakeCamera, IRotationSpatial, IFakeHandle, string> = {
            tilesets: tilesetLoader(tileset),
            spatial: new RotationSpatialMetric(),
            content: {
                load: async (context) => {
                    loads.push(context.uri);
                    if (context.uri.endsWith("child-b.glb")) return childBLoad.promise;
                    return { kind: "renderable", handle: { uri: context.uri } };
                },
                attach: (context) => {
                    operations.push(`attach:${context.uri}`);
                },
                detach: (context) => {
                    operations.push(`detach:${context.uri}`);
                },
            },
        };
        const runtime = new TileRuntime({
            id: "rotation",
            uri: "https://example.test/tileset.json",
            adapter,
            maxScreenSpaceError: 10,
        });

        await runtime.update({ multiplier: 1 });
        await runtime.whenIdle();
        expect(loads).toContain("https://example.test/child-a.glb");
        expect(loads).not.toContain("https://example.test/child-b.glb");
        expect(runtime.selectedTiles.map((node) => node.id)).toEqual(["rotation/root/0"]);

        operations.length = 0;
        await runtime.update({ multiplier: -1 });
        expect(loads).toContain("https://example.test/child-b.glb");
        expect(runtime.selectedTiles.map((node) => node.id)).toEqual(["rotation/root"]);
        expect(operations).toContain("attach:https://example.test/root.glb");

        childBLoad.resolve({ kind: "renderable", handle: { uri: "https://example.test/child-b.glb" } });
        await runtime.whenIdle();
        expect(runtime.selectedTiles.map((node) => node.id).sort()).toEqual(["rotation/root/0", "rotation/root/1"]);
        await runtime.dispose();
    });

    it("grafts extensionless external tilesets without classifying by file extension", async () => {
        const loadedUris: string[] = [];
        const external: ITileset = {
            asset: { version: "1.1" },
            geometricError: 0,
            root: { ...tile("mesh-resource"), refine: "REPLACE" },
        };
        const root: ITileset = {
            asset: { version: "1.1" },
            geometricError: 0,
            root: { ...tile("nested-resource"), refine: "REPLACE" },
        };
        const adapter: IRuntimeAdapter<IFakeCamera, IFakeSpatial, IFakeHandle, string> = {
            tilesets: tilesetLoader(root),
            spatial: new FakeSpatialMetric(),
            content: {
                load: async (context) => {
                    loadedUris.push(context.uri);
                    return context.uri.endsWith("nested-resource")
                        ? { kind: "external-tileset", tileset: external }
                        : { kind: "renderable", handle: { uri: context.uri } };
                },
                attach: () => undefined,
                detach: () => undefined,
            },
        };
        const runtime = new TileRuntime({ id: "external", uri: "https://example.test/tileset.json", adapter });

        await runtime.update({ multiplier: 1 });
        await runtime.whenIdle();

        expect(loadedUris).toEqual(expect.arrayContaining(["https://example.test/nested-resource", "https://example.test/mesh-resource"]));
        expect(runtime.root?.children).toHaveLength(1);
        expect(runtime.selectedTiles.map((node) => node.id)).toEqual(["external/root/external-0"]);
        await runtime.dispose();
    });

    it("receives camera events and exposes metadata to content, glyph and hook adapters", async () => {
        const schema: IMetadataSchema = {
            id: "Mining",
            classes: {
                Anchor: {
                    properties: {
                        label: { type: "STRING", required: true, semantic: "LABEL" },
                    },
                },
            },
        };
        const tileset: ITileset = {
            asset: { version: "1.1" },
            geometricError: 0,
            schema,
            metadata: { class: "Anchor", properties: { label: "Mine" } },
            groups: [{ class: "Anchor", properties: { label: "Investor" } }],
            root: {
                boundingVolume: { sphere: [0, 0, 0, 1] },
                geometricError: 0,
                refine: "REPLACE",
                metadata: { class: "Anchor", properties: { label: "Expansion" } },
                content: {
                    uri: "anchor.glb",
                    group: 0,
                    metadata: { class: "Anchor", properties: { label: "Arrow" } },
                },
            },
        };
        const snapshots: IContentPresentationContext<IFakeSpatial, IFakeHandle>[] = [];
        const glyphScopes: string[][] = [];
        const hooksCalled: string[] = [];
        const camera = new FakeCameraSource({ multiplier: 1 });
        const hooks: IRuntimeHooks<IFakeCamera, IFakeSpatial, IFakeHandle, string> = {
            beforeMetadataResolve: () => {
                hooksCalled.push("before-metadata");
            },
            afterMetadataResolve: () => {
                hooksCalled.push("after-metadata");
            },
            beforeGlyphPublish: () => {
                hooksCalled.push("before-glyph");
            },
            afterGlyphPublish: () => {
                hooksCalled.push("after-glyph");
            },
        };
        const adapter: IRuntimeAdapter<IFakeCamera, IFakeSpatial, IFakeHandle, string> = {
            tilesets: tilesetLoader(tileset),
            camera,
            spatial: new FakeSpatialMetric(),
            content: {
                load: async (context: IContentLoadContext<IFakeSpatial>) => ({
                    kind: "renderable",
                    handle: { uri: context.uri },
                    featureMetadata: [{ id: "feature-1", entity: { class: "Anchor", properties: { label: "Future pit" } } }],
                }),
                attach: (context) => {
                    snapshots.push(context);
                },
                detach: () => undefined,
            },
            glyphs: {
                publish: (context) => {
                    glyphScopes.push(context.metadata.flatMap((snapshot) => snapshot.scopes.map((scope) => scope.scope)));
                    return [context.tileId];
                },
                revoke: () => undefined,
            },
        };
        const runtime = new TileRuntime({ id: "metadata", uri: "https://example.test/tileset.json", adapter, hooks: [hooks] });

        await runtime.start();
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        await runtime.whenIdle();

        expect(snapshots).toHaveLength(1);
        expect(snapshots[0]?.metadata.scopes.map((scope) => scope.scope)).toEqual(["tileset", "tile", "group", "content", "feature"]);
        expect(glyphScopes.at(-1)).toEqual(["tileset", "tile", "group", "content", "feature"]);
        expect(hooksCalled).toEqual(expect.arrayContaining(["before-metadata", "after-metadata", "before-glyph", "after-glyph"]));

        camera.emit({ multiplier: 2 });
        await runtime.whenIdle();
        expect(runtime.selectedTiles).toHaveLength(1);
        await runtime.dispose();
    });

    it("loads an external metadata schema through the dedicated port", async () => {
        const schema: IMetadataSchema = { id: "External", classes: { Site: { properties: { name: { type: "STRING" } } } } };
        const tileset: ITileset = {
            asset: { version: "1.1" },
            geometricError: 0,
            schemaUri: "schemas/mining.json",
            metadata: { class: "Site", properties: { name: "Blue Mine" } },
            root: { boundingVolume: { sphere: [0, 0, 0, 1] }, geometricError: 0, refine: "REPLACE" },
        };
        const schemaRequests: string[] = [];
        const adapter: IRuntimeAdapter<IFakeCamera, IFakeSpatial, IFakeHandle, string> = {
            tilesets: tilesetLoader(tileset),
            spatial: new FakeSpatialMetric(),
            metadataSchemas: {
                load: async (request) => {
                    schemaRequests.push(request.uri);
                    return schema;
                },
            },
            content: {
                load: async (): Promise<ContentLoadResult<IFakeHandle>> => ({ kind: "empty" }),
                attach: () => undefined,
                detach: () => undefined,
            },
        };
        const runtime = new TileRuntime({ id: "schema", uri: "https://example.test/models/tileset.json", adapter });

        await runtime.start();

        expect(schemaRequests).toEqual(["https://example.test/models/schemas/mining.json"]);
        expect(runtime.document?.metadata.schema?.id).toBe("External");
        await runtime.dispose();
    });

    it("evicts detached renderables by budget, reloads them on return and exposes live statistics", async () => {
        const loads: string[] = [];
        const disposals: string[] = [];
        const externalMetrics: string[] = [];
        const tileset: ITileset = {
            asset: { version: "1.1" },
            geometricError: 100,
            root: {
                ...tile("root.glb", 100),
                refine: "REPLACE",
                children: [tile("child-a.glb"), tile("child-b.glb")],
            },
        };
        const adapter: IRuntimeAdapter<IFakeCamera, IFakeSpatial, IFakeHandle, string> = {
            tilesets: tilesetLoader(tileset),
            spatial: new FakeSpatialMetric(),
            content: {
                load: async (context) => {
                    loads.push(context.uri);
                    return {
                        kind: "renderable",
                        handle: { uri: context.uri },
                        cacheKey: context.uri,
                        cost: { cpuBytes: 10, gpuBytes: 20, networkBytes: 30 },
                    };
                },
                attach: () => undefined,
                detach: () => undefined,
                dispose: (context) => {
                    disposals.push(context.uri);
                },
            },
            telemetry: {
                record: (metric) => {
                    externalMetrics.push(metric.name);
                },
            },
        };
        const runtime = new TileRuntime({
            id: "cache",
            uri: "https://example.test/tileset.json",
            adapter,
            maxScreenSpaceError: 10,
            cache: { maxContentEntries: 2, unusedFrameRetention: 1000 },
        });
        const publications: number[] = [];
        runtime.instrumentation.subscribe((snapshot) => publications.push(snapshot.frame));

        await runtime.update({ multiplier: 0 });
        await runtime.whenIdle();
        await runtime.update({ multiplier: 1 });
        await runtime.whenIdle();

        expect(disposals).toContain("https://example.test/root.glb");
        expect(runtime.instrumentation.snapshot().cache.contentEvictions).toBeGreaterThanOrEqual(1);
        expect(runtime.instrumentation.snapshot().contents.cached).toBeLessThanOrEqual(2);
        expect(runtime.instrumentation.snapshot().metrics["content.load.network-bytes"]?.sum).toBe(90);

        await runtime.update({ multiplier: 0 });
        await runtime.whenIdle();
        expect(loads.filter((uri) => uri.endsWith("root.glb"))).toHaveLength(2);

        const metricsBeforeDisable = runtime.instrumentation.snapshot().metrics.frame?.count;
        const publicationsBeforeDisable = publications.length;
        const externalMetricsBeforeDisable = externalMetrics.length;
        runtime.instrumentation.setEnabled(false);
        await runtime.update({ multiplier: 0 });
        expect(runtime.instrumentation.snapshot().metrics.frame?.count).toBe(metricsBeforeDisable);
        expect(publications).toHaveLength(publicationsBeforeDisable);
        expect(externalMetrics).toHaveLength(externalMetricsBeforeDisable);

        runtime.instrumentation.setEnabled(true);
        await runtime.update({ multiplier: 0 });
        expect(runtime.instrumentation.snapshot().metrics.frame?.count).toBe((metricsBeforeDisable ?? 0) + 1);
        expect(publications.length).toBeGreaterThan(publicationsBeforeDisable);
        await runtime.dispose();
    });
});
