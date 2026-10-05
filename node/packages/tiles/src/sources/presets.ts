import { WebMercatorTileMetrics } from "../addressing";
import type { DemEncoding } from "../codecs";
import type { TileHttpClient, ITileHttpClientOptions } from "./tile-http-client";
import { WebTileSource } from "./web-tile-source";

/** Web tile source of elevation tiles, with the encoding of its pixels. */
export interface IDemTileSource {
    source: WebTileSource;
    encoding: DemEncoding;
}

/** Options shared by the presets. */
export interface IPresetOptions {
    client?: TileHttpClient | ITileHttpClientOptions;
}

/**
 * Mapzen Terrain Tiles in Terrarium encoding, hosted by the AWS Open Data program.
 *
 * - 256 px PNG tiles in Web Mercator, XYZ rows.
 * - Levels 0 to 15. Deeper levels exist on the server but are resampled, so they are not exposed here.
 * - No API key. The data combines several public sources whose attribution is mandatory.
 */
export const MAPZEN_TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

export const MAPZEN_TERRARIUM_ATTRIBUTION = "Terrain Tiles by Mapzen, hosted by AWS Open Data. Data sources: https://github.com/tilezen/joerd/blob/master/docs/attribution.md";

/** Creates the Mapzen Terrarium elevation source. */
export function createMapzenTerrariumSource(options: IPresetOptions = {}): IDemTileSource {
    return {
        source: new WebTileSource({
            id: "mapzen-terrarium",
            urlTemplate: MAPZEN_TERRARIUM_URL,
            metrics: new WebMercatorTileMetrics({ minLOD: 0, maxLOD: 15, tileSize: 256 }),
            attribution: MAPZEN_TERRARIUM_ATTRIBUTION,
            ...(options.client ? { client: options.client } : {}),
        }),
        encoding: "terrarium",
    };
}
