import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import type { Scene } from "@babylonjs/core/scene.js";
import {
    NO_METADATA,
    type IEcefSpatialState,
    type ITileActivationAdapter,
    type ITileActivationContext,
    type ITileDeactivationContext,
    type ITilePresentationAdapter,
    type ITilePresentationContext,
    type ITileAddress,
    type MetadataHandle,
} from "@spacexr/3d-tiles-runtime";
import { GeodeticSystem } from "@spacexr/geodesy";

import {
    createGridTopology,
    type IGridTopology,
    projectGridTopologyToEllipsoid,
} from "./geodesic-grid-geometry";
import type {
    IBabylonTileResourceStatistics,
    IBabylonTileResourceStatisticsProvider,
} from "./babylon-runtime-monitor";

const GRID_SUBDIVISIONS = 16;
const LOD_COLORS = [
    "#2f80ed",
    "#00c2ff",
    "#12b886",
    "#ffd43b",
    "#ff922b",
    "#fa5252",
    "#cc5de8",
    "#845ef7",
] as const;

export interface IBabylonGeodesicGridHandle {
    mesh: Mesh;
    identity: ITileAddress;
    center: Vector3;
    label: HTMLSpanElement;
    presented: boolean;
    metadataHandle: MetadataHandle;
    estimatedCpuBytes: number;
    estimatedGpuBytes: number;
}

export interface IBabylonGeodesicGridPipelineOptions {
    wireframe?: boolean;
}

function tileRegion(
    context: ITileActivationContext<
        IEcefSpatialState,
        IBabylonGeodesicGridHandle,
        never
    >,
): readonly number[] {
    const region = context.tile.source.boundingVolume.region;
    if (!region)
        throw new Error(
            `Tile ${context.tile.id} does not expose a geodetic region.`,
        );
    return region;
}

function tileIdentity(
    context: ITileActivationContext<
        IEcefSpatialState,
        IBabylonGeodesicGridHandle,
        never
    >,
): ITileAddress {
    const properties = context.tile.source.metadata?.properties;
    const readCoordinate = (name: "lod" | "x" | "y"): number => {
        const value = properties?.[name];
        if (typeof value !== "number" || !Number.isSafeInteger(value))
            throw new Error(
                `Tile ${context.tile.id} has no valid ${name} metadata.`,
            );
        return value;
    };
    return {
        lod: readCoordinate("lod"),
        x: readCoordinate("x"),
        y: readCoordinate("y"),
    };
}

function regionCenter(region: readonly number[]): Vector3 {
    const [west, south, east, north, minimumHeight, maximumHeight] = region;
    if (
        west === undefined ||
        south === undefined ||
        east === undefined ||
        north === undefined ||
        minimumHeight === undefined ||
        maximumHeight === undefined
    )
        throw new RangeError("The 3D Tiles region is incomplete.");

    const center = GeodeticSystem.WGS84.geodeticRadiansToEcef(
        (south + north) / 2,
        (west + east) / 2,
        (minimumHeight + maximumHeight) / 2,
    );
    return new Vector3(center.x, center.y, center.z);
}

function lodColor(lod: number): string {
    return LOD_COLORS[lod % LOD_COLORS.length]!;
}

/**
 * Babylon implementation of the renderer-neutral runtime ports.
 *
 * The adapter shares only normalized grid topology. It computes unique ECEF
 * positions for each tile from its 3D Tiles region and the WGS84 ellipsoid.
 * A future shader implementation can reuse the same topology and move that
 * projection to the GPU, allowing instances without changing runtime ports.
 */
