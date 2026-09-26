import type { IContent, ITile, ITileset } from "@spacexr/3d-tiles-core";

import type { IMetadataDocumentContext, IMetadataSnapshot, IRuntimeFeatureMetadata } from "../metadata/types";
import type { IImplicitCoordinates, IRuntimeImplicitTile } from "../implicit/types";
import type { IRuntimeResourceCost } from "./cache";

export type RuntimeContentStatus = "idle" | "queued" | "loading" | "ready" | "error" | "cancelled";
export type RuntimeContentKind = "unknown" | "renderable" | "external-tileset" | "empty";

export interface IRuntimeTilesetDocument {
    id: string;
    uri: string;
    baseUri: string;
    tileset: ITileset;
    metadata: IMetadataDocumentContext;
}

export interface IRuntimeContent<TContentHandle> {
    id: string;
    descriptor: IContent;
    uri: string;
    status: RuntimeContentStatus;
    kind: RuntimeContentKind;
    attempts: number;
    handle?: TContentHandle;
    featureMetadata?: readonly IRuntimeFeatureMetadata[];
    cacheKey?: string;
    cost?: IRuntimeResourceCost;
    error?: unknown;
    attached: boolean;
    lastTouchedFrame: number;
}

export interface IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle> {
    id: string;
    source: ITile;
    document: IRuntimeTilesetDocument;
    parent?: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>;
    children: Array<IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>>;
    depth: number;
    refine: "ADD" | "REPLACE";
    spatial: TSpatial;
    implicit?: IRuntimeImplicitTile;
    contents: Array<IRuntimeContent<TContentHandle>>;
    visible: boolean;
    selected: boolean;
    screenSpaceError: number;
    glyphHandles: Array<TGlyphHandle>;
    metadataSnapshots: readonly IMetadataSnapshot[];
    lastTouchedFrame: number;
}

export interface ITileContext<TSpatial> {
    runtimeId: string;
    tileId: string;
    depth: number;
    tile: ITile;
    document: IRuntimeTilesetDocument;
    spatial: TSpatial;
    implicitCoordinates?: IImplicitCoordinates;
}

export interface IRuntimeFrameResult<TSpatial, TContentHandle, TGlyphHandle> {
    frame: number;
    selected: readonly IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>[];
    requested: readonly IRuntimeContent<TContentHandle>[];
    pendingLoads: number;
}
