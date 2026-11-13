import type { IContent, IMetadataEntity, ITile, ITileset, NonEmptyArray } from "@spacexr/3d-tiles-core";
import {
    CUBE_FACE_COUNT,
    cubeTileGeometricError,
    expandTileUrlTemplate,
    formatTileAddress,
    validateTileUrlTemplate,
    type CubeTileSurface,
    type ICartesian3,
    type ITileUrlTemplateOptions,
} from "@spacexr/tiles";

import { ImplicitTilesetDecorator, type ITileAddress, type ITileDataSource, type ITileDataSourceTile } from "./tile-data-source";
import type {
    IImplicitCoordinates,
    IImplicitTileAddressContext,
    IImplicitTileOverride,
    IImplicitTileResolveContext,
    IImplicitTileResolver,
} from "./types";

/** Directions sampled per side of a tile to bound it, as the specification requires. */
const BOUND_SAMPLES = 5;

const dot = (a: ICartesian3, b: ICartesian3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * Oriented `box` bounding volume of a tile of the cube index, in the body-fixed frame: it contains the point of every
 * direction of the tile at every height of its range. It is computed from a grid of directions at both bounds of the
 * range, enlarged by the sagitta of the surface between them.
 *
 * @param minimumHeight - Lowest radial height of the tile, in metres. Defaults to 0.
 * @param maximumHeight - Highest radial height of the tile, in metres. Defaults to `minimumHeight`.
 * @throws RangeError When the address is invalid or the range is inverted.
 */
export function cubeTileBoundingBox(
    address: ITileAddress,
    surface: CubeTileSurface,
    minimumHeight = 0,
    maximumHeight = minimumHeight,
): number[] {
    if (maximumHeight < minimumHeight) throw new RangeError("maximumHeight must be greater than or equal to minimumHeight.");
    const up = surface.up(address, 0.5, 0.5);
    const west = surface.point(address, 0, 0.5);
    const east = surface.point(address, 1, 0.5);
    const along = { x: east.x - west.x, y: east.y - west.y, z: east.z - west.z };
    const lift = dot(along, up);
    const length = Math.hypot(along.x - lift * up.x, along.y - lift * up.y, along.z - lift * up.z);
    const axisX = { x: (along.x - lift * up.x) / length, y: (along.y - lift * up.y) / length, z: (along.z - lift * up.z) / length };
    const axisY = { x: up.y * axisX.z - up.z * axisX.y, y: up.z * axisX.x - up.x * axisX.z, z: up.x * axisX.y - up.y * axisX.x };

    const low = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    const high = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    let radius = 0;
    let smallestCosine = 1;
    const last = BOUND_SAMPLES - 1;
    const directions: ICartesian3[] = [];
    for (let j = 0; j <= last; j++) {
        for (let i = 0; i <= last; i++) {
            const direction = surface.up(address, i / last, j / last);
            directions.push(direction);
            if (i > 0) smallestCosine = Math.min(smallestCosine, dot(direction, directions[directions.length - 2]!));
            if (j > 0) smallestCosine = Math.min(smallestCosine, dot(direction, directions[directions.length - 1 - BOUND_SAMPLES]!));
            for (const height of [minimumHeight, maximumHeight]) {
                const point = surface.reference.point(direction, height);
                radius = Math.max(radius, Math.hypot(point.x, point.y, point.z));
                const coordinates = [dot(point, axisX), dot(point, axisY), dot(point, up)];
                coordinates.forEach((value, axis) => {
                    low[axis] = Math.min(low[axis]!, value);
                    high[axis] = Math.max(high[axis]!, value);
                });
            }
        }
    }
    // Between two sampled directions at an angle delta, the surface rises by at most r (1 - cos(delta / 2)).
    const sagitta = radius * (1 - Math.sqrt((1 + Math.min(smallestCosine, 1)) / 2));
    const half = low.map((value, axis) => (high[axis]! - value) / 2 + sagitta);
    const middle = low.map((value, axis) => (high[axis]! + value) / 2);
    const [cx, cy, cz] = middle as [number, number, number];
    const [hx, hy, hz] = half as [number, number, number];
    return [
        cx * axisX.x + cy * axisY.x + cz * up.x,
        cx * axisX.y + cy * axisY.y + cz * up.y,
        cx * axisX.z + cy * axisY.z + cz * up.z,
        axisX.x * hx,
        axisX.y * hx,
        axisX.z * hx,
        axisY.x * hy,
        axisY.y * hy,
        axisY.z * hy,
        up.x * hz,
        up.y * hz,
        up.z * hz,
    ];
}

/** Options of {@link CubeTileDataSource}. */
export interface ICubeTileDataSourceOptions extends ITileUrlTemplateOptions {
    id?: string;
    /** Surface of the tiles, on the reference surface of the body. */
    surface: CubeTileSurface;
    /** Root of the pyramid. */
    rootAddress: ITileAddress & { face: number };
    /** Deepest level of the pyramid. */
    maxLOD: number;
    /** URL templates, which may use `{face}`. */
    urlTemplates: string | readonly string[];
    /** Cells per tile side, for the geometric error. Defaults to 256. */
    tileSize?: number;
    minimumHeight?: number;
    maximumHeight?: number;
    tileMetadata?: (address: ITileAddress) => IMetadataEntity | undefined;
    contentMetadata?: (address: ITileAddress, contentIndex: number) => IMetadataEntity | undefined;
}

/** One quadtree of the cube index: tiles carry oriented boxes, and their geometric error follows the distortion of the cube. */
export class CubeTileDataSource implements ITileDataSource {
    public readonly id: string;
    public readonly metrics: { readonly minLOD: number; readonly maxLOD: number };
    public readonly rootAddress: ITileAddress & { face: number };
    public readonly urlTemplates: readonly string[];
    public readonly surface: CubeTileSurface;
    private readonly templates: readonly string[];
    private readonly tileSize: number;
    private readonly minimumHeight: number;
    private readonly maximumHeight: number;
    private readonly templateOptions: ITileUrlTemplateOptions;
    private readonly tileMetadata: ICubeTileDataSourceOptions["tileMetadata"];
    private readonly contentMetadata: ICubeTileDataSourceOptions["contentMetadata"];

    public constructor(options: ICubeTileDataSourceOptions) {
        const { rootAddress, maxLOD } = options;
        if (!Number.isInteger(maxLOD) || maxLOD < rootAddress.lod)
            throw new RangeError(`The pyramid at ${formatTileAddress(rootAddress)} must end at or below its root level.`);
        this.id = options.id ?? `cube-${rootAddress.face}`;
        this.surface = options.surface;
        this.rootAddress = rootAddress;
        this.metrics = { minLOD: rootAddress.lod, maxLOD };
        this.tileSize = options.tileSize ?? 256;
        this.minimumHeight = options.minimumHeight ?? 0;
        this.maximumHeight = options.maximumHeight ?? this.minimumHeight;
        this.tileMetadata = options.tileMetadata;
        this.contentMetadata = options.contentMetadata;
        this.templateOptions = {
            ...(options.subdomains ? { subdomains: [...options.subdomains] } : {}),
            ...(options.variables ? { variables: { ...options.variables } } : {}),
        };
        this.templates = typeof options.urlTemplates === "string" ? [options.urlTemplates] : [...options.urlTemplates];
        for (const template of this.templates) validateTileUrlTemplate(template, this.templateOptions);
        // The face is fixed for one quadtree: implicit templates only hold the implicit coordinates.
        this.urlTemplates = this.templates.map((template) => template.replaceAll("{face}", String(rootAddress.face)));
    }

    public addressOf(coordinates: IImplicitCoordinates): ITileAddress {
        const scale = 2 ** coordinates.level;
        const lod = this.rootAddress.lod + coordinates.level;
        if (lod > this.metrics.maxLOD) throw new RangeError(`LOD ${lod} exceeds data source maxLOD ${this.metrics.maxLOD}.`);
        return {
            face: this.rootAddress.face,
            lod,
            x: this.rootAddress.x * scale + coordinates.x,
            y: this.rootAddress.y * scale + coordinates.y,
        };
    }

    public resolve(coordinates: IImplicitCoordinates, computedContents: readonly IContent[] = []): ITileDataSourceTile {
        const address = this.addressOf(coordinates);
        const contents = this.templates.map((template, index) => {
            const metadata = this.contentMetadata?.(address, index);
            return {
                ...(computedContents[index] ?? computedContents[0] ?? {}),
                uri: expandTileUrlTemplate(template, address, this.templateOptions),
                ...(metadata ? { metadata } : {}),
            };
        });
        const metadata = this.tileMetadata?.(address);
        return {
            address,
            boundingVolume: { box: cubeTileBoundingBox(address, this.surface, this.minimumHeight, this.maximumHeight) as never },
            geometricError: cubeTileGeometricError(address, this.surface.reference, this.tileSize),
            contents,
            ...(metadata ? { metadata } : {}),
        };
    }
}

/** Options of {@link createCubeImplicitSource}. */
export interface ICubeImplicitSourceOptions extends ITileUrlTemplateOptions {
    /** Prefix of the data source identifiers. Defaults to `cube`. */
    id?: string;
    surface: CubeTileSurface;
    /** Level of the roots of the quadtrees, `4^minLOD` per face. Defaults to 0. */
    minLOD?: number;
    /**
     * Deepest level of the quadtrees, on every face: tiles are available down to it everywhere, whatever the depth of
     * the data, which a tile finer than the data at its place reads as a sub-area of the deepest data tile there.
     */
    maxLOD: number;
    /** URL templates, which may use `{face}`. */
    urlTemplates: string | readonly string[];
    tileSize?: number;
    subtreeLevels?: number;
    refine?: "ADD" | "REPLACE";
    minimumHeight?: number;
    maximumHeight?: number;
    /** Measured radial height range of a tile; the bounding box follows it. */
    heightRange?: (address: ITileAddress) => readonly [number, number] | undefined;
    tileMetadata?: (address: ITileAddress) => IMetadataEntity | undefined;
    contentMetadata?: (address: ITileAddress, contentIndex: number) => IMetadataEntity | undefined;
}

/** A whole body as implicit 3D Tiles: an explicit root with the implicit quadtrees of the six faces as children. */
export interface ICubeImplicitSource {
    tileset: ITileset;
    resolver: IImplicitTileResolver;
    dataSources: readonly CubeTileDataSource[];
}

class CubeImplicitResolver implements IImplicitTileResolver {
    public constructor(
        private readonly decorators: ReadonlyMap<ITile, ImplicitTilesetDecorator>,
        private readonly surface: CubeTileSurface,
        private readonly heightRange: ICubeImplicitSourceOptions["heightRange"],
    ) {}

    public addressOf(context: IImplicitTileAddressContext): ITileAddress {
        const decorator = this.decorators.get(context.rootTile);
        if (!decorator) throw new Error("No data source owns this implicit root tile.");
        return decorator.addressOf(context);
    }

    public resolve(context: IImplicitTileResolveContext): IImplicitTileOverride | undefined {
        const decorator = this.decorators.get(context.rootTile);
        if (!decorator) throw new Error("No data source owns this implicit root tile.");
        const override = decorator.resolve(context);
        const range = this.heightRange?.(decorator.addressOf(context));
        if (!range) return override;
        return {
            ...override,
            boundingVolume: { box: cubeTileBoundingBox(decorator.addressOf(context), this.surface, range[0], range[1]) as never },
            heightRange: range,
        };
    }
}

/**
 * Presents a whole body on the cube index as implicit 3D Tiles: a `region` cannot describe a polar face, so tiles
 * carry oriented boxes, and the explicit root is a sphere around the body.
 */
export function createCubeImplicitSource(options: ICubeImplicitSourceOptions): ICubeImplicitSource {
    const { surface, maxLOD, urlTemplates, tileSize, minimumHeight, maximumHeight, tileMetadata, contentMetadata, subdomains, variables } =
        options;
    const id = options.id ?? "cube";
    const minLOD = options.minLOD ?? 0;
    const decorators = new Map<ITile, ImplicitTilesetDecorator>();
    const dataSources: CubeTileDataSource[] = [];
    const create = (sourceId: string, rootAddress: ITileAddress & { face: number }): ITile => {
        const dataSource = new CubeTileDataSource({
            id: sourceId,
            surface,
            rootAddress,
            maxLOD,
            urlTemplates,
            ...(subdomains ? { subdomains } : {}),
            ...(variables ? { variables } : {}),
            ...(tileSize !== undefined ? { tileSize } : {}),
            ...(minimumHeight !== undefined ? { minimumHeight } : {}),
            ...(maximumHeight !== undefined ? { maximumHeight } : {}),
            ...(tileMetadata ? { tileMetadata } : {}),
            ...(contentMetadata ? { contentMetadata } : {}),
        });
        const decorator = new ImplicitTilesetDecorator(dataSource, {
            ...(options.subtreeLevels !== undefined ? { subtreeLevels: options.subtreeLevels } : {}),
            ...(options.refine ? { refine: options.refine } : {}),
        });
        dataSources.push(dataSource);
        decorators.set(decorator.tileset.root, decorator);
        return decorator.tileset.root;
    };

    const children: ITile[] = [];
    const roots = 2 ** minLOD;
    for (let face = 0; face < CUBE_FACE_COUNT; face++) {
        for (let y = 0; y < roots; y++) {
            for (let x = 0; x < roots; x++) {
                children.push(create(`${id}-${face}-${x}-${y}`, { face, lod: minLOD, x, y }));
            }
        }
    }

    const geometricError = Math.max(...children.map((child) => child.geometricError));
    const [a, b, c] = surface.reference.radii;
    return {
        tileset: {
            asset: { version: "1.1" },
            geometricError,
            root: {
                boundingVolume: { sphere: [0, 0, 0, Math.max(a, b, c) + Math.max(0, maximumHeight ?? 0)] },
                geometricError,
                refine: options.refine ?? "REPLACE",
                children: children as NonEmptyArray<ITile>,
            },
        },
        resolver: new CubeImplicitResolver(decorators, surface, options.heightRange),
        dataSources,
    };
}
