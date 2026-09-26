import type { NonEmptyArray, RootProperty } from "./common";

export type MetadataType = "SCALAR" | "VEC2" | "VEC3" | "VEC4" | "MAT2" | "MAT3" | "MAT4" | "STRING" | "BOOLEAN" | "ENUM";

export type MetadataComponentType = "INT8" | "UINT8" | "INT16" | "UINT16" | "INT32" | "UINT32" | "INT64" | "UINT64" | "FLOAT32" | "FLOAT64";

export type MetadataIntegerComponentType = Exclude<MetadataComponentType, "FLOAT32" | "FLOAT64">;

export type MetadataScalarValue = number | string | boolean;

export type MetadataValue = MetadataScalarValue | MetadataValue[];

export interface MetadataClassProperty extends RootProperty {
    name?: string;
    description?: string;
    type: MetadataType;
    componentType?: MetadataComponentType;
    enumType?: string;
    array?: boolean;
    count?: number;
    normalized?: boolean;
    offset?: MetadataValue;
    scale?: MetadataValue;
    max?: MetadataValue;
    min?: MetadataValue;
    required?: boolean;
    noData?: MetadataValue;
    default?: MetadataValue;
    semantic?: string;
}

export interface MetadataClass extends RootProperty {
    name?: string;
    description?: string;
    properties?: Record<string, MetadataClassProperty>;
}

export interface MetadataEnumValue extends RootProperty {
    name: string;
    description?: string;
    value: number;
}

export interface MetadataEnum extends RootProperty {
    name?: string;
    description?: string;
    valueType?: MetadataIntegerComponentType;
    values: NonEmptyArray<MetadataEnumValue>;
}

export interface MetadataSchema extends RootProperty {
    id: string;
    name?: string;
    description?: string;
    version?: string;
    classes?: Record<string, MetadataClass>;
    enums?: Record<string, MetadataEnum>;
}

export interface MetadataEntity extends RootProperty {
    class: string;
    properties?: Record<string, MetadataValue>;
}

export interface GroupMetadata extends MetadataEntity {
    name?: string;
    description?: string;
}

export interface PropertyStatistics extends RootProperty {
    min?: MetadataValue;
    max?: MetadataValue;
    mean?: number;
    median?: number;
    standardDeviation?: number;
    variance?: number;
    sum?: number;
    occurrences?: Record<string, number>;
}

export interface ClassStatistics extends RootProperty {
    count: number;
    properties?: Record<string, PropertyStatistics>;
}

export interface Statistics extends RootProperty {
    classes?: Record<string, ClassStatistics>;
    enums?: Record<string, Record<string, number>>;
}

export interface LegacyPropertyRange extends RootProperty {
    minimum: number;
    maximum: number;
}
