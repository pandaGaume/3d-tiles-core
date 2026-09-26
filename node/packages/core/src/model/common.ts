export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;

export interface JsonObject {
    [key: string]: JsonValue;
}

export type Extensions = Record<string, JsonObject>;

export type NonEmptyArray<T> = [T, ...T[]];

/** Properties shared by 3D Tiles JSON objects. */
export interface RootProperty {
    extensions?: Extensions;
    extras?: JsonValue;
    /** Preserve application-defined members during lossless codec round trips. */
    [key: string]: unknown;
}
