# CCapture.js - A library to capture canvas-based animations

CCapture.js is a library to help capturing animations created with HTML5 `canvas` at a fixed framerate. 

An examples is probably worth a lot of words: [CCapture.js with Game of Life 3D](http://www.clicktorelease.com/code/conway3d_ccapture/).

![Sample](https://raw.githubusercontent.com/spite/ccapture.js/master/assets/sample.gif)

#### What is CCapture.js and why would I need it? ####

Let's say that you finally have your amazing **canvas**-based animation running in your browser, be it 2D or 3D with the power of **WebGL**. You've been working hard to keep it fast and smooth. If you're using `requestAnimationFrame` you're aiming for a framerate of 60fps or, in other words, each frame is taking 16ms or less to render.

Now you want to record a video of it. Not a big deal, you can fire up a screen capture software that churns out a video file and be done with it. But what if you wanted to create an HD movie of your animation, and it simply cannot be rendered at higher resolutions because frames start dropping? What if you wanted to put all the quality settings up for the video? What if you wanted to push that particle count to 10 millions?

What if, indeed. What would happen is that you'd get a choppy video at best. At higher resolutions, fillrate is a bottleneck for most **canvas**-based animations. High quality settings or high number of elements may be only feasible on more powerful hardware.

With CCapture.js you can record smooth videos at a fixed framerate for all these situations, because it doesn't run in realtime: it makes the animations run at a given, fixed framerate which can be specified. You can record animations at smooth and consistent 30 or 60fps even if each frame takes seconds to render. You can even take a 240fps capture and create motion blur with post-production software.

The only requirement is that you step your values per frame according to ellapsed time. In other words, don't increment your variables with a fixed value each frame, but use an ellapsed time delta to adjust those incrementts. CCapture.js works by hooking the common methods for obtaining that ellapsed time: `Date.now()`, `setTimeout`, `requestAnimationFrame`, etc. and making them behave like a constant time step is happening, fixed by the specified framerate.

Methods supported so far:

- `Date.now`, `Date.prototype.getTime`
- `setTimeout`, `clearTimeout`, `setInterval` (`clearInterval` pending)
- `requestAnimationFrame`
- `performance.now`
- `HTMLVideoElement.prototype.currentTime`, `HTMLAudioElement.prototype.currentTime`

CCapture.js is more or less [ryg's kkapture](http://www.farb-rausch.de/~fg/kkapture/) but for JavaScript and `canvas`. 

The library supports multiple export formats using modular encoders (`CCFrameEncoder):

- `CCWebMEncoder` usses [Whammy.js](http://antimatter15.com/wp/2012/08/whammy-a-real-time-javascript-webm-encoder/) to create a WebM movie
- `CCGIFEncoder` uses [gifjs](http://jnordberg.github.io/gif.js/) to create animated GIFs
- `CCFFMpegServerEncoder` uses [ffmpegserver.js](https://github.com/greggman/ffmpegserver.js) to generate video on the server 

Forks, pull requests and code critiques are welcome!

#### Using the code ####

Include CCapture[.min].js and [Whammy.js](http://antimatter15.com/wp/2012/08/whammy-a-real-time-javascript-webm-encoder/) or [gifjs](http://jnordberg.github.io/gif.js/). 

```html
<script src="CCapture.min.js"></script>
<!-- Include Whammy if you want to export WebM -->
<script src="Whammy.js"></script>
<!-- Include gifjs if you want to export GIF -->
<script src="gif.js"></script>
```

To create a CCapture object, write:

```js
// Create a capturer that exports a WebM video
var capturer = new CCapture( { format: 'webm' } );

// Create a capturer that exports an animated GIF
// Notices you have to specify the path to the gif.worker.js 
var capturer = new CCapture( { format: 'gif', workersPath: 'js/' } );
```

This creates a CCapture object to run at 60fps, non-verbose. You can tweak the object by setting parameters on the constructor:

```js
var capturer = new CCapture( {
	framerate: 60,
	verbose: true
} );
```

You can decide when to start the capturer. When you call the `.start()` method, the hooks are set, so from that point on `setTimeout`, `setInterval` and other methods that are hooked will behave a bit differently. When you have everything ready to start capturing, call:

```js
capturer.start();
```

And then, in your `render()` method, after the frame is been drawn, call `.capture()` passing the canvas you want to capture.

```js
function render(){
  // rendering stuff ...
  capturer.capture( canvas );
}

requestAnimationFrame(render);
```

That's all. Once you're done with the animation, you can call `.stop()` and then `.save()`. That will compose the video and return a URL that can be previewed or downloaded.

```js
capturer.stop();
capturer.save( function( url ) { /* ... */ } );
```

#### Limitations ####

CCapture.js only works on browsers that have a `canvas implementation.

**Whammy.js** current version only works on a browser that supports the image/webp format. Exporting video is basically Chrome-only for now :( If you want to help to make it Firefox, Opera or even Internet Explorer compatible, please do!

**gif.js** has some performance limitations, be careful if capturing a lot of frames.

#### Contributors ####

Big thanks to [hugohil](https://github.com/hugohil) and [Greggman](https://github.com/greggman)!

#### License ####

MIT licensed

Copyright (C) 2012-2015 Jaume Sanchez Elias, http://www.clicktorelease.com
