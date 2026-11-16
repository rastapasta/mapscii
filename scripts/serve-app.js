// Serves app/ at http://localhost:8765/; with ?local, tiles and pictures come from MapSCII's disk cache.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const envPaths = require('env-paths');

const port = +(process.argv[2] || 8765);
const APP = path.join(__dirname, '..', 'app');
const CACHE = envPaths('mapscii').cache;
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.pbf': 'application/x-protobuf',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml'};

// Sends a response
function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {'Content-Type': type, 'Cache-Control': 'no-store'});
  res.end(body);
}

// Sends a file, or 404
function sendFile(res, file) {
  fs.readFile(file, (error, data) => {
    if (error) return send(res, 404, 'not found');
    send(res, 200, data, TYPES[path.extname(file)] || 'application/octet-stream');
  });
}

http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (error) {
    return send(res, 400, 'bad request');
  }
  // LOG=1 logs each request
  if (process.env.LOG) console.log(req.method, req.url);
  let p;
  try {
    p = decodeURIComponent(url.pathname);
  } catch (error) {
    return send(res, 400, 'bad request');
  }
  let m;
  if (p === '/local/tilejson.json') {
    return send(res, 200, JSON.stringify({
      tilejson: '2.0.0', tiles: ['/local/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14,
      attribution: '© OpenStreetMap contributors (MapSCII disk cache)',
      vector_layers: [{id: 'road'}, {id: 'water'}, {id: 'place_label'}],
    }), 'application/json');
  }
  if ((m = p.match(/^\/local\/(\d+)\/(\d+)\/(\d+)\.pbf$/))) {
    return sendFile(res, path.join(CACHE, m[1], `${m[2]}-${m[3]}.pbf`));
  }
  if ((m = p.match(/^\/local\/pictures\/(imagery|terrain)\/(\d+)\/(\d+)-(\d+)\.(jpg|png)$/))) {
    return sendFile(res, path.join(CACHE, 'pictures', m[1], m[2], `${m[3]}-${m[4]}.${m[5]}`));
  }
  // only files inside app/
  const file = path.normalize(path.join(APP, p.endsWith('/') ? `${p}index.html` : p));
  if (!file.startsWith(APP + path.sep)) return send(res, 403, 'no');
  sendFile(res, file);
}).listen(port, () => console.log(`the app: http://localhost:${port}/   (no internet: http://localhost:${port}/?local)`));
