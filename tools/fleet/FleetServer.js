// Keeps each device's latest position (over restarts too) and a GPX track per device and day.
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const {readReport} = require('../../src/PhoneReport');
const GpxWriter = require('../../src/GpxWriter');
const Gpx = require('../../src/Gpx');

// without a token anything on the network can report, so the number of devices is capped
const MAX_DEVICES = 5000;
// Escapes text for HTML
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;'})[c]);

class FleetServer {
  // folder: null keeps nothing; token: a secret devices must send; names: {id: name}
  constructor({folder = null, token = null, names = {}, minDistance = 10} = {}) {
    this.folder = folder;
    this.token = token;
    this.names = names;
    this.minDistance = minDistance;
    this.devices = new Map();
    this.writers = new Map();
    this.clients = new Set();
    if (folder) {
      try {
        for (const device of JSON.parse(fs.readFileSync(path.join(folder, 'devices.json'), 'utf8'))) {
          this.devices.set(device.id, device);
        }
      } catch (error) {
        void 0;
      }
    }
  }

  // Takes a device's new position, records it and sends it to the listeners
  update(id, position) {
    const own = Object.prototype.hasOwnProperty.call(this.names, id) ? this.names[id] : null;
    const name = String(own || (this.devices.get(id) || {}).name || id);
    // a bad device clock: use the arrival time
    const time = position.time && Number.isFinite(Date.parse(position.time)) ? position.time : new Date().toISOString();
    const device = Object.assign({}, position, {id, name, time, received: new Date().toISOString()});
    const previous = this.devices.get(id);
    this.devices.set(id, device);
    const line = JSON.stringify(device) + '\n';
    for (const client of this.clients) client.write(line);
    if (this.folder) {
      if (!previous || Gpx.length([previous, device]) * 1000 >= this.minDistance) {
        this._record(device);
      }
      this._saveSoon();
    }
  }

  // Adds a position to the device's GPX track of the day
  _record(device) {
    const when = new Date(device.time);
    const pad = (n) => String(n).padStart(2, '0');
    const day = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
    const safe = device.id.replace(/[^\w.-]+/g, '_');
    const key = `${safe} ${day}`;
    let writer = this.writers.get(key);
    if (!writer) {
      // close yesterday's file so a long-running server doesn't run out of file handles
      for (const [other, old] of this.writers) {
        if (other.startsWith(`${safe} `)) {
          old.close();
          this.writers.delete(other);
        }
      }
      writer = new GpxWriter(path.join(this.folder, 'tracks', day, `${safe}.gpx`), `${device.name} on ${day}`);
      this.writers.set(key, writer);
    }
    writer.add(device);
  }

