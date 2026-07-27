import assert from "node:assert/strict";
import { CCapture } from "../src/CCapture.js";
import { TimeWarp, originals } from "../src/TimeWarp.js";

const realSetTimeout = originals.setTimeout;
const realNow = originals.performanceNow;
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

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("inline auto-drive: capture() flushes the render loop by itself", async () => {
  const cc = new CCapture({ format: "webm", frameLimit: 5 });
  cc.framewrap.encoder = mockEncoder();
  let renders = 0;
  await cc.start();
  await new Promise((resolve) => {
    cc.on("stop", resolve);
    function render() {
      requestAnimationFrame(render);
      renders++;
      cc.capture(fakeCanvas); // fire-and-forget
    }
    render();
  });
  assert.equal(cc.frameCount, 5);
  assert.equal(cc.encoder.adds, 5);
  assert.equal(renders, 5, "capture() drove exactly 5 renders");
  assert.equal(cc.capturing, false);
  assert.equal(globalThis.performance.now, realNow, "clock restored after stop");
});

test("inline auto-drive with motion blur runs N sub-renders per frame", async () => {
  const cc = new CCapture({ format: "webm", frameLimit: 3, motionBlurFrames: 4 });
  cc.framewrap.encoder = mockEncoder();
  cc.framewrap.motionBlur = mockMotionBlur();
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
  assert.equal(cc.frameCount, 3);
  assert.equal(cc.encoder.adds, 3);
  assert.equal(renders, 12, "3 frames x 4 sub-frames");
});

test("step advances the virtual clock by one sub-frame", async () => {
  const cc = new CCapture({ format: "webm", framerate: 60 });
  cc.framewrap.encoder = mockEncoder();
  await cc.start();
  const t0 = performance.now();
  cc.step();
  assert.ok(Math.abs(performance.now() - t0 - cc.framewrap.frameStep) < 1e-6);
  await cc.stop();
});

test("step advances by frameStep/subframes under motion blur", async () => {
  const cc = new CCapture({ format: "webm", framerate: 60, motionBlurFrames: 4 });
  cc.framewrap.encoder = mockEncoder();
  await cc.start();
  const t0 = performance.now();
  cc.step();
  assert.ok(Math.abs(performance.now() - t0 - cc.framewrap.frameStep / 4) < 1e-6);
  await cc.stop();
});

test("record() drives a flat loop until the frame limit", async () => {
  const cc = new CCapture({ format: "webm", frameLimit: 4 });
  cc.framewrap.encoder = mockEncoder();
  let renders = 0;
  const saved = await cc.record(fakeCanvas, () => renders++);
  assert.equal(renders, 4);
  assert.equal(cc.encoder.adds, 4);
  assert.equal(cc.frameCount, 4);
  assert.equal(cc.capturing, false);
  assert.equal(saved, true);
});

test("record() calls render once per sub-frame under motion blur", async () => {
  const cc = new CCapture({ format: "webm", frameLimit: 2, motionBlurFrames: 3 });
  cc.framewrap.encoder = mockEncoder();
  cc.framewrap.motionBlur = mockMotionBlur();
  let renders = 0;
  await cc.record(fakeCanvas, () => renders++);
  assert.equal(renders, 6, "2 frames x 3 sub-frames");
  assert.equal(cc.encoder.adds, 2);
});

test("record() awaits async render (never overlaps)", async () => {
  const cc = new CCapture({ format: "webm", frameLimit: 3 });
  cc.framewrap.encoder = mockEncoder();
  let inFlight = 0;
  let maxConcurrent = 0;
  await cc.record(fakeCanvas, async () => {
    inFlight++;
    maxConcurrent = Math.max(maxConcurrent, inFlight);
    await Promise.resolve();
    inFlight--;
  });
  assert.equal(maxConcurrent, 1);
  assert.equal(cc.encoder.adds, 3);
});

test("record() requires a limit", async () => {
  const cc = new CCapture({ format: "webm" });
  cc.framewrap.encoder = mockEncoder();
  await assert.rejects(() => cc.record(fakeCanvas, () => {}), /frameLimit or timeLimit/);
});

test("shares an injected TimeWarp instance", () => {
  const tw = new TimeWarp({ framerate: 60 });
  const cc = new CCapture({ format: "webm", timewarp: tw });
  assert.equal(cc.timewarp, tw);
});

test("registers media, pauses it, and steps its virtual currentTime", async () => {
  let paused = false;
  const el = { pause: () => (paused = true) };
  const cc = new CCapture({ format: "webm", framerate: 60, media: el });
  cc.framewrap.encoder = mockEncoder();
  await cc.start();
  assert.equal(paused, true, "media paused on start");
  cc.step();
  assert.ok(Math.abs(el.__ccHookedTime - cc.framewrap.frameStep / 1000) < 1e-6);
  await cc.stop();
});

test("stop() restores the real clock; setTimeout hooked only while capturing", async () => {
  const cc = new CCapture({ format: "webm" });
  cc.framewrap.encoder = mockEncoder();
  await cc.start();
  assert.notEqual(globalThis.setTimeout, realSetTimeout, "hooked while active");
  await cc.stop();
  assert.equal(globalThis.setTimeout, realSetTimeout);
  assert.equal(globalThis.performance.now, realNow);
});

const run = async () => {
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${e.stack || e.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
  process.exit(process.exitCode || 0);
};

run();
