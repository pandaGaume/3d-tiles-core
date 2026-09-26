import { fileURLToPath } from "node:url";

import { defineConfig, loadEnv, type ProxyOptions } from "vite";

const GOOGLE_TILES_PROXY_PREFIX = "/google-3d-tiles";
const GOOGLE_TILES_TARGET = "https://tile.googleapis.com";

function googleTilesProxy(apiKey: string): Record<string, ProxyOptions> {
    return {
        [GOOGLE_TILES_PROXY_PREFIX]: {
            target: GOOGLE_TILES_TARGET,
            changeOrigin: true,
            secure: true,
            rewrite: (path) => {
                const url = new URL(path, "http://localhost");
                url.pathname = url.pathname.slice(GOOGLE_TILES_PROXY_PREFIX.length);
                url.searchParams.set("key", apiKey);
                return `${url.pathname}${url.search}`;
            },
        },
    };
}

export default defineConfig(({ command, mode }) => {
    const environment = loadEnv(mode, process.cwd(), "");
    const apiKey = environment.GOOGLE_MAP_TILES_API_KEY?.trim() ?? "";
    if (command === "serve" && !apiKey) {
        throw new Error("GOOGLE_MAP_TILES_API_KEY is missing. Copy .env.example to .env and add the server-side API key.");
    }
    const proxy = apiKey ? googleTilesProxy(apiKey) : {};

    return {
        resolve: {
            alias: {
                "@spacexr/3d-tiles-core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
                "@spacexr/3d-tiles-runtime": fileURLToPath(new URL("../../packages/runtime/src/index.ts", import.meta.url)),
            },
        },
        server: {
            port: 5173,
            open: true,
            proxy,
        },
        preview: {
            proxy,
        },
        build: {
            target: "es2022",
            sourcemap: true,
        },
    };
});
