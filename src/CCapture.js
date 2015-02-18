( function() { 

function CCFrameEncoder() {

}

CCFrameEncoder.start = function(){};
CCFrameEncoder.stop = function(){};
CCFrameEncoder.add = function(){};
CCFrameEncoder.save = function(){};

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

	this.encoder.on( 'finished', function(blob) {
		callback(URL.createObjectURL(blob));
	});

	if( this.settings.onProgress ) {
		this.encoder.on( 'progress', this.settings.onProgress );
	}

	this.encoder.render();

}

function CCapture( settings ) {

	var _settings = settings || {},
		_date = new Date(),
		_verbose,
		_time,
		_step,
		_timeouts = [],
		_frameCount = 0,
		_lastFrame = null,
		_requestAnimationFrameCallback = null,
		_capturing = false;

	_settings.framerate = _settings.framerate || 60;
	_verbose = _settings.verbose || false;
	_settings.step = 1000.0 / _settings.framerate;
	
	_log( 'Step is set to ' + _settings.step + 'ms' );

	var encoder;
	switch( _settings.format ) {
		case 'gif': _encoder = new CCGIFEncoder( _settings ); break;
		case 'webm': _encoder = new CCWebMEncoder( _settings ); break;
		default: throw "Error: Format not specified (gif or webm)";
	}

	var _oldSetTimeout = setTimeout,
		_oldClearTimeout = clearTimeout,
		_oldRequestAnimationFrame = requestAnimationFrame,
		_oldNow = Date.now,
		_oldGetTime = Date.prototype.getTime;
	// Date.prototype._oldGetTime = Date.prototype.getTime;
	
	function _init() {
		
		_log( 'Capturer start' );
		_time = Date.now();
		Date.prototype.getTime = function(){
			return _time;
		};
		Date.now = function() {
			return _time;
		};
		setTimeout = function( callback, time ) {
			var t = { 
				callback: callback, 
				time: time,
				triggerTime: _time + time
			};
			_timeouts.push( t );
			_log( 'Timeout set to ' + t.time );
			return t;
		}
		clearTimeout = function( id ) {
			for( var j = 0; j < _timeouts.length; j++ ) {
				if( _timeouts[ j ] == id ) {
					_timeouts.splice( j, 1 );
					_log( 'Timeout cleared' );
					continue;
				}
			}
		}
		requestAnimationFrame = function( callback ) {
			_requestAnimationFrameCallback = callback;
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
		setTimeout = _oldSetTimeout;
		clearTimeout = _oldClearTimeout;
		requestAnimationFrame = _oldRequestAnimationFrame;
		Date.prototype.getTime = _oldGetTime;
		Date.now = _oldNow;
	}

	function _capture( canvas ) {
	
		if( _capturing ) {
			_encoder.add( canvas );
	        _oldRequestAnimationFrame( _process );
		}
		
	}
	
	function _process() {
	
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
		
		if( _requestAnimationFrameCallback ) 
			_requestAnimationFrameCallback();
	}
	
	function _save( callback ) {

		_encoder.save( callback );
		
	}
	
	function _log( message ) {
		if( _verbose ) console.log( message );
	}

	return {
		start: _start,
		capture: _capture,
		stop: _stop,
		save: _save
	}
}

window.CCapture = CCapture;

}) ();