import { FrameEncoder } from "./FrameEncoder.js";
import { Tar } from "../third_party/Tar.js";
import { pad } from "../utils.js";

/**
 * Packs a sequence of frame blobs into a TAR archive. Subclasses (PNG/JPG/WebP)
 * turn the canvas into an image blob and hand it here.
 */
class TarEncoder extends FrameEncoder {
  constructor(params) {
    super(params);

    this.extension = "tar";
    this.mimeType = "application/x-tar";
    this.fileExtension = "";

    this.tape = null;
    this.count = 0;
  }

  async start() {
    await super.start();
    this.tape = new Tar();
    this.count = 0;
  }

  async add(blob) {
    const buffer = new Uint8Array(await blob.arrayBuffer());
    this.tape.append(`${pad(this.count)}.${this.fileExtension}`, buffer);
    this.count++;
    await super.add();
  }

  async save() {
    return this.frames ? this.tape.save() : null;
  }

  async dispose() {
    this.tape = new Tar();
  }
}

export { TarEncoder };
