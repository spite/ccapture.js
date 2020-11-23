/*
 Javascript MotionJPEG/AVI Builder

-- MIT License

Copyright (c) 2012 Satoshi Ueyama
Adapted by Elizabeth Hudnott

Permission is hereby granted, free of charge, to any person obtaining a copy of this
software and associated documentation files (the "Software"), to deal in the Software
without restriction, including without limitation the rights to use, copy, modify,
merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
*/

(function(aGlobal) {
	"use strict";
	var AVIF_HASINDEX = 0x00000010;
	var AVIIF_KEYFRAME = 0x00000010;
	var RateBase = 1000000;

	function MotionJPEGBuilder(verbose) {
		this.data = [];
		this.base64 = new Base64();
		this.movieDesc = {
			w: 0,
			h:0,
			fps: 0,
			videoStreamSize: 0,
			maxJPEGSize: 0,
		};

		this.avi = MotionJPEGBuilder.createAVIStruct();
		this.headerLIST = MotionJPEGBuilder.createHeaderLIST();
		this.moviLIST   = MotionJPEGBuilder.createMoviLIST();
		this.frameList  = [];
		this.verbose = verbose || false;
	}

	MotionJPEGBuilder.prototype = {
		setup: function(frameWidth, frameHeight, fps, quality) {
			this.movieDesc.w = frameWidth;
			this.movieDesc.h = frameHeight;
			this.movieDesc.fps = fps;
			this.quality = quality === undefined ? 0.92 : quality;
		},

		addCanvasFrame: function(canvas) {
			var url = canvas.toDataURL('image/jpeg', this.quality);
			var dataStart = url.indexOf(',') + 1;

			var bytes = this.base64.decode(url.substring(dataStart));
			if (bytes.length % 2 === 1) {
				bytes.push(0);	// padding
			}

			var arrayBuffer = new ArrayBuffer(bytes.length);
			var byteBuffer  = new Uint8Array(arrayBuffer);
			for (var i = 0;i < bytes.length; i++) {
				byteBuffer[i] = bytes[i];
			}

			var blob = new Blob([arrayBuffer], {type: 'image/jpeg'});
			var bsize = blob.size;
			this.movieDesc.videoStreamSize += bsize;
			this.frameList.push(blob);

			if (this.movieDesc.maxJPEGSize < bsize) {
				this.movieDesc.maxJPEGSize = bsize;
			}
		},

		addVideoStreamData: function(list, frameBuffer) {
			var stream = MotionJPEGBuilder.createMoviStream();
			stream.dwSize = frameBuffer.size;
			stream.handler = function(data) {
				data.push(frameBuffer);
			};

			list.push(stream);
			return stream.dwSize + 8;
		},

		finish: function(onFinish) {
			var streamSize = 0;
			this.moviLIST.aStreams = [];
			var frameCount = this.frameList.length;
			var frameIndices = [];
			var frOffset = 4; // 'movi' +0
			var IndexEntryOrder = ['chId', 'dwFlags', 'dwOffset', 'dwLength'];
			for (var i = 0; i < frameCount; i++) {
				var frsize = this.addVideoStreamData(this.moviLIST.aStreams, this.frameList[i]);
				frameIndices.push({
					chId: '00dc',
					dwFlags: AVIIF_KEYFRAME,
					dwOffset: frOffset,
					dwLength: frsize - 8,
					_order: IndexEntryOrder
				})

				frOffset += frsize;
				streamSize += frsize;
			};

			this.moviLIST.dwSize = streamSize + 4; // + 'movi'

			// stream header

			var frameDu = Math.floor(RateBase / this.movieDesc.fps);
			var strh = MotionJPEGBuilder.createStreamHeader();
			strh.wRight  = this.movieDesc.w;
			strh.wBottom = this.movieDesc.h;
			strh.dwLength = this.frameList.length;
			strh.dwScale  = frameDu;

			var bi = MotionJPEGBuilder.createBitmapHeader();
			bi.dwWidth  = this.movieDesc.w;
			bi.dwHeight = this.movieDesc.h;
			bi.dwSizeImage = 3 * bi.dwWidth * bi.dwHeight;

			var strf = MotionJPEGBuilder.createStreamFormat();
			strf.dwSize = bi.dwSize;
			strf.sContent = bi;

			var strl = MotionJPEGBuilder.createStreamHeaderLIST();
			strl.dwSize = 4 + (strh.dwSize + 8) + (strf.dwSize + 8);
			strl.aList = [strh, strf];

			// AVI Header
			var avih = MotionJPEGBuilder.createAVIMainHeader();
			avih.dwMicroSecPerFrame = frameDu;
			avih.dwMaxBytesPerSec = this.movieDesc.maxJPEGSize * this.movieDesc.fps;
			avih.dwTotalFrames = this.frameList.length;
			avih.dwWidth  = this.movieDesc.w;
			avih.dwHeight = this.movieDesc.h;
			avih.dwSuggestedBufferSize = 0;

			var hdrlSize = 4;
			hdrlSize += avih.dwSize + 8;
			hdrlSize += strl.dwSize + 8;
			this.headerLIST.dwSize = hdrlSize;
			this.headerLIST.aData = [avih, strl];

			var indexChunk = {
				chFourCC: 'idx1',
				dwSize: frameIndices.length * 16,
				aData: frameIndices,
				_order: ['chFourCC', 'dwSize', 'aData']
			};

			// AVI Container
			var aviSize = 0;
			aviSize += 8 + this.headerLIST.dwSize;
			aviSize += 8 + this.moviLIST.dwSize;
			aviSize += 8 + indexChunk.dwSize;

			this.avi.dwSize = aviSize + 4;
			this.avi.aData = [this.headerLIST, this.moviLIST, indexChunk];

			this.build(onFinish);
		},

		build: function(onFinish) {
			MotionJPEGBuilder.appendStruct(this.data, this.avi);
			var blob = new Blob(this.data, {type: 'video/avi'});
			this.data = [];
			onFinish(blob);
		}
	};

	MotionJPEGBuilder.appendStruct = function(data, s, nest) {
		nest = nest || 0;
		if (!s._order) {
			throw "Structured data must have '_order'";
		}

		var od = s._order;
		var len = od.length;
		for (var i = 0; i < len; i++) {
			var buffer;
			var fieldName = od[i];
			var val = s[fieldName];
			if (this.verbose) {
				console.log("          ".substring(0,nest) + fieldName);
			}
			switch(fieldName.charAt(0)) {
			case 'b': // BYTE
				buffer = new ArrayBuffer(1);
				var view = new Uint8Array(buffer);
				view[0] = val;
				data.push(buffer);
				break
			case 'c': // chars
				data.push(val);
				break;
			case 'd': // DWORD
				buffer = new ArrayBuffer(4);
				new DataView(buffer).setUint32(0, val, true);
				data.push(buffer);
				break;
			case 'w': // WORD
				buffer = new ArrayBuffer(2);
				new DataView(buffer).setUint16(0, val, true);
				data.push(buffer);
				break
			case 'W': // WORD(BE)
				buffer = new ArrayBuffer(2);
				new DataView(buffer).setUint16(0, val, false);
				data.push(buffer);
				break
			case 'a': // Array of structured data
				var dlen = val.length;
				for (var j = 0; j < dlen; j++) {
					MotionJPEGBuilder.appendStruct(data, val[j], nest+1);
				}
				break;
			case 'r': // Raw(ArrayBuffer)
				data.push(val);
				break;
			case 's': // Structured data
				MotionJPEGBuilder.appendStruct(data, val, nest+1);
				break;
			case 'h': // Handler function
				val(data);
				break;
			default:
				throw "Unknown data type: " + fieldName;
				break;
			}
		}
	};

	MotionJPEGBuilder.createAVIStruct = function() {
		return {
			chRIFF: 'RIFF',
			chFourCC: 'AVI ',
			dwSize: 0,
			aData: null,
			_order: ['chRIFF', 'dwSize', 'chFourCC', 'aData']
		};
	};

	MotionJPEGBuilder.createAVIMainHeader = function() {
		return {
			chFourCC: 'avih',
			dwSize: 56,
			// -----
			dwMicroSecPerFrame: 66666,
			dwMaxBytesPerSec: 1000,
			dwPaddingGranularity: 0,
			dwFlags: AVIF_HASINDEX,
			// +16

			dwTotalFrames: 1,
			dwInitialFrames: 0,
			dwStreams: 1,
			dwSuggestedBufferSize: 0,
			// +32

			dwWidth: 10,
			dwHeight: 20,
			dwReserved1: 0,
			dwReserved2: 0,
			dwReserved3: 0,
			dwReserved4: 0,
			// +56

			_order: [
				'chFourCC', 'dwSize',
				'dwMicroSecPerFrame', 'dwMaxBytesPerSec', 'dwPaddingGranularity', 'dwFlags',
				'dwTotalFrames', 'dwInitialFrames', 'dwStreams', 'dwSuggestedBufferSize',
				'dwWidth', 'dwHeight', 'dwReserved1', 'dwReserved2', 'dwReserved3', 'dwReserved4'
			]
		};
	};

	MotionJPEGBuilder.createHeaderLIST = function() {
		return {
			chLIST: 'LIST',
			dwSize: 0,
			chFourCC: 'hdrl',
			aData: null,
			_order: ['chLIST', 'dwSize', 'chFourCC', 'aData']
		};
	};

	MotionJPEGBuilder.createMoviLIST = function() {
		return {
			chLIST: 'LIST',
			dwSize: 0,
			chFourCC: 'movi',
			aStreams: null,
			_order: ['chLIST', 'dwSize', 'chFourCC', 'aStreams']
		};
	};

	MotionJPEGBuilder.createMoviStream = function() {
		return {
			chType: '00dc',
			dwSize: 0,
			handler: null,
			_order: ['chType', 'dwSize', 'handler']
		}
	};

	MotionJPEGBuilder.createStreamHeaderLIST = function() {
		return {
			chLIST: 'LIST',
			dwSize: 0,
			chFourCC: 'strl',
			aList: null,
			_order: ['chLIST', 'dwSize', 'chFourCC', 'aList']
		};
	};

	MotionJPEGBuilder.createStreamFormat = function() {
		return {
			chFourCC: 'strf',
			dwSize: 0,
			sContent: null,
			_order: ['chFourCC', 'dwSize', 'sContent']
		};
	};

	MotionJPEGBuilder.createStreamHeader = function() {
		return {
			chFourCC: 'strh',
			dwSize: 56,
			chTypeFourCC: 'vids',
			chHandlerFourCC: 'mjpg',
			// +16

			dwFlags: 0,
			wPriority: 0,
			wLanguage: 0,
			dwInitialFrames: 0,
			dwScale: 66666,

			// +32
			dwRate: RateBase,
			dwStart: 0,
			dwLength: 0,
			dwSuggestedBufferSize: 0,
			// +48

			dwQuality: 10000,
			dwSampleSize: 0,
			wLeft: 0,
			wTop: 0,
			wRight: 0,
			wBottom: 0,
			// +64

			_order:[
				 'chFourCC', 'dwSize', 'chTypeFourCC', 'chHandlerFourCC',
				 'dwFlags', 'wPriority', 'wLanguage', 'dwInitialFrames', 'dwScale',
				 'dwRate', 'dwStart', 'dwLength', 'dwSuggestedBufferSize',
				 'dwQuality', 'dwSampleSize', 'wLeft', 'wTop', 'wRight', 'wBottom'
				]
		};
	};

	MotionJPEGBuilder.createBitmapHeader = function() {
		return {
			dwSize:    40,
			dwWidth:   10,
			dwHeight:  20,
			wPlanes:   1,
			wBitcount: 24,
			chCompression: 'MJPG',
			dwSizeImage: 600,
			dwXPelsPerMeter: 0,
			dwYPelsPerMeter: 0,
			dwClrUsed: 0,
			dwClrImportant: 0,
			_order: [
				'dwSize', 'dwWidth', 'dwHeight', 'wPlanes', 'wBitcount', 'chCompression',
				'dwSizeImage', 'dwXPelsPerMeter', 'dwYPelsPerMeter', 'dwClrUsed', 'dwClrImportant'
			]
		}
	};


	MotionJPEGBuilder.createMJPEG = function() {
		return {
			W_SOI: 0xffd8,
			aSegments: null,
			W_EOI: 0xffd9,
			_order: ['dwSOI', 'aSegments', 'dwEOI']
		};
	};

	MotionJPEGBuilder.KnownMarkers = {
		0xC0: 'SOF0',
		0xC4: 'DHT',
		0xDA: 'SOS',
		0xDB: 'DQT',
		0xDD: 'DRI',
		0xE0: 'APP0'
	};

	var Base64 = function() {
		this.initialize();
	};

	Base64.prototype.initialize = function() {
		this.symbols = [];
		var startChar = "A".charCodeAt(0);
		for(var i = 0; i < 26; i++) {
			this.symbols.push(String.fromCharCode(startChar + i));
		}
		var startChar = "a".charCodeAt(0);
		for(var i = 0; i < 26; i++) {
			this.symbols.push(String.fromCharCode(startChar + i));
		}
		var startChar = "0".charCodeAt(0);
		for(var i = 0; i < 10; i++) {
			this.symbols.push(String.fromCharCode(startChar + i));
		}
		this.symbols.push("+", "/");

		this.encodeMap = [];
		for(var i = 0; i < this.symbols.length; i++) {
			this.encodeMap[i] = this.symbols[i];
		}

		this.decodeMap = [];
		for(var i = 0; i < this.symbols.length; i++) {
			this.decodeMap[this.symbols[i]] = i;
		}
		this.decodeMap["="] = null;
	};


	Base64.prototype.decode = function(encoded) {
		if(encoded.length % 4 != 0) {
			throw "encoded.length must be a multiple of 4.";
		}

		var decoded = [];
		var map = this.decodeMap;
		for (var i = 0, len = encoded.length; i < len; i += 4) {
			var b0 = map[encoded[i]];
			var b1 = map[encoded[i + 1]];
			var b2 = map[encoded[i + 2]];
			var b3 = map[encoded[i + 3]];

			var d0 = ((b0 << 2) + (b1 >> 4)) & 0xff;
			decoded.push(d0);

			if(b2 == null) break; // encoded[i + 1] == "="

			var d1 = ((b1 << 4) + (b2 >> 2)) & 0xff;
			decoded.push(d1);

			if(b3 == null) break; // encoded[i + 2] == "="

			var d2 = ((b2 << 6) + b3) & 0xff;
			decoded.push(d2);

		}

		return decoded;
	};


	// export
	aGlobal.MotionJPEGBuilder = MotionJPEGBuilder;
})(window);
