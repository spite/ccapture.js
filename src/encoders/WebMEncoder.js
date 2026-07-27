import { FrameEncoder } from "./FrameEncoder.js";
import { Writer as WebMWriter } from "../third_party/webm-writer.js";

/**
 * Legacy WebM encoder built on webm-writer-js. It works by grabbing each frame
 * as a WebP still, so it only runs where `canvas.toDataURL('image/webp')` is
 * supported (effectively Chromium). WebCodecsEncoder is the preferred path when
 * available; this remains as a fallback.
 */
class WebMEncoder extends FrameEncoder {
  constructor(params) {
    super(params);

    this.extension = "webm";
    this.mimeType = "video/webm";
    this.quality = Math.min(1, Math.max(0, (params.quality ?? 90) / 100));

    this.videoWriter = null;
    this.savedBlob = null;
  }

  async start() {
    await super.start();
    this.savedBlob = null;
    await this.dispose();
  }

  async add(canvas) {
    this.videoWriter.addFrame(canvas);
    await super.add();
  }

  async save() {
    if (this.savedBlob) return this.savedBlob; // complete() is not repeatable
    if (!this.frames) return null;
    const blob = await this.videoWriter.complete();
    // webm-writer's Blob can come back without a type; normalize it.
    this.savedBlob = blob.type ? blob : new Blob([blob], { type: this.mimeType });
    return this.savedBlob;
  }

  async dispose() {
    this.savedBlob = null;
    this.videoWriter = new WebMWriter({
      quality: this.quality,
      fileWriter: null,
      fd: null,
      frameRate: this.params.framerate,
    });
  }
}

export { WebMEncoder };
