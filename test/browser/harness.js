// Minimal in-browser test framework. No dependencies; runs in any browser.

// Real timer captured before any test can hook it (TimeWarp monkeypatches these).
const rawNow =
  (typeof performance !== "undefined" && performance.now.bind(performance)) ||
  Date.now.bind(Date);

const _tests = [];
export function test(name, fn) {
  _tests.push({ name, fn });
}

class SkipError extends Error {}

export const assert = {
  ok(cond, msg) {
    if (!cond) throw new Error(msg || "expected truthy");
  },
  equal(a, b, msg) {
    if (a !== b) throw new Error(`${msg ? msg + ": " : ""}got ${a}, want ${b}`);
  },
  close(a, b, eps = 1e-6, msg) {
    if (Math.abs(a - b) > eps)
      throw new Error(`${msg ? msg + ": " : ""}|${a} - ${b}| > ${eps}`);
  },
  match(str, re, msg) {
    if (!re.test(String(str))) throw new Error(`${msg ? msg + ": " : ""}"${str}" !~ ${re}`);
  },
  async throws(fn, re) {
    try {
      await fn();
    } catch (e) {
      if (re && !re.test(e.message)) throw new Error(`threw "${e.message}", wanted ${re}`);
      return;
    }
    throw new Error("expected a throw");
  },
  skip(reason) {
    throw new SkipError(reason || "skipped");
  },
};

// Snapshot / restore the globals TimeWarp can hook, so a test that forgets to
// stop() (or fails mid-flight) can't contaminate the rest of the suite.
function snapshot() {
  return {
    raf: globalThis.requestAnimationFrame,
    caf: globalThis.cancelAnimationFrame,
    st: globalThis.setTimeout,
    ct: globalThis.clearTimeout,
    si: globalThis.setInterval,
    ci: globalThis.clearInterval,
    now: typeof performance !== "undefined"
      ? Object.getOwnPropertyDescriptor(performance, "now")
      : undefined,
    dateNow: Date.now,
    getTime: Date.prototype.getTime,
  };
}
function restore(s) {
  globalThis.requestAnimationFrame = s.raf;
  globalThis.cancelAnimationFrame = s.caf;
  globalThis.setTimeout = s.st;
  globalThis.clearTimeout = s.ct;
  globalThis.setInterval = s.si;
  globalThis.clearInterval = s.ci;
  if (typeof performance !== "undefined") {
    if (s.now) Object.defineProperty(performance, "now", s.now);
    else delete performance.now;
  }
  Date.now = s.dateNow;
  // eslint-disable-next-line no-extend-native
  Date.prototype.getTime = s.getTime;
}

export async function runAll(onEach) {
  const results = [];
  for (const { name, fn } of _tests) {
    const t0 = rawNow();
    const snap = snapshot();
    let status = "pass";
    let error = null;
    try {
      await fn();
    } catch (e) {
      if (e instanceof SkipError) {
        status = "skip";
        error = e.message;
      } else {
        status = "fail";
        error = e.message;
      }
    } finally {
      restore(snap);
    }
    const row = { name, status, error, ms: Math.round(rawNow() - t0) };
    results.push(row);
    if (onEach) onEach(row);
  }
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;
  return { passed, failed, skipped, total: results.length, results };
}
