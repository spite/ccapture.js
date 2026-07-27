import { TarEncoder } from "./TarEncoder.js";
import { asyncCanvasToBlob } from "../utils.js";

/**
 * Base for the image-sequence encoders. Turns each canvas into an image blob
 * (PNG/JPG/WebP) and packs it into the TAR. `quality` comes from params as a
 * 0–100 value and is normalized to the 0–1 canvas.toBlob range; PNG ignores it.
 */
class ImageEncoder extends TarEncoder {
  constructor(params) {
    super(params);

    this.type = "image/png";
    const q = params.quality ?? 92;
    this.quality = Math.min(1, Math.max(0, q / 100));
  }

  async add(canvas) {
    const blob = await asyncCanvasToBlob(canvas, this.type, this.quality);
    if (!blob) {
      throw new Error(
        `Failed to encode a "${this.type}" frame — this browser may not support ` +
          `that image format via canvas.toBlob.`
      );
    }
    await super.add(blob);
  }
}

export { ImageEncoder };
