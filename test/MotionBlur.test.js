import assert from "node:assert/strict";
import {
  chooseBackend,
  isWebGLCanvas,
} from "../src/createMotionBlur.js";
import { GPUMotionBlur } from "../src/GPUMotionBlur.js";

// Fake canvases: getContext returns a context only for the matching type.
const glCanvas = { getContext: (t) => (t === "webgl2" ? {} : null) };
const glCanvas1 = { getContext: (t) => (t === "webgl" ? {} : null) };
const twoDCanvas = { getContext: (t) => (t === "2d" ? {} : null) };

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("isWebGLCanvas detects context type", () => {
  assert.equal(isWebGLCanvas(glCanvas), true);
  assert.equal(isWebGLCanvas(glCanvas1), true);
  assert.equal(isWebGLCanvas(twoDCanvas), false);
  assert.equal(isWebGLCanvas({}), false);
  assert.equal(isWebGLCanvas(null), false);
});

test("GPUMotionBlur.isSupported is false in Node", () => {
  assert.equal(GPUMotionBlur.isSupported(), false);
});

test("chooseBackend falls back to CPU when GPU is unsupported", () => {
  assert.equal(chooseBackend(glCanvas, 8, "auto"), "cpu");
  assert.equal(chooseBackend(glCanvas, 8, "gpu"), "cpu");
});

test("chooseBackend logic when GPU is available (stubbed)", () => {
  const real = GPUMotionBlur.isSupported;
  GPUMotionBlur.isSupported = () => true;
  try {
    assert.equal(chooseBackend(glCanvas, 8, "auto"), "gpu", "webgl + many samples");
    assert.equal(chooseBackend(glCanvas, 2, "auto"), "cpu", "too few samples for auto");
    assert.equal(chooseBackend(twoDCanvas, 8, "auto"), "cpu", "2d source stays CPU");
    assert.equal(chooseBackend(twoDCanvas, 8, "gpu"), "gpu", "explicit gpu overrides");
    assert.equal(chooseBackend(glCanvas, 8, "cpu"), "cpu", "explicit cpu overrides");
  } finally {
    GPUMotionBlur.isSupported = real;
  }
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
