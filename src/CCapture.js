( function() { 

"use strict";

// https://developer.mozilla.org/en-US/Add-ons/Code_snippets/Timers

var g_startTime = window.Date.now();

function CCFrameEncoder() {

	var _handlers = {};

	this.on = function(event, handler) {

		_handlers[event] = handler;

	};

	this.emit = function(event) {

		var handler = _handlers[event];
		if (handler) {

			handler.apply(null, Array.prototype.slice.call(arguments, 1));

		}

	};

}

CCFrameEncoder.start = function(){};
CCFrameEncoder.stop = function(){};
CCFrameEncoder.add = function(){};
CCFrameEncoder.save = function(){};
CCFrameEncoder.safeToProceed = function(){ return true; };

function CCWebMEncoder( settings ) {

	CCFrameEncoder.call( this );

	settings.quality = ( settings.quality / 100 ) || .8;
	
	this.settings = settings;
	this.encoder = new Whammy.Video( settings.framerate, settings.quality );

}

CCWebMEncoder.prototype = Object.create( CCFrameEncoder );

CCWebMEncoder.prototype.add = function( canvas ) {

	this.encoder.add( canvas );

}

CCWebMEncoder.prototype.save = function( callback ) {

	var output = this.encoder.compile(); 
	var blob = new Blob( [ output ], { type: "octet/stream" } );
	var url = window.URL.createObjectURL( blob );
	callback( url );

}

function CCFileEncoder( settings ) {

	CCFrameEncoder.call( this );
	
	this.settings = settings;
	this.files = [];
	this.convertingToBlob = false;

}

CCFileEncoder.prototype = Object.create( CCFrameEncoder );

CCFileEncoder.prototype.add = function( canvas ) {

	this.convertingToBlob = true;
	/*canvas.toBlob( function( blob ) {
		this.files.push( blob )
		this.convertingToBlob = false;
	}.bind( this ) )*/

	var type = 'image/png'
	var quality = 1;
	var binStr = atob( canvas.toDataURL( type, quality).split(',')[1] ),
		len = binStr.length,
		arr = new Uint8Array(len);

	for (var i=0; i<len; i++ ) {
		arr[i] = binStr.charCodeAt(i);
	}

	this.files.push( arr )

}

CCFileEncoder.prototype.safeToProceed = function() {
	return true;//this.convertingToBlob === false;
}

CCFileEncoder.prototype.save = function( callback ) {

	/*var zip = new JSZip();
	this.files.forEach( function( f, id ) {
		zip.file( String("0000000" + id).slice(-7) + '.png', f );
	} );
	var blob = zip.generate({type:"blob"});
	var url = window.URL.createObjectURL( blob );
	callback( url );*/

	function uint8ToString(buf) {
		var i, length, out = '';
		for (i = 0, length = buf.length; i < length; i += 1) {
			out += String.fromCharCode(buf[i]);
		}

		return out;
	}

	var tar = new Tar();
	var out
	this.files.forEach( function( f, id ) {
		out = tar.append( String("0000000" + id).slice(-7) + '.png', f );
	} );
	base64 = btoa(uint8ToString(out));

	url = "data:application/tar;base64," + base64;
	callback(url);


}

function CCFFMpegServerEncoder( settings ) {

	CCFrameEncoder.call( this );

	settings.quality = ( settings.quality / 100 ) || .8;

	this.settings = settings;
	this.encoder = new FFMpegServer.Video( settings );
    this.encoder.on( 'process', function() {
        this.emit( 'process' )
    }.bind( this ) );
    this.encoder.on('finished', function( url, size ) {
        var cb = this.callback;
        if ( cb ) {
            this.callback = undefined;
            cb( url, size );
        }
    }.bind( this ) );
    this.encoder.on( 'progress', function( progress ) {
        if ( this.settings.onProgress ) {
            this.settings.onProgress( progress )
        }
    }.bind( this ) );
    this.encoder.on( 'error', function( data ) {
        alert(JSON.stringify(data, null, 2));
    }.bind( this ) );

}

CCFFMpegServerEncoder.prototype = Object.create( CCFrameEncoder );

CCFFMpegServerEncoder.prototype.start = function() {

	this.encoder.start( this.settings );

};

CCFFMpegServerEncoder.prototype.add = function( canvas ) {

	this.encoder.add( canvas );

}

CCFFMpegServerEncoder.prototype.save = function( callback ) {

    this.callback = callback;
    this.encoder.end();

}

CCFFMpegServerEncoder.prototype.safeToProceed = function() {
    return this.encoder.safeToProceed();
};


/*function CCGIFEncoder( settings ) {

	CCFrameEncoder.call( this );

	settings.quality = settings.quality || 6;
	this.settings = settings;

	this.encoder = new GIFEncoder();
	this.encoder.setRepeat( 1 );
  	this.encoder.setDelay( settings.step );
  	this.encoder.setQuality( 6 );
  	this.encoder.setTransparent( null );
  	this.encoder.setSize( 150, 150 );

  	this.canvas = document.createElement( 'canvas' );
  	this.ctx = this.canvas.getContext( '2d' );
	
}

CCGIFEncoder.prototype = Object.create( CCFrameEncoder );

CCGIFEncoder.prototype.start = function() {

	this.encoder.start();

}

CCGIFEncoder.prototype.add = function( canvas ) {

	this.canvas.width = canvas.width;
	this.canvas.height = canvas.height;
	this.ctx.drawImage( canvas, 0, 0 );
	this.encoder.addFrame( this.ctx );

	this.encoder.setSize( canvas.width, canvas.height );
	var readBuffer = new Uint8Array(canvas.width * canvas.height * 4);
	var context = canvas.getContext( 'webgl' );
	context.readPixels(0, 0, canvas.width, canvas.height, context.RGBA, context.UNSIGNED_BYTE, readBuffer);
	this.encoder.addFrame( readBuffer, true );

}

CCGIFEncoder.prototype.stop = function() {

	this.encoder.finish();
	
}

CCGIFEncoder.prototype.save = function( callback ) {

	var binary_gif = this.encoder.stream().getData();

	var data_url = 'data:image/gif;base64,'+encode64(binary_gif);
	window.location = data_url;
	return;

	var blob = new Blob( [ binary_gif ], { type: "octet/stream" } );
	var url = window.URL.createObjectURL( blob );
	callback( url );

}*/

function CCGIFEncoder( settings ) {

	CCFrameEncoder.call( this );

	settings.quality = 31 - ( ( settings.quality * 30 / 100 ) || 10 );
	settings.workers = settings.workers || 4;
	this.settings = settings;

  	this.canvas = document.createElement( 'canvas' );
  	this.ctx = this.canvas.getContext( '2d' );
  	this.sizeSet = false;

  	this.encoder = new GIF({
		workers: settings.workers,
		quality: settings.quality,
		workerScript: settings.workersPath + 'gif.worker.js'
	} );
  		
    this.encoder.on( 'progress', function( progress ) {
        if ( this.settings.onProgress ) {
            this.settings.onProgress( progress )
        }
    }.bind( this ) );

    this.encoder.on('finished', function( blob ) {
        var cb = this.callback;
        if ( cb ) {
            this.callback = undefined;
            cb( URL.createObjectURL(blob) );
        }
    }.bind( this ) );

}

CCGIFEncoder.prototype = Object.create( CCFrameEncoder );

CCGIFEncoder.prototype.add = function( canvas ) {

	if( !this.sizeSet ) {
		this.encoder.setOption( 'width',canvas.width );
		this.encoder.setOption( 'height',canvas.height );
		this.sizeSet = true;
	}

	this.canvas.width = canvas.width;
	this.canvas.height = canvas.height;
	this.ctx.drawImage( canvas, 0, 0 );

	this.encoder.addFrame( this.ctx, { copy: true, delay: this.settings.step } );

	/*this.encoder.setSize( canvas.width, canvas.height );
	var readBuffer = new Uint8Array(canvas.width * canvas.height * 4);
	var context = canvas.getContext( 'webgl' );
	context.readPixels(0, 0, canvas.width, canvas.height, context.RGBA, context.UNSIGNED_BYTE, readBuffer);
	this.encoder.addFrame( readBuffer, true );*/

}

CCGIFEncoder.prototype.save = function( callback ) {

    this.callback = callback;

	this.encoder.render();

}

function CCapture( settings ) {

	var _settings = settings || {},
		_date = new Date(),
		_verbose,
		_display,
		_startTime,
		_time,
		_performanceStartTime,
		_performanceTime,
		_step,
        _encoder,
		_timeouts = [],
		_intervals = [],
		_frameCount = 0,
		_intermediateFrameCount = 0,
		_lastFrame = null,
		_requestAnimationFrameCallback = null,
		_capturing = false,
        _queued = false,
        _handlers = {};

	_settings.framerate = _settings.framerate || 60;
	_settings.motionBlurFrames = 2 * _settings.motionBlurFrames || 1;
	_verbose = _settings.verbose || false;
	_display = _settings.display || false;
	_settings.step = 1000.0 / _settings.framerate ;
	_settings.timeLimit = _settings.timeLimit || 0;
	_settings.frameLimit = _settings.frameLimit || 0;

	var _timeDisplay = document.createElement( 'div' );
	_timeDisplay.style.position = 'absolute';
	_timeDisplay.style.left = _timeDisplay.style.top = 0
	_timeDisplay.style.backgroundColor = 'black';
	_timeDisplay.style.fontFamily = 'monospace'
	_timeDisplay.style.fontSize = '11px'
	_timeDisplay.style.padding = '5px'
	_timeDisplay.style.color = 'red';
	_timeDisplay.style.zIndex = 100000
	document.body.appendChild( _timeDisplay );
	
	_log( 'Step is set to ' + _settings.step + 'ms' );

	var canvasMotionBlur = document.createElement( 'canvas' );
	var ctxMotionBlur = canvasMotionBlur.getContext( '2d' );
	var bufferMotionBlur;

    var _encoders = {
		gif: CCGIFEncoder,
		webm: CCWebMEncoder,
		ffmpegserver: CCFFMpegServerEncoder,
		png: CCFileEncoder,
		jpeg: CCFileEncoder
    };

    var ctor = _encoders[ _settings.format ];
    if ( !ctor ) {
		throw "Error: Incorrect or missing format: Valid formats are " + Object.keys(_encoders).join(", ");
    }
    _encoder = new ctor( _settings );

	_encoder.on('process', _process);
    _encoder.on('progress', _progress);

    if ("performance" in window == false) {
    	window.performance = {};
    }

	Date.now = (Date.now || function () {  // thanks IE8
		return new Date().getTime();
	});

	if ("now" in window.performance == false){

		var nowOffset = Date.now();

		if (performance.timing && performance.timing.navigationStart){
			nowOffset = performance.timing.navigationStart
		}

		window.performance.now = function now(){
			return Date.now() - nowOffset;
		}
	}

	var _oldSetTimeout = window.setTimeout,
		_oldSetInterval = window.setInterval,
		_oldClearTimeout = window.clearTimeout,
		_oldRequestAnimationFrame = window.requestAnimationFrame,
		_oldNow = window.Date.now,
		_oldPerformanceNow = window.performance.now,
		_oldGetTime = window.Date.prototype.getTime;
	// Date.prototype._oldGetTime = Date.prototype.getTime;
	
	var media = [];

    function _queueCheck() {
      if (!_queued) {
        // We use oldSetTimeout so we can run even when not the front tab.
        _queued = true;
        _oldSetTimeout( _process, 10 );  // "1" might be fine too but I want to give the browser at least a moment
      }
    }

	function _init() {
		
		_log( 'Capturer start' );
		_startTime = window.Date.now();
		_time = _startTime;
		_performanceStartTime = window.performance.now();
		_performanceTime = _performanceStartTime;

		window.Date.prototype.getTime = function(){
			return _time;
		};
		
		window.Date.now = function() {
			return _time;
		};

		if( _settings.timeouts ) {
			window.setTimeout = function( callback, time ) {
				var t = { 
					callback: callback, 
					time: time,
					triggerTime: _time + time
				};
				_timeouts.push( t );
				_log( 'Timeout set to ' + t.time );
	            _queueCheck();
				return t;
			};
			window.clearTimeout = function( id ) {
				for( var j = 0; j < _timeouts.length; j++ ) {
					if( _timeouts[ j ] == id ) {
						_timeouts.splice( j, 1 );
						_log( 'Timeout cleared' );
						continue;
					}
				}
			};
			window.setInterval = function( callback, time ) {
				var t = { 
					callback: callback, 
					time: time,
					triggerTime: _time + time
				};
				_intervals.push( t );
				_log( 'Interval set to ' + t.time );
		        _queueCheck();
				return t;
			};
		}

		window.requestAnimationFrame = function( callback ) {
			_requestAnimationFrameCallback = callback;
            _queueCheck();
		};

		window.performance.now = function(){
			return _performanceTime;
		};

		function hookCurrentTime() { 
			if( !this._hooked ) {
				this._hooked = true;
				this._hookedTime = this.currentTime || 0;
				this.pause();
				media.push( this );
			}
			return this._hookedTime;
		};

		Object.defineProperty( HTMLVideoElement.prototype, 'currentTime', { get: hookCurrentTime } )
		Object.defineProperty( HTMLAudioElement.prototype, 'currentTime', { get: hookCurrentTime } )

	}
	
	function _start() {
		_init();
		_encoder.start();
		_capturing = true;
	}
	
	function _stop() {
		_capturing = false;
		_encoder.stop();
		_destroy();
	}
	
	function _destroy() {
		_log( 'Capturer stop' );
		window.setTimeout = _oldSetTimeout;
		window.setInterval = _oldSetInterval;
		window.clearTimeout = _oldClearTimeout;
		window.requestAnimationFrame = _oldRequestAnimationFrame;
		window.Date.prototype.getTime = _oldGetTime;
		window.Date.now = _oldNow;
		window.performance.now = _oldPerformanceNow;

		//Object.defineProperty( HTMLVideoElement.prototype, 'currentTime', { get: HTMLVideoElement.prototype.hookCurrentTime } )
		//Object.defineProperty( HTMLAudioElement.prototype, 'currentTime', { get: HTMLAudioElement.prototype.hookCurrentTime } )

	}

	function _checkFrame( canvas ) {

		if( canvasMotionBlur.width !== canvas.width || canvasMotionBlur.height !== canvas.height ) {
			canvasMotionBlur.width = canvas.width;
			canvasMotionBlur.height = canvas.height;
			bufferMotionBlur = new Uint16Array( canvasMotionBlur.height * canvasMotionBlur.width * 4 );
			ctxMotionBlur.fillStyle = '#0'
			ctxMotionBlur.fillRect( 0, 0, canvasMotionBlur.width, canvasMotionBlur.height );
		}

	}

	function _blendFrame( canvas ) {

		//_log( 'Intermediate Frame: ' + _intermediateFrameCount );

		ctxMotionBlur.drawImage( canvas, 0, 0 );
		var imageData = ctxMotionBlur.getImageData( 0, 0, canvasMotionBlur.width, canvasMotionBlur.height ).data;
		for( var j = 0; j < bufferMotionBlur.length; j+= 4 ) {
			bufferMotionBlur[ j ] += imageData[ j ];
			bufferMotionBlur[ j + 1 ] += imageData[ j + 1 ];
			bufferMotionBlur[ j + 2 ] += imageData[ j + 2 ];
		}
		_intermediateFrameCount++;

	}

	function _saveFrame(){

		var imageData = ctxMotionBlur.getImageData( 0, 0, canvasMotionBlur.width, canvasMotionBlur.height );
		var data = imageData.data;
		for( var j = 0; j < bufferMotionBlur.length; j+= 4 ) {
			data[ j ] = bufferMotionBlur[ j ] * 2 / _settings.motionBlurFrames;
			data[ j + 1 ] = bufferMotionBlur[ j + 1 ] * 2 / _settings.motionBlurFrames;
			data[ j + 2 ] = bufferMotionBlur[ j + 2 ] * 2 / _settings.motionBlurFrames;
		}
		ctxMotionBlur.putImageData( imageData, 0, 0 );
		_encoder.add( canvasMotionBlur );
		_log( 'Full MB Frame! ' + _frameCount + ' ' +  _time + ' ' + _intermediateFrameCount + ' intermediate frames¡' );
		_updateTime();
		_intermediateFrameCount = 0;
		for( var j = 0; j < bufferMotionBlur.length; j+= 4 ) {
			bufferMotionBlur[ j ] = 0;
			bufferMotionBlur[ j + 1 ] = 0;
			bufferMotionBlur[ j + 2 ] = 0;
		}
		//gc();

	}

	function _updateTime() {

		_frameCount++;
		var seconds = _frameCount / _settings.framerate;
		if( ( _settings.frameLimit && _frameCount >= _settings.frameLimit ) || ( _settings.timeLimit && seconds >= _settings.timeLimit ) ) {
			_stop();
			_save( function( blob ) { window.location = blob; } );
		}
		var d = new Date( null );
		d.setSeconds( seconds );
		_timeDisplay.textContent = 'CCapture ' + _settings.format + ' | ' + _frameCount + ' frames | ' +  d.toISOString().substr( 11, 8 );

	}

	function _capture( canvas ) {
	
		if( _capturing ) {

			if( _settings.motionBlurFrames > 1 ) {

				_checkFrame( canvas );
				_blendFrame( canvas );

				if( _intermediateFrameCount >= _settings.motionBlurFrames ) {
					_saveFrame();					
				}


			} else {
				_encoder.add( canvas );
				_updateTime();
				_log( 'Full Frame! ' + _frameCount );
			}

		}
		
	}
	
	function _process() {

		if ( !_queued || !_encoder.safeToProceed() ) {

			return;

		}

		_queued = false;

		var elapsedFrames = 1;
		if( _settings.motionBlurFrames > 1 && _intermediateFrameCount === .5 * _settings.motionBlurFrames ) {
			elapsedFrames = .5 * _settings.motionBlurFrames;
			_saveFrame();
		} 

		var step = 1000 / _settings.framerate;
		var dt = ( _frameCount + _intermediateFrameCount / _settings.motionBlurFrames ) * step;

		_time = _startTime + dt;
		_performanceTime = _performanceStartTime + dt;
		media.forEach( function( v ) {
			v._hookedTime = dt / 1000;
		} );
		//_log( 'SubFrame: ' + _frameCount );

		for( var j = 0; j < _timeouts.length; j++ ) {
			if( _time >= _timeouts[ j ].triggerTime ) {
				_timeouts[ j ].callback();
				console.log( 'timeout!' );
				_timeouts.splice( j, 1 );
				continue;
			}
		}

		for( var j = 0; j < _intervals.length; j++ ) {
			if( _time >= _intervals[ j ].triggerTime ) {
				_intervals[ j ].callback();
				_intervals[ j ].triggerTime += _intervals[ j ].time;
				console.log( 'interval!' );
				continue;
			}
		}
		
        var cb =  _requestAnimationFrameCallback;
		if( cb ) {
			_requestAnimationFrameCallback = null;
			cb( _time - g_startTime );
        }
	}
	
	function _save( callback ) {

		_encoder.save( callback );
		
	}
	
	function _log( message ) {
		if( _verbose ) console.log( message );
	}

    function _on( event, handler ) {

        _handlers[event] = handler;

    }

    function _emit( event ) {

        var handler = _handlers[event];
        if ( handler ) {

            handler.apply( null, Array.prototype.slice.call( arguments, 1 ) );

        }

    }

    function _progress( progress ) {

        _emit( 'progress', progress );

    }

	return {
		start: _start,
		capture: _capture,
		stop: _stop,
		save: _save,
        on: _on
	}
}

window.CCapture = CCapture;

}) ();