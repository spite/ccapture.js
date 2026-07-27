import { ImageEncoder } from "./ImageEncoder.js";

class JPGEncoder extends ImageEncoder {
  constructor(params) {
    super(params);

    this.type = "image/jpeg";
    this.fileExtension = "jpg";
  }
}

export { JPGEncoder };
