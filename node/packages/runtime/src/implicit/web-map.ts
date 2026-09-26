import type { IContent, ITileset } from "@spacexr/3d-tiles-core";

import type { IImplicitCoordinates, IImplicitTileResolver, IImplicitTileResolveContext, IImplicitTileOverride } from "./types";

export type WebMapScheme = "XYZ" | "TMS";

export interface IWebMercatorTileResolverOptions {
    urlTemplates: string | readonly string[];
    scheme?: WebMapScheme;
    rootZoom?: number;
    rootX?: number;
    rootY?: number;
    minimumHeight?: number;
    maximumHeight?: number;
    geometricError?: (zoom: number, x: number, y: number) => number;
}

export interface IWebMapImplicitSourceOptions extends IWebMercatorTileResolverOptions {
    maximumZoom: number;
    subtreeLevels?: number;
    tileSize?: number;
    refine?: "ADD" | "REPLACE";
}

export interface IWebMapImplicitSource {
    tileset: ITileset;
    resolver: WebMercatorTileResolver;
}

function replaceWebTemplate(template: string, zoom: number, x: number, y: number): string {
    return template
        .replaceAll("{z}", String(zoom))
        .replaceAll("{level}", String(zoom))
        .replaceAll("{x}", String(x))
        .replaceAll("{y}", String(y));
}

function xyzRegion(
    zoom: number,
    x: number,
    y: number,
    minimumHeight: number,
    maximumHeight: number,
): [number, number, number, number, number, number] {
    const count = 2 ** zoom;
    const longitude = (tileX: number): number => (tileX / count) * Math.PI * 2 - Math.PI;
    const latitude = (tileY: number): number => Math.atan(Math.sinh(Math.PI * (1 - (2 * tileY) / count)));
    return [longitude(x), latitude(y + 1), longitude(x + 1), latitude(y), minimumHeight, maximumHeight];
}

function webCoordinates(
    coordinates: IImplicitCoordinates,
    scheme: WebMapScheme,
    rootZoom: number,
    rootX: number,
    rootY: number,
): { zoom: number; x: number; y: number; xyzY: number } {
    const localScale = 2 ** coordinates.level;
    const zoom = rootZoom + coordinates.level;
    const x = rootX * localScale + coordinates.x;
    if (scheme === "XYZ") {
        const y = rootY * localScale + (localScale - 1 - coordinates.y);
        return { zoom, x, y, xyzY: y };
    }
    const y = rootY * localScale + coordinates.y;
    return { zoom, x, y, xyzY: 2 ** zoom - 1 - y };
}

export class WebMercatorTileResolver implements IImplicitTileResolver {
    private readonly templates: readonly string[];
    private readonly scheme: WebMapScheme;
    private readonly rootZoom: number;
    private readonly rootX: number;
    private readonly rootY: number;
    private readonly minimumHeight: number;
    private readonly maximumHeight: number;
    private readonly geometricError: ((zoom: number, x: number, y: number) => number) | undefined;

    public constructor(options: IWebMercatorTileResolverOptions) {
        this.templates = typeof options.urlTemplates === "string" ? [options.urlTemplates] : options.urlTemplates;
        this.scheme = options.scheme ?? "XYZ";
        this.rootZoom = options.rootZoom ?? 0;
        this.rootX = options.rootX ?? 0;
        this.rootY = options.rootY ?? 0;
        this.minimumHeight = options.minimumHeight ?? 0;
        this.maximumHeight = options.maximumHeight ?? 0;
        this.geometricError = options.geometricError;
    }

    public resolve(context: IImplicitTileResolveContext): IImplicitTileOverride {
        const tile = webCoordinates(context.coordinates, this.scheme, this.rootZoom, this.rootX, this.rootY);
        const templates = this.templates.length > 0 ? this.templates : context.computedContents.map((content) => content.uri);
        const contents: IContent[] = templates.map((template, index) => ({
            ...(context.computedContents[index] ?? context.computedContents[0] ?? {}),
            uri: replaceWebTemplate(template, tile.zoom, tile.x, tile.y),
        }));
        return {
            boundingVolume: { region: xyzRegion(tile.zoom, tile.x, tile.xyzY, this.minimumHeight, this.maximumHeight) },
            ...(this.geometricError ? { geometricError: this.geometricError(tile.zoom, tile.x, tile.y) } : {}),
            contents,
        };
    }
}

export function createWebMapImplicitSource(options: IWebMapImplicitSourceOptions): IWebMapImplicitSource {
    const rootZoom = options.rootZoom ?? 0;
    const rootX = options.rootX ?? 0;
    const rootY = options.rootY ?? 0;
    if (options.maximumZoom < rootZoom) throw new RangeError("maximumZoom must be greater than or equal to rootZoom.");
    const scheme = options.scheme ?? "XYZ";
    const root = webCoordinates({ level: 0, x: 0, y: 0 }, scheme, rootZoom, rootX, rootY);
    const minimumHeight = options.minimumHeight ?? 0;
    const maximumHeight = options.maximumHeight ?? 0;
    const tileSize = options.tileSize ?? 256;
    const earthCircumference = 2 * Math.PI * 6378137;
    const rootGeometricError = options.geometricError?.(root.zoom, root.x, root.y) ?? earthCircumference / (tileSize * 2 ** rootZoom);
    const sourceTemplates = typeof options.urlTemplates === "string" ? [options.urlTemplates] : options.urlTemplates;
    const standardTemplates = sourceTemplates.map((template) => ({ uri: template.replaceAll("{z}", "{level}") }));
    const contentShape =
        standardTemplates.length === 1 ? { content: standardTemplates[0] } : { contents: standardTemplates as [IContent, ...IContent[]] };
    const tileset: ITileset = {
        asset: { version: "1.1" },
        geometricError: rootGeometricError,
        root: {
            boundingVolume: { region: xyzRegion(root.zoom, root.x, root.xyzY, minimumHeight, maximumHeight) },
            geometricError: rootGeometricError,
            refine: options.refine ?? "REPLACE",
            ...contentShape,
            implicitTiling: {
                subdivisionScheme: "QUADTREE",
                subtreeLevels: options.subtreeLevels ?? 5,
                availableLevels: options.maximumZoom - rootZoom + 1,
                subtrees: { uri: "virtual-subtrees/{level}/{x}/{y}.subtree" },
            },
        },
    };
    return { tileset, resolver: new WebMercatorTileResolver(options) };
}
