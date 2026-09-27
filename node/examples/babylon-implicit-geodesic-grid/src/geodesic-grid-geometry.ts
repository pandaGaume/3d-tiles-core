import { GeodeticSystem } from "@spacexr/geodesy";

/**
 * Renderer-neutral parametric topology shared by every geodesic tile.
 *
 * Coordinates are normalized over a tile region: u runs west to east and v
 * runs north to south. They deliberately contain no Cartesian position. This
 * keeps topology independent from the ellipsoid projection and prepares a
 * future instanced implementation where a vertex shader performs projection.
 */
export interface IGridTopology {
    readonly subdivisions: number;
    readonly coordinates: Float32Array;
    readonly uvs: Float32Array;
    readonly indices: Uint32Array;
}

/** Unique Cartesian geometry produced for one geographic tile. */
export interface IEllipsoidTileGeometry {
    readonly positions: number[];
    readonly uvs: Float32Array;
    readonly indices: Uint32Array;
}

/** Creates one reusable normalized grid topology. */
export function createGridTopology(subdivisions: number): IGridTopology {
    if (!Number.isInteger(subdivisions) || subdivisions < 1)
        throw new RangeError("Grid subdivisions must be a positive integer.");

    const vertexCount = (subdivisions + 1) ** 2;
    const coordinates = new Float32Array(vertexCount * 2);
    const uvs = new Float32Array(vertexCount * 2);
    const indices = new Uint32Array(subdivisions * subdivisions * 6);
    let vertexOffset = 0;

    for (let row = 0; row <= subdivisions; row++) {
        const v = row / subdivisions;
        for (let column = 0; column <= subdivisions; column++) {
            const u = column / subdivisions;
            coordinates[vertexOffset] = u;
            coordinates[vertexOffset + 1] = v;
            uvs[vertexOffset] = u;
            uvs[vertexOffset + 1] = 1 - v;
            vertexOffset += 2;
        }
    }

    const rowLength = subdivisions + 1;
    let indexOffset = 0;
    for (let row = 0; row < subdivisions; row++) {
        for (let column = 0; column < subdivisions; column++) {
            const northWest = row * rowLength + column;
            const northEast = northWest + 1;
            const southWest = northWest + rowLength;
            const southEast = southWest + 1;
            indices[indexOffset++] = northWest;
            indices[indexOffset++] = southWest;
            indices[indexOffset++] = northEast;
            indices[indexOffset++] = northEast;
            indices[indexOffset++] = southWest;
            indices[indexOffset++] = southEast;
        }
    }

    return { subdivisions, coordinates, uvs, indices };
}

/**
 * Projects a shared topology onto one geographic region of an ellipsoid.
 *
 * The region follows the 3D Tiles order
 * `[west, south, east, north, minimumHeight, maximumHeight]`, in radians and
 * metres. Each call returns unique positions because curvature and east-west
 * pinching depend on the region's latitude and longitude.
 */
export function projectGridTopologyToEllipsoid(
    topology: IGridTopology,
    region: readonly number[],
    system: GeodeticSystem = GeodeticSystem.WGS84,
): IEllipsoidTileGeometry {
    if (region.length < 6)
        throw new RangeError("A 3D Tiles region must contain six values.");

    const [west, south, east, north, minimumHeight] = region;
    if (
        west === undefined ||
        south === undefined ||
        east === undefined ||
        north === undefined ||
        minimumHeight === undefined
    )
        throw new RangeError("The 3D Tiles region is incomplete.");

    const positions = new Array<number>((topology.coordinates.length / 2) * 3);
    const scratch = { x: 0, y: 0, z: 0 };
    let positionOffset = 0;

    for (
        let coordinateOffset = 0;
        coordinateOffset < topology.coordinates.length;
        coordinateOffset += 2
    ) {
        const u = topology.coordinates[coordinateOffset]!;
        const v = topology.coordinates[coordinateOffset + 1]!;
        const longitude = west + (east - west) * u;
        const latitude = north + (south - north) * v;
        system.geodeticRadiansToEcef(
            latitude,
            longitude,
            minimumHeight,
            scratch,
        );
        positions[positionOffset++] = scratch.x;
        positions[positionOffset++] = scratch.y;
        positions[positionOffset++] = scratch.z;
    }

    return {
        positions,
        uvs: topology.uvs,
        indices: topology.indices,
    };
}
