# CCapture.js - A library to capture canvas-based animations
CCapture.js is a library to help capturing animations created with HTML5 `canvas` at a fixed framerate. 

- [What is CCapture.js and why would I need it?](#what-is-ccapturejs-and-why-would-i-need-it)
- [Using the code](#using-the-code)
- [Limitations](#limitations)
- [Gallery](#gallery)
- [Credits](#credits)
- [License](#license)

An example is probably worth a lot of words: [CCapture.js with Game of Life 3D](http://www.clicktorelease.com/code/conway3d_ccapture/).

![Sample](https://raw.githubusercontent.com/spite/ccapture.js/master/assets/sample.gif)

#### What is CCapture.js and why would I need it? ####

Let's say that you finally have your amazing **canvas**-based animation running in your browser, be it 2D or 3D with the power of **WebGL**. You've been working hard to keep it fast and smooth. If you're using `requestAnimationFrame` you're aiming for a framerate of 60fps or, in other words, each frame is taking 16ms or less to render.

Now you want to record a video of it. Not a big deal, you can fire up a screen capture software that churns out a video file and be done with it. But what if you wanted to create an HD movie of your animation, and it simply cannot be rendered at higher resolutions because frames start dropping? What if you wanted to put all the quality settings up for the video? What if you wanted to push that particle count to 10 millions?

What if, indeed. What would happen is that you'd get a choppy video at best. At higher resolutions, fillrate is a bottleneck for most **canvas**-based animations. High quality settings or high number of elements may be only feasible on more powerful hardware.

With CCapture.js you can record smooth videos at a fixed framerate for all these situations, because it doesn't run in realtime: it makes the animations run at a given, fixed framerate which can be specified. You can record animations at smooth and consistent 30 or 60fps even if each frame takes seconds to render. You can even take a 240fps capture and create motion blur with post-production software.

The only requirement is that you step your values per frame according to ellapsed time. In other words, don't increment your variables with a fixed value each frame, but use an ellapsed time delta to adjust those increments. CCapture.js works by hooking the common methods for obtaining that ellapsed time: `Date.now()`, `setTimeout`, `requestAnimationFrame`, etc. and making them behave like a constant time step is happening, fixed by the specified framerate.

Methods supported so far:

- `Date.now`, `Date.prototype.getTime`
- `setTimeout`, `clearTimeout`, `setInterval` (`clearInterval` pending)
- `requestAnimationFrame`
- `performance.now`
- `HTMLVideoElement.prototype.currentTime`, `HTMLAudioElement.prototype.currentTime`

CCapture.js is more or less [ryg's kkapture](http://www.farb-rausch.de/~fg/kkapture/) but for JavaScript and `canvas`. 

The library supports multiple export formats using modular encoders (`CCFrameEncoder):

- `CCWebMEncoder` uses [WebM Writer for JavaScript](https://github.com/thenickdude/webm-writer-js/) to create a WebM movie
- `CCPNGEncoder` and `CCJPEGEncoder` export PNG and JPEG files in a TAR file, respectively
- `CCGIFEncoder` uses [gifjs](http://jnordberg.github.io/gif.js/) to create animated GIFs
- `CCFFMpegServerEncoder` uses [ffmpegserver.js](https://github.com/greggman/ffmpegserver.js) to generate video on the server 

Forks, pull requests and code critiques are welcome!

#### Using the code ####

Include CCapture[.min].js and [WebM Writer](https://github.com/thenickdude/webm-writer-js) or [gifjs](http://jnordberg.github.io/gif.js/). 

```html
<script src="CCapture.min.js"></script>
<!-- Include WebM Writer if you want to export WebM -->
<script src="webm-writer-0.2.0.js"></script>
<!-- Include gifjs if you want to export GIF -->
<script src="gif.js"></script>
<!-- Include tar.js if you want to export PNG or JPEG -->
<script src="tar.js"></script>
<!-- Include download.js for easier file download -->
<script src="download.js"></script>
```
Or include the whole pack
```html
<script src="CCapture.all.min.js"></script>
```
Or use npm or bower to install the [package](https://www.npmjs.com/package/ccapture.js):
```bash
npm install ccapture.js
```
Or use bower to install the [package](https://www.npmjs.com/package/ccapture.js):
```bash
bower install ccapture.js
```

To create a CCapture object, write:

```js
// Create a capturer that exports a WebM video
var capturer = new CCapture( { format: 'webm' } );

// Create a capturer that exports an animated GIF
// Notices you have to specify the path to the gif.worker.js 
var capturer = new CCapture( { format: 'gif', workersPath: 'js/' } );

// Create a capturer that exports PNG images in a TAR file
var capturer = new CCapture( { format: 'png' } );

// Create a capturer that exports JPEG images in a TAR file
var capturer = new CCapture( { format: 'jpg' } );
```

This creates a CCapture object to run at 60fps, non-verbose. You can tweak the object by setting parameters on the constructor:

```js
var capturer = new CCapture( {
	framerate: 60,
	verbose: true
} );
```

The complete list of parameters is:
- ***framerate***: target framerate for the capture
- ***motionBlurFrames***: supersampling of frames to create a motion-blurred frame (0 or 1 make no effect)
- ***format***: webm/gif/png/jpg/ffmpegserver
- ***quality***: quality for webm/jpg
- ***name***: name of the files to be exported. if no name is provided, a GUID will be generated
- ***verbose***: dumps info on the console
- ***display***: adds a widget with capturing info (WIP)
- ***timeLimit***: automatically stops and downloads when reaching that time (seconds). Very convenient for long captures: set it and forget it (remember autoSaveTime!)
- ***autoSaveTime***: it will automatically download the captured data every n seconds (only available for webm/png/jpg)
- ***startTime***: skip to that mark (seconds)
- ***workersPath***: path to the gif worker script

You can decide when to start the capturer. When you call the `.start()` method, the hooks are set, so from that point on `setTimeout`, `setInterval` and other methods that are hooked will behave a bit differently. When you have everything ready to start capturing, and your animation loop is running, call:

```js
capturer.start();
```

**requestAnimationFrame, setTimeout, etc. won't work as expected after capture is started. Make sure your animation loop is running**

And then, in your `render()` method, after the frame is been drawn, call `.capture()` passing the canvas you want to capture.

```js
function render(){
	requestAnimationFrame(render);
	// rendering stuff ...
	capturer.capture( canvas );
}

render()

```

That's all. Once you're done with the animation, you can call `.stop()` and then `.save()`. That will compose the video and return a URL that can be previewed or downloaded.

```js
capturer.stop();

// default save, will download automatically a file called {name}.extension (webm/gif/tar)
capturer.save();

// custom save, will get a blob in the callback
capturer.save( function( blob ) { /* ... */ } );
```

**Note**: you don't need to `.stop()` in order to `.save()`. Call `capturer.save()` anytime you want to get a download up to that moment.

#### Limitations ####

CCapture.js only works on browsers that have a `canvas implementation.

**WebM Writer** current version only works on a browser that supports the image/webp format. Exporting video is basically Chrome-only for now :( If you want to help to make it Firefox, Opera or even Internet Explorer compatible, please do!

**gif.js** has some performance limitations, be careful if capturing a lot of frames.

**The *autoSaveTime* parameter**

Different browsers have different issues with big files: most break for big `Uint8Array` allocations, or when a file to downloads is larger than 1GB, etc. I haven't been able to find a solid solution for all, so I introduced the `autoSaveTime` parameter, just to prevent loss of large files. If used with a webm/png/jpg capturer, it will automatically compile, download and free the captured frames every *n* seconds specified in the parameter. The downloaded file will have the structure *{name}-part-00000n* and the extension (.webm or .tar). The files inside the TAR file will have the right number of sequence.

Use an `autoSaveTime` value that give you a file that is small enough to not trip the browser, but large enough to not generate a thousand part files. A value between 10 and 30 seconds for a 4K capture I've found works best: just make sure the file is under 1GB. For most regular, viewport-sized or even Full-HD captures it shouldn't be an issue, but keep in mind this issue.

**Memory allocation and garbage collection**

There's some issues in which memory -mostly from accumulated frames- will not be freed, depending on the platform and the mood of the browser. If you run into non-sawtooth like memory profiles, and are running chrome, try running it with ```--js-flags="--expose-gc"```. This way CCapture will run ```gc()``` every frame and memory consumption should stay stable.

#### Gallery ####

[![cru·ci·form 4K CCapture](http://img.youtube.com/vi/rly322ijJWA/0.jpg)](https://www.youtube.com/watch?v=rly322ijJWAY "cru·ci·form 4K CCapture")
[![obsidian by xplsv 4K CCapture](http://img.youtube.com/vi/D0qUgb6AGX8/0.jpg)](https://www.youtube.com/watch?v=D0qUgb6AGX8 "obsidian by xplsv 4K CCapture")
[![dataworld by xplsv 4K CCapture](http://img.youtube.com/vi/3HQBmurQps8/0.jpg)](https://www.youtube.com/watch?v=3HQBmurQps8 "dataworld by xplsv 4K CCapture")

#### Credits ####

- [WebM Writer](https://github.com/thenickdude/webm-writer-js) 
- Pre 1.0.9: Slightly modified version of [Whammy.js](https://github.com/antimatter15/whammy) (fixed variable size
   integer calculations)
- Slightly modified version of [tar.js](https://github.com/beatgammit/tar-js) (fixed memory allocations for many files)
- [download.js](http://danml.com/download.html)
- [Gif.js](https://github.com/jnordberg/gif.js)

#### Contributors ####

Big thanks to [hugohil](https://github.com/hugohil) and [Greggman](https://github.com/greggman)!

#### License ####

MIT licensed

Copyright (C) 2012-2016 Jaume Sanchez Elias, http://www.clicktorelease.com
