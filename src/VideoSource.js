// VideoSource — deterministic, frame-accurate video frames via WebCodecs.
//
// The `<video>` element is unreliable for frame-stepping: a paused, seeked video
// won't decode a drawable frame on some GPUs (drawImage/createImageBitmap come
// back black). This decodes the file ourselves — demux (mp4box.js) → WebCodecs
// VideoDecoder — so `frameAt(seconds)` always returns the exact frame, GPU quirks
// and all. MP4 only for now (H.264/H.265/AV1/VP9 in an MP4 container).
//
//   import { createVideoSource } from "ccapture.js/video-source";
//   const src = await createVideoSource("clip.mp4");
//   // in your render loop, on CCapture's warped clock:
//   const frame = await src.frameAt(offset + t * rate); // a VideoFrame
//   ctx.drawImage(frame, 0, 0);                          // or texImage2D
//   // frame is owned by the source — draw it now, don't close it.
//   src.close();                                         // when done

const DEFAULT_MP4BOX_URL = "https://cdn.jsdelivr.net/npm/mp4box@0.5.3/+esm";

// The real timers, captured at module load before TimeWarp may hook the globals,
// so the decode watchdog still fires while the virtual clock is paused mid-capture.
const realSetTimeout = (typeof globalThis !== "undefined" ? globalThis : this).setTimeout;
const realClearTimeout = (typeof globalThis !== "undefined" ? globalThis : this).clearTimeout;
const DECODE_TIMEOUT_MS = 15000;

/** Load an ArrayBuffer from a URL string, Blob, ArrayBuffer, or typed array. */
async function toArrayBuffer(input) {
  if (typeof input === "string") return await (await fetch(input)).arrayBuffer();
  if (input instanceof Blob) return await input.arrayBuffer();
  if (input instanceof ArrayBuffer) return input;
  if (ArrayBuffer.isView(input)) return input.buffer;
  throw new Error("createVideoSource: unsupported input (want URL, Blob, or ArrayBuffer)");
}

/** Pull the codec description (avcC/hvcC/vpcC/av1C) out of the sample table. */
function extractDescription(MP4Box, file, trackId) {
  const trak = file.getTrackById(trackId);
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    if (box) {
      const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8); // strip the 8-byte box header
    }
  }
  return undefined; // some codecs (e.g. VP9) don't need one
}

/** Demux the first video track into {config, samples[]} (samples in decode order). */
function demux(MP4Box, buffer) {
  return new Promise((resolve, reject) => {
    const file = MP4Box.createFile();
    const samples = [];
    let track = null;

    file.onError = (e) => reject(new Error("mp4box: " + e));
    file.onReady = (info) => {
      track = info.videoTracks[0];
      if (!track) return reject(new Error("createVideoSource: no video track in file"));
      file.setExtractionOptions(track.id, null, { nbSamples: Infinity });
      file.start();
    };
    file.onSamples = (_id, _user, list) => {
      for (const s of list) {
        samples.push({
          // microseconds — WebCodecs' unit
          timestamp: Math.round((s.cts / s.timescale) * 1e6),
          duration: Math.round((s.duration / s.timescale) * 1e6),
          key: !!s.is_sync,
          data: s.data.slice(), // copy: mp4box may reuse the underlying buffer
        });
      }
      if (track && samples.length >= track.nb_samples) {
        resolve({
          samples,
          config: {
            codec: track.codec,
            codedWidth: track.video.width,
            codedHeight: track.video.height,
            description: extractDescription(MP4Box, file, track.id),
          },
          width: track.video.width,
          height: track.video.height,
          duration: track.movie_duration / track.movie_timescale || track.samples_duration / track.timescale,
        });
      }
    };

    const ab = buffer.slice(0);
    ab.fileStart = 0;
    file.appendBuffer(ab);
    file.flush();
  });
}

