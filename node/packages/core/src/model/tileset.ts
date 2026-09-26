import type { BoundingVolume } from "./bounding-volume";
import type { NonEmptyArray, RootProperty } from "./common";
import type { ImplicitTiling } from "./implicit-tiling";
import type { GroupMetadata, LegacyPropertyRange, MetadataEntity, MetadataSchema, Statistics } from "./metadata";

export type TileTransform = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];

export type Refinement = "ADD" | "REPLACE";

export interface Asset extends RootProperty {
    version: string;
    tilesetVersion?: string;
}

export interface Content extends RootProperty {
    boundingVolume?: BoundingVolume;
    uri: string;
    metadata?: MetadataEntity;
    group?: number;
}

export interface Tile extends RootProperty {
    boundingVolume: BoundingVolume;
    viewerRequestVolume?: BoundingVolume;
    geometricError: number;
    refine?: Refinement;
    transform?: TileTransform;
    content?: Content;
    contents?: NonEmptyArray<Content>;
    metadata?: MetadataEntity;
    implicitTiling?: ImplicitTiling;
    children?: NonEmptyArray<Tile>;
}

export interface Tileset extends RootProperty {
    asset: Asset;
    properties?: Record<string, LegacyPropertyRange>;
    schema?: MetadataSchema;
    schemaUri?: string;
    statistics?: Statistics;
    groups?: NonEmptyArray<GroupMetadata>;
    metadata?: MetadataEntity;
    geometricError: number;
    root: Tile;
    extensionsUsed?: NonEmptyArray<string>;
    extensionsRequired?: NonEmptyArray<string>;
}
