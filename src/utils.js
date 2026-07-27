function asyncCanvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

function pad(n, length = 7) {
  return String(n).padStart(length, "0");
}

function guid() {
  const s4 = () =>
    Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
}

// A real timer captured before TimeWarp can hook setTimeout (used only as a
// non-browser fallback for nextTask).
const rawSetTimeout =
  typeof globalThis.setTimeout === "function"
    ? globalThis.setTimeout.bind(globalThis)
    : null;

let _channel;
let _pending;

/**
 * Yield a macrotask so the browser can paint and stay responsive between
 * captured frames. Uses MessageChannel — it's not hooked by TimeWarp and has no
 * 4ms clamp (unlike setTimeout). Captures are serialized, so one reused channel
 * with a single pending resolver is enough.
 */
function nextTask() {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && typeof MessageChannel !== "undefined") {
      if (!_channel) {
        _channel = new MessageChannel();
        _channel.port1.onmessage = () => {
          const r = _pending;
          _pending = null;
          if (r) r();
        };
      }
      _pending = resolve;
      _channel.port2.postMessage(0);
    } else if (rawSetTimeout) {
      rawSetTimeout(resolve, 0);
    } else {
      Promise.resolve().then(resolve);
    }
  });
}

export { asyncCanvasToBlob, pad, guid, nextTask };
