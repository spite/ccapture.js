import { BatchEncoder } from "./BatchEncoder.js";

// gifski-wasm single-thread build. Loaded lazily (only when you actually use
// this encoder). Override with `gifski` (a function) or `gifskiUrl` (a module to
// import — e.g. a vendored local copy) if you don't want the CDN dependency.
const DEFAULT_GIFSKI_URL =
  "https://cdn.jsdelivr.net/npm/gifski-wasm@2.2.0/dist/encode.js";

/**
 * High-quality GIF via gifski (libimagequant + dithering, Rust → WASM).
 *
 * gifski's API is batch-only, so this extends BatchEncoder: frames are buffered
 * (compressed) during capture, then encoded in one call at save. Best for short,
 * quality-critical GIFs; for long captures prefer the streaming `gif` (gifenc)
 * encoder, which keeps memory bounded.
 *
 * Not registered by default (it pulls in gifski). Opt in:
 *   import { FrameWrap, GifskiEncoder } from "ccapture";
 *   FrameWrap.registerEncoder("gif-hq", GifskiEncoder);
 *   new FrameWrap({ format: "gif-hq", quality: 90 });
 *
 * For multithreaded gifski, pass a `gifski` function imported from
 * "gifski-wasm/multi-thread" (needs COOP/COEP headers on your server).
 */
class GifskiEncoder extends BatchEncoder {
  constructor(params) {
    super(params);

    this.extension = "gif";
    this.mimeType = "image/gif";
    this.quality = Math.min(100, Math.max(1, params.quality ?? 90));
    // Buffer losslessly by default: gifski is about quality, so don't degrade
    // frames with lossy WebP before quantization. Override via `bufferMode`.
    this.bufferMode = params.bufferMode || "png";

    // gifski needs every frame as raw RGBA in one buffer, so GIFs must stay
    // small. Cap the longest side (default 640) or set explicit gifWidth/Height.
    this.gifMaxSize = params.gifMaxSize ?? 640;
    this.gifWidth = params.gifWidth || 0;
    this.gifHeight = params.gifHeight || 0;

    this._gifski = typeof params.gifski === "function" ? params.gifski : null;
    this._gifskiUrl = params.gifskiUrl || DEFAULT_GIFSKI_URL;
    this._srcCtx = null;
    this._dstCtx = null;
  }

  #ctxOf(ref, width, height) {
    let ctx = this[ref];
    if (!ctx || ctx.canvas.width !== width || ctx.canvas.height !== height) {
      const canvas =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(width, height)
          : Object.assign(document.createElement("canvas"), { width, height });
      ctx = canvas.getContext("2d", { willReadFrequently: true });
      this[ref] = ctx;
    }
    return ctx;
  }

  #targetSize(width, height) {
    if (this.gifWidth && this.gifHeight) {
      return [Math.max(1, this.gifWidth), Math.max(1, this.gifHeight)];
    }
    const longest = Math.max(width, height);
    if (!this.gifMaxSize || longest <= this.gifMaxSize) return [width, height];
    const s = this.gifMaxSize / longest;
    return [Math.max(1, Math.round(width * s)), Math.max(1, Math.round(height * s))];
  }

  #downscale(image, tw, th) {
    if (image.width === tw && image.height === th) return image;
    const src = this.#ctxOf("_srcCtx", image.width, image.height);
    src.putImageData(image, 0, 0);
    const dst = this.#ctxOf("_dstCtx", tw, th);
    dst.clearRect(0, 0, tw, th);
    dst.drawImage(src.canvas, 0, 0, tw, th);
    return dst.getImageData(0, 0, tw, th);
  }

  async #loadGifski() {
    if (this._gifski) return this._gifski;
    const mod = await import(/* @vite-ignore */ this._gifskiUrl);
    this._gifski = mod.default || mod.encode;
    if (typeof this._gifski !== "function") {
      throw new Error("gifski-wasm module did not export an encode function.");
    }
    return this._gifski;
  }

  async encodeAll({ frameCount, width, height, framerate, getFrame }) {
    const encode = await this.#loadGifski();

    const [tw, th] = this.#targetSize(width, height);

    // gifski holds all frames as raw RGBA at once; fail early with guidance
    // rather than an opaque out-of-memory RangeError.
    const bytes = frameCount * tw * th * 4;
    if (bytes > 1_200_000_000) {
      throw new Error(
        `GIF too large for gifski: ${frameCount} frames × ${tw}×${th} ≈ ` +
          `${Math.round(bytes / 1e6)} MB in one buffer. Lower gifMaxSize, ` +
          `framerate, or duration — or use the streaming "gif" format.`
      );
    }

    // Decode + downscale each frame (first half of progress).
    const frames = [];
    for (let i = 0; i < frameCount; i++) {
      const full = await getFrame(i);
      frames.push(this.#downscale(full, tw, th));
      this.emit("progress", ((i + 1) / frameCount) * 0.5);
    }

    const data = await encode({
      frames,
      width: tw,
      height: th,
      fps: framerate,
      quality: this.quality,
    });

    this.emit("progress", 1);
    return new Blob([data], { type: this.mimeType });
  }

  async dispose() {
    await super.dispose();
    this._srcCtx = null;
    this._dstCtx = null;
  }
}

export { GifskiEncoder };
