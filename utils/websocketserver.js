// http://fhtr.blogspot.com.au/2014/02/saving-out-video-frames-from-webgl-app.html
// Adapted from this _WikiBooks OpenGL Programming Video Capture article_.
var port = 8889;
var ws = require('ws');
var fs = require('fs');
var frame = 0;
var path = "../../../output";

var WebSocketServer = require('ws').Server, wss = new WebSocketServer({ port: port });

wss.on('connection', function connection(ws) {
  frame = 0;

  var d = new Date();
  var directory = path + "/" + d.toISOString();

  fs.mkdir(path, '755', function() {});
  fs.mkdir(directory, '755', function() {});

  ws.on('message', function incoming(data, filename, x) {
    console.log("filename")
    console.log(filename)

    base64Data = data.toString('base64');

    // Allows for up to 1 hour of encoded data at 25fps.
    var filename = ("00000" + frame).slice(-5)+".png";

    fs.writeFile(directory + "/" + filename, base64Data, 'base64', function(err) {
        if ( err ) console.log(err);
    });

    console.log('Wrote ' + filename);
    frame++;
  });
});

console.log('Server running at ws://127.0.0.1:'+port+'/');
