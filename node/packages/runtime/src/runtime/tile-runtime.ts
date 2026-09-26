import type { IContent, IMetadataSchema, ITile } from "@spacexr/3d-tiles-core";

import { LoadedSubtreeAvailability } from "../implicit/availability";
import {
    computeImplicitTile,
    expandImplicitTemplate,
    implicitBranchingFactor,
    implicitChildCoordinates,
    implicitLocalCoordinates,
} from "../implicit/coordinates";
import type {
    IImplicitCoordinates,
    ILoadedImplicitSubtree,
    IRuntimeImplicitContext,
    IRuntimeImplicitSubtree,
    IRuntimeImplicitTile,
} from "../implicit/types";
import { MetadataResolver } from "../metadata/metadata-resolver";
import type { IMetadataAncestorInput, IMetadataDiagnostic, IMetadataSnapshot } from "../metadata/types";
import type {
    IContentLoadContext,
    ContentLoadResult,
    IContentPresentationContext,
    IGlyphPublicationContext,
    ILoadedTileset,
    IRuntimeAdapter,
    IRuntimeMetric,
    IRuntimeSubscription,
    IRuntimeUriResolver,
} from "../ports";
import { StandardUriResolver } from "../ports";
import type {
    IResolvedRuntimeCacheOptions,
    IRuntimeCacheCounters,
    IRuntimeCacheEviction,
    IRuntimeCacheOptions,
    RuntimeCacheEvictionReason,
} from "./cache";
import { resolveRuntimeCacheOptions } from "./cache";
import type { IRuntimeContent, IRuntimeFrameResult, IRuntimeTile, IRuntimeTilesetDocument, ITileContext } from "./contracts";
import { RuntimeEventHub } from "./events";
import type {
    IContentHookContext,
    ICacheEvictionHookContext,
    IFrameHookContext,
    HookResult,
    IMetadataHookContext,
    IRuntimeErrorHookContext,
    IRuntimeHooks,
    ISubtreeHookContext,
    ITileHookContext,
    ITilesetLoadHookContext,
    ITilesetLoadedHookContext,
} from "./hooks";
import type { IRuntimeInstrumentationOptions, IRuntimeStateStatistics } from "./instrumentation";
import { RuntimeInstrumentation } from "./instrumentation";
import { PriorityScheduler } from "./priority-scheduler";

export interface ITileRuntimeOptions<TCamera, TSpatial, TContentHandle, TGlyphHandle> {
    id: string;
    uri: string;
    adapter: IRuntimeAdapter<TCamera, TSpatial, TContentHandle, TGlyphHandle>;
    maxScreenSpaceError?: number;
    maxScreenSpaceErrorForDepth?: (depth: number, defaultValue: number) => number;
    /**
     * Fraction of the SSE threshold retained while coarsening. A value of
     * `0.1` refines above the configured threshold and coarsens only below
     * 90 percent of it. This prevents LOD oscillation near the threshold.
     */
    refinementHysteresisRatio?: number;
    /**
     * Keeps already selected descendants while their coarser replacement is
     * loading, or as a last-resort fallback when no ready renderable ancestor
     * exists. Correct visual coverage never depends on the cache. Defaults to
     * true.
     */
    stableReplacementCut?: boolean;
    maxConcurrentLoads?: number;
    maxLoadAttempts?: number;
    cache?: IRuntimeCacheOptions | false;
    instrumentation?: boolean | IRuntimeInstrumentationOptions;
    hooks?: readonly IRuntimeHooks<TCamera, TSpatial, TContentHandle, TGlyphHandle>[];
}

interface IContentCacheEntry<TSpatial, TContentHandle, TGlyphHandle> {
    node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>;
    content: IRuntimeContent<TContentHandle> & { handle: TContentHandle };
}

interface ISubtreeCacheEntry<TSpatial, TContentHandle, TGlyphHandle> {
    node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>;
    subtree: IRuntimeImplicitSubtree;
    users: Array<IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>>;
}

export class TileRuntime<TCamera, TSpatial, TContentHandle = unknown, TGlyphHandle = unknown> {
    public readonly id: string;
    public readonly uri: string;
    public readonly adapter: IRuntimeAdapter<TCamera, TSpatial, TContentHandle, TGlyphHandle>;
    public readonly events = new RuntimeEventHub<TSpatial, TContentHandle, TGlyphHandle>();
    public readonly instrumentation: RuntimeInstrumentation;

    private readonly maxScreenSpaceError: number;
    private readonly maxScreenSpaceErrorForDepth: ((depth: number, defaultValue: number) => number) | undefined;
    private readonly refinementHysteresisRatio: number;
    private readonly stableReplacementCut: boolean;
    private readonly maxLoadAttempts: number;
    private readonly cacheOptions: IResolvedRuntimeCacheOptions;
    private readonly cacheCounters: IRuntimeCacheCounters = {
        sweeps: 0,
        contentEvictions: 0,
        subtreeEvictions: 0,
        implicitBranchPrunes: 0,
        prunedNodes: 0,
        releasedCpuBytes: 0,
        releasedGpuBytes: 0,
    };
    private readonly hooks: readonly IRuntimeHooks<TCamera, TSpatial, TContentHandle, TGlyphHandle>[];
    private readonly uriResolver: IRuntimeUriResolver;
    private readonly metadataResolver = new MetadataResolver();
    private readonly scheduler: PriorityScheduler;
    private readonly lifecycleController = new AbortController();
    private readonly nodes = new Map<string, IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>>();
    private readonly refiningNodes = new Set<string>();
    private readonly replacementFrontNodes = new Set<string>();
    private selectedAtFrameStart: Array<IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>> = [];

    private rootNode?: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>;
    private rootDocument?: IRuntimeTilesetDocument;
    private cameraSubscription: IRuntimeSubscription | undefined;
    private startPromise?: Promise<void>;
    private updateChain: Promise<void> = Promise.resolve();
    private lastCamera?: TCamera;
    private frame = 0;
    private disposed = false;
    private refreshNeeded = false;

    public constructor(options: ITileRuntimeOptions<TCamera, TSpatial, TContentHandle, TGlyphHandle>) {
        this.id = options.id;
        this.uri = options.uri;
        this.adapter = options.adapter;
        this.maxScreenSpaceError = options.maxScreenSpaceError ?? 16;
        this.maxScreenSpaceErrorForDepth = options.maxScreenSpaceErrorForDepth;
        this.refinementHysteresisRatio = options.refinementHysteresisRatio ?? 0.1;
        if (!Number.isFinite(this.refinementHysteresisRatio) || this.refinementHysteresisRatio < 0 || this.refinementHysteresisRatio >= 1) {
            throw new RangeError("refinementHysteresisRatio must be in the interval [0, 1).");
        }
        this.stableReplacementCut = options.stableReplacementCut ?? true;
        this.maxLoadAttempts = Math.max(1, Math.floor(options.maxLoadAttempts ?? 3));
        this.cacheOptions = resolveRuntimeCacheOptions(options.cache);
        this.hooks = options.hooks ?? [];
        this.uriResolver = options.adapter.uri ?? new StandardUriResolver();
        this.scheduler = new PriorityScheduler(options.maxConcurrentLoads ?? 4);
        this.instrumentation = new RuntimeInstrumentation(options.instrumentation, this.id, () => this.collectStatistics());
    }

    public get root(): IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle> | undefined {
        return this.rootNode;
    }

    public get document(): IRuntimeTilesetDocument | undefined {
        return this.rootDocument;
    }

    public get pendingLoads(): number {
        return this.scheduler.size;
    }

    /** True when settled asynchronous state still needs a caller-driven frame. */
    public get hasPendingWork(): boolean {
        // Queued and in-flight fetches run independently. Pumping traversal
        // frames while they are unresolved only ages the cache and repeats the
        // same cut. Their settlement calls markDirty(), which requests exactly
        // one new frame.
        return this.refreshNeeded;
    }

    public get selectedTiles(): readonly IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>[] {
        return [...this.nodes.values()].filter((node) => node.selected);
    }

    /** Immediately applies cache budgets. With force=true, every inactive cache entry is released. */
    public trimCache(force = false): Promise<void> {
        const operation = this.updateChain.then(async () => {
            if (this.disposed) return;
            await this.sweepCache(force);
            this.instrumentation.publish();
        });
        this.updateChain = operation.then(
            () => undefined,
            () => undefined,
        );
        return operation;
    }

