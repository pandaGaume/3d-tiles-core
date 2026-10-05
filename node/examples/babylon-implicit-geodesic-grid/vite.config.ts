import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

export default defineConfig({
    resolve: {
        alias: {
            "@spacexr/3d-tiles-core": fileURLToPath(
                new URL("../../packages/core/src/index.ts", import.meta.url),
            ),
            "@spacexr/3d-tiles-runtime": fileURLToPath(
                new URL("../../packages/runtime/src/index.ts", import.meta.url),
            ),
        },
    },
    server: {
        port: 5174,
        open: true,
    },
    esbuild: { target: "es2022", supported: {
      'destructuring': true
    }},
    optimizeDeps: { esbuildOptions: { target: "es2022" } },
    build: {
        target: "es2022",
        sourcemap: true,
    },
});
