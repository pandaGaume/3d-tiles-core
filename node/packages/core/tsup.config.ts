import { defineConfig } from "tsup";

export default defineConfig({
    entry: {
        index: "src/index.ts",
        "model/index": "src/model/index.ts",
        "codecs/index": "src/codecs/index.ts",
        "extensions/index": "src/extensions/index.ts",
        "validation/index": "src/validation/index.ts",
    },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "es2022",
    platform: "neutral",
    outDir: "dist",
    splitting: false,
    treeshake: true,
});

