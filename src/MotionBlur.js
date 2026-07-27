/**
 * CPU motion-blur accumulator.
 *
 * Several sub-frames are rendered across a single output frame's time span and
 * averaged together, producing the blur a real camera shutter would capture.
 *
 * Fixes over the original CCapture implementation:
 *   - accumulates in a Float32Array, so it never overflows (the original used a
 *     Uint16Array, which wrapped after ~256 samples);
 *   - averages all four channels including alpha (the original ignored alpha);
 *   - divides by the actual sample count rather than a fixed constant.
 *
 * A GPU backend can later implement the same add()/resolve()/reset() interface.
 */
class MotionBlur {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.accum = null;
    this.width = 0;
    this.height = 0;
    this.count = 0;
  }

  #ensureSize(width, height) {
    if (this.width === width && this.height === height && this.accum) return;
    this.width = this.canvas.width = width;
    this.height = this.canvas.height = height;
    this.accum = new Float32Array(width * height * 4);
    this.count = 0;
  }

  /** Add one sub-frame to the accumulator. */
  add(source) {
    this.#ensureSize(source.width, source.height);
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.drawImage(source, 0, 0);
    const { data } = this.ctx.getImageData(0, 0, this.width, this.height);
    const accum = this.accum;
    for (let i = 0; i < accum.length; i++) accum[i] += data[i];
    this.count++;
  }

  /** Resolve the average into `this.canvas` and return it. */
  resolve() {
    const image = this.ctx.createImageData(this.width, this.height);
    const data = image.data;
    const accum = this.accum;
    const n = this.count || 1;
    for (let i = 0; i < accum.length; i++) data[i] = accum[i] / n;
    this.ctx.putImageData(image, 0, 0);
    return this.canvas;
  }

  /** Clear the accumulator for the next output frame. */
  reset() {
    if (this.accum) this.accum.fill(0);
    this.count = 0;
  }

  /** No GPU resources to free; present for interface parity with GPUMotionBlur. */
  dispose() {}
}

export { MotionBlur };
