# Changelog

Notable changes to CCapture. Format loosely follows
[Keep a Changelog](https://keepachangelog.com); the project uses
[semantic versioning](https://semver.org).

## [2.0.0] — 2026-07-27

Ground-up rewrite for modern browsers. Full notes in the
[GitHub release](https://github.com/spite/ccapture.js/releases/tag/v2.0.0).

### Added
- Modular architecture: `CCapture` = `TimeWarp` (virtual clock) + `FrameWrap`
  (capture + encoding), each usable on its own.
- WebCodecs encoders for MP4 (H.264/AV1) and WebM (VP9/VP8/AV1) with runtime
  codec negotiation and automatic even-dimension fitting; legacy webm-writer
  fallback when WebCodecs is unavailable.
- GPU (WebGL2) and CPU motion blur, auto-selected.
- Frame-accurate audio: offline analysis (`renderAudioFrames`) and `AudioBuffer`
  muxing (AAC/Opus).
- Frame-stepped `<video>`/`<audio>` capture; `async`/`await` throughout.
- Pluggable encoders (`FrameEncoder` / `BatchEncoder`) + `CCapture.registerEncoder`.
- UMD/IIFE global build, bundled TypeScript declarations, ESM-from-source.
- Example gallery + landing page; Node and headless-browser test suites.

### Changed
- `CCapture` is now a class composing `FrameWrap` + `TimeWarp` (was the whole
  library); the capture-engine role is now `FrameWrap`.
- Default format is `mp4` (was `webm`).
- `save()` downloads by default; pass a callback to receive the `Blob`.
- `motionBlurFrames` is now the exact sub-frame count (previously doubled).

### Removed
- `ffmpegserver` and `webm-mediarecorder` formats.
- The gif worker (`workersPath`) — `gif` now uses gifenc, no worker script.

### Migration
See "Migrating from CCapture 1.x" in the [README](README.md). The 1.x line is
preserved on the [`1.x` branch](https://github.com/spite/ccapture.js/tree/1.x)
and on npm as `ccapture.js@1`.

## 1.x and earlier

See the git history on the `1.x` branch.

[2.0.0]: https://github.com/spite/ccapture.js/releases/tag/v2.0.0
