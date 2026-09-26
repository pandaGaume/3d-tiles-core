import type { IBoundingVolume, IContent, IImplicitTiling, IMetadataEntity, IMetadataSchema, ISubtree, ITile } from "@spacexr/3d-tiles-core";

export interface IImplicitCoordinates {
    level: number;
    x: number;
    y: number;
    z?: number;
}

export interface ILoadedImplicitSubtree {
    subtree: ISubtree;
    /** Buffer payloads indexed exactly like subtree.buffers. */
    buffers?: readonly Uint8Array[];
}

export interface IImplicitSubtreeLoadRequest {
    uri: string;
    documentUri: string;
    coordinates: IImplicitCoordinates;
    implicitTiling: IImplicitTiling;
    contentCount: number;
    signal: AbortSignal;
}

export interface IImplicitSubtreeLoader {
    load(request: IImplicitSubtreeLoadRequest): Promise<ILoadedImplicitSubtree>;
}

export interface IImplicitTileResolveContext {
    documentUri: string;
    rootTile: ITile;
    implicitTiling: IImplicitTiling;
    coordinates: IImplicitCoordinates;
    computedBoundingVolume: IBoundingVolume;
    computedGeometricError: number;
    computedContents: readonly IContent[];
}

export interface IImplicitTileOverride {
    boundingVolume?: IBoundingVolume;
    geometricError?: number;
    contents?: readonly IContent[];
    metadata?: IMetadataEntity;
}

/**
 * Optional runtime override for sources whose physical pyramid differs from
 * the regular 3D Tiles subdivision, for example XYZ Web Mercator services.
 */
export interface IImplicitTileResolver {
    resolve(context: IImplicitTileResolveContext): IImplicitTileOverride | undefined;
}

export interface IImplicitMetadataDecodeRequest {
    loaded: ILoadedImplicitSubtree;
    availability: ISubtreeAvailability;
    schema?: IMetadataSchema;
    implicitTiling: IImplicitTiling;
    coordinates: IImplicitCoordinates;
    localCoordinates: IImplicitCoordinates;
    contentCount: number;
}

export interface IImplicitMetadataDecodeResult {
    tileMetadata?: IMetadataEntity;
    contentMetadata?: readonly (IMetadataEntity | undefined)[];
}

/** Decodes binary property tables after a standard subtree has been loaded. */
export interface IImplicitMetadataDecoder {
    decode(request: IImplicitMetadataDecodeRequest): IImplicitMetadataDecodeResult;
}

export type ImplicitSubtreeStatus = "idle" | "queued" | "loading" | "ready" | "error" | "cancelled";

export interface IRuntimeImplicitContext {
    id: string;
    rootTile: ITile;
    implicitTiling: IImplicitTiling;
    contentTemplates: readonly IContent[];
}

export interface IRuntimeImplicitSubtree {
    uri: string;
    coordinates: IImplicitCoordinates;
    status: ImplicitSubtreeStatus;
    attempts: number;
    loaded?: ILoadedImplicitSubtree;
    availability?: ISubtreeAvailability;
    error?: unknown;
    estimatedBytes: number;
    lastTouchedFrame: number;
}

export interface IRuntimeImplicitTile {
    context: IRuntimeImplicitContext;
    coordinates: IImplicitCoordinates;
    localCoordinates: IImplicitCoordinates;
    subtree: IRuntimeImplicitSubtree;
    childrenMaterialized: boolean;
    metadataApplied: boolean;
}

export interface ISubtreeAvailability {
    isTileAvailable(coordinates: IImplicitCoordinates): boolean;
    isContentAvailable(contentIndex: number, coordinates: IImplicitCoordinates): boolean;
    isChildSubtreeAvailable(coordinates: IImplicitCoordinates): boolean;
}