  // Saves the latest positions a little later
  _saveSoon() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this._save(), 2000);
  }

  // Saves the latest positions, so they survive a restart
  _save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    fs.mkdirSync(this.folder, {recursive: true});
    const file = path.join(this.folder, 'devices.json');
    fs.writeFileSync(`${file}.tmp`, JSON.stringify([...this.devices.values()], null, 1));
    fs.renameSync(`${file}.tmp`, file);
  }

  // most recent first; age from the measurement, or arrival if the device's clock is ahead
  list(now = Date.now()) {
    return [...this.devices.values()]
      .map((d) => {
        const received = Date.parse(d.received || d.time);
        const measured = Date.parse(d.time);
        const when = Number.isFinite(measured) && measured <= received ? measured : received;
        return Object.assign({}, d, {age: Math.max(0, Math.round((now - when) / 1000))});
      })
      .sort((a, b) => a.age - b.age);
  }

  // Starts listening; resolves with the port
  listen(port = 2950, host = '0.0.0.0') {
    this.server = http.createServer((req, res) => {
      // one bad request must not end the server
      try {
        this._handle(req, res);
      } catch (error) {
        fail(res, error);
      }
    });
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => resolve(this.server.address().port));
    });
  }

  // Answers a request: a report, the device list, the stream or the page
  _handle(req, res) {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch (error) {
      res.writeHead(400, {'Content-Type': 'text/plain'});
      return res.end('bad request');
    }
    const cors = {'Access-Control-Allow-Origin': '*'};
    if (req.method === 'GET' && url.pathname === '/devices') {
      res.writeHead(200, {'Content-Type': 'application/json', ...cors});
      return res.end(JSON.stringify(this.list()));
    }
    if (req.method === 'GET' && url.pathname === '/stream') {
      res.writeHead(200, {'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache', ...cors});
      for (const device of this.list()) res.write(JSON.stringify(device) + '\n');
      this.clients.add(res);
      const ping = setInterval(() => res.write('\n'), 15000);
      req.on('close', () => {
        clearInterval(ping);
        this.clients.delete(res);
      });
      return;
    }
    if (url.pathname === '/report' || url.pathname === '/log' || (req.method === 'POST' && url.pathname === '/')) {
      return readReport(req, url).then(({position, device, token}) => {
        if (this.token && token !== this.token) {
          res.writeHead(403, {'Content-Type': 'text/plain'});
          return res.end('wrong or missing token');
        }
        if (!position) {
          res.writeHead(400, {'Content-Type': 'text/plain'});
          return res.end('expected lat and lon, and the device as id=...');
        }
        if (!this.devices.has(device) && this.devices.size >= MAX_DEVICES) {
          res.writeHead(429, {'Content-Type': 'text/plain'});
          return res.end('too many devices');
        }
        this.update(device, position);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end('[]');
      }).catch((error) => fail(res, error));
    }
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      return res.end(this._page(esc(req.headers.host || 'this-computer:2950')));
    }
    res.writeHead(404, {'Content-Type': 'text/plain', ...cors});
    res.end('not found');
  }

  // The page shown in a browser: the devices and how to report
  _page(host) {
    const ago = (s) => s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
    const rows = this.list().map((d) => `<tr${d.age > 600 ? ' class="old"' : ''}><td>${esc(d.name)}</td><td>${d.lat.toFixed(5)}, ${d.lon.toFixed(5)}</td><td>${d.speed !== undefined ? `${Math.round(d.speed)} km/h` : ''}</td><td>${ago(d.age)} ago</td><td><a href="https://www.openstreetmap.org/?mlat=${d.lat}&amp;mlon=${d.lon}#map=16/${d.lat}/${d.lon}">map</a></td></tr>`).join('');
    const token = this.token ? '&amp;token=YOUR-TOKEN' : '';
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="30"><title>Fleet</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:50em;margin:1.5em auto;padding:0 1em}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:4px 8px;border-bottom:1px solid #ddd}.old{color:#999}code{background:#eee;padding:.1em .3em;word-break:break-all}</style>
<h1>Fleet: ${this.devices.size} device${this.devices.size === 1 ? '' : 's'}</h1>
<table><tr><th>Device</th><th>Position</th><th>Speed</th><th>Last heard</th><th></th></tr>${rows}</table>
<h2>Adding a device</h2>
<p><b>GPSLogger</b> (Android), Log to custom URL: <code>http://${host}/log?id=%SER&amp;lat=%LAT&amp;lon=%LON&amp;time=%TIME&amp;spd=%SPD&amp;acc=%ACC${token}</code></p>
<p><b>OwnTracks</b>: mode HTTP, URL <code>http://${host}/</code>. <b>A GPS bridge</b>: <code>mapscii-gps --fleet http://${host} --name moto-12</code></p>
<p>In MapSCII: <code>mapscii --fleet http://${host}</code>. This page refreshes every 30 seconds.</p>`;
  }

  // Stops the server and closes the tracks
  stop() {
    for (const client of this.clients) client.end();
    for (const writer of this.writers.values()) writer.close();
    if (this.saveTimer) this._save();
    return this.server ? new Promise((resolve) => this.server.close(resolve)) : Promise.resolve();
  }
}

// Tells the device about an error; the server goes on
function fail(res, error) {
  try {
    if (!res.headersSent) res.writeHead(500, {'Content-Type': 'text/plain'});
    res.end(`could not do that: ${error.message}`);
  } catch (ignored) {
    void 0;
  }
}

module.exports = FleetServer;
