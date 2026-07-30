// Type declarations for CCapture.

export type CaptureCanvas = HTMLCanvasElement | OffscreenCanvas;

export type VideoCodec = "avc" | "vp9" | "av1" | "vp8";
export type MotionBlurBackendName = "auto" | "gpu" | "cpu";
export type BufferMode = "webp" | "png" | "raw";

/** Constructor for a custom encoder (see FrameEncoder / BatchEncoder). */
export type EncoderConstructor = new (params: CCaptureParams) => FrameEncoder;

/** Maps capture time (seconds) to a media element's `currentTime` (seconds). */
export type MediaTimeMap = (captureSeconds: number) => number;

/** A media element with an optional capture→media time mapping. */
export interface MediaSpec {
  element: HTMLMediaElement;
  /** Callback mapping capture seconds → media currentTime. Overrides offset/rate. */
  time?: MediaTimeMap;
  /** Linear sugar: media starts this many seconds in. Default 0. */
  offset?: number;
  /** Linear sugar: media seconds advanced per capture second. Default 1. */
  rate?: number;
}

/** A `media` entry: a bare element, or an element plus a time mapping. */
export type MediaOption = HTMLMediaElement | MediaSpec;

/** Options accepted by CCapture / FrameWrap (and forwarded to encoders/TimeWarp). */
export interface CCaptureParams {
  /** Output format / registered encoder name. Default "mp4". */
  format?: string;
  /** Target framerate of the output. Default 60. */
  framerate?: number;
  /** 0–100; drives video bitrate and JPEG/WebP quality. Default 90. */
  quality?: number;
  /** Base filename for the download. Defaults to a generated id. */
  name?: string;
  /** Bring-your-own encoder — a class or ready instance; overrides `format`. */
  encoder?: FrameEncoder | EncoderConstructor;

  /** Sub-frames averaged per output frame; 1 = no blur. Default 1. */
  motionBlurFrames?: number;
  /** Motion-blur backend. Default "auto". */
  motionBlur?: MotionBlurBackendName;

  /** avc/vp9/av1/vp8; defaults per container. */
  codec?: VideoCodec;
  /** Bits/sec for video; 0 derives from resolution × quality. Default 0. */
  bitrate?: number;
  /** An AudioBuffer to encode and mux as an audio track (mp4/webm). */
  audio?: AudioBuffer | null;
  /** Audio bits/sec. Default 128000. */
  audioBitrate?: number;
  /** WebCodecs encoder-queue high-water mark (backpressure). Default 8. */
  maxQueueSize?: number;

  /** GIF palette size, 2–256. Default 256. */
  gifColors?: number;

  /** Auto-stop & save at this time (seconds); 0 = unlimited. Default 0. */
  timeLimit?: number;
  /** Auto-stop & save at this output-frame count; 0 = unlimited. Default 0. */
  frameLimit?: number;
  /** If > 0, download the capture in parts every N seconds. Default 0. */
  autoSaveTime?: number;
  /** Seconds to skip into the animation before the first frame. Default 0. */
  startTime?: number;
  /**
   * Video/audio element(s) to frame-step in lockstep with capture.
   *
   * A bare element uses media time == capture time (1:1 from zero). To drive an
   * element from your own timeline, pass `{ element, time }` with a
   * `(captureSeconds) => mediaSeconds` callback, or the linear sugar
   * `{ element, offset?, rate? }` (→ `offset + captureSeconds * rate`).
   */
  media?: MediaOption | MediaOption[] | null;
  /** Hook HTMLMediaElement (currentTime/play) to frame-step media. Default true. */
  hookMedia?: boolean;

  /** Warp Date.now + Date.prototype.getTime (breaks date math). Default true. */
  hookDate?: boolean;
  /** Also warp Date.prototype.valueOf, so `+new Date()` is warped. Default false. */
  hookValueOf?: boolean;
  /** Log internal steps. Default false. */
  verbose?: boolean;
  /** Show a small on-page capture-status widget. Default false. */
  display?: boolean;
  /** Inject a shared TimeWarp instead of creating one (CCapture only). */
  timewarp?: TimeWarp;

  // Batch-encoder options (BatchEncoder / GifskiEncoder):
  /** How frames are buffered during capture. Default "webp" ("png" for gif-hq). */
  bufferMode?: BufferMode;
  /** Quality for lossy WebP buffering, 0–1. Default 0.92. */
  bufferQuality?: number;

  // gifski (GifskiEncoder) options:
  /** Cap the GIF's longest side (px). Default 640. */
  gifMaxSize?: number;
  /** Explicit GIF width/height (overrides gifMaxSize). */
  gifWidth?: number;
  gifHeight?: number;
  /** A gifski encode function, or a module URL to import it from. */
  gifski?: (opts: unknown) => Promise<Uint8Array>;
  gifskiUrl?: string;

