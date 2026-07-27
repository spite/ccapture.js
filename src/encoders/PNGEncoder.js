import { ImageEncoder } from "./ImageEncoder.js";

class PNGEncoder extends ImageEncoder {
  constructor(params) {
    super(params);

    this.type = "image/png";
    this.fileExtension = "png";
  }
}

export { PNGEncoder };
