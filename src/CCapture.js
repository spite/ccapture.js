( function() { 

"use strict";

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
		_time,
		_step,
        _encoder,
		_timeouts = [],
		_frameCount = 0,
		_lastFrame = null,
		_requestAnimationFrameCallback = null,
		_capturing = false,
        _queued = false,
        _handlers = {};

	_settings.framerate = _settings.framerate || 60;
	_verbose = _settings.verbose || false;
	_settings.step = 1000.0 / _settings.framerate;
	
	_log( 'Step is set to ' + _settings.step + 'ms' );

    var _encoders = {
      gif: CCGIFEncoder,
      webm: CCWebMEncoder,
      ffmpegserver: CCFFMpegServerEncoder
    };

    var ctor = _encoders[ _settings.format ];
    if ( !ctor ) {
      throw "Error: Incorrect or missing format: Valid formats are " + Object.keys(_encoders).join(", ");
    }
    _encoder = new ctor( _settings );

	_encoder.on('process', _process);
    _encoder.on('progress', _progress);

	var _oldSetTimeout = window.setTimeout,
		_oldClearTimeout = window.clearTimeout,
		_oldRequestAnimationFrame = window.requestAnimationFrame,
		_oldNow = window.Date.now,
		_oldGetTime = window.Date.prototype.getTime;
	// Date.prototype._oldGetTime = Date.prototype.getTime;
	
    function _queueCheck() {
      if (!_queued) {
        // We use oldSetTimeout so we can run even when not the front tab.
        _queued = true;
        _oldSetTimeout( _process, 16 );  // "1" might be fine too but I want to give the browser at least a moment
      }
    }

	function _init() {
		
		_log( 'Capturer start' );
		_time = window.Date.now();
		window.Date.prototype.getTime = function(){
			return _time;
		};
		window.Date.now = function() {
			return _time;
		};
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
		}
		window.clearTimeout = function( id ) {
			for( var j = 0; j < _timeouts.length; j++ ) {
				if( _timeouts[ j ] == id ) {
					_timeouts.splice( j, 1 );
					_log( 'Timeout cleared' );
					continue;
				}
			}
		}
		window.requestAnimationFrame = function( callback ) {
			_requestAnimationFrameCallback = callback;
            _queueCheck();
		}
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
		window.clearTimeout = _oldClearTimeout;
		window.requestAnimationFrame = _oldRequestAnimationFrame;
		window.Date.prototype.getTime = _oldGetTime;
		window.Date.now = _oldNow;
	}

	function _capture( canvas ) {
	
		if( _capturing ) {
			_encoder.add( canvas );
		}
		
	}
	
	function _process() {

		if ( !_queued || !_encoder.safeToProceed() ) {

			return;

		}

		_queued = false;

		_time += _settings.step;
		_frameCount++;
		_log( 'Frame: ' + _frameCount );

		for( var j = 0; j < _timeouts.length; j++ ) {
			if( _time >= _timeouts[ j ].triggerTime ) {
				_timeouts[ j ].callback();
				console.log( 'timeout!' );
				_timeouts.splice( j, 1 );
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

        _emit( 'progess', progress );

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