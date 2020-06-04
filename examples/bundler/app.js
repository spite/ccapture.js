import ccapture from "ccapture.js";

var capturer = new CCapture({
  format: "webm",
  framerate: 60,
  verbose: true,
  // motionBlurFrames: 6
});

let ellapsedTime, lastTime;
let recording = false;
let canvas = document.getElementById("testcanvas");
let ctx = canvas.getContext("2d");
canvas.width = 512;
canvas.height = 512;


// RAF loop
function render() {
  var currentTime = Date.now();
  currentTime = performance.now();
  ellapsedTime = currentTime - lastTime;


  ctx.clearRect(0, 0, 512, 512);
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 512, 512); // background

  for (var i = 0; i < 8; i++) {
    ctx.fillStyle = "green";
    ctx.fillRect(
      60 * i,
      200 * Math.sin(((i / 8) * currentTime) / 200) + 256,
      50,
      50
    );
  }

  window.requestAnimationFrame(render);
  if (recording) capturer.capture(canvas);

  lastTime = currentTime;
}

document.querySelector(".js-start").addEventListener("click", () => {
  if (!recording) {
    capturer.start();
    recording = true;
  }
});
document.querySelector(".js-stop").addEventListener("click", () => {
  if (recording) {
    capturer.stop();
    capturer.save();
    recording = false;
  }
});

render();
