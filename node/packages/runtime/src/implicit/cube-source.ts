import type {
    IAvailability,
    IContent,
    IMetadataEntity,
    ISubtree,
    ISubtreeBufferView,
    ITile,
    ITileset,
    NonEmptyArray,
} from "@spacexr/3d-tiles-core";
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

import { implicitAvailabilityIndex, implicitMortonIndex } from "./coordinates";
import { ImplicitTilesetDecorator, type ITileAddress, type ITileDataSource, type ITileDataSourceTile } from "./tile-data-source";
import type {
    IImplicitCoordinates,
    IImplicitSubtreeLoader,
    IImplicitSubtreeLoadRequest,
    IImplicitTileAddressContext,
    IImplicitTileOverride,
    IImplicitTileResolveContext,
    IImplicitTileResolver,
    ILoadedImplicitSubtree,
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
    /** Deepest level of the pyramid anywhere. */
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
    /**
     * Whether the pyramid holds a tile, where its depth varies from place to place; without it, every tile down to
     * `maxLOD`. It must hold the parent of every tile it holds, as the availability of 3D Tiles implicit tiling.
     */
    isAvailable?: (address: ITileAddress & { face: number }) => boolean;
    tileMetadata?: (address: ITileAddress) => IMetadataEntity | undefined;
    contentMetadata?: (address: ITileAddress, contentIndex: number) => IMetadataEntity | undefined;
}

/** A whole body as implicit 3D Tiles: an explicit root with the implicit quadtrees of the six faces as children. */
export interface ICubeImplicitSource {
    tileset: ITileset;
    resolver: IImplicitTileResolver;
    /** Loads the availability subtrees of the quadtrees: the runtime adapter takes it as its subtree loader. */
    subtrees: IImplicitSubtreeLoader;
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

/** Bits of an availability bitstream, least significant bit first, as 3D Tiles implicit tiling stores them. */
class AvailabilityBits {
    public readonly bytes: Uint8Array;
    public count = 0;

    public constructor(private readonly length: number) {
        this.bytes = new Uint8Array(Math.ceil(length / 8));
    }

    public set(index: number): void {
        const mask = 1 << (index % 8);
        const byte = index >> 3;
        if ((this.bytes[byte]! & mask) !== 0) return;
        this.bytes[byte] = this.bytes[byte]! | mask;
        this.count++;
    }

    /** 0 or 1 when every bit is the same. */
    public constant(): 0 | 1 | undefined {
        if (this.count === 0) return 0;
        return this.count === this.length ? 1 : undefined;
    }
}

const SUBTREE_URI = /virtual-subtrees\/([^/]+)\/\d+\/\d+\/\d+\.subtree$/;

/**
 * Writes the availability of the tiles of a cube source as the bits of virtual implicit subtrees: a tile, its contents
 * and a child subtree are available where the pyramid holds them. The URI of a subtree names its quadtree.
 */
export class CubeAvailabilitySubtreeLoader implements IImplicitSubtreeLoader {
    public constructor(
        private readonly sources: ReadonlyMap<string, CubeTileDataSource>,
        private readonly isAvailable?: (address: ITileAddress & { face: number }) => boolean,
    ) {}

    public async load(request: IImplicitSubtreeLoadRequest): Promise<ILoadedImplicitSubtree> {
        if (request.signal.aborted) throw request.signal.reason;
        const match = SUBTREE_URI.exec(request.uri);
        const source = match ? this.sources.get(decodeURIComponent(match[1]!)) : undefined;
        if (!source) throw new Error(`${request.uri} is not a subtree of this cube source.`);
        const tiling = request.implicitTiling;
        const root = request.coordinates;
        const holds = (level: number, x: number, y: number): boolean => {
            if (root.level + level >= tiling.availableLevels) return false;
            if (!this.isAvailable) return true;
            const scale = 2 ** level;
            const address = source.addressOf({ level: root.level + level, x: root.x * scale + x, y: root.y * scale + y });
            return this.isAvailable(address as ITileAddress & { face: number });
        };

        const levels = tiling.subtreeLevels;
        const tiles = new AvailabilityBits((4 ** levels - 1) / 3);
        for (let level = 0; level < levels; level++)
            for (let y = 0; y < 2 ** level; y++)
                for (let x = 0; x < 2 ** level; x++) if (holds(level, x, y)) tiles.set(implicitAvailabilityIndex({ level, x, y }, tiling));
        const children = new AvailabilityBits(4 ** levels);
        for (let y = 0; y < 2 ** levels; y++)
            for (let x = 0; x < 2 ** levels; x++)
                if (holds(levels, x, y)) children.set(implicitMortonIndex({ level: levels, x, y }, tiling.subdivisionScheme));

        const streams: Uint8Array[] = [];
        const views: ISubtreeBufferView[] = [];
        let byteLength = 0;
        const availability = (bits: AvailabilityBits): IAvailability => {
            const constant = bits.constant();
            if (constant !== undefined) return { constant };
            views.push({ buffer: 0, byteOffset: byteLength, byteLength: bits.bytes.byteLength });
            streams.push(bits.bytes);
            byteLength += bits.bytes.byteLength;
            return { bitstream: views.length - 1, availableCount: bits.count };
        };
        const tileAvailability = availability(tiles);
        const childSubtreeAvailability = availability(children);
        const subtree: ISubtree = {
            tileAvailability,
            // Every tile the pyramid holds has its contents.
            ...(request.contentCount > 0
                ? { contentAvailability: Array.from({ length: request.contentCount }, () => tileAvailability) as [IAvailability] }
                : {}),
            childSubtreeAvailability,
            ...(views.length > 0 ? { buffers: [{ byteLength }], bufferViews: views as NonEmptyArray<ISubtreeBufferView> } : {}),
        };
        if (views.length === 0) return { subtree };
        const buffer = new Uint8Array(byteLength);
        let offset = 0;
        for (const bytes of streams) {
            buffer.set(bytes, offset);
            offset += bytes.byteLength;
        }
        return { subtree, buffers: [buffer] };
    }
}

/**
 * Presents a whole body on the cube index as implicit 3D Tiles: a `region` cannot describe a polar face, so tiles
 * carry oriented boxes, and the explicit root is a sphere around the body. Each tile is available where the pyramid
 * holds it, so that its depth may vary from place to place, as the subtrees of a celestial dataset.
 */
export function createCubeImplicitSource(options: ICubeImplicitSourceOptions): ICubeImplicitSource {
    const { surface, maxLOD, urlTemplates, tileSize, minimumHeight, maximumHeight, tileMetadata, contentMetadata, subdomains, variables } =
        options;
    const id = options.id ?? "cube";
    const minLOD = options.minLOD ?? 0;
    const decorators = new Map<ITile, ImplicitTilesetDecorator>();
    const dataSources: CubeTileDataSource[] = [];
    const sources = new Map<string, CubeTileDataSource>();
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
            subtreesUri: `virtual-subtrees/${encodeURIComponent(sourceId)}/{level}/{x}/{y}.subtree`,
        });
        dataSources.push(dataSource);
        sources.set(sourceId, dataSource);
        decorators.set(decorator.tileset.root, decorator);
        return decorator.tileset.root;
    };

    const children: ITile[] = [];
    const roots = 2 ** minLOD;
    for (let face = 0; face < CUBE_FACE_COUNT; face++)
        for (let y = 0; y < roots; y++)
            for (let x = 0; x < roots; x++) children.push(create(`${id}-${face}-${x}-${y}`, { face, lod: minLOD, x, y }));

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
        subtrees: new CubeAvailabilitySubtreeLoader(sources, options.isAvailable),
        dataSources,
    };
}
