import assert from "node:assert/strict";
import { WebCodecsEncoder } from "../src/encoders/WebCodecsEncoder.js";
import { WebMEncoder } from "../src/encoders/WebMEncoder.js";
import { FrameWrap } from "../src/FrameWrap.js";

// These run in Node, where WebCodecs is absent — so they cover metadata and the
// fallback/selection logic, not actual encoding (which needs a browser).

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("isSupported is false without WebCodecs (Node)", () => {
  assert.equal(WebCodecsEncoder.isSupported(), false);
});

test("mp4 vs webm containers set the right extension/mime", () => {
  const mp4 = new WebCodecsEncoder({ format: "mp4", framerate: 60, quality: 90 });
  assert.equal(mp4.container, "mp4");
  assert.equal(mp4.extension, "mp4");
  assert.equal(mp4.mimeType, "video/mp4");
  assert.equal(mp4.codec, "avc");

  const webm = new WebCodecsEncoder({ format: "webm", framerate: 60, quality: 90 });
  assert.equal(webm.container, "webm");
  assert.equal(webm.extension, "webm");
  assert.equal(webm.mimeType, "video/webm");
  assert.equal(webm.codec, "vp9");
});

test("bitrate/codec/maxQueueSize params pass through", () => {
  const enc = new WebCodecsEncoder({
    format: "webm",
    framerate: 60,
    quality: 90,
    codec: "av1",
    bitrate: 12_000_000,
    maxQueueSize: 3,
  });
  assert.equal(enc.codec, "av1");
  assert.equal(enc.bitrate, 12_000_000);
  assert.equal(enc.maxQueueSize, 3);
  assert.equal(enc.bitrate === 0 ? "derive" : "explicit", "explicit");
});

test("keyframe interval rounds for fractional framerate", () => {
  const enc = new WebCodecsEncoder({ format: "mp4", framerate: 29.97, quality: 90 });
  assert.equal(enc.keyInterval, 60); // round(29.97 * 2)
});

test("FrameWrap falls back webm -> legacy WebMEncoder without WebCodecs", () => {
  const fw = new FrameWrap({ format: "webm" });
  assert.ok(fw.encoder instanceof WebMEncoder, "used the legacy fallback");
});

test("FrameWrap throws for mp4 when WebCodecs is unavailable", () => {
  assert.throws(() => new FrameWrap({ format: "mp4" }), /requires WebCodecs/);
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
