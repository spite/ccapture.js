import { CCapture } from "./CCapture.js";

// The unified, plug-and-play recorder (FrameWrap + TimeWarp).
export { CCapture } from "./CCapture.js";

// The two halves, usable independently.
export { FrameWrap, encoders } from "./FrameWrap.js";
export { TimeWarp } from "./TimeWarp.js";

// Frame-accurate audio analysis (offline).
export { renderAudioFrames } from "./AudioTimeline.js";

// Yield a macrotask (used to keep the tab responsive in manual capture loops).
export { nextTask } from "./utils.js";

// Motion blur backends.
export { MotionBlur } from "./MotionBlur.js";
export { GPUMotionBlur } from "./GPUMotionBlur.js";
export { createMotionBlur } from "./createMotionBlur.js";

// Encoder base classes + built-ins, for building/registering custom encoders.
// FrameEncoder = frame-by-frame (streaming); BatchEncoder = all-frames-at-once.
export { FrameEncoder } from "./encoders/FrameEncoder.js";
export { BatchEncoder } from "./encoders/BatchEncoder.js";
export { WebCodecsEncoder } from "./encoders/WebCodecsEncoder.js";
export { GIFEncoder } from "./encoders/GIFEncoder.js";
export { GifskiEncoder } from "./encoders/GifskiEncoder.js";

export default CCapture;
