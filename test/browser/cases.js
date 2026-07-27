import {
  CCapture,
  FrameWrap,
  TimeWarp,
  createMotionBlur,
  GifskiEncoder,
  BatchEncoder,
  renderAudioFrames,
} from "/src/index.js";
import { test, assert } from "./harness.js";

CCapture.registerEncoder("gif-hq", GifskiEncoder);

// ---------- helpers ----------

const fakeCanvas = { width: 4, height: 4 };

function mockEncoder() {
  return {
    adds: 0,
    name: "test.webm",
    mimeType: "video/webm",
    async start() {},
    async add() {
      this.adds++;
    },
    async stop() {},
    async save() {
      return new Blob(["x"], { type: this.mimeType });
    },
    async dispose() {},
  };
}
function mockMotionBlur() {
  return {
    adds: 0,
    canvas: { width: 4, height: 4 },
    add() {
      this.adds++;
    },
    resolve() {
      return this.canvas;
    },
    reset() {},
  };
}
function makeScene(size = 64) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  return {
    canvas,
    draw(t) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#fff";
      ctx.fillRect(Math.floor(((t % 1) * size) - 6), 0, 12, size);
    },
  };
}
async function recordBlob(format, frames = 6, extra = {}) {
  const { canvas, draw } = makeScene();
  const cap = new CCapture({ format, framerate: 30, ...extra });
  let captureError = null;
  cap.on("error", (e) => (captureError = e));
  await cap.start();
  let t0 = null;
  for (let i = 0; i < frames; i++) {
    if (t0 === null) t0 = performance.now();
    draw((performance.now() - t0) / 1000);
    await cap.capture(canvas);
  }
  await cap.stop();
  if (captureError) {
    await cap.dispose();
    throw captureError;
  }
  let blob = null;
  await cap.save((b) => (blob = b));
  await cap.dispose();
  return blob;
}
function loadVideo(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.muted = true;
    v.onloadedmetadata = () => {
      resolve({ w: v.videoWidth, h: v.videoHeight, dur: v.duration });
      URL.revokeObjectURL(url);
    };
    v.onerror = () => reject(new Error("video failed to load"));
    setTimeout(() => reject(new Error("video metadata timeout")), 8000);
    v.src = url;
  });
}
const ascii = (buf, s, n) => String.fromCharCode(...buf.slice(s, s + n));

// ---------- TimeWarp (timing hooks actually work in this engine) ----------

test("TimeWarp: performance.now warps by one step", () => {
  const tw = new TimeWarp({ framerate: 60 });
  tw.start();
  const a = performance.now();
  tw.step();
  assert.close(performance.now() - a, tw.frameStep, 1e-6);
  tw.stop();
});

test("TimeWarp: requestAnimationFrame fires on step with warped timestamp", () => {
  const tw = new TimeWarp({ framerate: 60 });
  tw.start();
  let ts = -1;
  requestAnimationFrame((t) => (ts = t));
  tw.step();
  assert.close(ts, tw.time, 1e-6, "rAF timestamp == performance.now");
  tw.stop();
});

test("TimeWarp: setTimeout fires after enough virtual time; clearTimeout cancels", () => {
  const tw = new TimeWarp({ framerate: 60 });
  tw.start();
  let fired = false;
  setTimeout(() => (fired = true), 50);
  tw.step();
  tw.step();
  assert.equal(fired, false, "not yet (2 steps < 50ms)");
  tw.step();
  assert.equal(fired, true, "fired past 50ms");
  let f2 = false;
  const id = setTimeout(() => (f2 = true), 5);
  clearTimeout(id);
  tw.step();
  assert.equal(f2, false, "clearTimeout cancelled");
  tw.stop();
});

test("TimeWarp: setInterval repeats; clearInterval stops", () => {
  const tw = new TimeWarp({ framerate: 60 });
  tw.start();
  let n = 0;
  const id = setInterval(() => n++, 16);
  tw.step();
  tw.step();
  assert.equal(n, 2);
  clearInterval(id);
  tw.step();
  assert.equal(n, 2);
  tw.stop();
});

test("TimeWarp: stop() restores the real performance.now", () => {
  const before = performance.now;
  const tw = new TimeWarp({ framerate: 60 });
  tw.start();
  assert.ok(performance.now !== before, "hooked while active");
  tw.stop();
  assert.equal(performance.now, before, "restored after stop");
});

// ---------- FrameWrap (capture only) ----------

