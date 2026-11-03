import { defineConfig } from "tsup";

export default defineConfig({
    entry: {
        index: "src/index.ts",
        "addressing/index": "src/addressing/index.ts",
        "pyramid/index": "src/pyramid/index.ts",
        "sources/index": "src/sources/index.ts",
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
    external: ["@spacexr/geodesy"],
});
