import type { ITileAddress, ITileMetrics } from "../addressing";
import { TileHttpClient, type ITileHttpClientOptions, type TileFetchResult } from "./tile-http-client";
import { expandTileUrlTemplate, validateTileUrlTemplate, type ITileUrlTemplateOptions } from "./url-template";

/** Options of {@link WebTileSource}. */
export interface IWebTileSourceOptions extends ITileUrlTemplateOptions {
    id?: string;
    /** URL template, expanded by {@link expandTileUrlTemplate}. */
    urlTemplate: string;
    /** Addressing, tile size and available levels of the source. */
    metrics: ITileMetrics;
    /** Shared client, or options used to create a dedicated one. */
    client?: TileHttpClient | ITileHttpClientOptions;
    /** Attribution text that applications must display with the tiles. */
    attribution?: string;
}

/**
 * Tile pyramid served over HTTP.
 *
 * The template is validated at construction, so a misspelled variable fails immediately instead of producing
 * invalid URLs. Requests outside `[metrics.minLOD, metrics.maxLOD]` are rejected: deeper levels must be derived
 * from an ancestor by the caller.
 */
export class WebTileSource {
    public readonly id: string;
    public readonly urlTemplate: string;
    public readonly metrics: ITileMetrics;
    public readonly attribution: string | undefined;
    public readonly client: TileHttpClient;
    private readonly templateOptions: ITileUrlTemplateOptions;

    public constructor(options: IWebTileSourceOptions) {
        this.id = options.id ?? "web-tiles";
        this.urlTemplate = options.urlTemplate;
        this.metrics = options.metrics;
        this.attribution = options.attribution;
        this.templateOptions = {
            ...(options.subdomains ? { subdomains: [...options.subdomains] } : {}),
            ...(options.variables ? { variables: { ...options.variables } } : {}),
        };
        this.client = options.client instanceof TileHttpClient ? options.client : new TileHttpClient(options.client);
        validateTileUrlTemplate(this.urlTemplate, this.templateOptions);
    }

    /** Returns `true` when the source serves this level of detail. */
    public servesLevel(lod: number): boolean {
        return Number.isInteger(lod) && lod >= this.metrics.minLOD && lod <= this.metrics.maxLOD;
    }

    /**
     * Returns the URL of a tile.
     *
     * @throws RangeError When the level is not served or the address lies outside its level.
     */
    public urlOf(address: ITileAddress): string {
        if (!this.servesLevel(address.lod)) {
            throw new RangeError(`Source ${this.id} serves levels ${this.metrics.minLOD} to ${this.metrics.maxLOD}, not ${address.lod}.`);
        }
        return expandTileUrlTemplate(this.urlTemplate, address, this.templateOptions);
    }

    /** Fetches a tile. See {@link TileHttpClient.fetchTile}. */
    public fetchTile(address: ITileAddress, signal?: AbortSignal): Promise<TileFetchResult> {
        return this.client.fetchTile(this.urlOf(address), signal);
    }
}