class VideoSource {
  #config;
  #samples; // decode order, each { timestamp, duration, key, data }
  #byTime; // presentation-sorted [{ timestamp, index }]
  #keyframes; // decode indices where key === true (ascending)
  #gopStart = -1; // decode index of the currently-cached GOP's keyframe
  #frames = new Map(); // timestamp(us) -> VideoFrame, for the cached GOP
  #decoder = null; // reused across GOPs (creating one per GOP churns HW decoders)
  #reject = null; // rejects the in-flight decode on a decoder error
  #lock = Promise.resolve(); // serializes frameAt so decodes never overlap

  constructor({ samples, config, width, height, duration }) {
    this.#samples = samples;
    this.#config = config;
    this.width = width;
    this.height = height;
    this.duration = duration;
    this.frameCount = samples.length;
    this.codec = config.codec;

    this.#keyframes = [];
    for (let i = 0; i < samples.length; i++) if (samples[i].key) this.#keyframes.push(i);
    if (this.#keyframes.length === 0) this.#keyframes.push(0); // treat frame 0 as a sync point

    this.#byTime = samples
      .map((s, index) => ({ timestamp: s.timestamp, index }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Decode index → the keyframe (decode index) at or before it. */
  #keyframeFor(decodeIndex) {
    let kf = this.#keyframes[0];
    for (const k of this.#keyframes) {
      if (k <= decodeIndex) kf = k;
      else break;
    }
    return kf;
  }

  /** Decode index of the keyframe that starts the *next* GOP (or samples.length). */
  #nextKeyframeAfter(kf) {
    for (const k of this.#keyframes) if (k > kf) return k;
    return this.#samples.length;
  }

  /** Largest sample (by presentation time) with timestamp <= t_us; else the first. */
  #sampleAtTime(t_us) {
    const arr = this.#byTime;
    let lo = 0, hi = arr.length - 1, best = arr[0];
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].timestamp <= t_us) { best = arr[mid]; lo = mid + 1; }
      else hi = mid - 1;
    }
    return best;
  }

  #closeFrames() {
    for (const f of this.#frames.values()) f.close();
    this.#frames.clear();
  }

  /** Create the (reused) decoder on demand; a keyframe re-inits its state. */
  #ensureDecoder() {
    if (this.#decoder && this.#decoder.state !== "closed") return;
    this.#decoder = new VideoDecoder({
      output: (frame) => this.#frames.set(frame.timestamp, frame),
      error: (e) => { const r = this.#reject; this.#reject = null; if (r) r(e); },
    });
    this.#decoder.configure(this.#config);
  }

  /**
   * Decode one GOP [start..end] (decode order) and cache the resulting frames.
   * Reuses a single decoder — each GOP begins with a keyframe, which resets the
   * decoder's prediction, so no reconfigure/close is needed between GOPs.
   */
  async #decodeGop(start, end) {
    this.#closeFrames();
    this.#ensureDecoder();
    const decoder = this.#decoder;
    try {
      await new Promise((resolve, reject) => {
        // Watchdog: a wedged flush must never hang forever (it would stick the
        // frameAt serialization lock and freeze every later call). Uses the real
        // setTimeout so it fires even while the virtual clock is paused.
        const timer = realSetTimeout(
          () => reject(new Error(`VideoSource: decode timed out (GOP ${start}..${end}, codec ${this.codec})`)),
          DECODE_TIMEOUT_MS
        );
        const settle = (fn) => (v) => { realClearTimeout(timer); fn(v); };
        const ok = settle(resolve);
        const fail = settle(reject);
        this.#reject = fail; // decoder error callback rejects here
        try {
          for (let i = start; i <= end; i++) {
            const s = this.#samples[i];
            decoder.decode(new EncodedVideoChunk({
              type: s.key ? "key" : "delta",
              timestamp: s.timestamp,
              duration: s.duration,
              data: s.data,
            }));
          }
          decoder.flush().then(ok, fail);
        } catch (e) { fail(e); }
      });
    } catch (e) {
      // A decoder error/timeout leaves it unusable — drop it so the next call
      // rebuilds, and surface the failure instead of hanging.
      try { if (this.#decoder && this.#decoder.state !== "closed") this.#decoder.close(); } catch {}
      this.#decoder = null;
      throw e;
    } finally {
      this.#reject = null;
    }
    this.#gopStart = start;
  }

  /**
   * Return the decoded frame whose presentation time is nearest at/or before
   * `seconds`. The returned VideoFrame is owned by the source: draw/encode it
   * immediately and do NOT close it (it's freed when the GOP changes or on
   * close()). Requesting a frame in a different GOP re-decodes from its keyframe.
   */
  async frameAt(seconds) {
    // Serialize: two concurrent decodes on the shared decoder would abort each
    // other's flush ("Aborted due to close()"). Each call waits its turn.
    const run = this.#lock.then(() => this.#frameAtInner(seconds));
    this.#lock = run.then(() => {}, () => {}); // never let a rejection break the chain
    return run;
  }

  async #frameAtInner(seconds) {
    const t_us = Math.max(0, seconds) * 1e6;
    const target = this.#sampleAtTime(t_us);
    const kf = this.#keyframeFor(target.index);
    if (kf !== this.#gopStart || this.#frames.size === 0) {
      await this.#decodeGop(kf, this.#nextKeyframeAfter(kf) - 1);
    }
    // Nearest cached frame at/or before the target timestamp.
    let best = null;
    for (const [ts, frame] of this.#frames) {
      if (ts <= target.timestamp && (!best || ts > best.ts)) best = { ts, frame };
    }
    return (best || { frame: this.#frames.get(target.timestamp) }).frame || null;
  }

  /** Free all decoded frames and the decoder. Call when finished. */
  close() {
    this.#closeFrames();
    this.#gopStart = -1;
    try { if (this.#decoder && this.#decoder.state !== "closed") this.#decoder.close(); } catch {}
    this.#decoder = null;
  }
}

/**
 * Create a frame-accurate {@link VideoSource} from an MP4 (URL / Blob /
 * ArrayBuffer). Requires WebCodecs `VideoDecoder`. mp4box.js is lazy-loaded from
 * a CDN by default; pass `mp4box` (the module) or `mp4boxUrl` to vendor it.
 */
export async function createVideoSource(input, opts = {}) {
  if (typeof VideoDecoder === "undefined") {
    throw new Error("createVideoSource: WebCodecs VideoDecoder is not available in this browser");
  }
  const MP4Box = opts.mp4box || (await import(/* @vite-ignore */ opts.mp4boxUrl || DEFAULT_MP4BOX_URL)).default;
  const buffer = await toArrayBuffer(input);
  const demuxed = demux(MP4Box, buffer);
  const data = await demuxed;

  // Prefer a SOFTWARE decoder by default: the whole point of this path is
  // reliability, and flaky H.264 hardware decoders (the same ones that give
  // black frames for a paused <video>) also abort under WebCodecs. Software
  // decode is deterministic and fast enough for non-realtime capture. Override
  // with { hardwareAcceleration: "prefer-hardware" | "no-preference" }.
  data.config.hardwareAcceleration = opts.hardwareAcceleration || "prefer-software";

  // Fail early with a clear message if the browser can't decode this codec.
  let support = await VideoDecoder.isConfigSupported(data.config).catch(() => null);
  if ((!support || !support.supported) && data.config.hardwareAcceleration !== "no-preference") {
    // Some browsers don't advertise a software path via isConfigSupported even
    // when one exists — retry without the preference before giving up.
    data.config.hardwareAcceleration = "no-preference";
    support = await VideoDecoder.isConfigSupported(data.config).catch(() => null);
  }
  if (!support || !support.supported) {
    throw new Error(`createVideoSource: codec "${data.config.codec}" is not decodable here`);
  }
  return new VideoSource(data);
}

export { VideoSource };