  /** Custom encoders may read further options. */
  [key: string]: unknown;
}

export type CaptureEvent = "start" | "frame" | "progress" | "save" | "stop" | "error";

/** Shared shape of both motion-blur backends. */
export interface MotionBlurBackend {
  canvas: CaptureCanvas;
  count: number;
  /** Present on the GPU backend. */
  gl?: WebGL2RenderingContext | null;
  add(source: CanvasImageSource): void;
  resolve(): CaptureCanvas;
  reset(): void;
  dispose?(): void;
}

// ---------- TimeWarp ----------

export interface TimeWarpParams {
  framerate?: number;
  startTime?: number;
  hookDate?: boolean;
  hookValueOf?: boolean;
  hookMedia?: boolean;
  verbose?: boolean;
}

export class TimeWarp {
  constructor(params?: TimeWarpParams);
  framerate: number;
  startTime: number;
  hookDate: boolean;
  hookValueOf: boolean;
  hookMedia: boolean;
  verbose: boolean;
  perfStart: number;
  dateStart: number;
  frameTime: number;
  readonly enabled: boolean;
  /** Milliseconds per frame (1000 / framerate). */
  readonly frameStep: number;
  /** Current virtual performance.now() value. */
  readonly time: number;
  start(): void;
  stop(): void;
  enable(): void;
  disable(): void;
  /** Advance the clock and dispatch callbacks (fire-and-forget media). */
  step(dt?: number): void;
  /** Like step(), but awaits media seeks before dispatching. */
  stepAsync(dt?: number): Promise<void>;
  /**
   * Register a media element to frame-step. Pass an optional `map` to drive its
   * `currentTime` from your own timeline: `currentTime = map(captureSeconds)`.
   * Called automatically (identity mapping) when code reads/writes `currentTime`.
   */
  addMedia(element: HTMLMediaElement, map?: MediaTimeMap): void;
  /** Seek all registered media to the current frame time and await it (no advance). */
  syncMedia(): Promise<void>;
}

/** The pristine native timing functions captured at load. */
export const originals: Record<string, unknown>;

// ---------- Encoders ----------

export class FrameEncoder {
  constructor(params: CCaptureParams);
  params: CCaptureParams;
  filename: string;
  extension: string;
  mimeType: string;
  frames: number;
  totalFrames: number;
  part: number;
  readonly name: string;
  on(event: string, handler: (...args: unknown[]) => void): this;
  emit(event: string, ...args: unknown[]): void;
  start(): Promise<void>;
  add(frame?: unknown): Promise<void>;
  stop(): Promise<void>;
  save(): Promise<Blob | null>;
  dispose(): Promise<void>;
}

export interface BatchEncodeContext {
  frameCount: number;
  width: number;
  height: number;
  framerate: number;
  getFrame(index: number): Promise<ImageData>;
}

export class BatchEncoder extends FrameEncoder {
  bufferMode: BufferMode;
  bufferQuality: number;
  buffer: unknown[];
  width: number;
  height: number;
  /** Implement this: turn all buffered frames into a Blob. */
  encodeAll(ctx: BatchEncodeContext): Promise<Blob | null>;
  /** Override to customize how a frame is buffered. */
  _store(canvas: CaptureCanvas): Promise<unknown>;
  /** Override to match _store. */
  _restore(token: unknown): Promise<ImageData>;
}

export class WebCodecsEncoder extends FrameEncoder {
  static isSupported(): boolean;
  container: "mp4" | "webm";
  codec: VideoCodec;
  /** Wait until the encoder queue drains below the high-water mark. */
  backpressure(): Promise<void>;
}

export class GIFEncoder extends FrameEncoder {
  maxColors: number;
  delay: number;
}

export class GifskiEncoder extends BatchEncoder {
  quality: number;
  gifMaxSize: number;
}

// ---------- Motion blur ----------

export class MotionBlur implements MotionBlurBackend {
  canvas: CaptureCanvas;
  count: number;
  add(source: CanvasImageSource): void;
  resolve(): CaptureCanvas;
  reset(): void;
  dispose(): void;
}

export class GPUMotionBlur implements MotionBlurBackend {
  static isSupported(): boolean;
  canvas: CaptureCanvas;
  count: number;
  gl: WebGL2RenderingContext | null;
  add(source: CanvasImageSource): void;
  resolve(): CaptureCanvas;
  reset(): void;
  dispose(): void;
}

export function createMotionBlur(
  source: CaptureCanvas,
  subframes: number,
  prefer?: MotionBlurBackendName
): MotionBlurBackend;

// ---------- Frame-accurate audio (offline) ----------

export interface AudioFrame {
  time: number;
  frequency: Uint8Array;
  waveform: Uint8Array;
}

export interface RenderAudioOptions {
  buffer?: AudioBuffer;
  url?: string;
  arrayBuffer?: ArrayBuffer;
  framerate?: number;
  frames?: number;
  startTime?: number;
  fftSize?: number;
  smoothing?: number;
}

