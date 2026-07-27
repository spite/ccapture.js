import assert from "node:assert/strict";
import { FrameWrap } from "../src/FrameWrap.js";

// FrameWrap is capture-only (no timing). These cover encoding, motion-blur
// cadence, limits, save, and disposal. Time-driven behaviour lives in the
// CCapture tests.

const fakeCanvas = { width: 4, height: 4 };

function mockEncoder() {
  return {
    adds: 0,
    started: false,
    stopped: false,
    saves: 0,
    name: "test.webm",
    mimeType: "video/webm",
    async start() {
      this.started = true;
    },
    async add() {
      this.adds++;
    },
    async stop() {
      this.stopped = true;
    },
    async save() {
      this.saves++;
      return new Blob(["x"], { type: this.mimeType });
    },
    async dispose() {
      this.disposed = true;
    },
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

test("one capture == one encoded frame (no motion blur)", async () => {
  const fw = new FrameWrap({ format: "webm" });
  fw.encoder = mockEncoder();
  await fw.start();
  for (let i = 0; i < 5; i++) await fw.capture(fakeCanvas);
  assert.equal(fw.encoder.adds, 5);
  assert.equal(fw.frameCount, 5);
  await fw.stop();
  assert.equal(fw.encoder.stopped, true);
  assert.equal(fw.capturing, false);
});

test("capture is a no-op before start / after stop", async () => {
  const fw = new FrameWrap({ format: "webm" });
  fw.encoder = mockEncoder();
  await fw.capture(fakeCanvas); // before start
  assert.equal(fw.encoder.adds, 0);
  await fw.start();
  await fw.stop();
  await fw.capture(fakeCanvas); // after stop
  assert.equal(fw.encoder.adds, 0);
});

test("does not hook or touch the clock", async () => {
  const realRAF = globalThis.requestAnimationFrame;
  const realNow = globalThis.performance.now;
  const fw = new FrameWrap({ format: "webm" });
  fw.encoder = mockEncoder();
  await fw.start();
  await fw.capture(fakeCanvas);
  assert.equal(globalThis.requestAnimationFrame, realRAF, "rAF untouched");
  assert.equal(globalThis.performance.now, realNow, "performance.now untouched");
  await fw.stop();
});

test("motion blur emits one frame per N sub-frames", async () => {
  const fw = new FrameWrap({ format: "webm", motionBlurFrames: 4 });
  fw.encoder = mockEncoder();
  fw.motionBlur = mockMotionBlur();
  await fw.start();
  for (let i = 0; i < 8; i++) await fw.capture(fakeCanvas);
  assert.equal(fw.motionBlur.adds, 8, "every sub-frame accumulated");
  assert.equal(fw.encoder.adds, 2, "two output frames from 8 sub-frames");
  assert.equal(fw.frameCount, 2);
  assert.equal(fw.intermediateFrameCount, 0, "counter resets after emit");
  await fw.stop();
});

test("frameLimit auto-stops and saves", async () => {
  const fw = new FrameWrap({ format: "webm", frameLimit: 3 });
  fw.encoder = mockEncoder();
  let savedBlob = null;
  fw.on("save", (b) => (savedBlob = b));
  await fw.start();
  for (let i = 0; i < 10; i++) await fw.capture(fakeCanvas);
  assert.equal(fw.frameCount, 3, "stops emitting at the limit");
  assert.equal(fw.encoder.adds, 3);
  assert.equal(fw.capturing, false);
  assert.ok(savedBlob instanceof Blob);
});

test("timeLimit auto-stops and saves", async () => {
  const fw = new FrameWrap({ format: "webm", framerate: 60, timeLimit: 0.05 });
  fw.encoder = mockEncoder();
  await fw.start();
  for (let i = 0; i < 10; i++) await fw.capture(fakeCanvas); // 0.05s*60 = 3 frames
  assert.equal(fw.frameCount, 3);
  assert.equal(fw.capturing, false);
  await fw.stop();
});

test("save routes the Blob to a callback instead of downloading", async () => {
  const fw = new FrameWrap({ format: "webm" });
  fw.encoder = mockEncoder();
  await fw.start();
  await fw.capture(fakeCanvas);
  let got = null;
  const ret = await fw.save((b) => (got = b));
  assert.ok(got instanceof Blob);
  assert.equal(ret, got);
  await fw.stop();
});

test("dispose() releases the encoder and is idempotent", async () => {
  const fw = new FrameWrap({ format: "webm" });
  fw.encoder = mockEncoder();
  await fw.dispose();
  assert.equal(fw.encoder.disposed, true);
  assert.equal(fw.motionBlur, null);
  await fw.dispose(); // must not throw a second time
});

test("dispose() stops an in-progress capture", async () => {
  const fw = new FrameWrap({ format: "webm" });
  fw.encoder = mockEncoder();
  await fw.start();
  assert.equal(fw.capturing, true);
  await fw.dispose();
  assert.equal(fw.capturing, false);
});

test("unknown format throws", () => {
  assert.throws(() => new FrameWrap({ format: "nope" }), /Unknown format/);
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
