import { defineConfig } from "tsup";

export default defineConfig({
    entry: {
        index: "src/index.ts",
        "implicit/index": "src/implicit/index.ts",
        "ports/index": "src/ports/index.ts",
        "metadata/index": "src/metadata/index.ts",
        "pipeline/index": "src/pipeline/index.ts",
        "spatial/index": "src/spatial/index.ts",
    },
    format: ["esm"],
    target: "es2022",
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: true,
    treeshake: true,
    external: ["@spacexr/3d-tiles-core", "@spacexr/geodesy"],
});
