import { FrameEncoder } from "./FrameEncoder.js";
import { asyncCanvasToBlob } from "../utils.js";

/**
 * Base class for **batch** encoders — libraries that need every frame at once
 * (e.g. gifski), rather than one at a time. It handles the awkward part for you:
 * buffering frames during capture and handing them back at save time. Subclasses
 * implement a single `encodeAll(ctx)` that turns the frames into a Blob.
 *
 * To keep capture-time memory bounded, frames are stored **compressed** by
 * default (`bufferMode: "webp"`, ~50–200 KB/frame instead of ~8 MB raw at
 * 1080p) and decoded back to `ImageData` on demand at save time. Use
 * `bufferMode: "png"` for lossless buffering, or `"raw"` to keep `ImageData`
 * (fastest, most memory).
 *
 * Subclass contract:
 *   async encodeAll(ctx) → Blob | null
 *   where ctx = { frameCount, width, height, framerate, getFrame(i) → Promise<ImageData> }
 *
 * Override `_store`/`_restore` only if you want a custom buffering strategy.
 */
class BatchEncoder extends FrameEncoder {
  constructor(params) {
    super(params);

    this.bufferMode = params.bufferMode || "webp"; // "webp" | "png" | "raw"
    this.bufferQuality = params.bufferQuality ?? 0.92; // for lossy webp buffering

    this.buffer = [];
    this.width = 0;
    this.height = 0;
    this._grabCanvas = null;
    this._grabCtx = null;
    this.savedBlob = null;
  }

  async start() {
    await super.start();
    this.buffer = [];
    this.savedBlob = null;
  }

  #ctx(width, height) {
    if (!this._grabCtx || this._grabCanvas.width !== width || this._grabCanvas.height !== height) {
      this._grabCanvas =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(width, height)
          : Object.assign(document.createElement("canvas"), { width, height });
      this._grabCtx = this._grabCanvas.getContext("2d", { willReadFrequently: true });
    }
    return this._grabCtx;
  }

  /** Turn a captured canvas into a compact stored token. Override to customize. */
  async _store(canvas) {
    if (this.bufferMode === "raw") {
      const ctx = this.#ctx(canvas.width, canvas.height);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(canvas, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    }
    const type = this.bufferMode === "png" ? "image/png" : "image/webp";
    const blob = await asyncCanvasToBlob(canvas, type, this.bufferQuality);
    if (!blob) {
      throw new Error(
        `BatchEncoder: canvas.toBlob("${type}") returned null — this browser may ` +
          `not support that buffer format. Try { bufferMode: "png" } or "raw".`
      );
    }
    // Keep the known capture dimensions; don't trust the decoded bitmap's size.
    return { blob, width: canvas.width, height: canvas.height };
  }

  /** Decode a stored token back to ImageData. Override to match `_store`. */
  async _restore(token) {
    // Already ImageData (raw buffering) — pass through. Guard the global since
    // ImageData isn't defined outside the browser.
    const isImageData =
      typeof ImageData !== "undefined"
        ? token instanceof ImageData
        : token && token.data && typeof token.width === "number";
    if (isImageData) return token;

    const { blob, width, height } = token;
    if (!width || !height) {
      throw new Error("BatchEncoder: stored frame has zero dimensions.");
    }
    const bmp = await createImageBitmap(blob);
    const ctx = this.#ctx(width, height);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(bmp, 0, 0, width, height);
    bmp.close?.();
    return ctx.getImageData(0, 0, width, height);
  }

  async add(canvas) {
    this.width = canvas.width;
    this.height = canvas.height;
    this.buffer.push(await this._store(canvas));
    await super.add();
  }

  async save() {
    if (this.savedBlob) return this.savedBlob;
    if (!this.buffer.length) return null;

    const ctx = {
      frameCount: this.buffer.length,
      width: this.width,
      height: this.height,
      framerate: this.params.framerate,
      getFrame: (i) => this._restore(this.buffer[i]),
    };
    const blob = await this.encodeAll(ctx);
    this.savedBlob = blob;
    return blob;
  }

  /** Subclasses implement this. @returns {Promise<Blob|null>} */
  async encodeAll() {
    throw new Error("BatchEncoder subclass must implement encodeAll(ctx).");
  }

  async dispose() {
    this.buffer = [];
    this.savedBlob = null;
    this._grabCanvas = null;
    this._grabCtx = null;
  }
}

export { BatchEncoder };
