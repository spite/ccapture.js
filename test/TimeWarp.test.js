import assert from "node:assert/strict";
import { TimeWarp, originals } from "../src/TimeWarp.js";

// References to the genuine natives, captured before any hooking.
const realSetTimeout = originals.setTimeout;
const realPerformanceNow = originals.performanceNow;

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("virtual clock advances by a fixed step", async () => {
  const tw = new TimeWarp({ framerate: 60 });
  tw.start();
  const t0 = performance.now();
  await tw.step();
  const t1 = performance.now();
  assert.ok(Math.abs(t1 - t0 - tw.frameStep) < 1e-6, "one step == frameStep");
  await tw.step();
  const t2 = performance.now();
  assert.ok(Math.abs(t2 - t0 - 2 * tw.frameStep) < 1e-6, "two steps");
  tw.stop();
});

test("startTime offsets the initial clock", async () => {
  const tw = new TimeWarp({ framerate: 60, startTime: 2 });
  tw.start();
  // frameTime seeded at 2000ms, so performance.now() == perfStart + 2000.
  assert.ok(Math.abs(tw.time - tw.perfStart - 2000) < 1e-6);
  tw.stop();
});

test("Date.now advances with the virtual clock and restores", async () => {
  const tw = new TimeWarp({ framerate: 60 });
  const before = Date.now();
  tw.start();
  const a = Date.now();
  await tw.step();
  const b = Date.now();
  // Epoch-magnitude numbers only resolve to ~5e-4ms, so use a loose tolerance.
  assert.ok(Math.abs(b - a - tw.frameStep) < 1e-2, "Date.now steps");
  tw.stop();
  assert.ok(Date.now() >= before, "Date.now real again after stop");
});

test("hookValueOf: off by default — +new Date() is not warped", () => {
  const tw = new TimeWarp({ framerate: 60 });
  tw.start();
  tw.step();
  tw.step();
  tw.step(); // frameTime = 50ms
  const warped = new Date().getTime() - tw.dateStart; // hooked -> ~50
  const real = +new Date() - tw.dateStart; // valueOf -> real, ~0
  assert.ok(Math.abs(warped - tw.frameTime) < 1e-3, "getTime warped");
  assert.ok(real < warped - 10, `+new Date() not warped (got ${real} vs ${warped})`);
  tw.stop();
});

test("hookValueOf: on — +new Date() is warped, and restored on stop", () => {
  const nativeValueOf = Date.prototype.valueOf;
  const tw = new TimeWarp({ framerate: 60, hookValueOf: true });
  tw.start();
  tw.step();
  tw.step();
  tw.step();
  const coerced = +new Date() - tw.dateStart;
  assert.ok(Math.abs(coerced - tw.frameTime) < 1e-3, "+new Date() warped");
  tw.stop();
  assert.equal(Date.prototype.valueOf, nativeValueOf, "valueOf restored");
});

test("hookMedia: false disables media registration", () => {
  const tw = new TimeWarp({ framerate: 60, hookMedia: false });
  tw.start();
  let paused = false;
  tw.addMedia({ pause: () => (paused = true) });
  assert.equal(paused, false, "addMedia is a no-op when hookMedia is false");
  tw.stop();
});

