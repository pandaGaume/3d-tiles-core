const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_HEADER_BYTES = 12;
const GLB_CHUNK_HEADER_BYTES = 8;

interface IGlbAsset {
    copyright?: unknown;
}

interface IGlbDocument {
    asset?: IGlbAsset;
}

/** Extracts semicolon-separated data attributions from a binary glTF asset. */
export function extractGlbCopyrights(buffer: ArrayBuffer): readonly string[] {
    if (buffer.byteLength < GLB_HEADER_BYTES) return [];
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== GLB_MAGIC) return [];
    const declaredLength = view.getUint32(8, true);
    const maximumLength = Math.min(declaredLength, buffer.byteLength);
    let offset = GLB_HEADER_BYTES;
    while (offset + GLB_CHUNK_HEADER_BYTES <= maximumLength) {
        const chunkLength = view.getUint32(offset, true);
        const chunkType = view.getUint32(offset + 4, true);
        const chunkStart = offset + GLB_CHUNK_HEADER_BYTES;
        const chunkEnd = chunkStart + chunkLength;
        if (chunkEnd > maximumLength) return [];
        if (chunkType === GLB_JSON_CHUNK) {
            try {
                const text = new TextDecoder("utf-8", { fatal: true })
                    .decode(new Uint8Array(buffer, chunkStart, chunkLength))
                    .replaceAll(String.fromCharCode(0), "")
                    .trim();
                const document = JSON.parse(text) as IGlbDocument;
                if (typeof document.asset?.copyright !== "string") return [];
                return document.asset.copyright
                    .split(";")
                    .map((entry) => entry.trim())
                    .filter((entry) => entry.length > 0);
            } catch {
                return [];
            }
        }
        offset = chunkEnd;
    }
    return [];
}
