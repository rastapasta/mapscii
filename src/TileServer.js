// Shares tiles on the local network as /tilejson.json. Missing tiles are downloaded once and kept.
'use strict';
const http = require('http');
const os = require('os');
const zlib = require('zlib');
const {promisify} = require('util');

const gzip = promisify(zlib.gzip);

class TileServer {
  constructor(tileSource, {download = true} = {}) {
    this.tileSource = tileSource;
    this.download = download;
    this.stats = {tiles: 0, bytes: 0, missing: 0, clients: new Set()};
    this.server = http.createServer((req, res) => {
      this._handle(req, res).catch((error) => {
        if (!res.headersSent) {
          res.writeHead(500, {'Content-Type': 'text/plain'});
        }
        res.end(String(error.message));
      });
    });
  }

  // Starts listening; resolves with the port
  listen(port = 8080, host = '0.0.0.0') {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => resolve(this.server.address().port));
    });
  }

  // Stops the server
  close() {
    return new Promise((resolve) => this.server.close(resolve));
  }

  // The addresses other computers on the network can reach this one at
  static addresses() {
    const result = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const address of list || []) {
        if (address.family === 'IPv4' && !address.internal) {
          result.push(address.address);
        }
      }
    }
    return result;
  }

  // Answers a request: the page, the TileJSON or a tile
  async _handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const cors = {'Access-Control-Allow-Origin': '*'};
    this.stats.clients.add(req.socket.remoteAddress);
    if (url.pathname === '/tilejson.json') {
      const base = `http://${req.headers.host || 'localhost'}`;
      return this._send(res, 200, {'Content-Type': 'application/json', ...cors}, JSON.stringify(this._tileJSON(base)));
    }
    const m = url.pathname.match(/^\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
    if (m) {
      return this._sendTile(req, res, +m[1], +m[2], +m[3], cors);
    }
    if (url.pathname === '/') {
      const base = `http://${req.headers.host || 'localhost'}`;
      // the Host header comes from the client: escape it
      return this._send(res, 200, {'Content-Type': 'text/html; charset=utf-8'}, this._page(escapeHtml(base)));
    }
    return this._send(res, 404, {'Content-Type': 'text/plain', ...cors}, 'not found');
  }

  // The TileJSON describing the shared tiles
  _tileJSON(base) {
    const source = this.tileSource;
    const info = source.packInfo || {};
    return {
      tilejson: '3.0.0',
      name: info.name || 'MapSCII tiles',
      tiles: [`${base}/{z}/{x}/{y}.pbf`],
      minzoom: 0,
      maxzoom: source.maxZoom(),
      bounds: info.bounds,
      attribution: source.attribution || undefined,
      vector_layers: source.vectorLayers || info.vector_layers || undefined,
      // TileJSON can't tell this schema apart
      mapscii_schema: source.schema,
    };
  }

  // Sends a tile, or 404 if there is none
  async _sendTile(req, res, z, x, y, cors) {
    const max = Math.pow(2, z);
    if (z > this.tileSource.maxZoom() || x >= max || y >= max) {
      return this._send(res, 404, cors, '');
    }
    let data;
    try {
      data = await this.tileSource.getTileData(z, x, y, {download: this.download});
    } catch (error) {
      if (error.status === 404 || error.notCached) {
        this.stats.missing++;
        return this._send(res, 404, cors, '');
      }
      return this._send(res, 502, {'Content-Type': 'text/plain', ...cors}, `could not get the tile: ${error.message}`);
    }
    const headers = {'Content-Type': 'application/vnd.mapbox-vector-tile', 'Cache-Control': 'max-age=86400', ...cors};
    let body = data;
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      body = await gzip(data);
      headers['Content-Encoding'] = 'gzip';
    }
    this.stats.tiles++;
    this.stats.bytes += body.length;
    return this._send(res, 200, headers, body);
  }

  // Sends a response with its length
  _send(res, status, headers, body) {
    res.writeHead(status, {'Content-Length': Buffer.byteLength(body), ...headers});
    res.end(body);
  }

  // The page shown in a browser, saying how to use the server
  _page(base) {
    return `<!doctype html><meta charset="utf-8"><title>MapSCII tile server</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40em;margin:2em auto;padding:0 1em}code{background:#eee;padding:.1em .3em}</style>
<h1>MapSCII tile server</h1>
<p>This computer shares its map tiles. In MapSCII on another computer on this network, run:</p>
<p><code>mapscii --tile_source ${base}/tilejson.json</code></p>
<p>Tiles shared so far: ${this.stats.tiles}.</p>`;
  }
}

// Escapes text for HTML
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;'})[c]);
}

module.exports = TileServer;