test("requestAnimationFrame fires once per step with warped timestamp", async () => {
  const tw = new TimeWarp({ framerate: 60 });
  tw.start();
  let count = 0;
  const stamps = [];
  const loop = (t) => {
    count++;
    stamps.push(t);
    if (count < 3) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  await tw.step();
  assert.equal(count, 1);
  assert.ok(Math.abs(stamps[0] - tw.time) < 1e-6, "timestamp == performance.now");
  await tw.step();
  assert.equal(count, 2);
  await tw.step();
  assert.equal(count, 3);
  await tw.step(); // no re-register on the 3rd, so nothing more fires
  assert.equal(count, 3);
  tw.stop();
});

test("cancelAnimationFrame removes a pending callback", async () => {
  const tw = new TimeWarp({ framerate: 60 });
  tw.start();
  let fired = false;
  const id = requestAnimationFrame(() => (fired = true));
  cancelAnimationFrame(id);
  await tw.step();
  assert.equal(fired, false);
  tw.stop();
});

test("setTimeout fires after enough virtual time; clearTimeout cancels", async () => {
  const tw = new TimeWarp({ framerate: 60 }); // step ~16.67ms
  tw.start();
  let fired = false;
  setTimeout(() => (fired = true), 50);
  await tw.step(); // ~16.7
  assert.equal(fired, false);
  await tw.step(); // ~33.3
  assert.equal(fired, false);
  await tw.step(); // ~50.0 -> due
  assert.equal(fired, true);

  let fired2 = false;
  const id = setTimeout(() => (fired2 = true), 10);
  clearTimeout(id);
  await tw.step();
  assert.equal(fired2, false);
  tw.stop();
});

test("setTimeout forwards extra arguments", async () => {
  const tw = new TimeWarp({ framerate: 60 });
  tw.start();
  let got;
  setTimeout((a, b) => (got = a + b), 5, 3, 4);
  await tw.step();
  assert.equal(got, 7);
  tw.stop();
});

test("setInterval repeats every period; clearInterval stops it", async () => {
  const tw = new TimeWarp({ framerate: 60 }); // ~16.67ms/step
  tw.start();
  let ticks = 0;
  const id = setInterval(() => ticks++, 16);
  await tw.step(); // 16.67 >= 16
  assert.equal(ticks, 1);
  await tw.step(); // 33.33 >= 32
  assert.equal(ticks, 2);
  clearInterval(id);
  await tw.step();
  assert.equal(ticks, 2);
  tw.stop();
});

test("setInterval(fn, 0) fires once per step", async () => {
  const tw = new TimeWarp({ framerate: 60 });
  tw.start();
  let ticks = 0;
  setInterval(() => ticks++, 0);
  tw.step();
  tw.step();
  tw.step();
  assert.equal(ticks, 3, "one tick per step, never stuck");
  tw.stop();
});

test("setInterval catches up across a large step", async () => {
  const tw = new TimeWarp({ framerate: 60 });
  tw.start();
  let ticks = 0;
  setInterval(() => ticks++, 10);
  await tw.step(100); // should fire ~10 times
  assert.equal(ticks, 10);
  tw.stop();
});

test("step dispatches callbacks synchronously (fire-and-forget)", async () => {
  const tw = new TimeWarp({ framerate: 60 });
  tw.start();
  let sync = false;
  let asyncTail = false;
  requestAnimationFrame(async () => {
    sync = true; // runs synchronously during step
    await Promise.resolve();
    asyncTail = true; // runs later, not awaited by step
  });
  tw.step();
  assert.equal(sync, true, "synchronous part ran during step");
  assert.equal(asyncTail, false, "step does not await the async tail");
  await Promise.resolve();
  assert.equal(asyncTail, true, "async tail runs on a later microtask");
  tw.stop();
});

test("stepAsync advances the clock and dispatches rAF", async () => {
  const tw = new TimeWarp({ framerate: 60 });
  tw.start();
  let fired = 0;
  const t0 = performance.now();
  requestAnimationFrame(() => fired++);
  await tw.stepAsync();
  assert.equal(fired, 1);
  assert.ok(Math.abs(performance.now() - t0 - tw.frameStep) < 1e-6);
  tw.stop();
});

test("addMedia registers, pauses, and stepAsync sets virtual currentTime", async () => {
  const tw = new TimeWarp({ framerate: 60 });
  tw.start();
  let paused = false;
  const el = { pause: () => (paused = true) };
  tw.addMedia(el);
  assert.equal(paused, true, "paused on register");
  tw.addMedia(el); // idempotent
  await tw.stepAsync();
  assert.ok(Math.abs(el.__ccHookedTime - tw.frameStep / 1000) < 1e-6);
  tw.stop();
});

test("stop() restores the genuine native functions", async () => {
  const tw = new TimeWarp({ framerate: 60 });
  tw.start();
  assert.notEqual(globalThis.setTimeout, realSetTimeout, "hooked while active");
  tw.stop();
  assert.equal(globalThis.setTimeout, realSetTimeout);
  assert.equal(globalThis.performance.now, realPerformanceNow);
});

const run = async () => {
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${e.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
  // stop() re-queues pending timers onto the real clock (correct in a browser),
  // which would keep Node alive; exit deterministically once results are in.
  process.exit(process.exitCode || 0);
};

run();
