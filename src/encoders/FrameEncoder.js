import { guid } from "../utils.js";
import { download } from "../third_party/download.js";

/**
 * Base class for all encoders. An encoder only turns frames (a canvas or a
 * blob) into an output Blob. The capture loop, timing, motion blur, and
 * frame/time limits are owned by FrameWrap — encoders stay dumb about all that.
 *
 * Contract:
 *   - `add(frame)`      consume one frame, then `await super.add()`.
 *   - `save()`          return a Blob for everything captured so far, or null
 *                       if there is nothing to save. No side effects.
 *   - `dispose()`       drop buffered frames and reset for a fresh part.
 *
 * Multipart auto-saving lives here because it is an output concern: some
 * formats must be flushed to disk periodically to avoid huge allocations. The
 * automatic part downloads happen here; the manual final save is routed back
 * through FrameWrap so callers can intercept the Blob.
 */
class FrameEncoder {
  constructor(params) {
    this.params = params;
    this.filename = params.name || guid();

    this.extension = "";
    this.mimeType = "";

    this._handlers = {};

    this.frames = 0;
    this.totalFrames = 0;
    this.part = 1;

    this.autoSaveTime = params.autoSaveTime || 0;
    this.multipart = this.autoSaveTime > 0;
    this.partFrames = this.multipart
      ? Math.max(1, Math.round(params.framerate * this.autoSaveTime))
      : 0;
  }

  /** Subscribe to encoder events (e.g. "progress"). FrameWrap forwards these. */
  on(event, handler) {
    this._handlers[event] = handler;
    return this;
  }

  emit(event, ...args) {
    const h = this._handlers[event];
    if (h) h(...args);
  }

  get name() {
    if (this.multipart) {
      return `${this.filename}-part-${String(this.part).padStart(5, "0")}.${
        this.extension
      }`;
    }
    return `${this.filename}.${this.extension}`;
  }

  async start() {
    this.frames = 0;
    this.totalFrames = 0;
    this.part = 1;
  }

  /**
   * Subclasses call `await super.add()` after consuming the frame, so
   * bookkeeping and multipart flushing happen in one place.
   */
  async add() {
    this.frames++;
    this.totalFrames++;

    if (this.multipart && this.frames >= this.partFrames) {
      const blob = await this.save();
      if (blob) download(blob, this.name, this.mimeType);
      await this.dispose();
      this.frames = 0;
      this.part++;
    }
  }

  async stop() {}

  /** @returns {Promise<Blob|null>} */
  async save() {
    return null;
  }

  async dispose() {}
}

export { FrameEncoder };
