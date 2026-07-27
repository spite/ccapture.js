import { MotionBlur } from "./MotionBlur.js";
import { GPUMotionBlur } from "./GPUMotionBlur.js";

/** Is `source` a canvas that already holds a WebGL(2) context? */
function isWebGLCanvas(source) {
  if (!source || typeof source.getContext !== "function") return false;
  try {
    // getContext returns the existing context of a matching type, or null; it
    // never creates a second context type, so these probes are side-effect free.
    if (source.getContext("2d")) return false;
    return !!(source.getContext("webgl2") || source.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * Decide which backend to use — pure, so it's testable without instantiating
 * anything (the CPU backend needs a DOM).
 *
 * `prefer`:
 *   - "auto" (default): GPU when the source is a WebGL canvas and there are
 *     enough samples to pay off (>2); otherwise CPU.
 *   - "gpu": force GPU when supported, else CPU.
 *   - "cpu": always CPU.
 *
 * @returns {"gpu" | "cpu"}
 */
function chooseBackend(source, subframes, prefer = "auto") {
  if (prefer === "cpu") return "cpu";
  const wantGPU =
    prefer === "gpu" ||
    (prefer === "auto" && subframes > 2 && isWebGLCanvas(source));
  return wantGPU && GPUMotionBlur.isSupported() ? "gpu" : "cpu";
}

/**
 * Instantiate the chosen motion-blur backend. Both backends share the
 * add/resolve/reset interface, so the caller never needs to know which it got.
 */
function createMotionBlur(source, subframes, prefer = "auto") {
  if (chooseBackend(source, subframes, prefer) === "gpu") {
    try {
      return new GPUMotionBlur();
    } catch {
      /* fall back to CPU */
    }
  }
  return new MotionBlur();
}

export { createMotionBlur, chooseBackend, isWebGLCanvas };
