#!/bin/bash

uglifyjs ../src/CCapture.js --compress --mangle -o ../build/CCapture.min.js
uglifyjs ../src/webm-writer-0.3.0.js ../src/download.js ../src/mjbuilder.js ../src/tar.js ../src/gif.js ../src/CCapture.js --compress --mangle -o ../build/CCapture.all.min.js
uglifyjs ../src/webm-writer-0.3.0.js ../src/download.js ../src/CCapture.js --compress --mangle -o ../build/CCapture.webm.min.js
uglifyjs ../src/mjbuilder.js ../src/download.js ../src/CCapture.js --compress --mangle -o ../build/CCapture.mjpg.min.js
uglifyjs ../src/tar.js --compress --mangle -o ../build/tar.min.js