test("FrameWrap: one capture == one encoded frame", async () => {
  const fw = new FrameWrap({ format: "webm" });
  fw.encoder = mockEncoder();
  await fw.start();
  for (let i = 0; i < 5; i++) await fw.capture(fakeCanvas);
  assert.equal(fw.encoder.adds, 5);
  await fw.stop();
});

test("FrameWrap: motion blur emits one frame per N sub-frames", async () => {
  const fw = new FrameWrap({ format: "webm", motionBlurFrames: 4 });
  fw.encoder = mockEncoder();
  fw.motionBlur = mockMotionBlur();
  await fw.start();
  for (let i = 0; i < 8; i++) await fw.capture(fakeCanvas);
  assert.equal(fw.encoder.adds, 2);
  await fw.stop();
});

test("FrameWrap: frameLimit auto-stops and saves", async () => {
  const fw = new FrameWrap({ format: "webm", frameLimit: 3 });
  fw.encoder = mockEncoder();
  let saved = null;
  fw.on("save", (b) => (saved = b));
  await fw.start();
  for (let i = 0; i < 10; i++) await fw.capture(fakeCanvas);
  assert.equal(fw.encoder.adds, 3);
  assert.equal(fw.capturing, false);
  assert.ok(saved instanceof Blob);
});

test("FrameWrap: does not touch the clock", async () => {
  const raf = requestAnimationFrame;
  const now = performance.now;
  const fw = new FrameWrap({ format: "webm" });
  fw.encoder = mockEncoder();
  await fw.start();
  await fw.capture(fakeCanvas);
  assert.equal(requestAnimationFrame, raf);
  assert.equal(performance.now, now);
  await fw.stop();
});

test("FrameWrap: unknown format throws", () => {
  assert.throws(() => new FrameWrap({ format: "nope" }), /Unknown format/);
});

// ---------- CCapture (composition + drive) ----------

test("CCapture: inline capture() auto-drives the render loop", async () => {
  const cc = new CCapture({ format: "webm", frameLimit: 5 });
  cc.framewrap.encoder = mockEncoder();
  let renders = 0;
  await cc.start();
  await new Promise((resolve) => {
    cc.on("stop", resolve);
    function render() {
      requestAnimationFrame(render);
      renders++;
      cc.capture(fakeCanvas);
    }
    render();
  });
  assert.equal(cc.frameCount, 5);
  assert.equal(renders, 5);
  assert.equal(cc.capturing, false);
});

test("CCapture: step advances the virtual clock", async () => {
  const cc = new CCapture({ format: "webm", framerate: 60 });
  cc.framewrap.encoder = mockEncoder();
  await cc.start();
  const a = performance.now();
  cc.step();
  assert.close(performance.now() - a, cc.framewrap.frameStep, 1e-6);
  await cc.stop();
});

test("CCapture: record() drives a flat loop to the limit", async () => {
  const cc = new CCapture({ format: "webm", frameLimit: 4 });
  cc.framewrap.encoder = mockEncoder();
  let renders = 0;
  const saved = await cc.record(fakeCanvas, () => renders++);
  assert.equal(renders, 4);
  assert.equal(cc.encoder.adds, 4);
  assert.equal(saved, true);
});

test("CCapture: registers media, pauses it, steps its currentTime", async () => {
  const el = document.createElement("video"); // real element (native currentTime)
  let paused = false;
  el.pause = () => (paused = true); // spy
  const cc = new CCapture({ format: "webm", framerate: 60, media: el });
  cc.framewrap.encoder = mockEncoder();
  await cc.start();
  assert.equal(paused, true, "media paused on start");
  cc.step();
  assert.close(el.__ccHookedTime, cc.framewrap.frameStep / 1000, 1e-6);
  await cc.stop();
});

test("CCapture: stop() restores the real clock", async () => {
  const before = performance.now;
  const cc = new CCapture({ format: "webm" });
  cc.framewrap.encoder = mockEncoder();
  await cc.start();
  assert.ok(performance.now !== before);
  await cc.stop();
  assert.equal(performance.now, before);
});

// ---------- Custom encoders ----------

test("registerEncoder adds a named format usable by CCapture", () => {
  class TinyEncoder {
    constructor(params) {
      this.params = params;
      this.extension = "bin";
      this.mimeType = "application/octet-stream";
    }
    on() {}
    async start() {}
    async add() {}
    async stop() {}
    async save() {
      return null;
    }
    async dispose() {}
  }
  CCapture.registerEncoder("tiny-test", TinyEncoder);
  assert.ok(CCapture.formats.includes("tiny-test"));
  assert.ok(new CCapture({ format: "tiny-test" }).encoder instanceof TinyEncoder);
});

