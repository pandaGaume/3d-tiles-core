import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

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
    test: {
        environment: "node",
    },
});
