import { LoadAssetContainerAsync, TransformNode, type AssetContainer, type Scene } from "@babylonjs/core";
import "@babylonjs/loaders/glTF/2.0/index.js";
import type {
    ContentLoadResult,
    IContentLoadContext,
    IContentPresentationContext,
    IEcefSpatialState,
    IRuntimeUriResolver,
    ITileContentAdapter,
} from "@spacexr/3d-tiles-runtime";

import type { AttributionController } from "./attribution";
import { extractGlbCopyrights } from "./glb";
import { decodeTileset, isTilesetResponse } from "./google-tiles";
import { createBabylonTileMatrix } from "./spatial";

async function googleRequestError(response: Response, requestedUri: string): Promise<Error> {
    const url = new URL(response.url || requestedUri);
    const secret = url.searchParams.get("key");
    const parameterNames = [...url.searchParams.keys()].filter((name) => name !== "key");
    const abbreviatedPath = url.pathname.length > 96 ? `...${url.pathname.slice(-96)}` : url.pathname;
    let detail = "";
    try {
        const payload = (await response.json()) as { error?: { message?: unknown } };
        if (typeof payload.error?.message === "string") detail = ` ${payload.error.message}`;
    } catch {
        // The HTTP status and redacted request URI still provide a useful diagnostic.
    }
    if (secret) detail = detail.replaceAll(secret, "[redacted]");
    const parameters = parameterNames.length > 0 ? parameterNames.join(", ") : "none";
    return new Error(
        `Google 3D tile request failed with HTTP ${response.status}.${detail} Request: ${url.origin}${abbreviatedPath}; parameters: ${parameters}.`,
    );
}

export interface IBabylonTileHandle {
    container: AssetContainer;
    root: TransformNode;
    addedToScene: boolean;
    copyrights: readonly string[];
    attachments: Set<string>;
    networkBytes: number;
}

/** Babylon.js content adapter for Google JSON external tilesets and GLB content. */
export class BabylonGoogleContentAdapter implements ITileContentAdapter<IEcefSpatialState, IBabylonTileHandle> {
    public constructor(
        private readonly scene: Scene,
        private readonly resolver: IRuntimeUriResolver,
        private readonly attribution: AttributionController,
    ) {}

    public async load(
        context: IContentLoadContext<IEcefSpatialState>,
        signal: AbortSignal,
    ): Promise<ContentLoadResult<IBabylonTileHandle>> {
        const response = await fetch(context.uri, {
            signal,
            credentials: "omit",
            headers: { Accept: "model/gltf-binary, application/json" },
        });
        if (!response.ok) throw await googleRequestError(response, context.uri);
        if (isTilesetResponse(response.url || context.uri, response.headers.get("content-type"))) {
            const documentUri = response.url || context.uri;
            const fetched = decodeTileset(await response.text(), documentUri, this.resolver);
            return {
                kind: "external-tileset",
                tileset: fetched.tileset,
                documentUri: fetched.documentUri,
                baseUri: fetched.baseUri,
            };
        }

        const buffer = await response.arrayBuffer();
        if (signal.aborted) throw signal.reason;
        const container = await LoadAssetContainerAsync(new Uint8Array(buffer), this.scene, {
            pluginExtension: ".glb",
            name: `tile-${context.tileId}`,
        });
        if (signal.aborted) {
            container.dispose();
            throw signal.reason;
        }
        const importedRoots = [...container.rootNodes];
        const root = new TransformNode(`tile-root-${context.tileId}`, this.scene);
        root.setPreTransformMatrix(createBabylonTileMatrix(context.spatial));
        root.setEnabled(false);
        for (const node of importedRoots) node.parent = root;
        container.transformNodes.push(root);
        container.populateRootNodes();
        this.scene.removeTransformNode(root);
        const handle: IBabylonTileHandle = {
            container,
            root,
            addedToScene: false,
            copyrights: extractGlbCopyrights(buffer),
            attachments: new Set<string>(),
            networkBytes: buffer.byteLength,
        };
        return {
            kind: "renderable",
            handle,
            mediaType: response.headers.get("content-type") ?? "model/gltf-binary",
            cacheKey: context.uri,
            cost: {
                networkBytes: buffer.byteLength,
                cpuBytes: buffer.byteLength,
                gpuBytes: buffer.byteLength,
            },
        };
    }

    public attach(context: IContentPresentationContext<IEcefSpatialState, IBabylonTileHandle>): void {
        const { handle } = context;
        const firstAttachment = handle.attachments.size === 0;
        handle.attachments.add(context.contentId);
        if (firstAttachment) {
            if (!handle.addedToScene) {
                handle.container.addAllToScene();
                handle.addedToScene = true;
            }
            handle.root.setEnabled(true);
        }
        this.attribution.attach(context.contentId, handle.copyrights);
    }

    public detach(context: IContentPresentationContext<IEcefSpatialState, IBabylonTileHandle>): void {
        const { handle } = context;
        handle.attachments.delete(context.contentId);
        this.attribution.detach(context.contentId);
        if (handle.attachments.size === 0) {
            handle.root.setEnabled(false);
        }
    }

    public dispose(context: IContentPresentationContext<IEcefSpatialState, IBabylonTileHandle>): void {
        for (const contentId of context.handle.attachments) this.attribution.detach(contentId);
        context.handle.attachments.clear();
        context.handle.container.dispose();
    }
}