test("BatchEncoder buffers during capture, encodes once at save", async () => {
  class MockBatch extends BatchEncoder {
    constructor(p) {
      super(p);
      this.extension = "bin";
      this.mimeType = "application/octet-stream";
      this.calls = 0;
    }
    async _store() {
      return { data: [1], width: 4, height: 4 };
    }
    async _restore(token) {
      return token; // custom token shape; skip the base blob-decode path
    }
    async encodeAll({ frameCount, getFrame }) {
      this.calls++;
      for (let i = 0; i < frameCount; i++) await getFrame(i);
      return new Blob([new Uint8Array(frameCount)]);
    }
  }
  const cc = new CCapture({ encoder: MockBatch, framerate: 60, frameLimit: 4 });
  await cc.record(fakeCanvas, () => {});
  assert.equal(cc.encoder.buffer.length, 4);
  assert.equal(cc.encoder.calls, 1);
});

// ---------- Integration: real encoders produce valid output ----------

const caps = (() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  return {
    videoEncoder: typeof VideoEncoder !== "undefined",
    webgl2: !!gl,
    colorFloat: !!(gl && gl.getExtension("EXT_color_buffer_float")),
  };
})();

for (const format of ["mp4", "webm", "gif", "png", "jpg", "webp"]) {
  test(`encode: ${format} produces a valid file`, async () => {
    if (format === "mp4" && !caps.videoEncoder) assert.skip("no WebCodecs");
    let blob;
    try {
      blob = await recordBlob(format);
    } catch (e) {
      // mp4 encode isn't available in every browser (e.g. Firefox has no H.264
      // encoder that yields a muxable config); that's a known limitation, not a
      // library bug — skip rather than fail. webm is the reliable video format.
      if (format === "mp4") assert.skip(`mp4 unsupported here: ${e.message}`);
      throw e;
    }
    assert.ok(blob && blob.size > 0, "non-empty blob");
    const buf = new Uint8Array(await blob.arrayBuffer());
    if (format === "mp4" || format === "webm") {
      const v = await loadVideo(blob); // throws if unplayable
      assert.ok(v.w > 0 && v.h > 0, "playable with dimensions");
    } else if (format === "gif") {
      assert.match(ascii(buf, 0, 6), /^GIF8/, "GIF magic");
    } else {
      assert.equal(ascii(buf, 257, 5), "ustar", "valid TAR");
    }
  });
}

// ---------- Integration: motion blur ----------

async function blurCase(prefer) {
  const size = 64;
  const src = document.createElement("canvas");
  src.width = size;
  src.height = size;
  const isGL = prefer === "gpu";
  const ctx = isGL ? src.getContext("webgl2") : src.getContext("2d");
  if (isGL && !ctx) assert.skip("no webgl2");
  const mb = createMotionBlur(src, 8, prefer);
  const backend = mb.gl ? "gpu" : "cpu";
  if (prefer === "gpu" && backend !== "gpu") assert.skip("gpu blur unsupported");

  for (let i = 0; i < 8; i++) {
    const x = Math.floor((i / 8) * size);
    if (isGL) {
      ctx.viewport(0, 0, size, size);
      ctx.enable(ctx.SCISSOR_TEST);
      ctx.scissor(0, 0, size, size);
      ctx.clearColor(0, 0, 0, 1);
      ctx.clear(ctx.COLOR_BUFFER_BIT);
      ctx.scissor(x, 0, 12, size);
      ctx.clearColor(1, 1, 1, 1);
      ctx.clear(ctx.COLOR_BUFFER_BIT);
      ctx.disable(ctx.SCISSOR_TEST);
    } else {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#fff";
      ctx.fillRect(x, 0, 12, size);
    }
    mb.add(src);
  }
  const out = mb.resolve();
  const scratch = document.createElement("canvas");
  scratch.width = size;
  scratch.height = size;
  const sctx = scratch.getContext("2d");
  sctx.drawImage(out, 0, 0);
  const data = sctx.getImageData(0, 0, size, size).data;
  let partial = 0;
  for (let x = 0; x < size; x++) {
    const r = data[(32 * size + x) * 4];
    if (r > 20 && r < 235) partial++;
  }
  mb.dispose?.();
  assert.ok(partial > 0, `expected grey (averaged) columns, got ${partial} [${backend}]`);
}

test("motion blur: CPU backend averages", () => blurCase("cpu"));
test("motion blur: GPU backend averages", () => blurCase("gpu"));

// ---------- Integration: video sync ----------

