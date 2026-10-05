/** Decoded image with 8-bit RGBA pixels, row-major from the top-left corner. */
export interface IRgbaImage {
    width: number;
    height: number;
    /** `width * height * 4` bytes in R, G, B, A order, not premultiplied. */
    data: Uint8Array | Uint8ClampedArray;
}

/**
 * Port decoding encoded image bytes (PNG, WebP, JPEG) into RGBA pixels.
 *
 * Implementations must return the stored pixel values unchanged: no colour space conversion and no alpha
 * premultiplication, otherwise encoded elevations are corrupted.
 */
export interface IImageDecoder {
    decode(bytes: Uint8Array, signal?: AbortSignal): Promise<IRgbaImage>;
}

/**
 * Image decoder for browsers and web workers, based on `createImageBitmap` and `OffscreenCanvas`.
 *
 * Node.js has neither API; supply another {@link IImageDecoder} there.
 */
export class BrowserImageDecoder implements IImageDecoder {
    public async decode(bytes: Uint8Array, signal?: AbortSignal): Promise<IRgbaImage> {
        if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
            throw new TypeError("BrowserImageDecoder requires createImageBitmap and OffscreenCanvas.");
        }
        signal?.throwIfAborted();
        // Copy into a plain ArrayBuffer: Blob rejects views over SharedArrayBuffer.
        const bitmap = await createImageBitmap(new Blob([bytes.slice()]), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
        try {
            signal?.throwIfAborted();
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = canvas.getContext("2d", { willReadFrequently: true });
            if (!context) throw new TypeError("OffscreenCanvas 2D context is not available.");
            context.drawImage(bitmap, 0, 0);
            const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
            return { width: image.width, height: image.height, data: image.data };
        } finally {
            bitmap.close();
        }
    }
}
