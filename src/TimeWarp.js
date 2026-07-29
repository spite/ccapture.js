/**
 * TimeWarp — deterministic time instrumentation.
 *
 * The core trick behind CCapture (à la ryg's kkapture): the browser's notion of
 * time is replaced by a virtual clock that only advances when *we* say so, one
 * fixed step per captured frame. Animations that derive motion from elapsed
 * time therefore render as if they run at a perfectly smooth framerate, no
 * matter how long each frame actually takes to compute.
 *
 * This module knows nothing about canvases, motion blur, or encoders — it only
 * owns time. FrameWrap drives it via `step()`.
 *
 * Hooked APIs:
 *   - performance.now
 *   - Date.now, Date.prototype.getTime          (gated by `hookDate`)
 *   - requestAnimationFrame / cancelAnimationFrame
 *   - setTimeout / clearTimeout
 *   - setInterval / clearInterval
 *   - HTMLMediaElement.prototype.currentTime     (video/audio)
 */

const target = globalThis;

// Capture pristine originals once, at module load, so we always restore the
// genuine native implementations regardless of what else may have patched them.
const originals = {
  requestAnimationFrame: target.requestAnimationFrame,
  cancelAnimationFrame: target.cancelAnimationFrame,
  setTimeout: target.setTimeout,
  clearTimeout: target.clearTimeout,
  setInterval: target.setInterval,
  clearInterval: target.clearInterval,
  performanceNow: target.performance ? target.performance.now : undefined,
  dateNow: Date.now,
  dateGetTime: Date.prototype.getTime,
  dateValueOf: Date.prototype.valueOf,
};

const nativeNow = originals.performanceNow
  ? originals.performanceNow.bind(target.performance)
  : originals.dateNow.bind(Date);

const nativeDateNow = originals.dateNow.bind(Date);

const mediaDescriptor =
  typeof HTMLMediaElement !== "undefined"
    ? Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype,
        "currentTime"
      )
    : undefined;

class TimeWarp {
  #enabled = false;
  #nextId = 1;

  #timeouts = [];
  #intervals = [];
  #rafCallbacks = [];
  #media = [];
  #origPlay = null;

  constructor({
    framerate = 60,
    startTime = 0,
    hookDate = true,
    hookValueOf = false,
    hookMedia = true,
    verbose = false,
  } = {}) {
    this.framerate = framerate;
    this.startTime = startTime; // seconds
    this.hookDate = hookDate;
    // Also warp Date.prototype.valueOf, so `+new Date()` is warped. Off by
    // default: it's the most invasive Date hook (affects numeric coercion of
    // every Date), and only applies when hookDate is on.
    this.hookValueOf = hookValueOf;
    // Hook HTMLMediaElement (currentTime / play) to frame-step video/audio.
    this.hookMedia = hookMedia;
    this.verbose = verbose;

    // Real-clock anchors, seeded on start() so magnitudes stay realistic.
    this.perfStart = 0;
    this.dateStart = 0;

    // Content time: how far into the animation we are, in ms.
    this.frameTime = 0;
  }

  get enabled() {
    return this.#enabled;
  }

  get frameStep() {
    return 1000 / this.framerate;
  }

  /** Virtual performance.now() value. */
  get time() {
    return this.perfStart + this.frameTime;
  }

