// Bundle entry for the UMD/IIFE global build (for <script> tags / CDNs).
// Exposes the whole API on a single `window.CCapture`:
//   new CCapture({...})           // the recorder
//   CCapture.FrameWrap, CCapture.TimeWarp, CCapture.createMotionBlur, ...
import CCapture from "./index.js";
import * as api from "./index.js";

for (const [key, value] of Object.entries(api)) {
  if (key !== "default") CCapture[key] = value;
}

(typeof globalThis !== "undefined" ? globalThis : window).CCapture = CCapture;
