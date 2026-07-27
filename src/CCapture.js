import { FrameWrap } from "./FrameWrap.js";
import { TimeWarp } from "./TimeWarp.js";
import { nextTask } from "./utils.js";

/**
 * CCapture — the unified, plug-and-play recorder.
 *
 * Composes a {@link FrameWrap} (canvas capture: motion blur + encoding) with a
 * {@link TimeWarp} (a virtual clock), and drives them together so a live
 * animation records as a smooth, fixed-framerate file. Drop-in usage:
 *
 *   const capturer = new CCapture({ format: "mp4", framerate: 60, timeLimit: 5 });
 *   capturer.start();
 *   function render() {
 *     requestAnimationFrame(render);   // hooked while capturing
 *     draw();
 *     capturer.capture(canvas);        // ← the only line you add
 *   }
 *   render();
 *
 * Because requestAnimationFrame is hooked during capture, the loop only advances
 * when capture() flushes it — so capture() paces everything, as fast as the
 * machine can draw and encode.
 *
 * For the pieces on their own: use `TimeWarp` for timing, or `FrameWrap` to
 * encode frames you produce yourself.
 */
class CCapture {
  /** Register a custom encoder format (delegates to FrameWrap). */
  static registerEncoder(name, EncoderClass) {
    FrameWrap.registerEncoder(name, EncoderClass);
    return CCapture;
  }

  /** Registered format names. */
  static get formats() {
    return FrameWrap.formats;
  }

  constructor(params = {}) {
    this.framewrap = new FrameWrap(params);
    this.params = this.framewrap.params;

    this.timewarp =
      this.params.timewarp ||
      new TimeWarp({
        framerate: this.params.framerate,
        startTime: this.params.startTime,
        hookDate: this.params.hookDate,
        hookValueOf: this.params.hookValueOf,
        hookMedia: this.params.hookMedia,
        verbose: this.params.verbose,
      });

    // When manual/driven (record() or explicit step()), capture() must not
    // advance the clock itself. Default false = least-intrusive auto-drive.
    this.manual = false;
    this.handlers = {};

    // Bubble up capture events; when capture stops, restore the real clock.
    for (const ev of ["start", "frame", "progress", "save", "error"]) {
      this.framewrap.on(ev, (...args) => this.emit(ev, ...args));
    }
    this.framewrap.on("stop", () => {
      this.timewarp.stop();
      this.emit("stop");
    });
  }

  on(event, handler) {
    this.handlers[event] = handler;
    return this;
  }

  emit(event, ...args) {
    const handler = this.handlers[event];
    if (handler) handler(...args);
  }

  get capturing() {
    return this.framewrap.capturing;
  }
  get frameCount() {
    return this.framewrap.frameCount;
  }
  get encoder() {
    return this.framewrap.encoder;
  }
  get motionBlur() {
    return this.framewrap.motionBlur;
  }

  #dt() {
    return this.framewrap.frameStep / this.framewrap.subframes;
  }

  async start() {
    this.timewarp.start();
    if (this.params.media) {
      for (const el of [].concat(this.params.media)) this.timewarp.addMedia(el);
    }
    await this.framewrap.start();
  }

  /** Capture the just-drawn frame; auto-drives the loop (see class docs). */
  async capture(canvas) {
    if (!this.framewrap.capturing) return;
    // FrameWrap.capture handles its own encode errors (emits "error", stops).
    await this.framewrap.capture(canvas);
    if (!this.manual && this.framewrap.capturing) {
      try {
        await this.#tick();
      } catch (e) {
        this.emit("error", e);
        await this.stop();
      }
    }
  }

  /** Apply encoder backpressure, yield to paint, then advance and flush the next rAF. */
  async #tick() {
    const enc = this.framewrap.encoder;
    if (typeof enc.backpressure === "function") await enc.backpressure();
    await nextTask(); // let the browser paint / breathe between frames
    if (this.framewrap.capturing) await this.timewarp.stepAsync(this.#dt());
  }

  /** Advance the virtual clock by one sub-frame (synchronous; no media await). */
  step() {
    this.timewarp.step(this.#dt());
  }

  /**
   * Headless convenience for when you DON'T have an existing animation loop:
   * CCapture owns a flat loop, calling your `render` once per sub-frame. Needs a
   * `frameLimit`/`timeLimit`.
   */
  async record(canvas, render) {
    if (!this.params.frameLimit && !this.params.timeLimit) {
      throw new Error(
        "record() needs a frameLimit or timeLimit so the loop can terminate; " +
          "use start()/capture() in your own loop for open-ended capture."
      );
    }
    this.manual = true;
    try {
      await this.start();
      while (this.framewrap.capturing) {
        await render(this.framewrap.frameCount);
        await this.capture(canvas);
        await this.timewarp.stepAsync(this.#dt());
        await nextTask();
      }
    } finally {
      this.manual = false;
    }
    return this.framewrap.saved;
  }

  async stop() {
    await this.framewrap.stop(); // emits "stop" → stops the clock too
    this.timewarp.stop(); // idempotent, covers the already-stopped case
  }

  async save(callback) {
    return this.framewrap.save(callback);
  }

  async dispose() {
    await this.framewrap.dispose();
    this.timewarp.stop();
  }
}

export { CCapture };