  #log(...args) {
    if (this.verbose) console.log("[TimeWarp]", ...args);
  }

  start() {
    this.perfStart = nativeNow();
    this.dateStart = nativeDateNow();
    this.frameTime = this.startTime * 1000;
    this.#timeouts.length = 0;
    this.#intervals.length = 0;
    this.#rafCallbacks.length = 0;
    this.#media.length = 0;
    this.enable();
    this.#log("start", { perfStart: this.perfStart, frameTime: this.frameTime });
  }

  stop() {
    this.disable();
    this.#log("stop");
  }

  enable() {
    if (this.#enabled) return;
    this.#enabled = true;
    this.#install();
  }

  disable() {
    if (!this.#enabled) return;
    this.#enabled = false;
    this.#restore();
  }

  #install() {
    target.requestAnimationFrame = (callback) => {
      const id = this.#nextId++;
      this.#rafCallbacks.push({ id, callback });
      return id;
    };
    target.cancelAnimationFrame = (id) => {
      this.#rafCallbacks = this.#rafCallbacks.filter((c) => c.id !== id);
    };

    target.setTimeout = (callback, time = 0, ...args) => {
      const id = this.#nextId++;
      this.#timeouts.push({
        id,
        callback: args.length ? () => callback(...args) : callback,
        time,
        triggerTime: this.frameTime + time,
      });
      return id;
    };
    target.clearTimeout = (id) => {
      this.#timeouts = this.#timeouts.filter((t) => t.id !== id);
    };

    target.setInterval = (callback, time = 0, ...args) => {
      const id = this.#nextId++;
      this.#intervals.push({
        id,
        callback: args.length ? () => callback(...args) : callback,
        time,
        triggerTime: this.frameTime + time,
      });
      return id;
    };
    target.clearInterval = (id) => {
      this.#intervals = this.#intervals.filter((t) => t.id !== id);
    };

    if (target.performance) {
      // performance.now is often non-writable; defineProperty overrides it.
      Object.defineProperty(target.performance, "now", {
        configurable: true,
        writable: true,
        value: () => this.time,
      });
    }

    if (this.hookDate) {
      const tw = this;
      const virtual = function () {
        return tw.dateStart + tw.frameTime;
      };
      Date.now = () => tw.dateStart + tw.frameTime;
      // Note: this warps getTime() for *all* Date objects, not just "now". That
      // is the same trade-off the original made; libraries that read
      // `new Date().getTime()` as a clock work, but arbitrary date math breaks.
      // Opt out with `hookDate: false` if that matters.
      // eslint-disable-next-line no-extend-native
      Date.prototype.getTime = virtual;
      // Optionally also warp valueOf, so `+new Date()` / coercion is warped too.
      if (this.hookValueOf) {
        // eslint-disable-next-line no-extend-native
        Date.prototype.valueOf = virtual;
      }
    }

    if (this.hookMedia && mediaDescriptor) this.#installMedia();

    this.#log("hooks installed");
  }

  #installMedia() {
    const tw = this;
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get() {
        // Auto-register on first read so `currentTime`-driven code just works.
        if (!this.__ccHooked) tw.addMedia(this);
        return this.__ccHookedTime;
      },
      set(value) {
        if (!this.__ccHooked) tw.addMedia(this);
        this.__ccHookedTime = value;
        mediaDescriptor.set.call(this, value); // scrub the real media
      },
    });

    // Prevent realtime playback taking over mid-capture; we drive time by
    // seeking instead. Restored on disable.
    this.#origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      return Promise.resolve();
    };
  }

  /**
   * Register a media element to be frame-stepped. Called automatically when code
   * reads/writes `currentTime`, but call it explicitly for a `<video>` you only
   * ever draw with `drawImage` (which never touches `currentTime`).
   */
  addMedia(element, map) {
    if (!this.hookMedia) return; // media tampering opted out
    if (!element) return;
    const existing = this.#media.find((m) => m.el === element);
    if (existing) {
      // Attach or replace a capture→media time mapping on an element that was
      // already registered (e.g. auto-registered on a `currentTime` write).
      if (typeof map === "function") existing.map = map;
      return;
    }
    element.__ccHooked = true;
    element.__ccHookedTime = mediaDescriptor
      ? mediaDescriptor.get.call(element) || 0
      : 0;
    if (typeof element.pause === "function") element.pause();
    this.#media.push({ el: element, map: typeof map === "function" ? map : null });
  }

  /**
   * Seek every registered media element to the current frame time (applying any
   * per-element time mapping) and await completion — WITHOUT advancing the clock.
   * CCapture calls this once at start so frame 0 lands on the mapped/offset time.
   */
  async syncMedia() {
    return this.#syncMedia();
  }

  #restore() {
    target.requestAnimationFrame = originals.requestAnimationFrame;
    target.cancelAnimationFrame = originals.cancelAnimationFrame;
    target.setTimeout = originals.setTimeout;
    target.clearTimeout = originals.clearTimeout;
    target.setInterval = originals.setInterval;
    target.clearInterval = originals.clearInterval;
    if (target.performance && originals.performanceNow) {
      Object.defineProperty(target.performance, "now", {
        configurable: true,
        writable: true,
        value: originals.performanceNow,
      });
    }
    if (this.hookDate) {
      Date.now = originals.dateNow;
      // eslint-disable-next-line no-extend-native
      Date.prototype.getTime = originals.dateGetTime;
      if (this.hookValueOf) {
        // eslint-disable-next-line no-extend-native
        Date.prototype.valueOf = originals.dateValueOf;
      }
    }
    if (this.hookMedia && mediaDescriptor) {
      Object.defineProperty(
        HTMLMediaElement.prototype,
        "currentTime",
        mediaDescriptor
      );
    }
    if (this.#origPlay) {
      HTMLMediaElement.prototype.play = this.#origPlay;
      this.#origPlay = null;
    }

    // Re-queue anything still pending onto the real clock so the app doesn't
    // silently lose callbacks after capture ends.
    for (const c of this.#rafCallbacks) {
      if (originals.requestAnimationFrame) {
        originals.requestAnimationFrame.call(target, c.callback);
      }
    }
    this.#rafCallbacks = [];

    for (const t of this.#timeouts) {
      const delay = Math.max(0, t.triggerTime - this.frameTime);
      originals.setTimeout.call(target, t.callback, delay);
    }
    this.#timeouts = [];

    for (const iv of this.#intervals) {
      originals.setInterval.call(target, iv.callback, iv.time);
    }
    this.#intervals = [];

    this.#log("hooks restored");
  }

  #invoke(fn, arg) {
    try {
      return Promise.resolve(fn(arg)).catch((e) => this.#onError(e));
    } catch (e) {
      this.#onError(e);
      return Promise.resolve();
    }
  }

  #onError(e) {
    console.error("[TimeWarp] callback error:", e);
  }

  /** Map capture seconds → media currentTime for one registered element. */
  #mediaTime(m, seconds) {
    if (!m.map) return seconds; // default: media time == capture time
    try {
      const t = m.map(seconds);
      return typeof t === "number" && isFinite(t) ? t : seconds;
    } catch (e) {
      this.#onError(e);
      return seconds;
    }
  }

  /** Fire-and-forget: set virtual currentTime and scrub, without awaiting seeks. */
  #updateMedia() {
    const seconds = this.frameTime / 1000;
    for (const m of this.#media) {
      const t = this.#mediaTime(m, seconds);
      m.el.__ccHookedTime = t;
      if (mediaDescriptor) {
        try {
          mediaDescriptor.set.call(m.el, t);
        } catch {
          /* ignore un-seekable media */
        }
      }
    }
  }

  /** Seek every media element to the current frame time and await completion. */
  async #syncMedia() {
    if (!this.#media.length) return;
    const seconds = this.frameTime / 1000;
    const waits = [];
    for (const m of this.#media) {
      const mapped = this.#mediaTime(m, seconds);
      m.el.__ccHookedTime = mapped;
      if (!mediaDescriptor) continue;

      let target = Math.max(0, mapped); // guard negative offsets
      const dur = m.el.duration;
      if (typeof dur === "number" && isFinite(dur) && dur > 0) {
        target = Math.min(target, dur);
      }
      let current;
      try {
        current = mediaDescriptor.get.call(m.el);
      } catch {
        continue;
      }
      if (Math.abs(current - target) < 1e-4) continue; // already there
      waits.push(this.#seek(m.el, target));
    }
    if (waits.length) await Promise.all(waits);
  }

  #seek(media, time) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        media.removeEventListener("seeked", onSeeked);
        resolve();
      };
      // `seeked` means currentTime updated — but the decoded frame may not be
      // ready for drawImage/texImage2D yet, so drawing immediately can grab a
      // stale/blank frame (black output). requestVideoFrameCallback would be the
      // "presented" signal, but it does NOT reliably fire for a paused video.
      // createImageBitmap(video) forces the current frame to decode on demand,
      // independent of the presentation pipeline — so once it resolves the frame
      // is ready to draw. Audio (no videoWidth) just resolves on 'seeked'.
      const onSeeked = () => {
        const isVideo = typeof media.videoWidth === "number";
        if (isVideo && typeof createImageBitmap === "function") {
          createImageBitmap(media).then(
            (bmp) => { if (bmp && bmp.close) bmp.close(); finish(); },
            () => finish()
          );
        } else {
          finish();
        }
      };
      media.addEventListener("seeked", onSeeked, { once: true });
      try {
        mediaDescriptor.set.call(media, time);
      } catch {
        finish();
        return;
      }
      // Hard safety net for media that never fires 'seeked' (not loaded/seekable).
      originals.setTimeout.call(target, finish, 2000);
    });
  }

  #dispatch() {
    const now = this.frameTime;

    // Timeouts: fire and remove everything due, without splicing mid-iteration.
    const dueTimeouts = [];
    this.#timeouts = this.#timeouts.filter((t) => {
      if (now >= t.triggerTime) {
        dueTimeouts.push(t);
        return false;
      }
      return true;
    });
    dueTimeouts.sort((a, b) => a.triggerTime - b.triggerTime);
    for (const t of dueTimeouts) this.#invoke(t.callback);

    // Intervals: catch up if the step skipped whole periods. A non-positive
    // period (setInterval(fn) or setInterval(fn, 0)) fires once per step.
    for (const iv of this.#intervals) {
      if (now < iv.triggerTime) continue;
      if (iv.time <= 0) {
        this.#invoke(iv.callback);
        iv.triggerTime = now + this.frameStep;
        continue;
      }
      let guard = 0;
      while (now >= iv.triggerTime && guard++ < 10000) {
        this.#invoke(iv.callback);
        iv.triggerTime += iv.time;
      }
    }

    // requestAnimationFrame: flush this generation with the warped timestamp.
    const raf = this.#rafCallbacks;
    this.#rafCallbacks = [];
    for (const c of raf) this.#invoke(c.callback, this.time);
  }

  /**
   * Advance the virtual clock by `dt` ms (default: one frame) and dispatch all
   * callbacks that come due.
   *
   * Dispatch is synchronous and fire-and-forget: callbacks run in order
   * (timeouts → intervals → rAF) and their return values are NOT awaited — this
   * is what lets `capture()` flush the next rAF without an O(N) promise chain.
   * Media scrubs are issued but not awaited; use `stepAsync` for frame-accurate
   * video/audio.
   */
  step(dt = this.frameStep) {
    if (!this.#enabled) return;
    this.frameTime += dt;
    this.#updateMedia();
    this.#dispatch();
  }

  /**
   * Like `step`, but awaits every media element finishing its seek before
   * dispatching the next frame — so a `<video>` drawn to the canvas shows the
   * exact frame for this moment. FrameWrap uses this to drive capture.
   */
  async stepAsync(dt = this.frameStep) {
    if (!this.#enabled) return;
    this.frameTime += dt;
    await this.#syncMedia();
    this.#dispatch();
  }
}

export { TimeWarp, originals };
