/** Camera changes that can invalidate traversal or screen-space error. */
export enum CameraChangeFlags {
    None = 0,
    Position = 1 << 0,
    Orientation = 1 << 1,
    Frustum = 1 << 2,
    Viewport = 1 << 3,
    ClipBounds = 1 << 4,
    Pose = Position | Orientation,
    Projection = Frustum | Viewport,
    All = Pose | Projection | ClipBounds,
}

export enum TileSelectionState {
    Inactive = 0,
    Active = 1,
}

export enum TileReadinessState {
    Idle = 0,
    Queued = 1,
    Preparing = 2,
    Ready = 3,
    Failed = 4,
    Cancelled = 5,
}

export enum TilePresentationState {
    Hidden = 0,
    Presenting = 1,
    Visible = 2,
    Hiding = 3,
}

export enum TileMetadataState {
    Unresolved = 0,
    Resolving = 1,
    Ready = 2,
    Failed = 3,
}

export enum TileContentKind {
    Unknown = 0,
    Renderable = 1,
    ExternalTileset = 2,
    Empty = 3,
}

export enum TileRefinementMode {
    Add = 0,
    Replace = 1,
}

export type MetadataHandle = number;

export const NO_METADATA: MetadataHandle = -1;