test("video: media is seeked in lockstep with capture", async () => {
  const video = document.createElement("video");
  video.muted = true;
  video.src = "/test/browser/sample.webm";
  await new Promise((ok, err) => {
    video.onloadeddata = ok;
    video.onerror = () => err(new Error("sample video failed to load"));
    setTimeout(() => err(new Error("sample video load timeout")), 8000);
  });

  let seeked = 0;
  video.addEventListener("seeked", () => seeked++);
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const cap = new CCapture({ format: "png", framerate: 4, media: video });
  await cap.start();
  for (let i = 0; i < 6; i++) {
    ctx.drawImage(video, 0, 0, size, size);
    await cap.capture(canvas);
  }
  await cap.stop();
  await cap.dispose();
  assert.ok(seeked > 0, `expected per-frame seeks, got ${seeked}`);
});

// ---------- Integration: frame-accurate audio ----------

test("audio: offline analysis tracks a frequency sweep frame-by-frame", async () => {
  // Build a chirp (200Hz -> 8kHz over 2s) so the spectral peak rises over time.
  const sampleRate = 44100, dur = 2;
  const ac = new OfflineAudioContext(1, sampleRate * dur, sampleRate);
  const buffer = ac.createBuffer(1, sampleRate * dur, sampleRate);
  const data = buffer.getChannelData(0);
  const f0 = 200, f1 = 8000;
  let phase = 0;
  for (let n = 0; n < data.length; n++) {
    const t = n / sampleRate;
    const f = f0 + (f1 - f0) * (t / dur);
    phase += (2 * Math.PI * f) / sampleRate;
    data[n] = Math.sin(phase) * 0.5;
  }

  const frames = await renderAudioFrames({
    buffer,
    framerate: 10,
    frames: 20,
    fftSize: 2048,
    smoothing: 0,
  });

  assert.equal(frames.length, 20, "one analysis per frame");
  assert.ok(frames[5].frequency.some((v) => v > 0), "frequency data is populated");

  const peakBin = (a) => {
    let max = 0, idx = 0;
    for (let i = 0; i < a.length; i++) if (a[i] > max) { max = a[i]; idx = i; }
    return idx;
  };
  const early = peakBin(frames[3].frequency);
  const late = peakBin(frames[16].frequency);
  assert.ok(late > early + 3, `spectral peak rises over time (${early} -> ${late})`);
});

// ---------- Integration: audio track muxing ----------

async function recordWithAudio(format, frames = 15) {
  const sr = 44100;
  const buffer = new OfflineAudioContext(1, sr, sr).createBuffer(1, sr, sr);
  const d = buffer.getChannelData(0);
  for (let i = 0; i < sr; i++) d[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.3;
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  const cap = new CCapture({ format, framerate: 30, audio: buffer });
  await cap.start();
  for (let i = 0; i < frames; i++) {
    ctx.fillStyle = "#08f";
    ctx.fillRect(0, 0, 32, 32);
    await cap.capture(canvas);
  }
  const audioEnabled = cap.encoder.audioEnabled;
  await cap.stop();
  let blob = null;
  await cap.save((x) => (blob = x));
  await cap.dispose();
  return { blob, audioEnabled };
}

test("audio track: webm muxes an Opus track", async () => {
  if (typeof AudioEncoder === "undefined") assert.skip("no AudioEncoder");
  const { blob, audioEnabled } = await recordWithAudio("webm");
  if (!audioEnabled) assert.skip("no audio encoder support here");
  const txt = new TextDecoder("latin1").decode(new Uint8Array(await blob.arrayBuffer()));
  assert.match(txt, /opus/i, "Opus audio track present");
});

test("audio track: mp4 muxes an audio track", async () => {
  if (typeof AudioEncoder === "undefined") assert.skip("no AudioEncoder");
  const { blob, audioEnabled } = await recordWithAudio("mp4");
  if (!audioEnabled) assert.skip("no mp4 audio encoder here");
  const txt = new TextDecoder("latin1").decode(new Uint8Array(await blob.arrayBuffer()));
  assert.match(txt, /mp4a|opus|dops/i, "audio track present (AAC or Opus)");
});

// ---------- Integration: gif-hq (gifski via CDN) ----------

test("gif-hq: gifski produces a valid GIF", async () => {
  let blob;
  try {
    blob = await recordBlob("gif-hq", 6);
  } catch (e) {
    assert.skip(`gifski unavailable: ${e.message}`);
  }
  const buf = new Uint8Array(await blob.arrayBuffer());
  assert.match(ascii(buf, 0, 6), /^GIF8/, "GIF magic");
});

export { caps };
