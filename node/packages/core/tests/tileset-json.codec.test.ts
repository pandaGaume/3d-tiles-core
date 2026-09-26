import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { TilesetCodecError, TilesetJsonCodec, validateTileset } from "../src";

interface FixtureCase {
    id: string;
    path: string;
    valid: boolean;
    expectedCodes: string[];
}

interface FixtureManifest {
    suite: string;
    cases: FixtureCase[];
}

const fixtureRoot = new URL("../../../../conformance/3d-tiles-1.1/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", fixtureRoot), "utf8")) as FixtureManifest;
const codec = new TilesetJsonCodec();

describe(manifest.suite, () => {
    for (const fixture of manifest.cases) {
        it(`${fixture.valid ? "accepts" : "rejects"} ${fixture.id}`, () => {
            const source = readFileSync(new URL(fixture.path, fixtureRoot), "utf8");
            const json = JSON.parse(source) as unknown;
            const result = validateTileset(json);

            expect(result.valid).toBe(fixture.valid);
            for (const code of fixture.expectedCodes) {
                expect(result.diagnostics.some((diagnostic) => diagnostic.code === code)).toBe(true);
            }

            if (fixture.valid) {
                const tileset = codec.decode(source);
                expect(JSON.parse(codec.encode(tileset)) as unknown).toEqual(json);
            } else {
                expect(() => codec.decode(source)).toThrow(TilesetCodecError);
            }
        });
    }
});

describe("TilesetJsonCodec", () => {
    it("decodes UTF-8 bytes", () => {
        const source = readFileSync(new URL("positive/minimal-extensionless-content.json", fixtureRoot), "utf8");
        const tileset = codec.decode(new TextEncoder().encode(source));

        expect(tileset.asset.version).toBe("1.1");
        expect(tileset.root.content?.uri).toBe("content/resource");
    });

    it("can indent serialized JSON", () => {
        const source = readFileSync(new URL("positive/minimal-extensionless-content.json", fixtureRoot), "utf8");
        const encoded = codec.encode(codec.decode(source), { pretty: 2 });

        expect(encoded).toContain('\n  "asset"');
    });

    it("reports malformed JSON separately from validation errors", () => {
        try {
            codec.decode("{");
            throw new Error("Expected decoding to fail.");
        } catch (error) {
            expect(error).toBeInstanceOf(TilesetCodecError);
            expect((error as TilesetCodecError).diagnostics).toEqual([]);
        }
    });
});
