import assert from "node:assert/strict";
import {
  CCapture,
  FrameWrap,
  GIFEncoder,
  FrameEncoder,
  BatchEncoder,
  GifskiEncoder,
} from "../src/index.js";

const fakeCanvas = { width: 4, height: 4 };

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---- GIF ----

test("GIF encoder metadata & param clamping", () => {
  const g = new GIFEncoder({ framerate: 60, quality: 90 });
  assert.equal(g.extension, "gif");
  assert.equal(g.mimeType, "image/gif");
  assert.equal(g.delay, 2, "60fps -> 2 centiseconds");
  assert.equal(g.maxColors, 256);

  assert.equal(new GIFEncoder({ framerate: 60, gifColors: 1000 }).maxColors, 256);
  assert.equal(new GIFEncoder({ framerate: 60, gifColors: 1 }).maxColors, 2);
  assert.equal(new GIFEncoder({ framerate: 30 }).delay, 3);
});

test("gif is a registered format", () => {
  assert.ok(FrameWrap.formats.includes("gif"));
  const fw = new FrameWrap({ format: "gif" });
  assert.ok(fw.encoder instanceof GIFEncoder);
});

// ---- Bring-your-own encoder ----

// Minimal custom encoder built on the public FrameEncoder contract.
class CountEncoder extends FrameEncoder {
  constructor(params) {
    super(params);
    this.extension = "bin";
    this.mimeType = "application/octet-stream";
    this.added = 0;
  }
  async add() {
    this.added++;
    await super.add();
  }
  async save() {
    return this.added ? new Blob([new Uint8Array(this.added)]) : null;
  }
}

test("registerEncoder adds a named format", () => {
  FrameWrap.registerEncoder("count", CountEncoder);
  assert.ok(FrameWrap.formats.includes("count"));
  const fw = new FrameWrap({ format: "count" });
  assert.ok(fw.encoder instanceof CountEncoder);
});

test("encoder param accepts a class", () => {
  const fw = new FrameWrap({ encoder: CountEncoder });
  assert.ok(fw.encoder instanceof CountEncoder);
});

test("encoder param accepts a ready instance", () => {
  const inst = new CountEncoder({ framerate: 60 });
  const fw = new FrameWrap({ encoder: inst });
  assert.equal(fw.encoder, inst);
});

test("a custom encoder drives a full capture", async () => {
  const cc = new CCapture({ encoder: CountEncoder, framerate: 60, frameLimit: 3 });
  let blob = null;
  cc.on("save", (b) => (blob = b));
  await cc.record(fakeCanvas, () => {});
  assert.equal(cc.encoder.added, 3);
  assert.ok(blob instanceof Blob);
});

// ---- Batch encoder framework ----

// A batch encoder that buffers frames and encodes them all at save(). Overrides
// _store so it needs no DOM (the default uses canvas.toBlob).
class MockBatch extends BatchEncoder {
  constructor(params) {
    super(params);
    this.extension = "bin";
    this.mimeType = "application/octet-stream";
    this.encodeAllCalls = 0;
  }
  async _store(canvas) {
    // ImageData-like token so the default _restore returns it as-is.
    return { data: [1, 2, 3], width: canvas.width, height: canvas.height };
  }
  async encodeAll({ frameCount, width, height, framerate, getFrame }) {
    this.encodeAllCalls++;
    this.emit("progress", 0.5);
    this.decoded = [];
    for (let i = 0; i < frameCount; i++) this.decoded.push(await getFrame(i));
    this.emit("progress", 1);
    return frameCount ? new Blob([new Uint8Array(frameCount)]) : null;
  }
}

test("BatchEncoder buffers during capture, encodes once at save", async () => {
  const cc = new CCapture({ encoder: MockBatch, framerate: 60, frameLimit: 4 });
  let progress = 0;
  cc.on("progress", (p) => (progress = p));
  await cc.record(fakeCanvas, () => {});
  assert.equal(cc.encoder.buffer.length, 4, "all frames buffered");
  assert.equal(cc.encoder.encodeAllCalls, 1, "encodeAll runs exactly once");
  assert.equal(cc.encoder.decoded.length, 4, "getFrame returns each buffered frame");
  assert.equal(progress, 1, "progress forwarded through CCapture");
});

test("BatchEncoder does not encode until save", async () => {
  const enc = new MockBatch({ framerate: 60 });
  await enc.start();
  await enc.add(fakeCanvas);
  await enc.add(fakeCanvas);
  assert.equal(enc.encodeAllCalls, 0, "no encode during capture");
  assert.equal(enc.buffer.length, 2);
  const blob = await enc.save();
  assert.equal(enc.encodeAllCalls, 1);
  assert.ok(blob instanceof Blob);
  const again = await enc.save();
  assert.equal(enc.encodeAllCalls, 1, "save is idempotent");
  assert.equal(again, blob);
});

test("BatchEncoder.dispose clears the buffer", async () => {
  const enc = new MockBatch({ framerate: 60 });
  await enc.start();
  await enc.add(fakeCanvas);
  await enc.dispose();
  assert.equal(enc.buffer.length, 0);
});

test("GifskiEncoder is a BatchEncoder with gif metadata (not auto-registered)", () => {
  const g = new GifskiEncoder({ framerate: 60, quality: 90 });
  assert.ok(g instanceof BatchEncoder);
  assert.equal(g.extension, "gif");
  assert.equal(g.mimeType, "image/gif");
  assert.equal(FrameWrap.formats.includes("gif-hq"), false, "opt-in, not built-in");
});

test("GifskiEncoder uses an injected encode function", async () => {
  let received = null;
  const fakeGifski = async (opts) => {
    received = opts;
    return new Uint8Array([71, 73, 70]); // "GIF"
  };
  const g = new GifskiEncoder({ framerate: 30, quality: 75, gifski: fakeGifski });
  const blob = await g.encodeAll({
    frameCount: 2,
    width: 8,
    height: 8,
    framerate: 30,
    getFrame: async (i) => ({ data: [i], width: 8, height: 8 }),
  });
  assert.ok(blob instanceof Blob);
  assert.equal(received.fps, 30);
  assert.equal(received.quality, 75);
  assert.equal(received.frames.length, 2);
});

test("GifskiEncoder rejects an oversized batch with guidance", async () => {
  const g = new GifskiEncoder({ framerate: 60, gifski: async () => new Uint8Array() });
  await assert.rejects(
    () =>
      g.encodeAll({
        frameCount: 1000,
        width: 4000,
        height: 4000,
        framerate: 60,
        getFrame: async () => ({ data: [], width: 4000, height: 4000 }),
      }),
    /too large/
  );
});

const run = async () => {
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      console.error(`  ✗ ${name}\n    ${e.stack || e.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
  process.exit(process.exitCode || 0);
};

run();
