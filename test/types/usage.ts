// Type-check fixture: exercises the public API against the .d.ts. Not executed
// at runtime — `tsc --noEmit` validates the declarations compile and fit usage.

import CCapture, {
  FrameWrap,
  TimeWarp,
  MotionBlur,
  GPUMotionBlur,
  createMotionBlur,
  FrameEncoder,
  BatchEncoder,
  WebCodecsEncoder,
  GIFEncoder,
  GifskiEncoder,
  encoders,
  originals,
} from "../../src/index.js";
import type {
  CCaptureParams,
  MotionBlurBackend,
  BatchEncodeContext,
} from "../../src/index.js";

async function main(canvas: HTMLCanvasElement) {
  const cap = new CCapture({
    format: "mp4",
    framerate: 60,
    timeLimit: 5,
    motionBlurFrames: 8,
    motionBlur: "auto",
    quality: 90,
  });

  cap.on("frame", (n) => n.toFixed(0));
  cap.on("progress", (p) => p.toFixed(2));
  cap.on("save", (b: Blob) => b.size);
  cap.on("error", (e: Error) => e.message);
  cap.on("stop", () => {});

  await cap.start();
  await cap.capture(canvas);
  cap.step();
  const saved: boolean = await cap.record(canvas, (frame) => {
    const t: number = frame / 60;
    void t;
  });
  void saved;
  const blob = await cap.save();
  if (blob) void blob.type;
  await cap.stop();
  await cap.dispose();

  const c: boolean = cap.capturing;
  const fc: number = cap.frameCount;
  void c;
  void fc;
}

// Statics + custom encoder registration
CCapture.registerEncoder("custom", class extends FrameEncoder {});
const formats: string[] = CCapture.formats;
void formats;

// TimeWarp standalone
const tw = new TimeWarp({ framerate: 30, startTime: 1, hookDate: false });
tw.start();
tw.step();
const time: number = tw.time;
void time;
tw.stop();
void originals;

// FrameWrap standalone
const fw = new FrameWrap({ format: "webm" });
void fw.capturing;
void FrameWrap.formats;
void encoders;

// Motion blur
const mb: MotionBlurBackend = createMotionBlur(document.createElement("canvas"), 8, "cpu");
mb.add(document.createElement("canvas"));
mb.resolve();
mb.reset();
void MotionBlur;
void GPUMotionBlur;
void GPUMotionBlur.isSupported();
void WebCodecsEncoder.isSupported();
void GIFEncoder;
void GifskiEncoder;

// Custom batch encoder
class MyBatch extends BatchEncoder {
  async encodeAll(ctx: BatchEncodeContext): Promise<Blob> {
    for (let i = 0; i < ctx.frameCount; i++) await ctx.getFrame(i);
    return new Blob([]);
  }
}
void MyBatch;

const params: CCaptureParams = { format: "gif", gifColors: 128, media: null };
void params;
void main;
