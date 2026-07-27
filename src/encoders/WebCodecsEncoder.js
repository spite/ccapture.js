import { FrameEncoder } from "./FrameEncoder.js";
import {
  Muxer as MP4Muxer,
  ArrayBufferTarget as MP4Target,
} from "../third_party/mp4-muxer.mjs";
import {
  Muxer as WebMMuxer,
  ArrayBufferTarget as WebMTarget,
} from "../third_party/webm-muxer.mjs";

// A real timer, captured at load (before TimeWarp can hook setTimeout), so
// backpressure waits on the real clock rather than the frozen virtual one.
const rawSetTimeout = globalThis.setTimeout.bind(globalThis);

// Codec candidates per family, tried in order via isConfigSupported so we adapt
// to what the browser/hardware actually accepts at the given resolution.
const CANDIDATES = {
  avc: ["avc1.640034", "avc1.4d0034", "avc1.640028", "avc1.42e01f"],
  vp9: ["vp09.00.10.08", "vp09.00.50.08"],
  av1: ["av01.0.08M.08", "av01.0.04M.08"],
  vp8: ["vp8"],
};

// Muxer-level codec identifiers.
const MP4_CODEC = { avc: "avc", av1: "av1", vp9: "vp9" };
const WEBM_CODEC = { vp9: "V_VP9", vp8: "V_VP8", av1: "V_AV1" };

// Audio codecs to try per container (WebCodecs AudioEncoder string + muxer id).
// mp4 prefers AAC (most compatible) but falls back to Opus where AAC encode is
// missing (e.g. plain Chromium); webm uses Opus.
const AUDIO = {
  mp4: [
    { encoder: "mp4a.40.2", muxer: "aac" },
    { encoder: "opus", muxer: "opus" },
  ],
  webm: [{ encoder: "opus", muxer: "A_OPUS" }],
};

// Codec families to try per container when none is explicitly requested. mp4
// falls back avc -> av1 so it still works where H.264 encoding is missing (e.g.
// plain Chromium); webm tries vp9 -> vp8 -> av1.
const MP4_FAMILIES = ["avc", "av1"];
const WEBM_FAMILIES = ["vp9", "vp8", "av1"];

/**
 * Modern encoder using the WebCodecs VideoEncoder (hardware-accelerated where
 * available), muxed to MP4 or WebM in memory. Preferred over the legacy
 * webm-writer path. Exposes `backpressure()` so FrameWrap can throttle the
 * capture loop to the encoder's real throughput without unbounded memory.
 */
class WebCodecsEncoder extends FrameEncoder {
  constructor(params) {
    super(params);

    this.container = params.format === "mp4" ? "mp4" : "webm";
    this.extension = this.container;
    this.mimeType = this.container === "mp4" ? "video/mp4" : "video/webm";

    this.explicitCodec = params.codec || null; // if set, don't try other families
    this.codec = this.explicitCodec || (this.container === "mp4" ? "avc" : "vp9");
    this.bitrate = params.bitrate || 0; // 0 = derive from resolution/quality
    this.maxQueueSize = params.maxQueueSize ?? 8;

    // Optional audio track: an AudioBuffer to encode and mux alongside video.
    this.audio = params.audio || null;
    this.audioBitrate = params.audioBitrate || 128000;

    this.videoEncoder = null;
    this.audioEncoder = null;
    this.audioEnabled = false;
    this.muxer = null;
    this.target = null;
    this.configured = false;
    this.encodeError = null;
    this.frameIndex = 0;
    this.keyInterval = Math.max(1, Math.round((params.framerate || 60) * 2));
    this.savedBlob = null;
    this.fitCanvas = null;
    this.fitCtx = null;
  }

  static isSupported() {
    return (
      typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined"
    );
  }

  async start() {
    if (!WebCodecsEncoder.isSupported()) {
      throw new Error("WebCodecs (VideoEncoder) is not available in this browser.");
    }
    await super.start();
    this.frameIndex = 0;
    this.encodeError = null;
    await this.dispose();
  }

