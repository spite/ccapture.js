import { createMotionBlur } from "./createMotionBlur.js";
import { download } from "./third_party/download.js";

import { PNGEncoder } from "./encoders/PNGEncoder.js";
import { JPGEncoder } from "./encoders/JPGEncoder.js";
import { WebPEncoder } from "./encoders/WebPEncoder.js";
import { WebMEncoder } from "./encoders/WebMEncoder.js";
import { WebCodecsEncoder } from "./encoders/WebCodecsEncoder.js";
import { GIFEncoder } from "./encoders/GIFEncoder.js";

const encoders = {
  mp4: WebCodecsEncoder,
  webm: WebCodecsEncoder,
  "webm-legacy": WebMEncoder,
  gif: GIFEncoder,
  png: PNGEncoder,
  jpg: JPGEncoder,
  webp: WebPEncoder,
};

// Pick the concrete encoder class for a format, falling back where WebCodecs
// isn't available: webm -> legacy webm-writer; mp4 has no fallback.
function resolveEncoder(format) {
  const Encoder = encoders[format];
  if (Encoder === WebCodecsEncoder && !WebCodecsEncoder.isSupported()) {
    if (format === "webm") return WebMEncoder;
    throw new Error(
      `Format "${format}" requires WebCodecs (VideoEncoder), which is not ` +
        `available in this browser. Try "webm" (falls back automatically).`
    );
  }
  return Encoder;
}

const defaultParams = {
  format: "mp4",
  framerate: 60,
  quality: 90,
  name: undefined, // falls back to a guid in the encoder
  encoder: undefined, // bring-your-own: an encoder class or instance (overrides format)
  gifColors: 256, // GIF palette size (2–256)
  codec: undefined, // avc/vp9/av1/vp8; defaults per container
  bitrate: 0, // bits/sec; 0 = derive from resolution & quality
  audio: null, // AudioBuffer to encode + mux as an audio track (mp4/webm)
  audioBitrate: 128000, // audio bits/sec
  maxQueueSize: 8, // WebCodecs encoder queue high-water mark (backpressure)
  motionBlurFrames: 1, // samples averaged per output frame; 1 = no blur
  motionBlur: "auto", // backend: "auto" | "gpu" | "cpu"
  timeLimit: 0, // seconds; 0 = unlimited
  frameLimit: 0, // output frames; 0 = unlimited
  autoSaveTime: 0, // seconds; >0 downloads parts periodically
  verbose: false,
  display: false,
};

/**
 * FrameWrap — canvas capture: motion blur, encoding, frame/time limits, saving.
 *
 * It knows nothing about time. You feed it already-drawn frames with
 * `capture(canvas)` at whatever rate suits you, and it encodes them. For the
 * usual "smooth fixed-framerate recording of a live animation", use `CCapture`,
 * which drives a FrameWrap with a TimeWarp clock. Use FrameWrap directly when
 * you produce frames deterministically yourself and don't want the browser
 * clock touched.
 */
class FrameWrap {
  /**
   * Register a custom encoder under a `format` name (see BatchEncoder /
   * FrameEncoder for the contract).
   */
  static registerEncoder(name, EncoderClass) {
    encoders[name] = EncoderClass;
    return FrameWrap;
  }

  /** The currently registered format names. */
  static get formats() {
    return Object.keys(encoders);
  }

  constructor(params = {}) {
    this.params = { ...defaultParams, ...params };

    // Bring-your-own encoder (instance or class) takes precedence over `format`.
    const byo = this.params.encoder;
    if (byo) {
      this.encoder = typeof byo === "function" ? new byo(this.params) : byo;
    } else {
      if (!encoders[this.params.format]) {
        throw new Error(
          `Unknown format "${this.params.format}". Valid formats: ${Object.keys(
            encoders
          ).join(", ")}`
        );
      }
      this.encoder = new (resolveEncoder(this.params.format))(this.params);
    }

    this.subframes = Math.max(1, Math.round(this.params.motionBlurFrames) || 1);
    this.frameStep = 1000 / this.params.framerate;

    this.frameCount = 0;
    this.intermediateFrameCount = 0;
    this.capturing = false;
    this.saved = false;

    this.motionBlur = null;
    this.handlers = {};

    if (typeof this.encoder.on === "function") {
      this.encoder.on("progress", (p) => this.emit("progress", p));
    }

    this.#createDisplay();
  }

