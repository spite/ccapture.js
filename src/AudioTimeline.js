// Frame-accurate audio analysis for captures.
//
// A realtime AudioContext can't be frame-stepped — it runs on the audio
// hardware clock. But an OfflineAudioContext renders non-realtime and can
// suspend() at exact times, so we render the audio offline, pause at every
// frame's timestamp, sample an AnalyserNode, and return the analysis per frame.
//
// Usage: precompute before capturing, then read frames[i] in your render loop.
//
//   const audio = await renderAudioFrames({ url: "song.mp3", framerate: 60, frames: 300 });
//   // render(i): draw using audio[i].frequency / audio[i].waveform
//
// (You still align the audio to the video afterwards in an editor — this only
// makes the *visuals* deterministic against the soundtrack.)

const OfflineCtx =
  typeof OfflineAudioContext !== "undefined"
    ? OfflineAudioContext
    : typeof webkitOfflineAudioContext !== "undefined"
    ? webkitOfflineAudioContext
    : null;

async function decodeToBuffer({ buffer, url, arrayBuffer }) {
  if (buffer) return buffer;
  if (url) arrayBuffer = await (await fetch(url)).arrayBuffer();
  if (!arrayBuffer) {
    throw new Error("renderAudioFrames needs one of: buffer, url, arrayBuffer.");
  }
  // decodeAudioData lives on BaseAudioContext, so a tiny offline ctx works.
  const tmp = new OfflineCtx(1, 1, 44100);
  return tmp.decodeAudioData(arrayBuffer.slice(0)); // slice: decode detaches it
}

/**
 * Render audio offline and sample an AnalyserNode at each frame time.
 *
 * @param {object} opts
 * @param {AudioBuffer} [opts.buffer]     decoded audio (or use url/arrayBuffer)
 * @param {string}      [opts.url]        audio file to fetch + decode
 * @param {ArrayBuffer} [opts.arrayBuffer]encoded audio to decode
 * @param {number}      [opts.framerate=60]
 * @param {number}      [opts.frames]     frame count (defaults to fill the clip)
 * @param {number}      [opts.startTime=0] seconds to start at
 * @param {number}      [opts.fftSize=2048]
 * @param {number}      [opts.smoothing=0.8] AnalyserNode smoothingTimeConstant
 * @returns {Promise<Array<{ time:number, frequency:Uint8Array, waveform:Uint8Array }>>}
 */
async function renderAudioFrames(opts = {}) {
  if (!OfflineCtx) throw new Error("OfflineAudioContext is not available.");

  const {
    framerate = 60,
    startTime = 0,
    fftSize = 2048,
    smoothing = 0.8,
  } = opts;

  const buffer = await decodeToBuffer(opts);
  const sampleRate = buffer.sampleRate;
  const duration = buffer.duration;

  const total =
    opts.frames ?? Math.max(0, Math.floor((duration - startTime) * framerate));

  // suspend() quantizes to 128-sample blocks; frames closer than that collide.
  if (sampleRate / framerate < 128) {
    throw new Error(
      `framerate ${framerate} is too high for ${sampleRate}Hz audio analysis ` +
        `(frames must be ≥128 samples apart).`
    );
  }

  const length = Math.ceil((startTime + total / framerate) * sampleRate) + fftSize;
  const ctx = new OfflineCtx(buffer.numberOfChannels || 1, length, sampleRate);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = fftSize;
  analyser.smoothingTimeConstant = smoothing;
  source.connect(analyser);
  analyser.connect(ctx.destination);
  source.start(0);

  const frames = new Array(total);
  const emptyFreq = () => new Uint8Array(analyser.frequencyBinCount);
  const emptyWave = () => new Uint8Array(analyser.fftSize);

  for (let i = 0; i < total; i++) {
    const time = startTime + i / framerate;
    if (time >= duration) {
      frames[i] = { time, frequency: emptyFreq(), waveform: emptyWave() };
      continue;
    }
    // Register the suspend before rendering; the callback samples and resumes.
    ctx.suspend(time).then(() => {
      const frequency = emptyFreq();
      analyser.getByteFrequencyData(frequency);
      const waveform = emptyWave();
      analyser.getByteTimeDomainData(waveform);
      frames[i] = { time, frequency, waveform };
      ctx.resume();
    });
  }

  await ctx.startRendering();
  return frames;
}

export { renderAudioFrames };
