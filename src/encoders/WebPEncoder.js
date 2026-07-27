import { ImageEncoder } from "./ImageEncoder.js";

class WebPEncoder extends ImageEncoder {
  constructor(params) {
    super(params);

    this.type = "image/webp";
    this.fileExtension = "webp";
  }
}

export { WebPEncoder };