/** Render audio offline and sample an AnalyserNode at each frame time. */
export function renderAudioFrames(opts?: RenderAudioOptions): Promise<AudioFrame[]>;

/** Yield a macrotask (keeps the tab responsive between frames in manual loops). */
export function nextTask(): Promise<void>;

// ---------- Deterministic video frames (WebCodecs) ----------

export interface VideoSourceOptions {
  /** A preloaded mp4box.js module (its default export). */
  mp4box?: unknown;
  /** URL to lazy-import mp4box.js from (default: a CDN ESM build). */
  mp4boxUrl?: string;
  /**
   * WebCodecs decoder acceleration. Defaults to "prefer-software" for
   * reliability (flaky H.264 hardware decoders can abort); set "prefer-hardware"
   * or "no-preference" to change it.
   */
  hardwareAcceleration?: "no-preference" | "prefer-software" | "prefer-hardware";
}

/** Frame-accurate video decoder: `frameAt(seconds)` → the exact decoded frame. */
export class VideoSource {
  readonly codec: string;
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  readonly frameCount: number;
  /**
   * The decoded frame at/or before `seconds`. Owned by the source — draw or
   * encode it immediately; do not close it (freed on GOP change / close()).
   */
  frameAt(seconds: number): Promise<VideoFrame | null>;
  /** Free all decoded frames. */
  close(): void;
}

/**
 * Create a frame-accurate {@link VideoSource} from an MP4 (URL / Blob /
 * ArrayBuffer). Requires WebCodecs `VideoDecoder`. Bypasses the `<video>`
 * element, so it's immune to the paused-seek "black frame" GPU quirk.
 */
export function createVideoSource(
  input: string | Blob | ArrayBuffer | ArrayBufferView,
  opts?: VideoSourceOptions
): Promise<VideoSource>;

// ---------- FrameWrap (capture only) ----------

export class FrameWrap {
  constructor(params?: CCaptureParams);
  static registerEncoder(name: string, EncoderClass: EncoderConstructor): typeof FrameWrap;
  static readonly formats: string[];
  params: CCaptureParams;
  encoder: FrameEncoder;
  subframes: number;
  frameStep: number;
  frameCount: number;
  intermediateFrameCount: number;
  capturing: boolean;
  saved: boolean;
  motionBlur: MotionBlurBackend | null;

  on(event: "frame", handler: (frame: number) => void): this;
  on(event: "progress", handler: (progress: number) => void): this;
  on(event: "save", handler: (blob: Blob) => void): this;
  on(event: "error", handler: (error: Error) => void): this;
  on(event: "start" | "stop", handler: () => void): this;
  on(event: string, handler: (...args: unknown[]) => void): this;
  emit(event: CaptureEvent | string, ...args: unknown[]): void;

  start(): Promise<void>;
  capture(canvas: CaptureCanvas): Promise<void>;
  stop(): Promise<void>;
  save(callback?: (blob: Blob) => void): Promise<Blob | null>;
  dispose(): Promise<void>;
}

/** The registered encoder classes, keyed by format name. */
export const encoders: Record<string, EncoderConstructor>;

// ---------- CCapture (the unified recorder) ----------

export class CCapture {
  constructor(params?: CCaptureParams);
  static registerEncoder(name: string, EncoderClass: EncoderConstructor): typeof CCapture;
  static readonly formats: string[];

  framewrap: FrameWrap;
  timewarp: TimeWarp;
  params: CCaptureParams;
  /** When true, capture() does not advance the clock (record()/manual step()). */
  manual: boolean;
  readonly capturing: boolean;
  readonly frameCount: number;
  readonly encoder: FrameEncoder;
  readonly motionBlur: MotionBlurBackend | null;

  on(event: "frame", handler: (frame: number) => void): this;
  on(event: "progress", handler: (progress: number) => void): this;
  on(event: "save", handler: (blob: Blob) => void): this;
  on(event: "error", handler: (error: Error) => void): this;
  on(event: "start" | "stop", handler: () => void): this;
  on(event: string, handler: (...args: unknown[]) => void): this;
  emit(event: CaptureEvent | string, ...args: unknown[]): void;

  start(): Promise<void>;
  /** Capture the just-drawn frame; auto-drives the loop. */
  capture(canvas: CaptureCanvas): Promise<void>;
  /** Advance the virtual clock by one sub-frame (manual mode). */
  step(): void;
  /** Headless flat loop; needs a frameLimit/timeLimit. Resolves to `saved`. */
  record(
    canvas: CaptureCanvas,
    render: (frame: number) => void | Promise<void>
  ): Promise<boolean>;
  stop(): Promise<void>;
  save(callback?: (blob: Blob) => void): Promise<Blob | null>;
  dispose(): Promise<void>;
}

export default CCapture;
