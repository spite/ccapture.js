# Browser smoke test

The Node tests cover timing and the capture loop against mock encoders. This
harness runs the **real** browser paths — actual WebCodecs/GIF/image encoding,
container validity, and motion-blur averaging (CPU + GPU) — in headless Chromium.

## Setup (once)

```bash
npm install                         # installs playwright-core
npx playwright install chromium     # downloads the Chromium build
sudo npx playwright install-deps chromium   # system libraries (needs root)
```

On Debian/Ubuntu without `playwright install-deps`, the libraries are roughly:

```bash
sudo apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libatspi2.0-0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2
```

## Run

**In a real browser (Chrome / Firefox / Safari) — no Playwright needed:**

```bash
npm run serve
# open http://localhost:8000/test/browser/
```

The page runs the whole suite and shows a live pass/fail list with timings and a
capability header. This is the way to check cross-browser behaviour — just open
the URL in each browser. (Only `npm install` is required for this; the browser
setup below is not.)

**Headless via Playwright (for CI / one command):**

```bash
npm run test:browser
```

Same tests, driven in headless Chromium; prints results and exits non-zero on
failure.

Both paths run the exact same cases from `cases.js`.

## What it checks

- **TimeWarp / FrameWrap / CCapture logic** — the timing hooks, capture loop,
  auto-drive, `record`, media registration, and clock restore actually work *in
  this engine* (global monkeypatching can differ across browsers).
- **mp4 / webm** — records 6 frames, then loads the Blob into a `<video>` and
  asserts it reports non-zero dimensions (i.e. the container is valid/playable).
- **gif** — `GIF` magic bytes.
- **png / jpg / webp** — a valid TAR (`ustar`).
- **motion blur** — sweeps a white bar over black across 8 sub-frames and checks
  the resolved frame has partial (grey) pixels, proving averaging happened;
  reports whether the CPU or GPU backend ran.
- **video sync** — registers a VP9 `sample.webm` as `media` and confirms the
  capture pipeline drives per-frame seeks (`seekedCount`). If the environment can
  decode distinct frames to canvas (the `controlDiffers` probe), it also asserts
  the captured frames advanced.
- **gif-hq** — records with the gifski (`GifskiEncoder`) batch path, loading
  gifski-wasm from a CDN, and checks the output is a valid GIF. Reported as
  `skipped` if the CDN/network is unavailable.

## Notes

- Under software rendering (`swiftshader`), `EXT_color_buffer_float` is usually
  present (GPU blur runs), but **video-to-canvas decode is unreliable** — so the
  video case verifies the seek *mechanism* rather than pixels there. On a real
  GPU/browser the pixel assertion kicks in.
- Headless **Chromium lacks H.264 encode/decode**, so `mp4` records via the AV1
  fallback here and the H.264 example clip won't decode (hence `sample.webm`).
- `sample.webm` is generated with `ffmpeg -f lavfi -i testsrc ... -c:v libvpx-vp9`.
