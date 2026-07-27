/**
 * WebGL2 motion-blur accumulator — same interface as the CPU MotionBlur
 * (add / resolve / reset), but the accumulation stays on the GPU.
 *
 * Each sub-frame is uploaded as a texture and additively blended into a float
 * (RGBA16F) framebuffer; resolve() draws that framebuffer scaled by 1/count
 * onto this.canvas. Nothing is read back to the CPU during accumulation — the
 * frame only leaves the GPU when the encoder consumes this.canvas (and with
 * WebCodecs it may not leave at all). This avoids the CPU path's per-sub-frame
 * getImageData readback and its ~W·H·4 JS accumulation loop.
 */

let _supported;

const QUAD = new Float32Array([-1, -1, 3, -1, -1, 3]); // oversized triangle

const VERT = `#version 300 es
in vec2 position;
out vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

// Copy the source texture straight through; additive blending does the summing.
const FRAG_ACCUM = `#version 300 es
precision highp float;
uniform sampler2D src;
in vec2 vUv;
out vec4 fragColor;
void main() { fragColor = texture(src, vUv); }`;

// Divide the accumulated sum by the sample count; output opaque (like the
// original CPU version, which kept RGB and ignored alpha).
const FRAG_RESOLVE = `#version 300 es
precision highp float;
uniform sampler2D accum;
uniform float scale;
in vec2 vUv;
out vec4 fragColor;
void main() { fragColor = vec4(texture(accum, vUv).rgb * scale, 1.0); }`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error("[GPUMotionBlur] shader: " + gl.getShaderInfoLog(shader));
  }
  return shader;
}

function program(gl, vert, frag) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vert));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(p, 0, "position");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error("[GPUMotionBlur] link: " + gl.getProgramInfoLog(p));
  }
  return p;
}

class GPUMotionBlur {
  static isSupported() {
    if (_supported !== undefined) return _supported;
    _supported = false;
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2");
      _supported = !!(gl && gl.getExtension("EXT_color_buffer_float"));
    } catch {
      _supported = false;
    }
    return _supported;
  }

  constructor() {
    this.canvas = document.createElement("canvas");
    const gl = this.canvas.getContext("webgl2", {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true, // so the encoder can read the resolved frame
    });
    if (!gl || !gl.getExtension("EXT_color_buffer_float")) {
      throw new Error("[GPUMotionBlur] WebGL2 + EXT_color_buffer_float required");
    }
    this.gl = gl;

    this.accumProgram = program(gl, VERT, FRAG_ACCUM);
    this.resolveProgram = program(gl, VERT, FRAG_RESOLVE);
    this.srcLoc = gl.getUniformLocation(this.accumProgram, "src");
    this.accumLoc = gl.getUniformLocation(this.resolveProgram, "accum");
    this.scaleLoc = gl.getUniformLocation(this.resolveProgram, "scale");

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // Source texture (canvas uploaded here each sub-frame), flipped to match
    // the WebGL bottom-up convention so the output isn't upside down.
    this.srcTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    this.accumTex = null;
    this.fbo = null;
    this.width = 0;
    this.height = 0;
    this.count = 0;
  }

  #ensureSize(width, height) {
    if (this.width === width && this.height === height && this.fbo) return;
    const gl = this.gl;
    this.width = this.canvas.width = width;
    this.height = this.canvas.height = height;

    if (this.accumTex) gl.deleteTexture(this.accumTex);
    if (this.fbo) gl.deleteFramebuffer(this.fbo);

    this.accumTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.accumTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.accumTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.reset();
  }

  add(source) {
    this.#ensureSize(source.width, source.height);
    const gl = this.gl;

    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE); // additive accumulation

    gl.useProgram(this.accumProgram);
    gl.uniform1i(this.srcLoc, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.count++;
  }

  resolve() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);

    gl.useProgram(this.resolveProgram);
    gl.uniform1f(this.scaleLoc, 1 / (this.count || 1));
    gl.uniform1i(this.accumLoc, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.accumTex);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    return this.canvas;
  }

  reset() {
    const gl = this.gl;
    if (this.fbo) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.viewport(0, 0, this.width, this.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    this.count = 0;
  }

  /** Free GL resources and release the WebGL context. Idempotent. */
  dispose() {
    const gl = this.gl;
    if (!gl) return;
    try {
      if (this.accumTex) gl.deleteTexture(this.accumTex);
      if (this.srcTex) gl.deleteTexture(this.srcTex);
      if (this.fbo) gl.deleteFramebuffer(this.fbo);
      // Force the context to be reclaimed rather than waiting for GC — browsers
      // cap the number of live WebGL contexts.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      /* context may already be lost */
    }
    this.gl = null;
    this.accumTex = null;
    this.fbo = null;
  }
}

export { GPUMotionBlur };
