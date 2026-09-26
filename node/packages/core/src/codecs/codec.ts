export interface DecodeOptions {
    validate?: boolean;
}

export interface EncodeOptions extends DecodeOptions {
    pretty?: boolean | number;
}

export interface Codec<T> {
    decode(input: string | Uint8Array, options?: DecodeOptions): T;
    encode(value: T, options?: EncodeOptions): string;
}
