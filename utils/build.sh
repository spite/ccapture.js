#!/bin/bash

java -jar compiler.jar --js=../src/CCapture.js --js_output_file=../build/CCapture.min.js
java -jar compiler.jar --js=../src/download.js --js=../src/Whammy.js --js=../src/tar.js --js=../src/gif.js --js=../src/CCapture.js --js_output_file=../build/CCapture.all.min.js