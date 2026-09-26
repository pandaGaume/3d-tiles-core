import type { Tileset } from "../model";
import { validateTileset, type Diagnostic } from "../validation";
import type { Codec, DecodeOptions, EncodeOptions } from "./codec";

export class TilesetCodecError extends Error {
    public readonly diagnostics: readonly Diagnostic[];

    public constructor(message: string, diagnostics: readonly Diagnostic[] = [], options?: ErrorOptions) {
        super(message, options);
        this.name = "TilesetCodecError";
        this.diagnostics = diagnostics;
    }
}

function decodeText(input: string | Uint8Array): string {
    return typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true }).decode(input);
}

function indentation(pretty: boolean | number | undefined): number | undefined {
    if (pretty === true) return 4;
    if (typeof pretty === "number") return Math.max(0, Math.min(10, Math.trunc(pretty)));
    return undefined;
}

export class TilesetJsonCodec implements Codec<Tileset> {
    public decode(input: string | Uint8Array, options: DecodeOptions = {}): Tileset {
        let value: unknown;
        try {
            value = JSON.parse(decodeText(input)) as unknown;
        } catch (error) {
            throw new TilesetCodecError("The tileset is not valid UTF-8 JSON.", [], { cause: error });
        }

        if (options.validate === false) return value as Tileset;
        const result = validateTileset(value);
        if (!result.valid || !result.value) {
            throw new TilesetCodecError("The tileset failed structural validation.", result.diagnostics);
        }
        return result.value;
    }

    public encode(value: Tileset, options: EncodeOptions = {}): string {
        if (options.validate !== false) {
            const result = validateTileset(value);
            if (!result.valid) {
                throw new TilesetCodecError("The tileset failed structural validation.", result.diagnostics);
            }
        }
        return JSON.stringify(value, undefined, indentation(options.pretty));
    }
}
