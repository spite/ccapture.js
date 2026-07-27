import { FrameEncoder } from "./FrameEncoder.js";
import {
  GIFEncoder as Gifenc,
  quantize,
  applyPalette,
} from "../third_party/gifenc.mjs";

/**
 * Animated GIF encoder built on gifenc (ESM, no worker).
 *
 * GIF is inherently 256-color and palette-quantized, which is CPU work on RGBA
 * pixels — so unlike WebCodecs it needs a getImageData readback per frame and
 * can't stay on the GPU. Frame timing is coarse too: GIF delays are in
 * centiseconds, so e.g. 60fps becomes a delay of 2 (~50fps).
 *
 * Also a worked example of the encoder contract — see registerEncoder().
 */
class GIFEncoder extends FrameEncoder {
  constructor(params) {
    super(params);

    this.extension = "gif";
    this.mimeType = "image/gif";
    this.maxColors = Math.min(256, Math.max(2, params.gifColors ?? 256));
    this.delay = Math.max(1, Math.round(100 / params.framerate)); // centiseconds

    this.gif = null;
    this.canvas = null;
    this.ctx = null;
    this.savedBlob = null;
  }

  async start() {
    await super.start();
    this.gif = Gifenc();
    this.savedBlob = null;
  }

  #readback(canvas) {
    const { width, height } = canvas;
    if (!this.ctx || this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(width, height)
          : Object.assign(document.createElement("canvas"), { width, height });
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    }
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.drawImage(canvas, 0, 0);
    return this.ctx.getImageData(0, 0, width, height);
  }

  async add(canvas) {
    const { data, width, height } = this.#readback(canvas);
    const palette = quantize(data, this.maxColors);
    const index = applyPalette(data, palette);
    this.gif.writeFrame(index, width, height, { palette, delay: this.delay });
    await super.add();
  }

  async save() {
    if (this.savedBlob) return this.savedBlob;
    if (!this.frames) return null;
    this.gif.finish();
    this.savedBlob = new Blob([this.gif.bytes()], { type: this.mimeType });
    return this.savedBlob;
  }

  async dispose() {
    this.gif = null;
    this.savedBlob = null;
  }
}

export { GIFEncoder };
