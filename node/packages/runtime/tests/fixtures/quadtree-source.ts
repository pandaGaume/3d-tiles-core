import type { IContent, ITileset } from "@spacexr/3d-tiles-core";
import type { GeodeticSystem } from "@spacexr/geodesy";
import { WebMercatorTileMetrics, expandTileUrlTemplate, type ITileMetrics } from "@spacexr/tiles";

import {
    ImplicitTilesetDecorator,
    type IImplicitCoordinates,
    type ITileAddress,
    type ITileDataSource,
    type ITileDataSourceTile,
} from "../../src";

/** Options of {@link createQuadtreeSource}. */
export interface IQuadtreeSourceOptions {
    id?: string;
    urlTemplates: string;
    /** Metrics of the pyramid, or `geodeticSystem` and `maximumZoom` for a pyramid from level 0. */
    metrics?: ITileMetrics;
    geodeticSystem?: GeodeticSystem;
    maximumZoom?: number;
    rootAddress?: ITileAddress;
    subtreeLevels?: number;
    minimumHeight?: number;
    maximumHeight?: number;
}

/**
 * A Web Mercator XYZ quadtree for the runtime tests. The runtime owns no tiling scheme: production sources, such as the web
 * map source of `@spacexr/terrain-tileset`, live outside it. This fixture gives the same regions, errors and URLs.
 */
class QuadtreeSource implements ITileDataSource {
    public readonly id: string;
    public readonly metrics: ITileMetrics;
    public readonly rootAddress: ITileAddress;
    public readonly urlTemplates: readonly string[];

    public constructor(private readonly options: IQuadtreeSourceOptions) {
        const system = options.geodeticSystem;
        this.metrics =
            options.metrics ??
            (system && options.maximumZoom !== undefined
                ? new WebMercatorTileMetrics({ minLOD: 0, maxLOD: options.maximumZoom }, system)
                : (() => {
                      throw new RangeError("The fixture needs metrics, or a geodetic system and a maximum zoom.");
                  })());
        this.id = options.id ?? "quadtree";
        this.rootAddress = options.rootAddress ?? { lod: this.metrics.minLOD, x: 0, y: 0 };
        this.urlTemplates = [options.urlTemplates];
    }

    public addressOf(coordinates: IImplicitCoordinates): ITileAddress {
        const scale = 2 ** coordinates.level;
        return {
            lod: this.rootAddress.lod + coordinates.level,
            x: this.rootAddress.x * scale + coordinates.x,
            y: this.rootAddress.y * scale + (scale - 1 - coordinates.y),
        };
    }

    public resolve(coordinates: IImplicitCoordinates, computedContents: readonly IContent[] = []): ITileDataSourceTile {
        const address = this.addressOf(coordinates);
        const northWest = this.metrics.getTileXYToLatLon(address.x, address.y, address.lod);
        const southEast = this.metrics.getTileXYToLatLon(address.x + 1, address.y + 1, address.lod);
        const nearestToEquator =
            northWest.latitude >= 0 && southEast.latitude <= 0 ? 0 : Math.min(Math.abs(northWest.latitude), Math.abs(southEast.latitude));
        const radians = Math.PI / 180;
        return {
            address,
            boundingVolume: {
                region: [
                    northWest.longitude * radians,
                    southEast.latitude * radians,
                    southEast.longitude * radians,
                    northWest.latitude * radians,
                    this.options.minimumHeight ?? 0,
                    this.options.maximumHeight ?? 0,
                ],
            },
            geometricError: this.metrics.groundResolution(nearestToEquator, address.lod),
            contents: this.urlTemplates.map((template) => ({
                ...(computedContents[0] ?? {}),
                uri: expandTileUrlTemplate(template, address),
            })),
        };
    }
}

/** Creates the fixture quadtree and presents it as an implicit tileset. */
export function createQuadtreeSource(options: IQuadtreeSourceOptions): {
    dataSource: QuadtreeSource;
    decorator: ImplicitTilesetDecorator;
    tileset: ITileset;
    resolver: ImplicitTilesetDecorator;
} {
    const dataSource = new QuadtreeSource(options);
    const decorator = new ImplicitTilesetDecorator(
        dataSource,
        options.subtreeLevels !== undefined ? { subtreeLevels: options.subtreeLevels } : {},
    );
    return { dataSource, decorator, tileset: decorator.tileset, resolver: decorator };
}