  #log(...args) {
    if (this.params.verbose) console.log("[FrameWrap]", ...args);
  }

  on(event, handler) {
    this.handlers[event] = handler;
    return this;
  }

  emit(event, ...args) {
    const handler = this.handlers[event];
    if (handler) handler(...args);
  }

  #reset() {
    this.frameCount = 0;
    this.intermediateFrameCount = 0;
    this.saved = false;
    this.motionBlur?.reset();
  }

  async start() {
    this.#reset();
    await this.encoder.start();
    this.capturing = true;
    this.#log("start");
    this.emit("start");
  }

  /**
   * Encode one already-drawn frame. With motion blur, several sub-frames are
   * averaged before an output frame is emitted. No timing side effects.
   */
  async capture(canvas) {
    if (!this.capturing) return;
    try {
      await this.#process(canvas);
    } catch (e) {
      console.error("[FrameWrap] capture error:", e);
      this.emit("error", e);
      await this.stop();
    }
  }

  async #process(canvas) {
    if (this.subframes > 1) {
      this.motionBlur ||= createMotionBlur(
        canvas,
        this.subframes,
        this.params.motionBlur
      );
      this.motionBlur.add(canvas);
      this.intermediateFrameCount++;

      if (this.intermediateFrameCount >= this.subframes) {
        const blended = this.motionBlur.resolve();
        await this.encoder.add(blended);
        this.motionBlur.reset();
        this.intermediateFrameCount = 0;
        this.frameCount++;
        this.#updateDisplay();
        await this.#afterFrame();
        return;
      }
    } else {
      await this.encoder.add(canvas);
      this.frameCount++;
      await this.#afterFrame();
    }
    this.#updateDisplay();
  }

  async #afterFrame() {
    this.emit("frame", this.frameCount);
    const { frameLimit, timeLimit, framerate } = this.params;
    const seconds = this.frameCount / framerate;
    if (
      (frameLimit && this.frameCount >= frameLimit) ||
      (timeLimit && seconds >= timeLimit)
    ) {
      this.#log("limit reached, finalizing");
      await this.stop();
      await this.save();
    }
  }

  async stop() {
    if (!this.capturing) return;
    this.capturing = false;
    await this.encoder.stop();
    this.#log("stop");
    this.emit("stop");
  }

  /**
   * Finalize and either download the result or hand the Blob to `callback`.
   * Safe to call while still capturing to grab everything so far.
   * @returns {Promise<Blob|null>}
   */
  async save(callback) {
    const blob = await this.encoder.save();
    if (!blob) return null;
    this.saved = true;
    if (callback) {
      callback(blob);
    } else if (typeof document !== "undefined") {
      download(blob, this.encoder.name, this.encoder.mimeType);
    }
    this.emit("save", blob);
    return blob;
  }

  async dispose() {
    if (this.capturing) await this.stop();
    this.motionBlur?.dispose?.();
    this.motionBlur = null;
    await this.encoder?.dispose?.();
    if (this.display) {
      this.display.remove?.();
      this.display = null;
    }
  }

  #createDisplay() {
    if (typeof document === "undefined" || !this.params.display) return;
    const el = document.createElement("div");
    Object.assign(el.style, {
      position: "absolute",
      left: "0",
      top: "0",
      backgroundColor: "black",
      fontFamily: "monospace",
      fontSize: "11px",
      padding: "5px",
      color: "red",
      zIndex: "100000",
    });
    document.body.appendChild(el);
    this.display = el;
  }

  #updateDisplay() {
    if (!this.display) return;
    const seconds = this.frameCount / this.params.framerate;
    const d = new Date(null);
    d.setSeconds(seconds);
    const clock = d.toISOString().substr(11, 8);
    const inter =
      this.subframes > 1 ? ` (${this.intermediateFrameCount} inter)` : "";
    this.display.textContent = `CCapture ${this.params.format} | ${this.frameCount} frames${inter} | ${clock}`;
  }
}

export { FrameWrap, encoders, defaultParams };