    public async start(): Promise<void> {
        if (this.disposed) throw new Error("The runtime has been disposed.");
        if (this.startPromise) return this.startPromise;
        this.startPromise = this.initializeRoot();
        return this.startPromise;
    }

    public update(camera: TCamera): Promise<IRuntimeFrameResult<TSpatial, TContentHandle, TGlyphHandle>> {
        const operation = this.updateChain.then(async () => {
            await this.start();
            return this.performUpdate(camera);
        });
        this.updateChain = operation.then(
            () => undefined,
            () => undefined,
        );
        return operation;
    }

    public async whenIdle(): Promise<void> {
        while (!this.disposed) {
            await this.scheduler.whenIdle();
            await this.updateChain;
            if (this.scheduler.size > 0) continue;
            const camera = this.lastCamera;
            if (!this.refreshNeeded || camera === undefined) return;
            await this.update(camera);
        }
    }

    public async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        this.cameraSubscription?.unsubscribe();
        this.cameraSubscription = undefined;
        this.lifecycleController.abort();
        this.scheduler.dispose();
        await this.updateChain;
        const selected = [...this.nodes.values()].filter((node) => node.selected).sort((left, right) => right.depth - left.depth);
        for (const node of selected) await this.deactivateNode(node);
        for (const node of [...this.nodes.values()].sort((left, right) => right.depth - left.depth)) await this.disposeNodeContent(node);
        this.nodes.clear();
        this.refiningNodes.clear();
        this.replacementFrontNodes.clear();
        this.selectedAtFrameStart = [];
        this.events.clear();
        this.instrumentation.clear();
    }

    protected async performUpdate(camera: TCamera): Promise<IRuntimeFrameResult<TSpatial, TContentHandle, TGlyphHandle>> {
        if (this.disposed) throw new Error("The runtime has been disposed.");
        const startedAt = this.startTiming();
        const root = this.rootNode;
        if (!root) throw new Error("The root tileset is not initialized.");
        this.lastCamera = camera;
        // A frame consumes the state accumulated by completed asynchronous
        // work. Loads that settle during this traversal set the flag again and
        // are consumed by the next caller-driven frame.
        this.refreshNeeded = false;
        const currentFrame = ++this.frame;
        const beforeContext: IFrameHookContext<TCamera, TSpatial, TContentHandle, TGlyphHandle> = {
            runtimeId: this.id,
            frame: currentFrame,
            camera,
        };
        await this.invokeHooks("beforeFrame", (hook) => hook.beforeFrame?.(beforeContext));

        const desired = new Map<string, IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>>();
        const requested: IRuntimeContent<TContentHandle>[] = [];
        this.selectedAtFrameStart = [...this.nodes.values()].filter((node) => node.selected);
        this.replacementFrontNodes.clear();
        for (const node of this.nodes.values()) node.visible = false;
        this.visit(root, camera, desired, requested);

        const entering = [...desired.values()].filter((node) => !node.selected).sort((left, right) => left.depth - right.depth);
        const staying = [...desired.values()].filter((node) => node.selected);
        for (const node of [...entering, ...staying]) await this.activateNode(node);

        const leaving = [...this.nodes.values()]
            .filter((node) => node.selected && !desired.has(node.id))
            .sort((left, right) => right.depth - left.depth);
        for (const node of leaving) await this.deactivateNode(node);
        await this.sweepCache();

        const result: IRuntimeFrameResult<TSpatial, TContentHandle, TGlyphHandle> = {
            frame: currentFrame,
            selected: [...desired.values()],
            requested,
            pendingLoads: this.scheduler.size,
        };
        this.events.emit({ type: "frame", result });
        this.recordMetric({
            name: "frame",
            value: 1,
            unit: "count",
            tags: { runtime: this.id, requested: requested.length, pending: this.scheduler.size },
        });
        this.recordMetric({
            name: "frame.selected",
            value: desired.size,
            unit: "count",
            tags: { runtime: this.id },
        });
        const afterContext: IFrameHookContext<TCamera, TSpatial, TContentHandle, TGlyphHandle> = {
            ...beforeContext,
            result,
        };
        await this.invokeHooks("afterFrame", (hook) => hook.afterFrame?.(afterContext));
        this.recordDuration("frame.duration", startedAt, { runtime: this.id });
        this.instrumentation.publish();
        return result;
    }

    protected visit(
        node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>,
        camera: TCamera,
        desired: Map<string, IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>>,
        requested: IRuntimeContent<TContentHandle>[],
    ): void {
        node.visible = this.adapter.spatial.isVisible(node.spatial, camera);
        if (!node.visible) return;
        node.lastTouchedFrame = this.frame;
        if (node.implicit) node.implicit.subtree.lastTouchedFrame = this.frame;
        node.screenSpaceError = this.adapter.spatial.screenSpaceError({
            camera,
            spatial: node.spatial,
            tile: node.source,
            depth: node.depth,
        });
        if (node.implicit && node.implicit.subtree.status !== "ready") {
            this.requestImplicitSubtree(node, node.screenSpaceError);
            this.selectNode(node, desired, requested);
            return;
        }
        const threshold = this.maxScreenSpaceErrorForDepth?.(node.depth, this.maxScreenSpaceError) ?? this.maxScreenSpaceError;
        const hasPotentialPresentation = node.contents.some((content) => content.kind === "unknown" || content.kind === "renderable");
        const wasRefining = this.refiningNodes.has(node.id);
        const effectiveThreshold = wasRefining ? threshold * (1 - this.refinementHysteresisRatio) : threshold;
        const refinementRequested = node.screenSpaceError > effectiveThreshold || !hasPotentialPresentation;
        if (refinementRequested) this.materializeImplicitChildren(node);
        const wantsRefinement = refinementRequested && node.children.length > 0;
        this.setRefinementState(node, wantsRefinement);

        if (!wantsRefinement) {
            // A coarse tile may have been evicted while its descendants were
            // selected. Never remove those descendants before the parent is
            // renderable, otherwise zooming out exposes the clear colour for
            // one or more load cycles. Correctness must not depend on cache.
            if (hasPotentialPresentation && !this.isNodePresentationReady(node)) {
                this.requestNodeContents(node, node.screenSpaceError, requested);
                if (this.stableReplacementCut && this.retainVisibleSelectedDescendants(node, camera, desired)) return;
                if (this.selectReadyCoverageAncestor(node.parent, desired, requested)) return;
            }
            this.selectNode(node, desired, requested);
            return;
        }

        if (node.refine === "ADD") {
            this.selectNode(node, desired, requested);
            for (const child of node.children) this.visit(child, camera, desired, requested);
            return;
        }

        const replacementReady = node.children.every((child) => this.collectReplacementFront(child, camera, requested));
        if (replacementReady) {
            for (const child of node.children) this.visit(child, camera, desired, requested);
        } else {
            // A ready ancestor provides complete coverage for every visible
            // child branch. Previously selected descendants are retained only
            // when no such ancestor is currently available.
            if (this.selectReadyCoverageAncestor(node, desired, requested)) return;
            if (this.stableReplacementCut && this.retainVisibleSelectedDescendants(node, camera, desired)) return;
            this.selectNode(node, desired, requested);
        }
    }

    protected collectReplacementFront(
        node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>,
        camera: TCamera,
        requested: IRuntimeContent<TContentHandle>[],
    ): boolean {
        node.visible = this.adapter.spatial.isVisible(node.spatial, camera);
        if (!node.visible) return true;
        node.lastTouchedFrame = this.frame;
        if (node.implicit) node.implicit.subtree.lastTouchedFrame = this.frame;
        node.screenSpaceError = this.adapter.spatial.screenSpaceError({
            camera,
            spatial: node.spatial,
            tile: node.source,
            depth: node.depth,
        });
        if (node.implicit && node.implicit.subtree.status !== "ready") {
            this.requestImplicitSubtree(node, node.screenSpaceError);
            return false;
        }
        this.materializeImplicitChildren(node);
        const potential = node.contents.filter((content) => content.kind === "unknown" || content.kind === "renderable");
        if (potential.length > 0) {
            for (const content of potential) content.lastTouchedFrame = this.frame;
            this.replacementFrontNodes.add(node.id);
            this.requestNodeContents(node, node.screenSpaceError, requested);
            return potential.every((content) => content.kind === "renderable" && content.status === "ready");
        }
        if (node.children.length === 0) return true;
        return node.children.every((child) => this.collectReplacementFront(child, camera, requested));
    }

    private isNodePresentationReady(node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>): boolean {
        const potential = node.contents.filter((content) => content.kind === "unknown" || content.kind === "renderable");
        return (
            potential.length > 0 &&
            potential.every((content) => content.kind === "renderable" && content.status === "ready" && content.handle !== undefined)
        );
    }

    private selectReadyCoverageAncestor(
        start: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle> | undefined,
        desired: Map<string, IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>>,
        requested: IRuntimeContent<TContentHandle>[],
    ): boolean {
        let candidate = start;
        while (candidate) {
            if (this.isNodePresentationReady(candidate)) {
                this.selectNode(candidate, desired, requested);
                return true;
            }
            candidate = candidate.parent;
        }
        return false;
    }

    private retainVisibleSelectedDescendants(
        node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>,
        camera: TCamera,
        desired: Map<string, IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>>,
    ): boolean {
        let retained = false;
        for (const candidate of this.selectedAtFrameStart) {
            if (!this.isDescendantOf(candidate, node)) continue;
            candidate.visible = this.adapter.spatial.isVisible(candidate.spatial, camera);
            if (!candidate.visible) continue;
            candidate.lastTouchedFrame = this.frame;
            if (candidate.implicit) candidate.implicit.subtree.lastTouchedFrame = this.frame;
            candidate.screenSpaceError = this.adapter.spatial.screenSpaceError({
                camera,
                spatial: candidate.spatial,
                tile: candidate.source,
                depth: candidate.depth,
            });
            desired.set(candidate.id, candidate);
            for (const content of candidate.contents) content.lastTouchedFrame = this.frame;
            retained = true;
        }
        return retained;
    }

    private isDescendantOf(
        candidate: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>,
        ancestor: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>,
    ): boolean {
        let parent = candidate.parent;
        while (parent) {
            if (parent === ancestor) return true;
            parent = parent.parent;
        }
        return false;
    }

    private setRefinementState(node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>, refining: boolean): void {
        const wasRefining = this.refiningNodes.has(node.id);
        if (wasRefining === refining) return;
        if (refining) this.refiningNodes.add(node.id);
        else this.refiningNodes.delete(node.id);
        this.recordMetric({
            name: refining ? "tile.refine" : "tile.coarsen",
            value: 1,
            unit: "count",
            tags: {
                runtime: this.id,
                tile: node.id,
                depth: node.depth,
                screenSpaceError: node.screenSpaceError,
            },
        });
    }

    protected selectNode(
        node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>,
        desired: Map<string, IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>>,
        requested: IRuntimeContent<TContentHandle>[],
    ): void {
        desired.set(node.id, node);
        node.lastTouchedFrame = this.frame;
        for (const content of node.contents) content.lastTouchedFrame = this.frame;
        this.requestNodeContents(node, node.screenSpaceError, requested);
    }

    protected requestNodeContents(
        node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>,
        priority: number,
        requested: IRuntimeContent<TContentHandle>[],
    ): void {
        for (const content of node.contents) {
            if (content.kind !== "unknown" && content.kind !== "renderable") continue;
            if (content.status !== "idle" && content.status !== "error" && content.status !== "cancelled") continue;
            if (content.attempts >= this.maxLoadAttempts) continue;
            content.status = "queued";
            const added = this.scheduler.enqueue(content.id, priority, (signal) => this.loadContent(node, content, signal));
            if (added) {
                requested.push(content);
                this.events.emit({ type: "content-state", tile: node, content });
            }
        }
    }

    protected async loadContent(
        node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>,
        content: IRuntimeContent<TContentHandle>,
        signal: AbortSignal,
    ): Promise<void> {
        const startedAt = this.startTiming();
        content.attempts++;
        content.status = "loading";
        content.lastTouchedFrame = this.frame;
        this.events.emit({ type: "content-state", tile: node, content });
        const hookContext: IContentHookContext<TSpatial, TContentHandle, TGlyphHandle> = { runtimeId: this.id, tile: node, content };
        await this.invokeHooks("beforeContentLoad", (hook) => hook.beforeContentLoad?.(hookContext), node, content);
        try {
            const result = await this.adapter.content.load(this.contentLoadContext(node, content), signal);
            if (signal.aborted) {
                content.status = "cancelled";
                return;
            }
            await this.acceptContentResult(node, content, result);
            content.status = "ready";
            content.lastTouchedFrame = this.frame;
            delete content.error;
            this.recordMetric({
                name: "content.load",
                value: 1,
                unit: "count",
                tags: { runtime: this.id, tile: node.id, kind: content.kind },
            });
            this.recordDuration("content.load.duration", startedAt, {
                runtime: this.id,
                tile: node.id,
                kind: content.kind,
            });
            if (content.cost?.networkBytes !== undefined) {
                this.recordMetric({
                    name: "content.load.network-bytes",
                    value: content.cost.networkBytes,
                    unit: "byte",
                    tags: { runtime: this.id, tile: node.id },
                });
            }
            await this.invokeHooks("afterContentLoad", (hook) => hook.afterContentLoad?.({ ...hookContext, result }), node, content);
        } catch (error) {
            content.error = error;
            content.status = signal.aborted ? "cancelled" : "error";
            await this.reportError("content.load", error, node, content);
        } finally {
            this.events.emit({ type: "content-state", tile: node, content });
            this.markDirty();
        }
    }

    protected async acceptContentResult(
        node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>,
        content: IRuntimeContent<TContentHandle>,
        result: ContentLoadResult<TContentHandle>,
    ): Promise<void> {
        content.kind = result.kind;
        if (result.kind === "renderable") {
            content.handle = result.handle;
            if (result.cacheKey) content.cacheKey = result.cacheKey;
            else delete content.cacheKey;
            if (result.cost) content.cost = result.cost;
            else delete content.cost;
            if (result.featureMetadata) content.featureMetadata = result.featureMetadata;
            else delete content.featureMetadata;
            return;
        }
        if (result.kind === "external-tileset") {
            const documentUri = result.documentUri ?? content.uri;
            const loaded: ILoadedTileset = {
                tileset: result.tileset,
                ...(result.baseUri ? { baseUri: result.baseUri } : {}),
            };
            const document = await this.createDocument(`${node.document.id}/${content.id}`, documentUri, loaded);
            const child = this.createNode(document.tileset.root, document, node, `external-${node.contents.indexOf(content)}`);
            node.children.push(child);
            const hookContext: ITilesetLoadedHookContext = {
                runtimeId: this.id,
                uri: documentUri,
                parentDocumentUri: node.document.uri,
                loaded,
                document,
            };
            await this.invokeHooks("afterTilesetLoad", (hook) => hook.afterTilesetLoad?.(hookContext), node, content);
        }
    }

    protected async activateNode(node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>): Promise<void> {
        const wasSelected = node.selected;
        const readyContents = node.contents.filter(
            (content): content is IRuntimeContent<TContentHandle> & { handle: TContentHandle } =>
                content.kind === "renderable" && content.status === "ready" && content.handle !== undefined,
        );
        const hasNewContent = readyContents.some((content) => !content.attached);
        if (wasSelected && !hasNewContent) return;

        const snapshots: IMetadataSnapshot[] = [];
        for (const content of readyContents) {
            const snapshot = await this.resolveMetadata(node, content.descriptor, content.featureMetadata);
            snapshots.push(snapshot);
            if (content.attached) continue;
            const presentation = this.presentationContext(node, content, snapshot);
            const hookContext: IContentHookContext<TSpatial, TContentHandle, TGlyphHandle> = {
                runtimeId: this.id,
                tile: node,
                content,
                metadata: snapshot,
            };
            await this.invokeHooks("beforeContentAttach", (hook) => hook.beforeContentAttach?.(hookContext), node, content);
            try {
                await this.adapter.content.attach(presentation);
                content.attached = true;
                content.lastTouchedFrame = this.frame;
                this.recordMetric({
                    name: "tile.attach",
                    value: 1,
                    unit: "count",
                    tags: { runtime: this.id, tile: node.id },
                });
                await this.invokeHooks("afterContentAttach", (hook) => hook.afterContentAttach?.(hookContext), node, content);
            } catch (error) {
                await this.reportError("content.attach", error, node, content);
            }
        }
        if (snapshots.length === 0) snapshots.push(await this.resolveMetadata(node));
        node.metadataSnapshots = snapshots;

        if (this.adapter.glyphs) {
            if (node.glyphHandles.length > 0) await this.revokeGlyphs(node);
            const tileHookContext: ITileHookContext<TSpatial, TContentHandle, TGlyphHandle> = { runtimeId: this.id, tile: node };
            await this.invokeHooks("beforeGlyphPublish", (hook) => hook.beforeGlyphPublish?.(tileHookContext), node);
            try {
                const handles = await this.adapter.glyphs.publish(this.glyphContext(node));
                node.glyphHandles = [...handles];
                await this.invokeHooks("afterGlyphPublish", (hook) => hook.afterGlyphPublish?.(tileHookContext), node);
            } catch (error) {
                await this.reportError("glyph.publish", error, node);
            }
        }

        node.selected = true;
        if (!wasSelected) {
            const context: ITileHookContext<TSpatial, TContentHandle, TGlyphHandle> = { runtimeId: this.id, tile: node };
            await this.invokeHooks("onTileSelected", (hook) => hook.onTileSelected?.(context), node);
            this.events.emit({ type: "tile-selected", tile: node });
        }
    }

    protected async deactivateNode(node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>): Promise<void> {
        if (!node.selected) return;
        await this.revokeGlyphs(node);
        for (const content of node.contents) {
            if (!content.attached || content.handle === undefined) continue;
            const snapshot =
                node.metadataSnapshots.find((candidate) => candidate.content === content.descriptor) ??
                (await this.resolveMetadata(node, content.descriptor));
            const presentation = this.presentationContext(
                node,
                content as IRuntimeContent<TContentHandle> & { handle: TContentHandle },
                snapshot,
            );
            const hookContext: IContentHookContext<TSpatial, TContentHandle, TGlyphHandle> = {
                runtimeId: this.id,
                tile: node,
                content,
                metadata: snapshot,
            };
            await this.invokeHooks("beforeContentDetach", (hook) => hook.beforeContentDetach?.(hookContext), node, content);
            try {
                await this.adapter.content.detach(presentation);
                content.attached = false;
                content.lastTouchedFrame = this.frame;
                this.recordMetric({
                    name: "tile.detach",
                    value: 1,
                    unit: "count",
                    tags: { runtime: this.id, tile: node.id },
                });
                await this.invokeHooks("afterContentDetach", (hook) => hook.afterContentDetach?.(hookContext), node, content);
            } catch (error) {
                await this.reportError("content.detach", error, node, content);
            }
        }
        node.selected = false;
        const context: ITileHookContext<TSpatial, TContentHandle, TGlyphHandle> = { runtimeId: this.id, tile: node };
        await this.invokeHooks("onTileDeselected", (hook) => hook.onTileDeselected?.(context), node);
        this.events.emit({ type: "tile-deselected", tile: node });
    }

    protected async resolveMetadata(
        node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>,
        content?: IContent,
        features?: IRuntimeContent<TContentHandle>["featureMetadata"],
    ): Promise<IMetadataSnapshot> {
        const tileContext: ITileHookContext<TSpatial, TContentHandle, TGlyphHandle> = { runtimeId: this.id, tile: node };
        await this.invokeHooks("beforeMetadataResolve", (hook) => hook.beforeMetadataResolve?.(tileContext), node);
        const ancestors: IMetadataAncestorInput[] = [];
        let parent = node.parent;
        while (parent) {
            ancestors.unshift({ id: parent.id, tile: parent.source, document: parent.document.metadata });
            parent = parent.parent;
        }
        const snapshot = this.metadataResolver.resolve({
            document: node.document.metadata,
            tileId: node.id,
            tile: node.source,
            ancestors,
            ...(node.implicit?.subtree.loaded?.subtree.subtreeMetadata
                ? {
                      subtree: {
                          id: node.implicit.subtree.uri,
                          entity: node.implicit.subtree.loaded.subtree.subtreeMetadata,
                          documentUri: node.implicit.subtree.uri,
                      },
                  }
                : {}),
            ...(content ? { content } : {}),
            ...(features ? { features } : {}),
        });
        for (const diagnostic of snapshot.diagnostics) {
            this.recordMetric({
                name: "metadata.diagnostic",
                value: 1,
                unit: "count",
                tags: { runtime: this.id, tile: node.id, code: diagnostic.code, severity: diagnostic.severity },
            });
        }
        const hookContext: IMetadataHookContext<TSpatial, TContentHandle, TGlyphHandle> = { ...tileContext, snapshot };
        await this.invokeHooks("afterMetadataResolve", (hook) => hook.afterMetadataResolve?.(hookContext), node);
        this.events.emit({ type: "metadata-resolved", tile: node, snapshot });
        return snapshot;
    }

    private async initializeRoot(): Promise<void> {
        const hookContext: ITilesetLoadHookContext = { runtimeId: this.id, uri: this.uri };
        await this.invokeHooks("beforeTilesetLoad", (hook) => hook.beforeTilesetLoad?.(hookContext));
        const startedAt = this.startTiming();
        try {
            const loaded = await this.adapter.tilesets.load({ uri: this.uri, signal: this.lifecycleController.signal });
            const document = await this.createDocument(this.id, this.uri, loaded);
            this.rootDocument = document;
            this.rootNode = this.createNode(document.tileset.root, document, undefined, "root");
            this.recordMetric({
                name: "tileset.load",
                value: this.elapsed(startedAt),
                unit: "millisecond",
                tags: { runtime: this.id, document: this.uri },
            });
            const loadedContext: ITilesetLoadedHookContext = { ...hookContext, loaded, document };
            await this.invokeHooks("afterTilesetLoad", (hook) => hook.afterTilesetLoad?.(loadedContext));
            this.events.emit({ type: "tileset-ready", document });
            const cameraSubscription = this.adapter.camera?.subscribe((camera) => {
                void this.update(camera).catch((error) => this.reportError("camera.update", error));
            });
            if (cameraSubscription) this.cameraSubscription = cameraSubscription;
            const currentCamera = this.adapter.camera?.current?.();
            if (currentCamera !== undefined)
                queueMicrotask(() => void this.update(currentCamera).catch((error) => this.reportError("camera.update", error)));
        } catch (error) {
            await this.reportError("tileset.load", error);
            throw error;
        }
    }

    private async createDocument(id: string, uri: string, loaded: ILoadedTileset): Promise<IRuntimeTilesetDocument> {
        const baseUri = loaded.baseUri ?? this.uriResolver.baseOf(uri);
        const diagnostics: IMetadataDiagnostic[] = [];
        let schema: IMetadataSchema | undefined = loaded.tileset.schema;
        let schemaUri: string | undefined;
        if (loaded.tileset.schemaUri) {
            schemaUri = this.uriResolver.resolve(loaded.tileset.schemaUri, baseUri);
            if (this.adapter.metadataSchemas) {
                try {
                    schema = await this.adapter.metadataSchemas.load({
                        uri: schemaUri,
                        documentUri: uri,
                        signal: this.lifecycleController.signal,
                    });
                } catch (error) {
                    diagnostics.push({
                        code: "METADATA_SCHEMA_LOAD_FAILED",
                        severity: "error",
                        message: `Could not load metadata schema "${schemaUri}": ${String(error)}`,
                        path: "$.schemaUri",
                        documentUri: uri,
                    });
                }
            } else {
                diagnostics.push({
                    code: "METADATA_SCHEMA_LOADER_MISSING",
                    severity: "warning",
                    message: `A metadata schema loader is required for "${schemaUri}".`,
                    path: "$.schemaUri",
                    documentUri: uri,
                });
            }
        }
        const metadata = {
            uri,
            tileset: loaded.tileset,
            ...(schema ? { schema } : {}),
            ...(schemaUri ? { schemaUri } : {}),
            diagnostics,
        };
        return {
            id,
            uri,
            baseUri,
            tileset: loaded.tileset,
            metadata,
        };
    }

    private createNode(
        tile: ITile,
        document: IRuntimeTilesetDocument,
        parent: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle> | undefined,
        segment: string,
        implicit?: IRuntimeImplicitTile,
    ): IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle> {
        const id = parent ? `${parent.id}/${segment}` : `${this.id}/${segment}`;
        let source = tile;
        let implicitState = implicit;
        if (tile.implicitTiling && !implicitState) {
            const contentTemplates = tile.contents ? [...tile.contents] : tile.content ? [tile.content] : [];
            const context: IRuntimeImplicitContext = {
                id,
                rootTile: tile,
                implicitTiling: tile.implicitTiling,
                contentTemplates,
            };
            const coordinates: IImplicitCoordinates = {
                level: 0,
                x: 0,
                y: 0,
                ...(tile.implicitTiling.subdivisionScheme === "OCTREE" ? { z: 0 } : {}),
            };
            const subtree = this.createImplicitSubtree(context, coordinates, document);
            implicitState = {
                context,
                coordinates,
                localCoordinates: coordinates,
                subtree,
                childrenMaterialized: false,
                metadataApplied: false,
            };
            source = this.createImplicitTileSource(implicitState, document, true);
        }
        const spatial = this.adapter.spatial.derive({ tile: source, ...(parent ? { parent: parent.spatial } : {}) });
        const descriptors = implicitState ? [] : source.contents ? [...source.contents] : source.content ? [source.content] : [];
        const node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle> = {
            id,
            source,
            document,
            ...(parent ? { parent } : {}),
            ...(implicitState ? { implicit: implicitState } : {}),
            children: [],
            depth: parent ? parent.depth + 1 : 0,
            refine: source.refine ?? parent?.refine ?? "REPLACE",
            spatial,
            contents: descriptors.map((descriptor, index) => ({
                id: `${id}/content-${index}`,
                descriptor,
                uri: this.uriResolver.resolve(descriptor.uri, document.baseUri),
                status: "idle",
                kind: "unknown",
                attempts: 0,
                attached: false,
                lastTouchedFrame: this.frame,
            })),
            visible: false,
            selected: false,
            screenSpaceError: 0,
            glyphHandles: [],
            metadataSnapshots: [],
            lastTouchedFrame: this.frame,
        };
        this.nodes.set(id, node);
        if (implicitState?.subtree.status === "ready") this.applyImplicitContents(node);
        for (let index = 0; index < (source.children?.length ?? 0); index++) {
            const child = source.children?.[index];
            if (child) node.children.push(this.createNode(child, document, node, String(index)));
        }
        return node;
    }

    private createImplicitSubtree(
        context: IRuntimeImplicitContext,
        coordinates: IImplicitCoordinates,
        document: IRuntimeTilesetDocument,
    ): IRuntimeImplicitSubtree {
        const reference = expandImplicitTemplate(context.implicitTiling.subtrees.uri, coordinates);
        return {
            uri: this.uriResolver.resolve(reference, document.baseUri),
            coordinates,
            status: "idle",
            attempts: 0,
            estimatedBytes: 0,
            lastTouchedFrame: this.frame,
        };
    }

    private createImplicitTileSource(implicit: IRuntimeImplicitTile, document: IRuntimeTilesetDocument, root = false): ITile {
        const computed = computeImplicitTile(implicit.context.rootTile, implicit.context.implicitTiling, implicit.coordinates);
        const override = this.adapter.implicitTiles?.resolve({
            documentUri: document.uri,
            rootTile: implicit.context.rootTile,
            implicitTiling: implicit.context.implicitTiling,
            coordinates: implicit.coordinates,
            computedBoundingVolume: computed.boundingVolume,
            computedGeometricError: computed.geometricError,
            computedContents: computed.contents,
        });
        return {
            boundingVolume: override?.boundingVolume ?? computed.boundingVolume,
            geometricError: override?.geometricError ?? computed.geometricError,
            refine: implicit.context.rootTile.refine ?? "REPLACE",
            ...(root && implicit.context.rootTile.transform ? { transform: implicit.context.rootTile.transform } : {}),
            ...(override?.metadata ? { metadata: override.metadata } : {}),
        };
    }

    private implicitContents(node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>): readonly IContent[] {
        const implicit = node.implicit;
        if (!implicit) return [];
        const computed = computeImplicitTile(implicit.context.rootTile, implicit.context.implicitTiling, implicit.coordinates);
        const override = this.adapter.implicitTiles?.resolve({
            documentUri: node.document.uri,
            rootTile: implicit.context.rootTile,
            implicitTiling: implicit.context.implicitTiling,
            coordinates: implicit.coordinates,
            computedBoundingVolume: computed.boundingVolume,
            computedGeometricError: computed.geometricError,
            computedContents: computed.contents,
        });
        return override?.contents ?? computed.contents;
    }

    private applyImplicitContents(node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>): void {
        const implicit = node.implicit;
        const availability = implicit?.subtree.availability;
        const loaded = implicit?.subtree.loaded;
        if (!implicit || !availability || !loaded || node.contents.length > 0) return;
        const decoded = this.adapter.implicitMetadata?.decode({
            loaded,
            availability,
            ...(node.document.metadata.schema ? { schema: node.document.metadata.schema } : {}),
            implicitTiling: implicit.context.implicitTiling,
            coordinates: implicit.coordinates,
            localCoordinates: implicit.localCoordinates,
            contentCount: implicit.context.contentTemplates.length,
        });
        if (!implicit.metadataApplied) {
            if (decoded?.tileMetadata) node.source.metadata = decoded.tileMetadata;
            implicit.metadataApplied = true;
        }
        const available = this.implicitContents(node)
            .map((descriptor, index) => ({
                descriptor: decoded?.contentMetadata?.[index] ? { ...descriptor, metadata: decoded.contentMetadata[index] } : descriptor,
                index,
            }))
            .filter(({ index }) => availability.isContentAvailable(index, implicit.localCoordinates));
        if (available.length === 0) return;
        if (implicit.context.contentTemplates.length === 1) node.source.content = available[0]!.descriptor;
        else node.source.contents = available.map(({ descriptor }) => descriptor) as [IContent, ...IContent[]];
        for (const { descriptor, index } of available) {
            node.contents.push({
                id: `${node.id}/content-${index}`,
                descriptor,
                uri: this.uriResolver.resolve(descriptor.uri, node.document.baseUri),
                status: "idle",
                kind: "unknown",
                attempts: 0,
                attached: false,
                lastTouchedFrame: this.frame,
            });
        }
    }

    private requestImplicitSubtree(node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>, priority: number): void {
        const implicit = node.implicit;
        if (!implicit) return;
        const subtree = implicit.subtree;
        if (subtree.status !== "idle" && subtree.status !== "error" && subtree.status !== "cancelled") return;
        if (subtree.attempts >= this.maxLoadAttempts) return;
        subtree.status = "queued";
        subtree.lastTouchedFrame = this.frame;
        this.events.emit({ type: "subtree-state", tile: node, subtree });
        const key = `subtree:${implicit.context.id}:${subtree.coordinates.level}:${subtree.coordinates.x}:${subtree.coordinates.y}:${subtree.coordinates.z ?? 0}`;
        this.scheduler.enqueue(key, priority, async (signal) => {
            const startedAt = this.startTiming();
            subtree.status = "loading";
            subtree.attempts++;
            this.events.emit({ type: "subtree-state", tile: node, subtree });
            const hookContext: ISubtreeHookContext<TSpatial, TContentHandle, TGlyphHandle> = {
                runtimeId: this.id,
                tile: node,
                subtree,
            };
            try {
                await this.invokeHooks("beforeSubtreeLoad", (hook) => hook.beforeSubtreeLoad?.(hookContext), node);
                const loader = this.adapter.subtrees;
                if (!loader) throw new Error(`Implicit subtree loader is required for ${subtree.uri}.`);
                const loaded = await loader.load({
                    uri: subtree.uri,
                    documentUri: node.document.uri,
                    coordinates: subtree.coordinates,
                    implicitTiling: implicit.context.implicitTiling,
                    contentCount: implicit.context.contentTemplates.length,
                    signal,
                });
                if (signal.aborted) {
                    subtree.status = "cancelled";
                    return;
                }
                const availability = new LoadedSubtreeAvailability(loaded, implicit.context.implicitTiling);
                const rootCoordinates: IImplicitCoordinates = {
                    level: 0,
                    x: 0,
                    y: 0,
                    ...(implicit.context.implicitTiling.subdivisionScheme === "OCTREE" ? { z: 0 } : {}),
                };
                if (!availability.isTileAvailable(rootCoordinates))
                    throw new Error(`Subtree ${subtree.uri} does not make its root tile available.`);
                subtree.loaded = loaded;
                subtree.availability = availability;
                subtree.estimatedBytes = this.estimateSubtreeBytes(loaded);
                subtree.lastTouchedFrame = this.frame;
                subtree.status = "ready";
                delete subtree.error;
                this.applyImplicitContents(node);
                await this.invokeHooks("afterSubtreeLoad", (hook) => hook.afterSubtreeLoad?.({ ...hookContext, loaded }), node);
                this.recordMetric({
                    name: "subtree.load",
                    value: 1,
                    unit: "count",
                    tags: { runtime: this.id, tile: node.id },
                });
                this.recordDuration("subtree.load.duration", startedAt, { runtime: this.id, tile: node.id });
                this.recordMetric({
                    name: "subtree.load.bytes",
                    value: subtree.estimatedBytes,
                    unit: "byte",
                    tags: { runtime: this.id, tile: node.id },
                });
            } catch (error) {
                subtree.error = error;
                subtree.status = signal.aborted ? "cancelled" : "error";
                await this.reportError("subtree.load", error, node);
            } finally {
                this.events.emit({ type: "subtree-state", tile: node, subtree });
                this.markDirty();
            }
        });
    }

    private materializeImplicitChildren(node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>): void {
        const implicit = node.implicit;
        if (!implicit || implicit.childrenMaterialized || implicit.subtree.status !== "ready" || !implicit.subtree.availability) return;
        implicit.subtree.lastTouchedFrame = this.frame;
        implicit.childrenMaterialized = true;
        const tiling = implicit.context.implicitTiling;
        if (implicit.coordinates.level + 1 >= tiling.availableLevels) return;
        const childCount = implicitBranchingFactor(tiling);
        for (let index = 0; index < childCount; index++) {
            const coordinates = implicitChildCoordinates(implicit.coordinates, index, tiling.subdivisionScheme);
            const localCoordinates = implicitLocalCoordinates(coordinates, implicit.subtree.coordinates);
            let subtree = implicit.subtree;
            let available: boolean;
            let childLocal = localCoordinates;
            if (localCoordinates.level < tiling.subtreeLevels) {
                available = subtree.availability!.isTileAvailable(localCoordinates);
            } else {
                available = subtree.availability!.isChildSubtreeAvailable(localCoordinates);
                if (available) {
                    subtree = this.createImplicitSubtree(implicit.context, coordinates, node.document);
                    childLocal = {
                        level: 0,
                        x: 0,
                        y: 0,
                        ...(tiling.subdivisionScheme === "OCTREE" ? { z: 0 } : {}),
                    };
                }
            }
            if (!available) continue;
            const childImplicit: IRuntimeImplicitTile = {
                context: implicit.context,
                coordinates,
                localCoordinates: childLocal,
                subtree,
                childrenMaterialized: false,
                metadataApplied: false,
            };
            const source = this.createImplicitTileSource(childImplicit, node.document);
            node.children.push(this.createNode(source, node.document, node, `implicit-${index}`, childImplicit));
        }
    }

    private tileContext(node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>): ITileContext<TSpatial> {
        return {
            runtimeId: this.id,
            tileId: node.id,
            depth: node.depth,
            tile: node.source,
            document: node.document,
            spatial: node.spatial,
            ...(node.implicit ? { implicitCoordinates: node.implicit.coordinates } : {}),
        };
    }

    private contentLoadContext(
        node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>,
        content: IRuntimeContent<TContentHandle>,
    ): IContentLoadContext<TSpatial> {
        return {
            ...this.tileContext(node),
            contentId: content.id,
            content: content.descriptor,
            uri: content.uri,
        };
    }

    private presentationContext(
        node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>,
        content: IRuntimeContent<TContentHandle> & { handle: TContentHandle },
        metadata: IMetadataSnapshot,
    ): IContentPresentationContext<TSpatial, TContentHandle> {
        return { ...this.contentLoadContext(node, content), handle: content.handle, metadata };
    }

    private glyphContext(node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>): IGlyphPublicationContext<TSpatial, TContentHandle> {
        return {
            ...this.tileContext(node),
            metadata: node.metadataSnapshots,
            contentHandles: node.contents
                .filter(
                    (content): content is IRuntimeContent<TContentHandle> & { handle: TContentHandle } =>
                        content.attached && content.handle !== undefined,
                )
                .map((content) => content.handle),
        };
    }

    private async revokeGlyphs(node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>): Promise<void> {
        if (!this.adapter.glyphs || node.glyphHandles.length === 0) return;
        const context: ITileHookContext<TSpatial, TContentHandle, TGlyphHandle> = { runtimeId: this.id, tile: node };
        await this.invokeHooks("beforeGlyphRevoke", (hook) => hook.beforeGlyphRevoke?.(context), node);
        try {
            await this.adapter.glyphs.revoke(node.glyphHandles, this.glyphContext(node));
            node.glyphHandles = [];
            await this.invokeHooks("afterGlyphRevoke", (hook) => hook.afterGlyphRevoke?.(context), node);
        } catch (error) {
            await this.reportError("glyph.revoke", error, node);
        }
    }

    private async sweepCache(force = false): Promise<void> {
        if (!this.cacheOptions.enabled) return;
        const startedAt = this.startTiming();
        this.cacheCounters.sweeps++;
        await this.sweepContentCache(force);
        await this.sweepSubtreeCache(force);
        await this.sweepImplicitBranches(force);
        if (this.instrumentation.enabled) {
            const state = this.collectStatistics();
            this.recordMetric({ name: "cache.content.entries", value: state.contents.cached, unit: "count" });
            this.recordMetric({ name: "cache.content.cpu-bytes", value: state.contents.cpuBytes, unit: "byte" });
            this.recordMetric({ name: "cache.content.gpu-bytes", value: state.contents.gpuBytes, unit: "byte" });
            this.recordMetric({ name: "cache.subtree.entries", value: state.subtrees.cached, unit: "count" });
            this.recordMetric({ name: "cache.subtree.bytes", value: state.subtrees.bytes, unit: "byte" });
        }
        this.recordDuration("cache.sweep.duration", startedAt, { runtime: this.id });
    }

    private async sweepContentCache(force: boolean): Promise<void> {
        const candidates: Array<IContentCacheEntry<TSpatial, TContentHandle, TGlyphHandle>> = [];
        let entries = 0;
        let cpuBytes = 0;
        let gpuBytes = 0;
        for (const node of this.nodes.values()) {
            for (const candidate of node.contents) {
                if (candidate.handle === undefined || candidate.kind !== "renderable" || candidate.status !== "ready") continue;
                entries++;
                cpuBytes += candidate.cost?.cpuBytes ?? 0;
                gpuBytes += candidate.cost?.gpuBytes ?? 0;
                // A ready but gated REPLACE-front tile is intentionally not
                // selected yet. It is nevertheless required for the atomic
                // swap and must not be evicted while the current traversal is
                // waiting for its siblings.
                if (node.selected || candidate.attached || this.replacementFrontNodes.has(node.id)) continue;
                candidates.push({
                    node,
                    content: candidate as IRuntimeContent<TContentHandle> & { handle: TContentHandle },
                });
            }
        }
        candidates.sort((left, right) => left.content.lastTouchedFrame - right.content.lastTouchedFrame);
        for (const candidate of candidates) {
            const reason = this.contentEvictionReason(candidate.content, entries, cpuBytes, gpuBytes, force);
            if (!reason) continue;
            const releasedCpuBytes = candidate.content.cost?.cpuBytes ?? 0;
            const releasedGpuBytes = candidate.content.cost?.gpuBytes ?? 0;
            await this.evictContent(candidate.node, candidate.content, reason);
            entries--;
            cpuBytes -= releasedCpuBytes;
            gpuBytes -= releasedGpuBytes;
        }
    }

    private contentEvictionReason(
        content: IRuntimeContent<TContentHandle>,
        entries: number,
        cpuBytes: number,
        gpuBytes: number,
        force: boolean,
    ): RuntimeCacheEvictionReason | undefined {
        if (force || this.frame - content.lastTouchedFrame > this.cacheOptions.unusedFrameRetention) return "stale";
        if (entries > this.cacheOptions.maxContentEntries) return "entry-budget";
        if (cpuBytes > this.cacheOptions.maxContentCpuBytes) return "cpu-budget";
        if (gpuBytes > this.cacheOptions.maxContentGpuBytes) return "gpu-budget";
        return undefined;
    }

    private async evictContent(
        node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>,
        content: IRuntimeContent<TContentHandle> & { handle: TContentHandle },
        reason: RuntimeCacheEvictionReason,
    ): Promise<void> {
        const eviction: IRuntimeCacheEviction = {
            kind: "content",
            reason,
            tileId: node.id,
            resourceId: content.cacheKey ?? content.uri,
            releasedCpuBytes: content.cost?.cpuBytes ?? 0,
            releasedGpuBytes: content.cost?.gpuBytes ?? 0,
            releasedEntries: 1,
        };
        const hookContext: ICacheEvictionHookContext<TSpatial, TContentHandle, TGlyphHandle> = {
            runtimeId: this.id,
            eviction,
            tile: node,
            content,
        };
        await this.invokeHooks("beforeCacheEviction", (hook) => hook.beforeCacheEviction?.(hookContext), node, content);
        await this.disposeContentHandle(node, content);
        node.metadataSnapshots = node.metadataSnapshots.filter((snapshot) => snapshot.content !== content.descriptor);
        this.cacheCounters.contentEvictions++;
        this.cacheCounters.releasedCpuBytes += eviction.releasedCpuBytes;
        this.cacheCounters.releasedGpuBytes += eviction.releasedGpuBytes;
        this.events.emit({ type: "cache-eviction", eviction });
        this.recordMetric({
            name: "content.cache.evict",
            value: 1,
            unit: "count",
            tags: { runtime: this.id, tile: node.id, reason },
        });
        await this.invokeHooks("afterCacheEviction", (hook) => hook.afterCacheEviction?.(hookContext), node, content);
    }

    private async sweepSubtreeCache(force: boolean): Promise<void> {
        const bySubtree = new Map<IRuntimeImplicitSubtree, ISubtreeCacheEntry<TSpatial, TContentHandle, TGlyphHandle>>();
        for (const node of this.nodes.values()) {
            const subtree = node.implicit?.subtree;
            if (!subtree) continue;
            const existing = bySubtree.get(subtree);
            if (existing) existing.users.push(node);
            else bySubtree.set(subtree, { node, subtree, users: [node] });
        }
        const loaded = [...bySubtree.values()].filter((entry) => entry.subtree.status === "ready" && entry.subtree.loaded !== undefined);
        let entries = loaded.length;
        let bytes = loaded.reduce((total, entry) => total + entry.subtree.estimatedBytes, 0);
        const candidates = loaded
            .filter((entry) => !this.isSubtreeProtected(entry))
            .sort((left, right) => left.subtree.lastTouchedFrame - right.subtree.lastTouchedFrame);
        for (const candidate of candidates) {
            const stale = this.frame - candidate.subtree.lastTouchedFrame > this.cacheOptions.unusedFrameRetention;
            let reason: RuntimeCacheEvictionReason | undefined;
            if (force || stale) reason = "stale";
            else if (entries > this.cacheOptions.maxSubtreeEntries) reason = "entry-budget";
            else if (bytes > this.cacheOptions.maxSubtreeBytes) reason = "byte-budget";
            if (!reason) continue;
            const releasedBytes = candidate.subtree.estimatedBytes;
            await this.evictSubtree(candidate, reason);
            entries--;
            bytes -= releasedBytes;
        }
    }

    private isSubtreeProtected(entry: ISubtreeCacheEntry<TSpatial, TContentHandle, TGlyphHandle>): boolean {
        if (entry.subtree.status === "queued" || entry.subtree.status === "loading") return true;
        return entry.users.some(
            (node) =>
                node.selected ||
                node.lastTouchedFrame === this.frame ||
                node.glyphHandles.length > 0 ||
                node.contents.some((content) => content.attached || content.status === "queued" || content.status === "loading"),
        );
    }

    private async evictSubtree(
        entry: ISubtreeCacheEntry<TSpatial, TContentHandle, TGlyphHandle>,
        reason: RuntimeCacheEvictionReason,
    ): Promise<void> {
        const eviction: IRuntimeCacheEviction = {
            kind: "subtree",
            reason,
            tileId: entry.node.id,
            resourceId: entry.subtree.uri,
            releasedCpuBytes: entry.subtree.estimatedBytes,
            releasedGpuBytes: 0,
            releasedEntries: 1,
        };
        const hookContext: ICacheEvictionHookContext<TSpatial, TContentHandle, TGlyphHandle> = {
            runtimeId: this.id,
            eviction,
            tile: entry.node,
            subtree: entry.subtree,
        };
        await this.invokeHooks("beforeCacheEviction", (hook) => hook.beforeCacheEviction?.(hookContext), entry.node);
        delete entry.subtree.loaded;
        delete entry.subtree.availability;
        delete entry.subtree.error;
        entry.subtree.status = "idle";
        entry.subtree.attempts = 0;
        entry.subtree.estimatedBytes = 0;
        this.cacheCounters.subtreeEvictions++;
        this.cacheCounters.releasedCpuBytes += eviction.releasedCpuBytes;
        this.events.emit({ type: "cache-eviction", eviction });
        this.recordMetric({
            name: "subtree.cache.evict",
            value: 1,
            unit: "count",
            tags: { runtime: this.id, tile: entry.node.id, reason },
        });
        await this.invokeHooks("afterCacheEviction", (hook) => hook.afterCacheEviction?.(hookContext), entry.node);
    }

    private async sweepImplicitBranches(force: boolean): Promise<void> {
        const candidates = [...this.nodes.values()]
            .filter((node) => this.isImplicitBranchRoot(node))
            .sort((left, right) => {
                const age = this.oldestChildFrame(left) - this.oldestChildFrame(right);
                return age !== 0 ? age : right.depth - left.depth;
            });
        for (const parent of candidates) {
            if (!this.isImplicitBranchRoot(parent)) continue;
            const descendants = this.branchDescendants(parent);
            if (descendants.length === 0 || this.isBranchProtected(descendants)) continue;
            const stale = descendants.every((node) => this.frame - node.lastTouchedFrame > this.cacheOptions.unusedFrameRetention);
            let reason: RuntimeCacheEvictionReason | undefined;
            if (force || stale) reason = "stale";
            else if (this.nodes.size > this.cacheOptions.maxMaterializedTiles) reason = "node-budget";
            if (!reason) continue;
            await this.pruneImplicitBranch(parent, descendants, reason);
        }
    }

    private isImplicitBranchRoot(node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>): boolean {
        const context = node.implicit?.context;
        return (
            context !== undefined &&
            node.implicit?.childrenMaterialized === true &&
            node.children.length > 0 &&
            node.children.every((child) => child.implicit?.context === context)
        );
    }

    private oldestChildFrame(node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>): number {
        return node.children.reduce((oldest, child) => Math.min(oldest, child.lastTouchedFrame), Number.POSITIVE_INFINITY);
    }

    private branchDescendants(
        parent: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>,
    ): Array<IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>> {
        const descendants: Array<IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>> = [];
        const pending = [...parent.children];
        while (pending.length > 0) {
            const node = pending.pop();
            if (!node) continue;
            descendants.push(node);
            pending.push(...node.children);
        }
        return descendants;
    }

    private isBranchProtected(nodes: readonly IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>[]): boolean {
        return nodes.some(
            (node) =>
                node.selected ||
                node.lastTouchedFrame === this.frame ||
                node.glyphHandles.length > 0 ||
                node.contents.some((content) => content.attached || content.status === "queued" || content.status === "loading"),
        );
    }

    private async pruneImplicitBranch(
        parent: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>,
        descendants: readonly IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>[],
        reason: RuntimeCacheEvictionReason,
    ): Promise<void> {
        const releasedCpuBytes = descendants.reduce(
            (total, node) => total + node.contents.reduce((sum, content) => sum + (content.cost?.cpuBytes ?? 0), 0),
            0,
        );
        const releasedGpuBytes = descendants.reduce(
            (total, node) => total + node.contents.reduce((sum, content) => sum + (content.cost?.gpuBytes ?? 0), 0),
            0,
        );
        const eviction: IRuntimeCacheEviction = {
            kind: "implicit-branch",
            reason,
            tileId: parent.id,
            resourceId: `${parent.id}/children`,
            releasedCpuBytes,
            releasedGpuBytes,
            releasedEntries: descendants.length,
        };
        const hookContext: ICacheEvictionHookContext<TSpatial, TContentHandle, TGlyphHandle> = {
            runtimeId: this.id,
            eviction,
            tile: parent,
        };
        await this.invokeHooks("beforeCacheEviction", (hook) => hook.beforeCacheEviction?.(hookContext), parent);
        for (const node of [...descendants].sort((left, right) => right.depth - left.depth)) {
            await this.disposeNodeContent(node);
            this.refiningNodes.delete(node.id);
            this.replacementFrontNodes.delete(node.id);
            this.nodes.delete(node.id);
        }
        parent.children = [];
        if (parent.implicit) parent.implicit.childrenMaterialized = false;
        this.cacheCounters.implicitBranchPrunes++;
        this.cacheCounters.prunedNodes += descendants.length;
        this.cacheCounters.releasedCpuBytes += releasedCpuBytes;
        this.cacheCounters.releasedGpuBytes += releasedGpuBytes;
        this.events.emit({ type: "cache-eviction", eviction });
        this.recordMetric({
            name: "tile.node.prune",
            value: descendants.length,
            unit: "count",
            tags: { runtime: this.id, tile: parent.id, reason },
        });
        await this.invokeHooks("afterCacheEviction", (hook) => hook.afterCacheEviction?.(hookContext), parent);
    }

    private async disposeNodeContent(node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>): Promise<void> {
        for (const content of node.contents) {
            if (content.handle === undefined) continue;
            await this.disposeContentHandle(node, content as IRuntimeContent<TContentHandle> & { handle: TContentHandle });
        }
    }

    private async disposeContentHandle(
        node: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>,
        content: IRuntimeContent<TContentHandle> & { handle: TContentHandle },
    ): Promise<void> {
        try {
            if (this.adapter.content.dispose) {
                const snapshot =
                    node.metadataSnapshots.find((candidate) => candidate.content === content.descriptor) ??
                    (await this.resolveMetadata(node, content.descriptor));
                await this.adapter.content.dispose(this.presentationContext(node, content, snapshot));
            }
        } catch (error) {
            await this.reportError("content.dispose", error, node, content);
        } finally {
            const releasedContent: IRuntimeContent<TContentHandle> = content;
            delete releasedContent.handle;
            delete releasedContent.featureMetadata;
            delete releasedContent.cacheKey;
            delete releasedContent.cost;
            delete releasedContent.error;
            releasedContent.status = "idle";
            releasedContent.kind = "unknown";
            releasedContent.attempts = 0;
            releasedContent.attached = false;
        }
    }

    private estimateSubtreeBytes(loaded: ILoadedImplicitSubtree): number {
        const bufferBytes = loaded.buffers?.reduce((total, buffer) => total + buffer.byteLength, 0) ?? 0;
        try {
            return bufferBytes + new TextEncoder().encode(JSON.stringify(loaded.subtree)).byteLength;
        } catch {
            return bufferBytes;
        }
    }

    private collectStatistics(): IRuntimeStateStatistics {
        const nodes = [...this.nodes.values()];
        const nodeStatistics = {
            total: nodes.length,
            explicit: nodes.filter((node) => !node.implicit).length,
            implicit: nodes.filter((node) => node.implicit !== undefined).length,
            selected: nodes.filter((node) => node.selected).length,
            visible: nodes.filter((node) => node.visible).length,
        };
        const contentStatistics = {
            total: 0,
            idle: 0,
            queued: 0,
            loading: 0,
            ready: 0,
            error: 0,
            cancelled: 0,
            attached: 0,
            cached: 0,
            cpuBytes: 0,
            gpuBytes: 0,
            networkBytes: 0,
        };
        for (const node of nodes) {
            for (const content of node.contents) {
                contentStatistics.total++;
                contentStatistics[content.status]++;
                if (content.attached) contentStatistics.attached++;
                if (content.handle !== undefined) contentStatistics.cached++;
                contentStatistics.cpuBytes += content.cost?.cpuBytes ?? 0;
                contentStatistics.gpuBytes += content.cost?.gpuBytes ?? 0;
                contentStatistics.networkBytes += content.cost?.networkBytes ?? 0;
            }
        }
        const subtrees = new Set<IRuntimeImplicitSubtree>();
        for (const node of nodes) if (node.implicit) subtrees.add(node.implicit.subtree);
        const subtreeStatistics = {
            total: subtrees.size,
            idle: 0,
            queued: 0,
            loading: 0,
            ready: 0,
            error: 0,
            cancelled: 0,
            cached: 0,
            bytes: 0,
        };
        for (const subtree of subtrees) {
            subtreeStatistics[subtree.status]++;
            if (subtree.loaded) subtreeStatistics.cached++;
            subtreeStatistics.bytes += subtree.estimatedBytes;
        }
        return {
            frame: this.frame,
            pendingLoads: this.scheduler.size,
            nodes: nodeStatistics,
            contents: contentStatistics,
            subtrees: subtreeStatistics,
            cache: {
                enabled: this.cacheOptions.enabled,
                limits: { ...this.cacheOptions },
                ...this.cacheCounters,
            },
        };
    }

    private startTiming(): number | undefined {
        return this.instrumentation.enabled ? performance.now() : undefined;
    }

    private elapsed(startedAt: number | undefined): number {
        return startedAt === undefined ? 0 : performance.now() - startedAt;
    }

    private recordDuration(name: IRuntimeMetric["name"], startedAt: number | undefined, tags?: IRuntimeMetric["tags"]): void {
        if (startedAt === undefined) return;
        this.recordMetric({ name, value: this.elapsed(startedAt), unit: "millisecond", ...(tags ? { tags } : {}) });
    }

    private recordMetric(metric: IRuntimeMetric): void {
        if (!this.instrumentation.enabled) return;
        this.instrumentation.record(metric);
        try {
            this.adapter.telemetry?.record(metric);
        } catch {
            // Monitoring backends must not interrupt traversal or cache enforcement.
        }
    }

    private markDirty(): void {
        if (!this.disposed) this.refreshNeeded = true;
    }

    private async invokeHooks(
        phase: string,
        invoke: (hook: IRuntimeHooks<TCamera, TSpatial, TContentHandle, TGlyphHandle>) => HookResult | undefined,
        tile?: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>,
        content?: IRuntimeContent<TContentHandle>,
    ): Promise<void> {
        for (const hook of this.hooks) {
            try {
                await invoke(hook);
            } catch (error) {
                await this.reportError(`hook.${phase}`, error, tile, content, true);
            }
        }
    }

    private async reportError(
        phase: string,
        error: unknown,
        tile?: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>,
        content?: IRuntimeContent<TContentHandle>,
        fromHook = false,
    ): Promise<void> {
        this.events.emit({
            type: "error",
            phase,
            error,
            ...(tile ? { tileId: tile.id } : {}),
            ...(content ? { contentId: content.id } : {}),
        });
        this.recordMetric({
            name: "runtime.error",
            value: 1,
            unit: "count",
            tags: { runtime: this.id, phase, ...(tile ? { tile: tile.id } : {}) },
        });
        if (phase.startsWith("content.")) {
            this.recordMetric({
                name: "content.error",
                value: 1,
                unit: "count",
                tags: { runtime: this.id, phase, ...(tile ? { tile: tile.id } : {}) },
            });
        }
        if (fromHook) return;
        const context: IRuntimeErrorHookContext<TSpatial, TContentHandle, TGlyphHandle> = {
            runtimeId: this.id,
            phase,
            error,
            ...(tile ? { tile } : {}),
            ...(content ? { content } : {}),
        };
        for (const hook of this.hooks) {
            try {
                await hook.onError?.(context);
            } catch {
                // Error hooks are terminal observers. Their failures are ignored to avoid recursion.
            }
        }
    }
}
