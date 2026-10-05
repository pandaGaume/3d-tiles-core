import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            "@spacexr/3d-tiles-core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
            "@spacexr/tiles": fileURLToPath(new URL("../tiles/src/index.ts", import.meta.url)),
        },
    },
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts"],
    },
});
