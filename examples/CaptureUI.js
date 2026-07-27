import { CCapture, GifskiEncoder, renderAudioFrames } from "../src/index.js";

// Opt-in high-quality GIF (gifski-wasm, loaded lazily from a CDN on first use).
CCapture.registerEncoder("gif-hq", GifskiEncoder);

/**
 * A shared capture control panel for the examples.
 *
 * Minimal use: pass a `canvas` and a `render(t, ctx)` that draws one frame at
 * the (warped) time `t`. CaptureUI owns format / framerate / motion-blur /
 * duration selection, an idle preview, the capture loop, progress + frame count.
 *
 * Extras for the richer examples:
 *   - `media`   — video/audio element(s) to frame-step during capture
 *   - `audio`   — an AudioBuffer to mux as an audio track
 *   - `analyze` — precompute per-frame audio analysis (from `audio`) and pass it
 *                 to render as `ctx.analysis` ({ frequency, waveform })
 *   - `accept` + `onFile(file)` — show a file input; onFile returns
 *                 `{ media?, audio? }` and may resize the canvas
 *
 * `render(t, ctx)` — ctx = { frame, analysis }. Existing `render(t)` still works.
 */

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
  .ccui { position: fixed; top: 1rem; left: 1rem; z-index: 99999;
    width: 250px; background: #16161aee; color: #eee; border: 1px solid #333;
    border-radius: 10px; padding: 14px; backdrop-filter: blur(6px);
    font: 13px/1.5 system-ui, sans-serif; box-shadow: 0 8px 30px #0008; }
  .ccui h2 { margin: 0 0 10px; font-size: 14px; letter-spacing: .02em; }
  .ccui label { display: block; margin: 8px 0 3px; color: #9aa; font-size: 11px;
    text-transform: uppercase; letter-spacing: .05em; }
  .ccui select, .ccui input[type=number], .ccui input[type=file] { width: 100%;
    box-sizing: border-box; background: #0e0e12; color: #eee; border: 1px solid #333;
    border-radius: 6px; padding: 6px 8px; font: inherit; }
  .ccui .check { display: flex; align-items: center; gap: 8px; margin-top: 10px;
    color: #ccc; text-transform: none; letter-spacing: 0; font-size: 13px; }
  .ccui .check input { flex: 0; width: auto; }
  .ccui button { width: 100%; margin-top: 12px; padding: 9px; border: 0;
    border-radius: 7px; font: 600 13px system-ui; cursor: pointer; color: #fff; }
  .ccui button.start { background: crimson; }
  .ccui button.stop { background: #b8860b; }
  .ccui button:disabled { background: #444; cursor: default; }
  .ccui .bar { height: 6px; background: #0e0e12; border-radius: 4px; margin-top: 12px; overflow: hidden; }
  .ccui .bar > i { display: block; height: 100%; width: 0%; background: crimson; transition: width .08s linear; }
  .ccui .meta { display: flex; justify-content: space-between; margin-top: 8px; font-variant-numeric: tabular-nums; color: #bbb; }
  .ccui .status { margin-top: 8px; min-height: 1.3em; color: #7fd1ff; font-size: 12px; }
  .ccui .badge { display:inline-block; margin-top:6px; padding:2px 7px; border-radius:5px; background:#0e0e12; border:1px solid #333; color:#8a8; font-size:11px; }
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, attrs);
  for (const c of [].concat(children)) {
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}
const option = (value, label) => el("option", { value, textContent: label });

export function createCaptureUI(config) {
  const {
    canvas,
    render,
    title = "CCapture",
    name = String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "capture",
    formats = ["mp4", "webm", "gif", "gif-hq", "png", "jpg", "webp"],
    framerates = [24, 30, 60],
    defaultFramerate = 60,
    duration = 4,
    motionBlur = true,
    preview = true,
    analyze = false,
    accept = null,
    onFile = null,
    container = document.body,
  } = config;

  injectStyles();

  // Mutable capture sources (also settable on the returned object / via onFile).
  let media = config.media || null;
  let audio = config.audio || null;
  let analysis = null;

  const formatSel = el("select", {}, formats.map((f) => option(f, f.toUpperCase())));
  const fpsSel = el("select", {}, framerates.map((f) => option(String(f), `${f} fps`)));
  fpsSel.value = String(defaultFramerate);
  const durInput = el("input", { type: "number", value: String(duration), min: "1", max: "60" });
  const mbCheck = el("input", { type: "checkbox" });
  const mbSamples = el("input", { type: "number", value: "8", min: "2", max: "64", disabled: true });
  mbCheck.addEventListener("change", () => (mbSamples.disabled = !mbCheck.checked));

  const fileInput = accept ? el("input", { type: "file", accept }) : null;

  const button = el("button", { className: "start", textContent: "Start" });
  const barFill = el("i");
  const frameMeta = el("span", { textContent: "0 frames" });
  const timeMeta = el("span", { textContent: "0.0s" });
  const status = el("div", { className: "status", textContent: "Idle." });
  const backendBadge = el("span", { className: "badge", textContent: "" });

  const children = [el("h2", { textContent: title })];
  if (fileInput) children.push(el("label", { textContent: "Source file" }), fileInput);
  children.push(
    el("label", { textContent: "Format" }), formatSel,
    el("label", { textContent: "Framerate" }), fpsSel,
    el("label", { textContent: "Duration (s)" }), durInput
  );
  if (motionBlur) {
    children.push(
      el("div", { className: "check" }, [mbCheck, "Motion blur"]),
      el("label", { textContent: "Samples" }), mbSamples
    );
  }
  children.push(
    button,
    el("div", { className: "bar" }, [barFill]),
    el("div", { className: "meta" }, [frameMeta, timeMeta]),
    status,
    backendBadge
  );
  const panel = el("div", { className: "ccui" }, children);
  container.appendChild(panel);

  let idle = true;
  let capturer = null;

  // Wait for a file before recording only if there's no default source yet.
  if (fileInput) {
    if (!media && !audio) button.disabled = true;
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;
      button.disabled = true;
      status.textContent = "Loading…";
      try {
        const res = (await onFile(file)) || {};
        if ("media" in res) media = res.media;
        if ("audio" in res) audio = res.audio;
        status.textContent = "Ready.";
        button.disabled = false;
      } catch (e) {
        status.textContent = e.message;
      }
    });
  }

  function setControlsDisabled(disabled) {
    for (const c of [formatSel, fpsSel, durInput, mbCheck, mbSamples, fileInput]) {
      if (c) c.disabled = disabled || (c === mbSamples && !mbCheck.checked);
    }
  }

  function previewLoop() {
    if (!idle) return;
    const t = performance.now() / 1000;
    render(t, { frame: 0, analysis: undefined });
    requestAnimationFrame(previewLoop);
  }
  if (preview) previewLoop();

  function toIdle() {
    idle = true;
    button.textContent = "Start";
    button.className = "start";
    button.disabled = false;
    setControlsDisabled(false);
    backendBadge.textContent = "";
    if (preview) previewLoop();
  }

  async function start() {
    if (!idle) return;
    idle = false;

    const framerate = +fpsSel.value;
    let dur = Math.max(1, +durInput.value || duration);
    if (media && Number.isFinite(media.duration)) dur = Math.min(dur, media.duration);
    const samples = mbCheck.checked ? Math.max(2, +mbSamples.value || 8) : 1;
    const targetFrames = Math.round(dur * framerate);

    if (capturer) {
      try { await capturer.dispose(); } catch {}
      capturer = null;
    }

    // Precompute frame-accurate audio analysis if requested.
    analysis = null;
    if (analyze && audio) {
      status.textContent = "Analyzing audio…";
      try {
        analysis = await renderAudioFrames({ buffer: audio, framerate, frames: targetFrames, fftSize: 1024, smoothing: 0.7 });
      } catch (e) {
        status.textContent = `Audio analysis failed: ${e.message}`;
      }
    }

    try {
      capturer = new CCapture({
        format: formatSel.value,
        name,
        framerate,
        timeLimit: dur,
        quality: 95,
        motionBlurFrames: samples,
        media,
        audio,
      });
    } catch (e) {
      status.textContent = e.message;
      toIdle();
      return;
    }

    let badged = false;
    capturer.on("frame", (n) => {
      frameMeta.textContent = `${n} / ${targetFrames} frames`;
      timeMeta.textContent = `${(n / framerate).toFixed(1)}s`;
      barFill.style.width = `${Math.min(100, (n / targetFrames) * 100)}%`;
      if (!badged && capturer.motionBlur) {
        badged = true;
        backendBadge.textContent = `${capturer.motionBlur.gl ? "GPU" : "CPU"} blur · ${samples}×`;
      }
    });
    capturer.on("progress", (p) => {
      if (!capturer.capturing) status.textContent = `Encoding… ${Math.round(p * 100)}%`;
    });
    capturer.on("save", () => (status.textContent = "Saved — check downloads."));
    capturer.on("error", (e) => (status.textContent = `Error: ${e.message}`));
    capturer.on("stop", () => toIdle());

    setControlsDisabled(true);
    button.textContent = "Stop";
    button.className = "stop";
    status.textContent = "Recording…";
    barFill.style.width = "0%";
    backendBadge.textContent = samples > 1 ? "blur pending…" : "";

    await capturer.start();

    let t0 = null;
    function loop() {
      if (!capturer.capturing) return;
      requestAnimationFrame(loop);
      if (t0 === null) t0 = performance.now();
      const frame = capturer.frameCount;
      render((performance.now() - t0) / 1000, { frame, analysis: analysis ? analysis[frame] : undefined });
      capturer.capture(canvas);
    }
    loop();
  }

  async function stop() {
    if (!capturer || !capturer.capturing) return;
    button.disabled = true;
    status.textContent = "Finalizing…";
    await capturer.stop();
    await capturer.save();
  }

  button.addEventListener("click", () => (idle ? start() : stop()));

  const ui = { panel, get capturer() { return capturer; } };
  Object.defineProperty(ui, "media", { get: () => media, set: (v) => (media = v) });
  Object.defineProperty(ui, "audio", { get: () => audio, set: (v) => (audio = v) });
  return ui;
}
