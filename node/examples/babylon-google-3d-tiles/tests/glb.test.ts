import { describe, expect, it } from "vitest";

import { extractGlbCopyrights } from "../src/glb";

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;

function createGlb(document: unknown): ArrayBuffer {
    const encoded = new TextEncoder().encode(JSON.stringify(document));
    const paddedLength = Math.ceil(encoded.byteLength / 4) * 4;
    const buffer = new ArrayBuffer(20 + paddedLength);
    const view = new DataView(buffer);
    view.setUint32(0, GLB_MAGIC, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, buffer.byteLength, true);
    view.setUint32(12, paddedLength, true);
    view.setUint32(16, GLB_JSON_CHUNK, true);
    const chunk = new Uint8Array(buffer, 20, paddedLength);
    chunk.fill(0x20);
    chunk.set(encoded);
    return buffer;
}

describe("extractGlbCopyrights", () => {
    it("splits and trims glTF asset attribution", () => {
        const buffer = createGlb({ asset: { version: "2.0", copyright: "Google; Data provider ;Google" } });

        expect(extractGlbCopyrights(buffer)).toEqual(["Google", "Data provider", "Google"]);
    });

    it("returns no attribution for malformed or missing GLB metadata", () => {
        expect(extractGlbCopyrights(new ArrayBuffer(3))).toEqual([]);
        expect(extractGlbCopyrights(createGlb({ asset: { version: "2.0" } }))).toEqual([]);
    });
});
