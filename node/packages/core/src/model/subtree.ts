import type { NonEmptyArray, RootProperty } from "./common";
import type { MetadataComponentType, MetadataEntity, MetadataValue } from "./metadata";

export interface Availability extends RootProperty {
    constant?: 0 | 1;
    bitstream?: number;
    availableCount?: number;
}

export interface SubtreeBuffer extends RootProperty {
    uri?: string;
    byteLength: number;
}

export interface SubtreeBufferView extends RootProperty {
    buffer: number;
    byteOffset?: number;
    byteLength: number;
}

export interface PropertyTableProperty extends RootProperty {
    values: number;
    arrayOffsets?: number;
    stringOffsets?: number;
    arrayOffsetType?: "UINT8" | "UINT16" | "UINT32" | "UINT64";
    stringOffsetType?: "UINT8" | "UINT16" | "UINT32" | "UINT64";
    offset?: MetadataValue;
    scale?: MetadataValue;
    max?: MetadataValue;
    min?: MetadataValue;
}

export interface PropertyTable extends RootProperty {
    name?: string;
    class: string;
    count: number;
    properties?: Record<string, PropertyTableProperty>;
}

export interface Subtree extends RootProperty {
    buffers?: NonEmptyArray<SubtreeBuffer>;
    bufferViews?: NonEmptyArray<SubtreeBufferView>;
    propertyTables?: NonEmptyArray<PropertyTable>;
    tileAvailability: Availability;
    contentAvailability?: NonEmptyArray<Availability>;
    childSubtreeAvailability: Availability;
    tileMetadata?: number;
    contentMetadata?: NonEmptyArray<number>;
    subtreeMetadata?: MetadataEntity;
}

/** Retained as a named alias for clients that map binary metadata components. */
export type PropertyTableComponentType = MetadataComponentType;
