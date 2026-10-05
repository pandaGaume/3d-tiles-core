import type { ISubtree } from "../model";
import type { IEncodeOptions } from "./codec";

const HEADER_LENGTH = 24;
const MAGIC = 0x74627573;
const VERSION = 1;

export interface IDecodedSubtree {
    subtree: ISubtree;
    binaryChunk?: Uint8Array;
}

export interface ISubtreeBinaryEncodeOptions extends IEncodeOptions {
    binaryChunk?: Uint8Array;
}

export class SubtreeCodecError extends Error {
    public constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "SubtreeCodecError";
    }
}

function decodeText(input: Uint8Array): string {
    return new TextDecoder("utf-8", { fatal: true }).decode(input);
}

function parseJson(input: string): ISubtree {
    try {
        const value = JSON.parse(input) as unknown;
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            throw new SubtreeCodecError("The subtree JSON root must be an object.");
        }
        return value as ISubtree;
    } catch (error) {
        if (error instanceof SubtreeCodecError) throw error;
        throw new SubtreeCodecError("The subtree is not valid UTF-8 JSON.", { cause: error });
    }
}

function safeLength(value: bigint, field: string): number {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new SubtreeCodecError(`${field} exceeds the JavaScript safe integer range.`);
    return Number(value);
}

function padding(length: number): number {
    return (8 - (length % 8)) % 8;
}

export class SubtreeCodec {
    public decode(input: string | Uint8Array): IDecodedSubtree {
        if (typeof input === "string") return { subtree: parseJson(input) };
        if (input.byteLength < 4 || new DataView(input.buffer, input.byteOffset, input.byteLength).getUint32(0, true) !== MAGIC) {
            return { subtree: parseJson(decodeText(input)) };
        }
        if (input.byteLength < HEADER_LENGTH) throw new SubtreeCodecError("The binary subtree header is truncated.");

        const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
        const version = view.getUint32(4, true);
        if (version !== VERSION) throw new SubtreeCodecError(`Unsupported binary subtree version ${version}.`);
        const jsonLength = safeLength(view.getBigUint64(8, true), "The JSON chunk length");
        const binaryLength = safeLength(view.getBigUint64(16, true), "The binary chunk length");
        const jsonStart = HEADER_LENGTH;
        const binaryStart = jsonStart + jsonLength;
        const end = binaryStart + binaryLength;
        if (end > input.byteLength) throw new SubtreeCodecError("The binary subtree chunks exceed the available bytes.");

        const subtree = parseJson(decodeText(input.subarray(jsonStart, binaryStart)));
        const binaryChunk = input.slice(binaryStart, end);
        return binaryChunk.byteLength > 0 ? { subtree, binaryChunk } : { subtree };
    }

    public encodeJson(subtree: ISubtree, options: IEncodeOptions = {}): string {
        const indent = options.pretty === true ? 4 : typeof options.pretty === "number" ? Math.max(0, Math.min(10, Math.trunc(options.pretty))) : undefined;
        return JSON.stringify(subtree, undefined, indent);
    }

    public encodeBinary(subtree: ISubtree, options: ISubtreeBinaryEncodeOptions = {}): Uint8Array {
        const json = new TextEncoder().encode(this.encodeJson(subtree, options));
        const jsonPadding = padding(json.byteLength);
        const binary = options.binaryChunk ?? new Uint8Array();
        const binaryPadding = padding(binary.byteLength);
        const jsonLength = json.byteLength + jsonPadding;
        const binaryLength = binary.byteLength + binaryPadding;
        const output = new Uint8Array(HEADER_LENGTH + jsonLength + binaryLength);
        const view = new DataView(output.buffer);
        view.setUint32(0, MAGIC, true);
        view.setUint32(4, VERSION, true);
        view.setBigUint64(8, BigInt(jsonLength), true);
        view.setBigUint64(16, BigInt(binaryLength), true);
        output.set(json, HEADER_LENGTH);
        output.fill(0x20, HEADER_LENGTH + json.byteLength, HEADER_LENGTH + jsonLength);
        output.set(binary, HEADER_LENGTH + jsonLength);
        return output;
    }
}