  #bitrateFor(width, height) {
    if (this.bitrate) return this.bitrate;
    const bpp = 0.05 + 0.15 * (this.params.quality / 100); // bits per pixel/frame
    return Math.round(width * height * this.params.framerate * bpp);
  }

  // Some browsers (Firefox for H.264) report isConfigSupported: true but their
  // encoder never emits a decoderConfig, which the mp4 muxer requires. Probe by
  // encoding one keyframe and checking a decoderConfig actually arrives.
  async #deliversConfig(config) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v) => {
        if (settled) return;
        settled = true;
        try {
          enc.close();
        } catch {}
        resolve(v);
      };
      let enc;
      try {
        enc = new VideoEncoder({
          output: (chunk, meta) => finish(!!(meta && meta.decoderConfig)),
          error: () => finish(false),
        });
        enc.configure(config);
        const c =
          typeof OffscreenCanvas !== "undefined"
            ? new OffscreenCanvas(config.width, config.height)
            : Object.assign(document.createElement("canvas"), {
                width: config.width,
                height: config.height,
              });
        c.getContext("2d").fillRect(0, 0, 2, 2);
        const frame = new VideoFrame(c, { timestamp: 0 });
        enc.encode(frame, { keyFrame: true });
        frame.close();
        enc.flush().then(() => finish(false)).catch(() => finish(false));
      } catch {
        finish(false);
      }
    });
  }

  async #configure(sourceWidth, sourceHeight) {
    // The coded size is fixed for the whole stream (a VideoEncoder can't change
    // dimensions mid-stream). H.264/VP9/AV1 with 4:2:0 chroma also require even
    // dimensions, so we round the first frame's size down to even. Any later
    // frame whose size differs (odd source, or a mid-capture canvas resize) is
    // fitted into this coded size in add(); matching frames stay copy-free.
    const width = sourceWidth - (sourceWidth % 2);
    const height = sourceHeight - (sourceHeight % 2);
    this.codedWidth = width;
    this.codedHeight = height;
    this.frameIndex = 0; // restart timestamps per part (multipart)
    this.savedBlob = null;

    const bitrate = this.#bitrateFor(width, height);

    // Try each codec family (avc->av1 for mp4, vp9->vp8->av1 for webm), unless a
    // codec was explicitly requested, and each family's candidate strings.
    const families = this.explicitCodec
      ? [this.explicitCodec]
      : this.container === "mp4"
      ? MP4_FAMILIES
      : WEBM_FAMILIES;

    let config = null;
    let family = null;
    outer: for (const fam of families) {
      for (const codec of CANDIDATES[fam] || []) {
        const attempt = { codec, width, height, bitrate, framerate: this.params.framerate };
        // For an mp4 container, ask the encoder for a length-prefixed bitstream
        // with a decoder config (avcC/hvcC). Chromium does this by default;
        // Firefox does not, which leaves mp4-muxer without a decoderConfig.
        if (this.container === "mp4") {
          if (codec.startsWith("avc")) attempt.avc = { format: "avc" };
          else if (codec.startsWith("hvc") || codec.startsWith("hev"))
            attempt.hevc = { format: "hevc" };
        }
        try {
          const support = await VideoEncoder.isConfigSupported(attempt);
          if (!support || !support.supported) continue;
          // isConfigSupported can lie (Firefox reports H.264 support but its
          // encoder yields no decoderConfig for mp4). For mp4, verify a real
          // encode actually delivers the config the muxer needs.
          if (this.container === "mp4" && !(await this.#deliversConfig(attempt))) {
            continue;
          }
          config = attempt;
          family = fam;
          break outer;
        } catch {
          /* try next candidate */
        }
      }
    }
    if (!config) {
      const hint = this.container === "mp4" ? ' Try format "webm".' : "";
      throw new Error(
        `No usable VideoEncoder config for ${this.container} (tried ${families.join(
          "/"
        )}) at ${width}x${height} in this browser.${hint}`
      );
    }
    this.codec = family; // the family we actually got
    this.encoderConfig = config;

    // Decide whether we can add an audio track: try each candidate codec and
    // verify the AudioEncoder actually supports it.
    this.audioEnabled = false;
    let audioConfig = null;
    let audioMuxerCodec = null;
    if (this.audio && typeof AudioEncoder !== "undefined") {
      for (const cand of AUDIO[this.container]) {
        const conf = {
          codec: cand.encoder,
          sampleRate: this.audio.sampleRate,
          numberOfChannels: this.audio.numberOfChannels,
          bitrate: this.audioBitrate,
        };
        try {
          const sup = await AudioEncoder.isConfigSupported(conf);
          if (sup && sup.supported) {
            audioConfig = conf;
            audioMuxerCodec = cand.muxer;
            this.audioEnabled = true;
            break;
          }
        } catch {
          /* try next audio codec */
        }
      }
      if (!this.audioEnabled) {
        console.warn("[WebCodecs] no supported audio encoder here; encoding video only.");
      }
    }

    const audioTrack = this.audioEnabled
      ? {
          codec: audioMuxerCodec,
          sampleRate: this.audio.sampleRate,
          numberOfChannels: this.audio.numberOfChannels,
        }
      : undefined;

    if (this.container === "mp4") {
      this.target = new MP4Target();
      this.muxer = new MP4Muxer({
        target: this.target,
        video: { codec: MP4_CODEC[family], width, height },
        ...(audioTrack ? { audio: audioTrack } : {}),
        fastStart: "in-memory",
      });
    } else {
      this.target = new WebMTarget();
      this.muxer = new WebMMuxer({
        target: this.target,
        video: { codec: WEBM_CODEC[family], width, height },
        ...(audioTrack ? { audio: audioTrack } : {}),
      });
    }

    this.videoEncoder = new VideoEncoder({
      output: (chunk, meta) => this.muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        this.encodeError = e;
        console.error("[WebCodecs] encoder error:", e);
      },
    });
    this.videoEncoder.configure(config);

    if (this.audioEnabled) {
      this.audioEncoder = new AudioEncoder({
        output: (chunk, meta) => this.muxer.addAudioChunk(chunk, meta),
        error: (e) => {
          this.encodeError = e;
          console.error("[WebCodecs] audio encoder error:", e);
        },
      });
      this.audioEncoder.configure(audioConfig);
    }

    this.configured = true;
  }

  // Encode the audio buffer (trimmed to the captured video length) in one pass.
  #encodeAudio() {
    const buf = this.audio;
    const sr = buf.sampleRate;
    const ch = buf.numberOfChannels;
    const videoSeconds = this.frameIndex / this.params.framerate;
    const total = Math.min(buf.length, Math.ceil(videoSeconds * sr));
    const channels = [];
    for (let c = 0; c < ch; c++) channels.push(buf.getChannelData(c));

    const block = 4096;
    for (let off = 0; off < total; off += block) {
      const frames = Math.min(block, total - off);
      const planar = new Float32Array(frames * ch); // f32-planar layout
      for (let c = 0; c < ch; c++) {
        planar.set(channels[c].subarray(off, off + frames), c * frames);
      }
      const data = new AudioData({
        format: "f32-planar",
        sampleRate: sr,
        numberOfFrames: frames,
        numberOfChannels: ch,
        timestamp: Math.round((off / sr) * 1e6),
        data: planar,
      });
      this.audioEncoder.encode(data);
      data.close();
    }
  }

  #fit(canvas) {
    // Return a canvas of exactly the coded size. If the source already matches,
    // use it directly (no copy); otherwise draw it into a reused fit canvas.
    if (canvas.width === this.codedWidth && canvas.height === this.codedHeight) {
      return canvas;
    }
    if (!this.fitCanvas) {
      this.fitCanvas =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(this.codedWidth, this.codedHeight)
          : Object.assign(document.createElement("canvas"), {
              width: this.codedWidth,
              height: this.codedHeight,
            });
      this.fitCtx = this.fitCanvas.getContext("2d");
    }
    this.fitCtx.clearRect(0, 0, this.codedWidth, this.codedHeight);
    this.fitCtx.drawImage(canvas, 0, 0); // crops/letterboxes from the top-left
    return this.fitCanvas;
  }

  async add(canvas) {
    if (this.encodeError) throw this.encodeError;
    if (!this.configured) await this.#configure(canvas.width, canvas.height);

    const source = this.#fit(canvas);
    const timestamp = Math.round((this.frameIndex * 1e6) / this.params.framerate);
    const duration = Math.round(1e6 / this.params.framerate);
    const frame = new VideoFrame(source, { timestamp, duration });
    const keyFrame = this.frameIndex % this.keyInterval === 0;
    this.videoEncoder.encode(frame, { keyFrame });
    frame.close();

    this.frameIndex++;
    await super.add();
  }

  /** Wait until the encoder queue drains below the high-water mark. */
  async backpressure() {
    const enc = this.videoEncoder;
    if (!enc) return;
    while (enc.encodeQueueSize > this.maxQueueSize) {
      if (this.encodeError) return;
      await new Promise((resolve) => rawSetTimeout(resolve, 0));
    }
  }

  async save() {
    if (this.savedBlob) return this.savedBlob; // idempotent: finalize once
    if (!this.frames || !this.videoEncoder) return null;
    await this.videoEncoder.flush();
    if (this.audioEnabled && this.audioEncoder) {
      this.#encodeAudio();
      await this.audioEncoder.flush();
    }
    if (this.encodeError) throw this.encodeError;
    try {
      this.muxer.finalize();
    } catch (e) {
      throw new Error(
        `${this.container} muxing failed — this browser's WebCodecs likely didn't ` +
          `provide a decoder config for "${this.codec}". Try format "webm". (${e.message})`
      );
    }
    this.savedBlob = new Blob([this.target.buffer], { type: this.mimeType });
    return this.savedBlob;
  }

  async dispose() {
    for (const enc of [this.videoEncoder, this.audioEncoder]) {
      if (enc && enc.state !== "closed") {
        try {
          enc.close();
        } catch {
          /* already closed */
        }
      }
    }
    this.videoEncoder = null;
    this.audioEncoder = null;
    this.audioEnabled = false;
    this.muxer = null;
    this.target = null;
    this.configured = false;
    this.savedBlob = null;
    this.fitCanvas = null;
    this.fitCtx = null;
  }

  async stop() {
    await super.stop();
  }
}

export { WebCodecsEncoder };
