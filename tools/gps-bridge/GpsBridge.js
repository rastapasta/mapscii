// Takes positions from a USB GPS, gpsd, NMEA over TCP, phone apps or a recorded file;
// streams them at /stream and records GPX.
'use strict';
const fs = require('fs');
const net = require('net');
const http = require('http');
const path = require('path');
const {execFileSync} = require('child_process');
const {NmeaReader} = require('../../src/Nmea');
const GpxWriter = require('../../src/GpxWriter');
const Gpx = require('../../src/Gpx');
const {readReport} = require('../../src/PhoneReport');

class GpsBridge {
  // options: {record (folder or null), minDistance (m), minInterval (s), maxAccuracy (m), token}
  constructor(options = {}) {
    this.options = Object.assign({record: null, minDistance: 5, minInterval: 30, maxAccuracy: 50, token: null}, options);
    this.position = null;
    this.clients = new Set();
    this.stats = {received: 0, recorded: 0, skipped: 0, source: null, status: 'waiting for a position'};
    this.writer = null;
    this.writerDay = null;
    this.fleetTarget = null;
    this.lastRecorded = null;
    this.stops = [];
  }

  // A new position from any source: passed on, recorded and sent to the fleet
  update(position, source) {
    if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lon) ||
        Math.abs(position.lat) > 90 || Math.abs(position.lon) > 180) {
      return;
    }
    const p = Object.assign({}, position, {source});
    if (!p.time) p.time = new Date().toISOString();
    this.position = p;
    for (const key of ['speed', 'course', 'altitude']) {
      if (typeof p[key] === 'number') p[key] = Math.round(p[key] * 10) / 10;
    }
    this.stats.received++;
    this.stats.source = source;
    this.stats.status = 'receiving';
    const line = JSON.stringify(p) + '\n';
    for (const client of this.clients) {
      client.write(line);
    }
    this._record(p);
    this._toFleet(p);
  }

  // at most every 15 s or after 25 m, so it costs little data
  fleet(url, name, token = null) {
    this.fleetTarget = {url: url.replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'http://') + '/report', name, token, last: null, busy: false};
  }

  // Passes the position on to a fleet server, at most every 15 s or after 25 m
  _toFleet(p) {
    const target = this.fleetTarget;
    if (!target || target.busy) return;
    const last = target.last;
    if (last && Date.now() - last.at < 15000 && Gpx.length([last, p]) * 1000 < 25) return;
    target.busy = true;
    const body = JSON.stringify(Object.assign({device: target.name}, p, {source: undefined, token: target.token || undefined}));
    const req = http.request(target.url, {method: 'POST', headers: {'Content-Type': 'application/json'}, timeout: 20000}, (res) => {
      res.resume();
      target.busy = false;
      if (res.statusCode === 200) {
        target.last = {lat: p.lat, lon: p.lon, at: Date.now()};
        this.stats.fleet = 'passed on';
      } else {
        this.stats.fleet = `the fleet server answered ${res.statusCode}`;
      }
    });
    req.on('error', (error) => {
      target.busy = false;
      this.stats.fleet = `fleet server: ${error.code === 'ECONNREFUSED' ? 'not there' : error.message}`;
    });
    req.on('timeout', () => req.destroy(new Error('no answer')));
    req.end(body);
  }

  // Adds the position to the day's GPX track, skipping rough or too close fixes
  _record(p) {
    if (!this.options.record) return;
    // rough fixes would make a zigzag
    if (p.accuracy !== undefined && p.accuracy > this.options.maxAccuracy) {
      this.stats.skipped++;
      return;
    }
    const last = this.lastRecorded;
    if (last) {
      const moved = Gpx.length([last, p]) * 1000;
      const seconds = (Date.parse(p.time) - Date.parse(last.time)) / 1000;
      if (moved < this.options.minDistance && !(seconds >= this.options.minInterval)) {
        return;
      }
    }
    const when = new Date(p.time);
    const pad = (n) => String(n).padStart(2, '0');
    const day = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
    if (day !== this.writerDay) {
      if (this.writer) this.writer.close();
      this.writer = new GpxWriter(path.join(this.options.record, `${day}.gpx`), `Track of ${day}`);
      this.writerDay = day;
    }
    this.writer.add(p);
    this.lastRecorded = p;
    this.stats.recorded++;
  }

  // The GPX file being recorded, or null
  trackFile() {
    return this.writer ? this.writer.file : null;
  }

  // --- sources ------------------------------------------------------------

  // reopened when unplugged
  device(file, baud = null) {
    let stopped = false;
    let stream = null;
    const open = () => {
      if (stopped) return;
      if (baud) {
        try {
          execFileSync('stty', ['-F', file, String(baud), 'raw', '-echo'], {stdio: 'ignore'});
        } catch (error) {
          void 0;
        }
      }
      const reader = new NmeaReader((p) => this.update(p, file));
      stream = fs.createReadStream(file);
      stream.on('data', (chunk) => reader.write(chunk));
      stream.on('error', (error) => {
        this.stats.status = `${file}: ${error.code === 'ENOENT' ? 'not plugged in' : error.code === 'EACCES' ? 'no permission (add yourself to the group "dialout")' : error.message}`;
      });
      stream.on('close', () => setTimeout(open, 3000).unref());
    };
    open();
    this.stops.push(() => {
      stopped = true;
      if (stream) stream.destroy();
    });
  }

  // e.g. phone apps such as "GPS2IP"; reconnects
  tcp(host, port) {
    this._connect(host, port, (socket) => {
      const reader = new NmeaReader((p) => this.update(p, `${host}:${port}`));
      socket.on('data', (chunk) => reader.write(chunk));
    });
  }

  // gpsd, the GPS service of Linux
  gpsd(host = '127.0.0.1', port = 2947) {
    this._connect(host, port, (socket) => {
      socket.write('?WATCH={"enable":true,"json":true};\n');
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          let report;
          try {
            report = JSON.parse(line);
          } catch (error) {
            continue;
          }
          if (report.class !== 'TPV' || !(report.mode >= 2) || report.lat === undefined) continue;
          const p = {lat: report.lat, lon: report.lon, time: report.time};
          if (report.speed !== undefined) p.speed = report.speed * 3.6;
          if (report.track !== undefined) p.course = report.track;
          if (report.altMSL !== undefined || report.alt !== undefined) p.altitude = report.altMSL !== undefined ? report.altMSL : report.alt;
          const err = report.eph !== undefined ? report.eph : report.epx !== undefined ? Math.max(report.epx, report.epy || 0) : undefined;
          if (err !== undefined) p.accuracy = Math.round(err);
          this.update(p, `gpsd ${host}:${port}`);
        }
      });
    });
  }

  // A TCP connection that reconnects when it drops
  _connect(host, port, onSocket) {
    let stopped = false;
    let socket = null;
    const connect = () => {
      if (stopped) return;
      socket = net.connect(port, host);
      socket.on('connect', () => onSocket(socket));
      socket.on('error', (error) => {
        this.stats.status = `${host}:${port}: ${error.code === 'ECONNREFUSED' ? 'nothing there (is the app or gpsd running?)' : error.message}`;
      });
      socket.on('close', () => setTimeout(connect, 3000).unref());
    };
    connect();
    this.stops.push(() => {
      stopped = true;
      if (socket) socket.destroy();
    });
  }

  // GPX without times plays one point a second
  replay(file, {speed = 1, loop = false} = {}) {
    const text = fs.readFileSync(file, 'utf8');
    let positions;
    if (/<gpx[\s>]/.test(text)) {
      positions = Gpx.parse(text).tracks.flatMap((track) => track.points);
    } else {
      positions = [];
      const reader = new NmeaReader((p) => positions.push(p));
      reader.write(text + '\n');
    }
    if (!positions.length) {
      throw new Error(`${file} has no positions`);
    }
    let i = 0;
    let timer = null;
    const next = () => {
      if (i >= positions.length) {
        if (!loop) {
          this.stats.status = 'replay finished';
          return;
        }
        i = 0;
      }
      const p = Object.assign({}, positions[i]);
      // times shifted to now, so the track is recorded as today's
      p.time = new Date().toISOString();
      this.update(p, `replay of ${path.basename(file)}`);
      i++;
      const a = Date.parse(positions[i - 1].time);
      const b = i < positions.length ? Date.parse(positions[i].time) : NaN;
      const gap = Number.isFinite(a) && Number.isFinite(b) && b >= a ? (b - a) : 1000;
      timer = setTimeout(next, Math.min(gap, 60000) / speed);
    };
    next();
    this.stops.push(() => clearTimeout(timer));
    return positions.length;
  }

  // --- the HTTP side --------------------------------------------------------

  // Starts listening; resolves with the port
  listen(port = 2948, host = '0.0.0.0') {
    this.server = http.createServer((req, res) => {
      // one bad request must not end the bridge
      try {
        this._handle(req, res);
      } catch (error) {
        answerError(res, error);
      }
    });
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => resolve(this.server.address().port));
    });
  }

  // Answers a request: the stream, the latest position, a phone report or the page
  _handle(req, res) {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch (error) {
      res.writeHead(400, {'Content-Type': 'text/plain'});
      return res.end('bad request');
    }
    const cors = {'Access-Control-Allow-Origin': '*'};
    if (req.method === 'GET' && url.pathname === '/stream') {
      res.writeHead(200, {'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache', ...cors});
      if (this.position) res.write(JSON.stringify(this.position) + '\n');
      this.clients.add(res);
      // a blank line now and then keeps the connection alive through routers
      const ping = setInterval(() => res.write('\n'), 15000);
      req.on('close', () => {
        clearInterval(ping);
        this.clients.delete(res);
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/position') {
      if (!this.position) {
        res.writeHead(204, cors);
        return res.end();
      }
      res.writeHead(200, {'Content-Type': 'application/json', ...cors});
      return res.end(JSON.stringify(this.position));
    }
    if (req.method === 'GET' && url.pathname === '/track.gpx') {
      const file = this.trackFile();
      if (!file) {
        res.writeHead(404, {'Content-Type': 'text/plain', ...cors});
        return res.end('nothing recorded yet');
      }
      res.writeHead(200, {'Content-Type': 'application/gpx+xml', 'Content-Disposition': `attachment; filename="${path.basename(file)}"`, ...cors});
      return fs.createReadStream(file).pipe(res);
    }
    if (url.pathname === '/log' || (req.method === 'POST' && url.pathname === '/')) {
      return this._phone(req, res, url);
    }
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      // the Host header comes from the client: escape it
      return res.end(this._page(String(req.headers.host || 'this-computer:2948').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)));
    }
    res.writeHead(404, {'Content-Type': 'text/plain', ...cors});
    res.end('not found');
  }

  // Takes a position reported by a phone app
  _phone(req, res, url) {
    readReport(req, url).then(({position, token}) => {
      if (this.options.token && token !== this.options.token) {
        res.writeHead(403, {'Content-Type': 'text/plain'});
        return res.end('wrong or missing token');
      }
      if (!position) {
        res.writeHead(400, {'Content-Type': 'text/plain'});
        return res.end('expected lat and lon (GPSLogger: ?lat=%LAT&lon=%LON) or an OwnTracks location');
      }
      this.update(position, `phone ${req.socket.remoteAddress}`);
      // OwnTracks expects a JSON array back
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end('[]');
    }).catch((error) => answerError(res, error));
  }

  // The page shown in a browser: the position and how to connect
  _page(host) {
    const token = this.options.token ? '&amp;token=YOUR-TOKEN' : '';
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MapSCII GPS bridge</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40em;margin:2em auto;padding:0 1em}code{background:#eee;padding:.1em .3em;word-break:break-all}</style>
<h1>MapSCII GPS bridge</h1>
<p>${this.position ? `Last position: ${this.position.lat.toFixed(5)}, ${this.position.lon.toFixed(5)} (${this.position.time}, from ${this.position.source})` : 'No position yet.'}</p>
<h2>Send your phone's position</h2>
<p><b>GPSLogger</b> (Android): Logging details → Log to custom URL, URL:<br><code>http://${host}/log?lat=%LAT&amp;lon=%LON&amp;time=%TIME&amp;spd=%SPD&amp;acc=%ACC&amp;alt=%ALT${token}</code></p>
<p><b>OwnTracks</b>: mode HTTP, URL <code>http://${host}/</code>${this.options.token ? ' (the token as password)' : ''}.</p>
<h2>Use it</h2>
<p>MapSCII: <code>mapscii --gps http://${host}</code> &middot; Today's track: <a href="/track.gpx">track.gpx</a></p>`;
  }

  // Stops the sources, the server and the recording
  stop() {
    for (const stop of this.stops) stop();
    this.stops = [];
    for (const client of this.clients) client.end();
    if (this.writer) this.writer.close();
    return this.server ? new Promise((resolve) => this.server.close(resolve)) : Promise.resolve();
  }
}

// Tells the device about an error; the bridge goes on
function answerError(res, error) {
  try {
    if (!res.headersSent) res.writeHead(500, {'Content-Type': 'text/plain'});
    res.end(`could not do that: ${error.message}`);
  } catch (ignored) {
    void 0;
  }
}

module.exports = GpsBridge;
