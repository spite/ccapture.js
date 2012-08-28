# CCapture.js - A library to capture canvas-based animations

CCapture.js is a library to help capturing animations created with HTML5 canvas at a fixed framerate. 

An examples is probably worth a lot of words: [http://www.clicktorelease.com/code/conway3d_ccapture/](CCapture.js with Game of Life 3D).

#### What is CCapture.js and why would I need it? ####

Let's say that you finally have your amazing canvas-based animation running in your browser, be it 2D or 3D with the power of WebGL. You've been working hard to keep it fast and smooth. If you're using requestAnimationFrame you're aiming for a framerate of 60fps or, in other words, each frame is taking 16ms or less to render.

Now you want to record a video of it. Not a big deal, you can fire up a screen capture software that churns out a video file and be done with it. But what if you wanted to create an HD movie of your animation, and it simply cannot be rendered at higher resolutions because frames start dropping? What if you wanted to put all the quality settings up for the video? What if you wanted to push that particle count to 10 millions?

What if, indeed. What would happen is that you'd get a choppy video at best. At higher resolutions, fillrate is a bottleneck for most canvas-based animations. High quality settings or high number of elements may be only feasible on more powerful hardware.

With CCapture.js you can record smooth videos at a fixed framerate for all these situations, because it doesn't run in realtime: it makes the animations run at a given, fixed framerate which can be specified. You can record animations at smooth and consistent 30 or 60fps even if each frame takes seconds to render. You can even take a 240fps capture and create motion blur with post-production software.

The only requirement is that you step your values per frame according to ellapsed time. In other words, don't increment your variables with a fixed value each frame, but use an ellapsed time delta to adjust those incrementts. CCapture.js works by hooking the common methods for obtaining that ellapsed time: Date.now(), setTimeout, requestAnimationFrame (and more to come, eventually), and making them behave like a constant time step is happening, fixed by the specified framerate.

CCapture is more or less [ryg's kkapture](http://www.farb-rausch.de/~fg/kkapture/) but for JavaScript and canvas. Right now is using [Whammy.js](http://antimatter15.com/wp/2012/08/whammy-a-real-time-javascript-webm-encoder/) to create a WebM movie, but other file formats could be exported.

Forks, pull requests and code critiques are welcome!

#### Using the code ####

Include CCapture[.min].js and [Whammy.js](http://antimatter15.com/wp/2012/08/whammy-a-real-time-javascript-webm-encoder/). 

The lib uses [Whammy.js](http://antimatter15.com/wp/2012/08/whammy-a-real-time-javascript-webm-encoder/) to convert the animation frames into a WebM movie.

```html
<script src="CCapture.min.js"></script>
<script src="Whammy.js"></script>
````

To create a CCapture object, write:

```js
var capturer = new CCapture();
```

This creates a CCapture object to run at 60fps, non-verbose. You can tweak the object by setting parameters on the constructor:

```js
var capturer = new CCapture( {
	framerate: 120,
	verbose: true
} );
```

You can decide when to start the capturer. When you call the .start() method, the hooks are set, so from that point on setTimeout and other methods that are hooked will behave a bit differently. When you have everything ready to start capturing, call:

```js
capturer.start();
```

And then, in your render() method, after the frame is been drawn, call .capture() passing the canvas you want to capture.

```js
capturer.capture( canvas );
```

That's all. Once you're done with the animation, you can call .save(). That will compose the video and return a URL that can be previewed or downloaded.

```js
var videoURL = capturer.save();
```

#### Limitations ####

CCapture.js only works on browsers that have a Canvas implementation.
Also, Whammy.js current version doesn't seem to work on anything but Chrome.
So, basically it's Chrome-only for now :(

#### License ####

MIT licensed

Copyright (C) 2012 Jaume Sanchez Elias, http://www.clicktorelease.com