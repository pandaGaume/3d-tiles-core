import type {
    IMetadataEntity,
    IMetadataSchema,
    ITile,
    ITileset,
    NonEmptyArray,
} from "@spacexr/3d-tiles-core";
import {
    createWebMapImplicitSource,
    type ImplicitTilesetDecorator,
    type IImplicitTileResolveContext,
    type IImplicitTileResolver,
    type IImplicitTileOverride,
    type ITileAddress,
    type WebMapTileDataSource,
    WebMercatorTileMetrics,
} from "@spacexr/3d-tiles-runtime";

export const TILE_METRICS = new WebMercatorTileMetrics({
    minLOD: 3,
    maxLOD: 12,
    tileSize: 256,
});

const schema: IMetadataSchema = {
    id: "SpaceXRGeodesicGrid",
    name: "SpaceXR geodesic grid pipeline proof",
    classes: {
        GeodesicGridTile: {
            properties: {
                lod: {
                    type: "SCALAR",
                    componentType: "UINT32",
                    required: true,
                },
                x: { type: "SCALAR", componentType: "UINT32", required: true },
                y: { type: "SCALAR", componentType: "UINT32", required: true },
            },
        },
    },
};

function tileMetadata(address: ITileAddress): IMetadataEntity {
    return {
        class: "GeodesicGridTile",
        properties: {
            lod: address.lod,
            x: address.x,
            y: address.y,
        },
    };
}

export interface IGeodesicGridSource {
    tileset: ITileset;
    resolver: IImplicitTileResolver;
    dataSources: readonly WebMapTileDataSource[];
    metrics: WebMercatorTileMetrics;
}

class GeodesicGridImplicitResolver implements IImplicitTileResolver {
    public constructor(
        private readonly decoratorsByRoot: ReadonlyMap<
            ITile,
            ImplicitTilesetDecorator
        >,
    ) {}

    public resolve(
        context: IImplicitTileResolveContext,
    ): IImplicitTileOverride | undefined {
        const decorator = this.decoratorsByRoot.get(context.rootTile);
        if (!decorator)
            throw new Error("No data source owns this implicit root tile.");
        return decorator.resolve(context);
    }
}

/** Creates a global Web Map forest whose LOD 3 roots are decorated as implicit 3D Tiles. */
export function createGeodesicGridSource(): IGeodesicGridSource {
    const rootsPerAxis = 2 ** TILE_METRICS.minLOD;
    const children: ITile[] = [];
    const dataSources: WebMapTileDataSource[] = [];
    const decoratorsByRoot = new Map<ITile, ImplicitTilesetDecorator>();

    for (let y = 0; y < rootsPerAxis; y++) {
        for (let x = 0; x < rootsPerAxis; x++) {
            const source = createWebMapImplicitSource({
                id: `geodesic-grid-${x}-${y}`,
                urlTemplates: "grid://tile/{z}/{x}/{y}",
                metrics: TILE_METRICS,
                rootAddress: { lod: TILE_METRICS.minLOD, x, y },
                subtreeLevels: 4,
                minimumHeight: 0,
                maximumHeight: 500,
                refine: "REPLACE",
                tileMetadata,
                contentMetadata: tileMetadata,
            });
            children.push(source.tileset.root);
            dataSources.push(source.dataSource);
            decoratorsByRoot.set(source.tileset.root, source.decorator);
        }
    }

    const maximumLatitudeRadians = (TILE_METRICS.maxLatitude * Math.PI) / 180;
    const rootGeometricError = TILE_METRICS.groundResolution(
        0,
        TILE_METRICS.minLOD,
    );
    const firstChild = children[0];
    if (!firstChild)
        throw new Error(
            "The global Web Map source requires at least one root.",
        );
    const rootChildren: NonEmptyArray<ITile> = [
        firstChild,
        ...children.slice(1),
    ];
    return {
        tileset: {
            asset: { version: "1.1" },
            geometricError: rootGeometricError,
            schema,
            root: {
                boundingVolume: {
                    region: [
                        -Math.PI,
                        -maximumLatitudeRadians,
                        Math.PI,
                        maximumLatitudeRadians,
                        0,
                        500,
                    ],
                },
                geometricError: rootGeometricError,
                refine: "REPLACE",
                children: rootChildren,
            },
        },
        resolver: new GeodesicGridImplicitResolver(decoratorsByRoot),
        dataSources,
        metrics: TILE_METRICS,
    };
}
