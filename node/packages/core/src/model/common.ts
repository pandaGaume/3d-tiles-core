export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonValue[] | IJsonObject;

export interface IJsonObject {
    [key: string]: JsonValue;
}

export type Extensions = Record<string, IJsonObject>;

export type NonEmptyArray<T> = [T, ...T[]];

/** Properties shared by 3D Tiles JSON objects. */
export interface IRootProperty {
    extensions?: Extensions;
    extras?: JsonValue;
    /** Preserve application-defined members during lossless codec round trips. */
    [key: string]: unknown;
}
