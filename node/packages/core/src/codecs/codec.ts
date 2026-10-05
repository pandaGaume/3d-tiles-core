export interface IDecodeOptions {
    validate?: boolean;
}

export interface IEncodeOptions extends IDecodeOptions {
    pretty?: boolean | number;
}

export interface ICodec<T> {
    decode(input: string | Uint8Array, options?: IDecodeOptions): T;
    encode(value: T, options?: IEncodeOptions): string;
}
