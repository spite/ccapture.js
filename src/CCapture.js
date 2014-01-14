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
	_step = 1000.0 / _settings.framerate;
	
	var _encoder = new Whammy.Video( _settings.framerate );

	var _oldSetTimeout = setTimeout,
		_oldClearTimeout = clearTimeout,
		_oldRequestAnimationFrame = requestAnimationFrame,
		_oldNow = Date.now,
		_oldGetTime = Date.prototype.getTime;
	// Date.prototype._oldGetTime = Date.prototype.getTime;
	
	function _init() {
		
		_log( 'Capturer start' );
		_time = _date.getTime();
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
		_capturing = true;
	}
	
	function _stop() {
		_capturing = false;
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
			_log( 'Frame saved' );
		}
        _oldRequestAnimationFrame( _process );
		
	}
	
	function _process() {
	
		_log( 'Incrementing time' );
		_time += _step;
		_frameCount++;
		
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
	
	function _save() {
	
		var output = _encoder.compile(); 
		var url = (window.webkitURL || window.URL).createObjectURL(output);
		return url;
		
	}
	
	function _log( message ) {
		if( _verbose ) console.log( message );
	}
	
	_init();
	
	return {
		start: _start,
		capture: _capture,
		stop: _stop,
		save: _save
	}
}