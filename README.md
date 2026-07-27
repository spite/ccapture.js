# CCapture

Capture canvas-based animations at a **fixed framerate**, with motion blur and
modern encoders — a ground-up rewrite of [CCapture.js](https://github.com/spite/ccapture.js)
(ES modules, WebCodecs, GPU motion blur, `async`/`await`).

Your animation renders as fast (or as slowly) as it needs to; CCapture lies to
it about what time it is, so the exported video is perfectly smooth at exactly
the framerate you asked for — 30, 60, 240, whatever. Record a 4K frame that takes
two seconds to draw and still get a flawless 60fps file.

```js
import CCapture from "ccapture.js";

const capturer = new CCapture({ format: "mp4", framerate: 60, timeLimit: 5 });
capturer.start();

function render() {
  requestAnimationFrame(render);      // your normal loop
  drawMyScene();                      // draws using performance.now() / rAF time
  capturer.capture(canvas);           // ← the only line you add
}
render();
```

That's it. After 5 seconds an `.mp4` downloads. No `await`, no restructuring.

`CCapture` is the unified, plug-and-play recorder. It's composed of two pieces
you can also use on their own: **`FrameWrap`** (canvas capture — motion blur +
encoding) and **`TimeWarp`** (the virtual clock).

---

## Table of contents

- [How it works](#how-it-works)
- [Install](#install)
- [The least-intrusive API](#the-least-intrusive-api)
- [Adding it to an existing sketch](#adding-it-to-an-existing-sketch)
- [Options](#options)
- [Formats & encoders](#formats--encoders)
- [Custom encoders](#custom-encoders)
- [Motion blur](#motion-blur)
- [Methods & events](#methods--events)
- [Recipes](#recipes)
- [Using TimeWarp on its own](#using-timewarp-on-its-own)
- [Using FrameWrap on its own](#using-framewrap-on-its-own)
- [The `hookDate` trade-off](#the-hookdate-trade-off)
- [Migrating from CCapture 1.x](#migrating-from-ccapture-1x)
- [Browser support & caveats](#browser-support--caveats)
- [Examples](#examples)
- [License](#license)

---

## How it works

The idea (à la [ryg's kkapture](http://www.farb-rausch.de/~fg/kkapture/)) is to
replace the browser's notion of time with a **virtual clock** that only advances
one fixed step per captured frame. Anything that derives motion from elapsed
time then steps deterministically, decoupled from wall-clock.

The library is three composable pieces:

- **`TimeWarp`** — owns time. Hooks `performance.now`, `requestAnimationFrame`,
  `setTimeout`/`setInterval`, `Date`, and media `currentTime`, and advances a
  virtual clock on demand. Knows nothing about canvases.
- **`FrameWrap`** — owns capture. Takes already-drawn canvas frames, applies
  motion blur, enforces frame/time limits, and feeds a pluggable encoder. Knows
  nothing about time.
- **`CCapture`** — composes the two and drives them: the plug-and-play recorder.

Because `requestAnimationFrame` is hooked during capture, your render loop only
advances when `CCapture.capture()` flushes it — so it paces the whole thing, as
fast as your machine can draw and encode, with no wall-clock throttle.

Use `CCapture` for the normal "record a live animation" case; reach for the
halves directly when you only need one (timing without capture, or encoding
frames you produce yourself without touching the browser clock).

---

## Install

```bash
npm install ccapture.js
```

```js
import CCapture from "ccapture.js";
// or: import { CCapture, FrameWrap, TimeWarp } from "ccapture.js";
```

Or use it straight from source as native ES modules (no build step) — point at
`src/index.js` and serve over HTTP.

Ships with **TypeScript declarations** (`.d.ts`) — full autocomplete and
type-checking out of the box, no `@types` package needed.

### Script tag (no build, no bundler)

A UMD/IIFE global build is included for classic `<script>` use — the whole API
hangs off `window.CCapture`:

```html
<script src="https://cdn.jsdelivr.net/npm/ccapture.js@2/build/ccapture.umd.min.js"></script>
<script>
  const capturer = new CCapture({ format: "mp4", framerate: 60, timeLimit: 5 });
  // CCapture.FrameWrap, CCapture.TimeWarp, CCapture.createMotionBlur, … also here
</script>
```

Build it yourself with `npm run build` (outputs `build/ccapture.umd[.min].js`).

---

## The least-intrusive API

The common case is a single `capture(canvas)` call inside your existing loop:

```js
const capturer = new CCapture({ format: "mp4", framerate: 60, timeLimit: 5 });
capturer.start();

function render() {
  requestAnimationFrame(render);
  // draw using performance.now() (warped) or the rAF timestamp
  capturer.capture(canvas);
}
render();
```

Notes:
- Set a `timeLimit` or `frameLimit` and it stops and saves itself. Otherwise call
  `capturer.stop()` then `capturer.save()` when you're done.
- Kick your loop once (`render()`), or make sure it's already running, right after
  `start()` — after that, `capture()` drives it.
- The frame you pass to `capture()` should already be drawn. `capture()` is
  `async` but you don't need to `await` it.

---

## Adding it to an existing sketch

Three steps, whatever you're using: **(1)** make a `CCapture`, **(2)** `start()`
it, **(3)** call `capture(yourCanvas)` once per frame in your loop. Drive motion
from `performance.now()` / the rAF timestamp / `millis()` (all warped during
capture) rather than fixed per-frame increments.

**three.js** — pass the renderer's canvas:
```js
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
  capturer.capture(renderer.domElement);
}
```

**p5.js** — p5 owns the loop, so drive it with `redraw()` while capturing (see
the [p5 example](examples/p5/)):
```js
capturer.on("stop", () => loop());        // resume live preview when done
await capturer.start();
noLoop();
(function tick() {
  if (!capturer.capturing) return;
  requestAnimationFrame(tick);
  redraw();                                // your draw() on the warped clock
  capturer.capture(document.querySelector("canvas"));
})();
```
Global-mode p5 users can drop in the UMD build (`window.CCapture`) with two
`<script>` tags instead of importing.

**Plain canvas / WebGL / WebGPU** — same as the top example; pass your
`<canvas>`. WebGPU canvases capture fine (WebCodecs reads them directly); GPU
motion blur currently needs WebGL2, so a WebGPU source uses the CPU blur backend.

---

## Options

All options are passed to the `CCapture` constructor (capture options go to its
`FrameWrap`, timing options to its `TimeWarp`). Defaults shown.

| Option | Default | Description |
|---|---|---|
| `format` | `"mp4"` | `mp4`, `webm`, `webm-legacy`, `png`, `jpg`, `webp`. |
| `framerate` | `60` | Target framerate of the output. |
| `quality` | `90` | 0–100. Drives video bitrate and JPEG/WebP quality (PNG ignores it). |
| `name` | *(guid)* | Base filename for the download. |
| `gifColors` | `256` | GIF palette size (2–256). |
| `codec` | *(per container)* | `avc` / `vp9` / `av1` / `vp8`. Default `avc` for mp4, `vp9` for webm. |
| `bitrate` | `0` | Bits/sec for video. `0` derives it from resolution × quality. |
| `audio` | `null` | An `AudioBuffer` to encode + mux as an audio track (mp4/webm). |
| `audioBitrate` | `128000` | Audio bits/sec. |
| `maxQueueSize` | `8` | WebCodecs encoder-queue high-water mark (backpressure). |
| `motionBlurFrames` | `1` | Sub-frames averaged per output frame. `1` = no blur. |
| `motionBlur` | `"auto"` | Blur backend: `auto` / `gpu` / `cpu`. |
| `timeLimit` | `0` | Seconds; auto-stops & saves at this mark. `0` = unlimited. |
| `frameLimit` | `0` | Output frames; auto-stops & saves at this count. `0` = unlimited. |
| `autoSaveTime` | `0` | Seconds; if `>0`, downloads the capture in parts periodically. |
| `startTime` | `0` | Seconds to skip into the animation before the first frame. |
| `media` | `null` | A `<video>`/`<audio>` element (or array) to frame-step. See [capturing video](#capturing-a-video-or-audio-element). |
| `hookMedia` | `true` | Hook `HTMLMediaElement` (`currentTime`/`play`) to frame-step media. |
| `hookDate` | `true` | Warp `Date.now` + `Date.prototype.getTime`. See [the trade-off](#the-hookdate-trade-off). |
| `hookValueOf` | `false` | Also warp `Date.prototype.valueOf`, so `+new Date()` is warped (needs `hookDate`). |
| `display` | `false` | Show a small on-page capture-status widget. |
| `verbose` | `false` | Log internal steps to the console. |
| `timewarp` | *(created)* | Inject a shared `TimeWarp` instance instead of creating one. |

---

## Formats & encoders

| Format | Output | Encoder |
|---|---|---|
| `mp4` | `.mp4` (H.264/AV1) | **WebCodecs** `VideoEncoder` + mp4 muxer |
| `webm` | `.webm` (VP9/VP8/AV1) | **WebCodecs**; falls back to the legacy writer if unavailable |
| `webm-legacy` | `.webm` | webm-writer-js (WebP frames; Chromium-only) |
| `gif` | `.gif` | [gifenc](https://github.com/mattdesl/gifenc) (256-color, CPU) |
| `png` / `jpg` / `webp` | `.tar` of images | `canvas.toBlob` packed into a TAR |

GIF is 256-color and palette-quantized (tune with `gifColors`), so it needs a
CPU readback per frame and its timing is coarse (delays are whole centiseconds,
so 60fps plays back at ~50fps). Prefer a video format unless you specifically
need a GIF. Need your own format? See [Custom encoders](#custom-encoders).

**WebCodecs is the default and preferred path** — it's hardware-accelerated and
back-pressured, so you can run flat-out with bounded memory. Codec strings are
negotiated at runtime via `VideoEncoder.isConfigSupported`, and odd/resized
frames are automatically fitted to a valid even-dimension coded size.

If a browser lacks WebCodecs, `webm` transparently falls back to the legacy
writer; `mp4` throws a clear error (switch to `webm`).

---

## Custom encoders

An encoder is just an object with a small interface, so you can wrap anything — a
WASM codec, a server upload, APNG, whatever. There are two base classes for the
two kinds of encoder.

### Frame-by-frame encoders — `FrameEncoder`

For codecs that take one frame at a time (WebCodecs, image sequences, GIF via
gifenc). Extend `FrameEncoder` for free filename, multipart-autosave, and event
handling:

```js
import { FrameEncoder } from "ccapture.js";

class MyEncoder extends FrameEncoder {
  constructor(params) {
    super(params);
    this.extension = "bin";              // download filename extension
    this.mimeType = "application/octet-stream";
  }
  async start() { await super.start(); /* init */ }
  async add(canvas) { /* consume this frame */ await super.add(); }
  async save() { return new Blob([/* … */], { type: this.mimeType }); } // or null
  async dispose() { /* free resources */ }
  // optional: async backpressure() {}   // FrameWrap awaits this before each frame
  // (this.emit("progress", 0..1) bubbles up as the "progress" event)
}
```

### Batch encoders — `BatchEncoder`

For libraries that need *all* frames at once (e.g. gifski). `BatchEncoder` does
the buffering for you — frames are stored compressed during capture
(`bufferMode: "webp" | "png" | "raw"`) to keep memory bounded, then handed back
at save time. You implement one method:

```js
import { BatchEncoder } from "ccapture.js";

class MyBatchEncoder extends BatchEncoder {
  constructor(params) {
    super(params);
    this.extension = "gif";
    this.mimeType = "image/gif";
  }
  async encodeAll({ frameCount, width, height, framerate, getFrame }) {
    const frames = [];
    for (let i = 0; i < frameCount; i++) {
      frames.push(await getFrame(i));            // decoded ImageData, on demand
      this.emit("progress", (i + 1) / frameCount);
    }
    const bytes = await myBatchLib.encode({ frames, width, height, fps: framerate });
    return new Blob([bytes], { type: this.mimeType });
  }
}
```

### Registering / using either kind

```js
// Pass directly (class or ready instance) — overrides `format`:
new CCapture({ encoder: MyEncoder });
new CCapture({ encoder: new MyEncoder(params) });

// Or register a named format (great for plugins):
CCapture.registerEncoder("mine", MyEncoder); // also on FrameWrap
new CCapture({ format: "mine" });

CCapture.formats; // → all registered format names
```

The built-in `GIFEncoder` (frame-by-frame) and `GifskiEncoder` (batch) are
real-world examples of each base.

### High-quality GIF via gifski

`GifskiEncoder` wraps [gifski-wasm](https://github.com/jamsinclair/gifski-wasm)
(libimagequant + dithering) — much better quality than the default `gif`, at the
cost of buffering frames (batch) and pulling in gifski. It's **not registered by
default**; opt in:

```js
import { CCapture, GifskiEncoder } from "ccapture.js";

CCapture.registerEncoder("gif-hq", GifskiEncoder);
new CCapture({ format: "gif-hq", quality: 90, frameLimit: 120 });
```

gifski needs every frame as raw RGBA in one buffer, so GIFs must stay small.
`GifskiEncoder` **downscales** frames to `gifMaxSize` (longest side, default
`640`) — set `gifMaxSize`, or explicit `gifWidth`/`gifHeight`, to change it. It
throws early with guidance if the batch would still be too large; keep clips
short (and remember GIF playback is coarse, ~≤50fps).

gifski loads lazily from a CDN by default. To vendor it or use the multithreaded
build (needs `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy`
headers), pass your own: `{ encoder: new GifskiEncoder({ gifski: encodeFn }) }`
or `{ gifskiUrl: "/vendor/gifski/encode.js" }`. Best for short, quality-critical
GIFs — for long captures the streaming `gif` keeps memory bounded.

## Motion blur

Set `motionBlurFrames` to the number of sub-frames to average per output frame.
Each sub-frame is rendered at a fractional time step, then blended — the same
blur a real camera shutter produces.

```js
new CCapture({ format: "mp4", motionBlurFrames: 16 });
```

You don't change your loop: internally `capture()` runs N sub-renders per output
frame. The backend is chosen automatically (`motionBlur: "auto"`):

- **GPU** (WebGL2) when the source is a WebGL canvas and `motionBlurFrames > 2` —
  accumulation stays on the GPU, no per-sub-frame readback.
- **CPU** otherwise — a `Float32` accumulator (no overflow, alpha included).

Force it with `motionBlur: "gpu"` or `"cpu"`.

---

## Methods & events

### Methods

- **`start()`** → `Promise` — install hooks, start the encoder, begin capturing.
- **`capture(canvas)`** → `Promise` — capture the just-drawn frame (auto-drives
  the loop; see above).
- **`stop()`** → `Promise` — stop capturing and restore the real clock.
- **`save(callback?)`** → `Promise<Blob|null>` — finalize. With no callback it
  downloads the file; with a callback it hands you the `Blob` instead. Safe to
  call while still capturing to grab everything so far.
- **`step()`** — advance the virtual clock by one (sub-)frame manually. Only
  needed for the manual driving mode.
- **`record(canvas, render)`** → `Promise<boolean>` — headless convenience: give
  it a `render(frame)` function and it owns a flat capture loop (needs a
  `frameLimit`/`timeLimit`). Use when you *don't* have an existing rAF loop.
- **`dispose()`** → `Promise` — release the encoder and any GPU blur context.
  Call it if you create a new `FrameWrap` per recording.
- **`on(event, handler)`** — subscribe to an event (one handler per event).

### Events

| Event | Payload | Fired when |
|---|---|---|
| `start` | — | capture begins |
| `frame` | `frameCount` | an output frame is encoded |
| `progress` | `0..1` | encoder reports progress (where supported) |
| `save` | `Blob` | the file is finalized |
| `stop` | — | capture stops (auto or manual) |
| `error` | `Error` | a capture/encode error occurred |

---

## Recipes

**Stop manually and get a Blob instead of downloading**

```js
capturer.start();
// … your loop calling capture(canvas) …
await capturer.stop();
await capturer.save((blob) => {
  const url = URL.createObjectURL(blob);
  video.src = url;
});
```

**Headless / no existing loop**

```js
const capturer = new CCapture({ format: "mp4", framerate: 60, frameLimit: 300 });
await capturer.record(canvas, (frame) => {
  const t = frame / 60;          // seconds
  drawMyScene(t);
});
```

**Long captures without blowing memory** — download in parts:

```js
new CCapture({ format: "mp4", autoSaveTime: 20 }); // a file every 20s
```

**Skip into the animation**

```js
new CCapture({ format: "mp4", startTime: 3, timeLimit: 5 }); // seconds 3→8
```

**Capturing a `<video>` or `<audio>` element**

Register the element with `media` and CCapture frame-steps it in lockstep: each
frame it seeks the element to the exact time and waits for `seeked` before your
`render` draws, so a video drawn to canvas is frame-accurate (not the usual
best-effort realtime grab).

```js
const capturer = new CCapture({ format: "mp4", framerate: 60, timeLimit: 8, media: video });
capturer.start();
function render() {
  requestAnimationFrame(render);
  ctx.drawImage(video, 0, 0);   // shows the frame for this exact moment
  capturer.capture(canvas);
}
render();
```

- Register the element even if you only `drawImage` it — `drawImage` never reads
  `currentTime`, so it wouldn't otherwise be discovered. (Code that *does* read
  `video.currentTime` is auto-registered.)
- The element must be **same-origin**; a cross-origin video taints the canvas and
  encoding will throw.
- `play()` is suppressed during capture (CCapture drives time by seeking).
- Audio-reactive visuals that use the **Web Audio API** can't be frame-stepped
  (see caveats).

**Frame-accurate audio-reactive visuals**

A realtime `AnalyserNode` reads audio at wall-clock time, so it desyncs during a
slow capture. `renderAudioFrames()` renders the audio *offline* and samples it at
each frame's exact time, so the visuals line up with the soundtrack
frame-for-frame (add the audio back in an editor afterwards):

```js
import { CCapture, renderAudioFrames } from "ccapture.js";

const framerate = 60, frames = 300;

// Decode once, then use the buffer for both the analysis and the muxed track.
const arrayBuffer = await (await fetch("track.mp3")).arrayBuffer();
const buffer = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(arrayBuffer);

const audio = await renderAudioFrames({ buffer, framerate, frames, fftSize: 1024 });

const capturer = new CCapture({ format: "mp4", framerate, frameLimit: frames, audio: buffer });
await capturer.record(canvas, (i) => {
  const { frequency, waveform } = audio[i]; // this frame's spectrum / waveform (Uint8Array)
  drawBars(frequency);
});
// → an mp4 with frame-accurate visuals AND the audio track muxed in.
```

**Share one clock across two recorders** (e.g. two canvases in lockstep):

```js
import { CCapture, TimeWarp } from "ccapture.js";
const timewarp = new TimeWarp({ framerate: 60 });
const a = new CCapture({ format: "mp4", timewarp });
const b = new CCapture({ format: "mp4", timewarp });
```

---

## Using TimeWarp on its own

`TimeWarp` is fully standalone — useful for deterministic testing or your own
capture pipeline.

```js
import { TimeWarp } from "ccapture.js";

const tw = new TimeWarp({ framerate: 60 });
tw.start();                 // performance.now/rAF/timers now virtual
// … drive your animation …
tw.step();                  // advance exactly one frame (1000/60 ms)
tw.step(8);                 // or advance a custom dt in ms
tw.stop();                  // restore the real clock
```

Properties: `time` (virtual `performance.now`), `frameStep` (ms/frame),
`enabled`. Methods: `start`/`stop`/`enable`/`disable`/`step(dt?)`.

## Using FrameWrap on its own

If you already produce frames deterministically (a server render, your own fixed
loop) and don't want the browser clock touched, use `FrameWrap` directly — it's
pure capture (motion blur + encoding + limits + save), no timing:

```js
import { FrameWrap } from "ccapture.js";

const fw = new FrameWrap({ format: "mp4", framerate: 60 });
await fw.start();
for (const frameCanvas of myFrames) await fw.capture(frameCanvas);
await fw.stop();
await fw.save();
```

---

## The `hookDate` trade-off

With `hookDate: true` (default), TimeWarp overrides **both** `Date.now` and
`Date.prototype.getTime` to return the virtual clock — so animations that time
themselves with `Date.now()` or `new Date().getTime()` work.

The catch: overriding `Date.prototype.getTime` affects **every** `Date` object,
not just "now". While capturing, real date math breaks:

```js
new Date("2020-01-01").getTime();          // returns the virtual clock, not 2020
laterDate.getTime() - earlierDate.getTime(); // garbage — both are "now"
```

Set **`hookDate: false`** if your animation uses `performance.now()` / the rAF
timestamp anyway (three.js, GSAP, most modern code) *and* something on the page
does real date math during capture. `performance.now`, rAF, and timers stay
hooked either way.

`+new Date()` and `.valueOf()` are **not** warped by `hookDate` alone (they go
through `Date.prototype.valueOf`, a separate function). If your code times off
`+new Date()`, add **`hookValueOf: true`** — off by default because it changes
the numeric value of every `Date`, not just "now".

---

## Migrating from CCapture 1.x

The concepts are identical; the surface is modernized.

| CCapture 1.x | CCapture 2.x |
|---|---|
| `new CCapture({ format: 'webm' })` | `new CCapture({ format: 'mp4' })` (or `webm`) |
| global `<script>` + `window.CCapture` | ESM `import`, **or** the UMD build (`window.CCapture` still works) |
| `capturer.save(cb)` (callback only) | `await capturer.save()` (downloads) or `save(cb)` for the Blob |
| `format: 'ffmpegserver'` / `'webm-mediarecorder'` | removed (server-based / realtime) |
| `workersPath` (gif worker) | n/a — `gif` uses gifenc, no worker script |
| `motionBlurFrames` doubled internally | `motionBlurFrames` = exact sample count |
| CPU-only motion blur | CPU **and** GPU (auto) |
| WebM via WebP frames (Chromium) | WebCodecs MP4/WebM (all modern browsers) |

`new CCapture({...})` keeps working and the `.start()` / `.capture()` /
`.stop()` / `.save()` flow is unchanged — but `CCapture` is now its own class
(composing `FrameWrap` + `TimeWarp`) rather than the whole library. If you were
relying on `CCapture` being the capture engine itself, that role is now
`FrameWrap`.

---

## Browser support & caveats

- **WebCodecs** (`mp4`, `webm`): recent Chrome, Edge, Safari, and Firefox.
  Without it, `webm` falls back to the legacy writer; `mp4` errors.
- **GPU motion blur** needs WebGL2 + `EXT_color_buffer_float` (widely available);
  otherwise it falls back to CPU.
- Capturing a **cross-origin** canvas taints it and encoding will throw — a
  browser security rule, not something the library can bypass.
- Odd or mid-capture-resized canvases are fitted to an even coded size
  automatically (H.264 requires even dimensions).

**What TimeWarp does and doesn't warp.**

*Always hooked* (they're how capture is driven): `performance.now`,
`requestAnimationFrame`/`cancelAnimationFrame`, `setTimeout`/`setInterval`.

*Hooked but opt-out-able:*
- `Date.now` + `Date.prototype.getTime` — `hookDate` (default on);
- `Date.prototype.valueOf` (so `+new Date()`) — `hookValueOf` (default **off**);
- `<video>`/`<audio>` `currentTime` + `play` — `hookMedia` (default on).

*Partly covered:*
- **Web Audio** — a realtime `AudioContext` can't be stepped, but for
  audio-reactive visuals `renderAudioFrames()` renders the audio *offline* and
  samples an `AnalyserNode` at each frame time, giving frame-accurate spectrum /
  waveform data. See [Frame-accurate audio](#recipes). You can also **mux an
  `AudioBuffer` into the output** via the `audio` option (AAC/Opus for mp4, Opus
  for webm — where the browser's `AudioEncoder` supports it; falls back to
  video-only otherwise).

*Not covered* — these run on clocks the library can't step, so they'll drift
during a capture:
- the **Web Animations API** (`element.animate`) and **CSS animations/transitions**,
  which run on the compositor/document timeline.

> Note on `+new Date()`: by default it reads the real construction time (only
> `Date.now()`/`getTime()` are warped). Set `hookValueOf: true` to warp it too —
> it's off by default because it's the most invasive Date hook (it changes the
> numeric value of *every* Date, not just "now").

---

## Examples

Serve the repo over HTTP (ES modules require it) and open `/examples/`:

```bash
python3 -m http.server
# → http://localhost:8000/examples/
```

- **basic** — 2D canvas, all formats, motion-blur toggle.
- **three** — Three.js (WebGL); shows the auto-selected GPU motion blur.
- **gsap** — a GSAP timeline scrubbed by the warped clock.
- **video** — a `<video>` frame-stepped in lockstep with capture.
- **demo** — the smallest possible inline capture loop.

All examples share `examples/CaptureUI.js`, a drop-in control panel (format,
framerate, motion blur, duration, start/stop, progress, frame count).

---

## License

MIT © Jaume Sanchez Elias — https://www.clicktorelease.com