export class BabylonGeodesicGridPipeline
    implements
        IBabylonTileResourceStatisticsProvider,
        ITileActivationAdapter<
            IEcefSpatialState,
            IBabylonGeodesicGridHandle,
            never
        >,
        ITilePresentationAdapter<
            IEcefSpatialState,
            IBabylonGeodesicGridHandle,
            never
        >
{
    private readonly handles = new Set<IBabylonGeodesicGridHandle>();
    private readonly materialsByLod = new Map<number, StandardMaterial>();
    private readonly topology: IGridTopology;
    private readonly labelLayer: HTMLElement;
    private readonly scene: Scene;
    private readonly wireframe: boolean;
    private createdHandleCount = 0;
    private releasedHandleCount = 0;

    public constructor(
        scene: Scene,
        labelLayer: HTMLElement,
        options: IBabylonGeodesicGridPipelineOptions = {},
        subdivisions = GRID_SUBDIVISIONS,
    ) {
        this.scene = scene;
        this.labelLayer = labelLayer;
        this.wireframe = options.wireframe ?? true;
        this.topology = createGridTopology(subdivisions);
    }

    public async activate(
        context: ITileActivationContext<
            IEcefSpatialState,
            IBabylonGeodesicGridHandle,
            never
        >,
    ): Promise<void> {
        for (const content of context.pendingContents) {
            if (context.signal.aborted) {
                await context.readiness.cancelled(content.id);
                continue;
            }
            try {
                const handle = this.createHandle(context, content.id);
                const accepted = await context.readiness.ready(content.id, {
                    kind: "renderable",
                    handle,
                    cacheKey: content.uri,
                    cost: {
                        cpuBytes: handle.estimatedCpuBytes,
                        gpuBytes: handle.estimatedGpuBytes,
                        networkBytes: 0,
                    },
                });
                if (!accepted) this.disposeHandle(handle);
            } catch (error) {
                await context.readiness.failed(content.id, error);
            }
        }
    }

    public deactivate(
        _context: ITileDeactivationContext<
            IEcefSpatialState,
            IBabylonGeodesicGridHandle,
            never
        >,
    ): void {
        // Selection and visual presentation intentionally remain separate.
    }

    public present(
        context: ITilePresentationContext<
            IEcefSpatialState,
            IBabylonGeodesicGridHandle,
            never
        >,
    ): void {
        for (const resource of context.resources) {
            resource.handle.metadataHandle = resource.metadataHandle;
            resource.handle.presented = true;
            resource.handle.mesh.isVisible = true;
        }
    }

    public hide(
        context: ITilePresentationContext<
            IEcefSpatialState,
            IBabylonGeodesicGridHandle,
            never
        >,
    ): void {
        for (const resource of context.resources) {
            resource.handle.presented = false;
            resource.handle.mesh.isVisible = false;
            resource.handle.label.style.display = "none";
        }
    }

    public release(
        context: ITilePresentationContext<
            IEcefSpatialState,
            IBabylonGeodesicGridHandle,
            never
        >,
    ): void {
        for (const resource of context.resources)
            this.disposeHandle(resource.handle);
    }

    /** Projects labels for the current presentation cut into screen space. */
    public updateDebugLabels(): void {
        const camera = this.scene.activeCamera;
        if (!camera) return;

        const engine = this.scene.getEngine();
        const width = engine.getRenderWidth();
        const height = engine.getRenderHeight();
        const viewport = camera.viewport.toGlobal(width, height);
        const transform = this.scene.getTransformMatrix();
        const margin = 80;

        for (const handle of this.handles) {
            if (!handle.presented) {
                handle.label.style.display = "none";
                continue;
            }

            const projected = Vector3.Project(
                handle.center,
                Matrix.IdentityReadOnly,
                transform,
                viewport,
            );
            const insideViewport =
                projected.z >= 0 &&
                projected.z <= 1 &&
                projected.x >= -margin &&
                projected.x <= width + margin &&
                projected.y >= -margin &&
                projected.y <= height + margin;
            if (!insideViewport) {
                handle.label.style.display = "none";
                continue;
            }

            handle.label.style.display = "block";
            handle.label.style.transform = `translate3d(${projected.x}px, ${projected.y}px, 0) translate(-50%, -50%)`;
        }
    }

    public dispose(): void {
        for (const handle of [...this.handles]) this.disposeHandle(handle);
        for (const material of this.materialsByLod.values()) material.dispose();
        this.materialsByLod.clear();
    }

    /** Returns the resources that are actually retained by the Babylon adapter. */
    public getStatistics(): IBabylonTileResourceStatistics {
        let presented = 0;
        let cpuBytes = 0;
        let gpuBytes = 0;
        for (const handle of this.handles) {
            if (handle.presented) presented++;
            cpuBytes += handle.estimatedCpuBytes;
            gpuBytes += handle.estimatedGpuBytes;
        }
        return {
            handles: this.handles.size,
            presented,
            created: this.createdHandleCount,
            released: this.releasedHandleCount,
            cpuBytes,
            gpuBytes,
        };
    }

    private createHandle(
        context: ITileActivationContext<
            IEcefSpatialState,
            IBabylonGeodesicGridHandle,
            never
        >,
        contentId: string,
    ): IBabylonGeodesicGridHandle {
        const region = tileRegion(context);
        const identity = tileIdentity(context);
        const geometry = projectGridTopologyToEllipsoid(this.topology, region);
        const normals: number[] = [];
        VertexData.ComputeNormals(
            geometry.positions,
            geometry.indices,
            normals,
        );

        const mesh = new Mesh(`geodesic-grid-${contentId}`, this.scene);
        const vertexData = new VertexData();
        vertexData.positions = geometry.positions;
        vertexData.uvs = geometry.uvs;
        vertexData.indices = geometry.indices;
        vertexData.normals = normals;
        vertexData.applyToMesh(mesh);
        mesh.material = this.materialForLod(identity.lod);
        mesh.isVisible = false;
        mesh.alwaysSelectAsActiveMesh = true;

        const label = this.labelLayer.ownerDocument.createElement("span");
        label.className = "tile-label";
        label.textContent = `X ${identity.x}  Y ${identity.y}  LOD ${identity.lod}`;
        label.style.setProperty("--tile-color", lodColor(identity.lod));
        this.labelLayer.append(label);

        const estimatedCpuBytes =
            (geometry.positions.length + normals.length) *
                Float64Array.BYTES_PER_ELEMENT +
            geometry.uvs.byteLength +
            geometry.indices.byteLength;
        const estimatedGpuBytes =
            (geometry.positions.length + normals.length) *
                Float32Array.BYTES_PER_ELEMENT +
            geometry.uvs.byteLength +
            geometry.indices.byteLength;
        const handle: IBabylonGeodesicGridHandle = {
            mesh,
            identity,
            center: regionCenter(region),
            label,
            presented: false,
            metadataHandle: NO_METADATA,
            estimatedCpuBytes,
            estimatedGpuBytes,
        };
        this.handles.add(handle);
        this.createdHandleCount++;
        return handle;
    }

    private materialForLod(lod: number): StandardMaterial {
        const existing = this.materialsByLod.get(lod);
        if (existing) return existing;

        const color = Color3.FromHexString(lodColor(lod));
        const material = new StandardMaterial(
            `geodesic-grid-material-lod-${lod}`,
            this.scene,
        );
        material.diffuseColor = color.scale(0.55);
        material.emissiveColor = color;
        material.specularColor = Color3.Black();
        material.disableLighting = true;
        material.wireframe = this.wireframe;
        material.backFaceCulling = false;
        material.useLogarithmicDepth = true;
        this.materialsByLod.set(lod, material);
        return material;
    }

    private disposeHandle(handle: IBabylonGeodesicGridHandle): void {
        if (!this.handles.delete(handle)) return;
        this.releasedHandleCount++;
        handle.label.remove();
        handle.mesh.dispose(false, false);
    }
}
