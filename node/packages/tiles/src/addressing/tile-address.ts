/**
 * Address of a tile in a quadtree pyramid, in the XYZ convention.
 *
 * `x` grows eastward and `y` grows southward from the north-west corner, as in
 * Slippy Map, Google and Bing tiles. Use {@link toTmsY} for TMS sources, whose
 * `y` grows northward.
 */
export interface ITileAddress {
    /** Level of detail, also called zoom. Level 0 has a single tile. */
    lod: number;
    x: number;
    y: number;
}

/** Number of tiles along one axis at a level of detail. */
export function tileCount(lod: number): number {
    return 2 ** lod;
}

/** Returns `true` when the address lies inside its pyramid level. */
export function isValidTileAddress(address: ITileAddress): boolean {
    const { lod, x, y } = address;
    if (!Number.isSafeInteger(lod) || lod < 0 || lod > 52) return false;
    const count = tileCount(lod);
    return Number.isSafeInteger(x) && Number.isSafeInteger(y) && x >= 0 && y >= 0 && x < count && y < count;
}

/**
 * Throws when the address lies outside its pyramid level.
 *
 * @throws RangeError When the address is invalid.
 */
export function assertValidTileAddress(address: ITileAddress): void {
    if (!isValidTileAddress(address)) throw new RangeError(`Tile ${address.lod}/${address.x}/${address.y} lies outside its pyramid level.`);
}

/**
 * Converts between XYZ and TMS row numbers. The conversion is its own inverse.
 *
 * @param y - Row number in one convention.
 * @param lod - Level of detail.
 * @returns Row number in the other convention.
 */
export function toTmsY(y: number, lod: number): number {
    return tileCount(lod) - 1 - y;
}

/**
 * Encodes an address as a Bing Maps quadkey.
 *
 * Each digit encodes one level, from the coarsest: `x` bit plus twice the `y` bit.
 * Level 0 has the empty quadkey.
 */
export function tileAddressToQuadkey(address: ITileAddress): string {
    assertValidTileAddress(address);
    let quadkey = "";
    for (let level = address.lod; level > 0; level--) {
        const mask = 2 ** (level - 1);
        const digit = (Math.floor(address.x / mask) % 2) + 2 * (Math.floor(address.y / mask) % 2);
        quadkey += String(digit);
    }
    return quadkey;
}

/**
 * Decodes a Bing Maps quadkey.
 *
 * @throws RangeError When the quadkey contains a character other than 0 to 3.
 */
export function quadkeyToTileAddress(quadkey: string): ITileAddress {
    let x = 0;
    let y = 0;
    for (const character of quadkey) {
        const digit = character.charCodeAt(0) - 48;
        if (digit < 0 || digit > 3) throw new RangeError(`Invalid quadkey digit "${character}" in "${quadkey}".`);
        x = x * 2 + (digit % 2);
        y = y * 2 + Math.floor(digit / 2);
    }
    return { lod: quadkey.length, x, y };
}

/** Returns the parent address, or `undefined` at level 0. */
export function parentTileAddress(address: ITileAddress): ITileAddress | undefined {
    if (address.lod === 0) return undefined;
    return { lod: address.lod - 1, x: Math.floor(address.x / 2), y: Math.floor(address.y / 2) };
}

/** Returns the ancestor `levels` levels above, clamped to level 0. */
export function ancestorTileAddress(address: ITileAddress, levels: number): ITileAddress {
    const steps = Math.min(Math.max(0, Math.trunc(levels)), address.lod);
    const scale = 2 ** steps;
    return { lod: address.lod - steps, x: Math.floor(address.x / scale), y: Math.floor(address.y / scale) };
}

/** Returns the four children in north-west, north-east, south-west, south-east order. */
export function childTileAddresses(address: ITileAddress): [ITileAddress, ITileAddress, ITileAddress, ITileAddress] {
    const lod = address.lod + 1;
    const x = address.x * 2;
    const y = address.y * 2;
    return [
        { lod, x, y },
        { lod, x: x + 1, y },
        { lod, x, y: y + 1 },
        { lod, x: x + 1, y: y + 1 },
    ];
}
