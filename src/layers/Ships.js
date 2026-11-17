// Ships from AISStream's live AIS feed (needs a key).
'use strict';
/* global WebSocket */
const {Layer} = require('./LayerManager');
const Net = require('../Net');

const URL = 'wss://stream.aisstream.io/v0/stream';
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
const MAX_SHIPS = 5000;
const FORGET_AFTER = 15 * 60000;
// AIS ship type, by its tens digit
const TYPES = {2: 'wing in ground', 3: 'special craft', 4: 'high-speed craft', 5: 'special craft', 6: 'passenger ship', 7: 'cargo ship', 8: 'tanker', 9: 'other'};

// ws compresses the stream and counts the data; Node 22+ has its own WebSocket
function openSocket(url) {
  let WS = null;
  try {
    WS = require('ws');
  } catch (error) {
    WS = null;
  }
  if (WS) return new WS(url, Object.assign({perMessageDeflate: true}, /^wss:/.test(url) ? {agent: Net.agents.https} : {}));
  return typeof WebSocket === 'function' ? new WebSocket(url) : null;
}

class Ships extends Layer {
  constructor() {
    super('ships', 'ships', {aliases: ['ais', 'boats', 'vessels'], every: 60});
    this.ships = new Map();
    this.socket = null;
    this.box = null;
    this.retry = 5;
    this.url = URL;
  }

  // [[south, west], [north, east]], the view plus half its size; null below zoom 6
  _box() {
    const view = this.manager.view;
    if (!view || view.zoom < 6) return null;
    const b = view.bounds;
    const dLat = (b.north - b.south) / 2;
    const dLon = (((b.east - b.west) + 360) % 360 || 360) / 2;
    const r = (v) => Math.round(v * 100) / 100;
    return [[r(Math.max(-90, b.south - dLat)), r(Math.max(-180, b.west - dLon))], [r(Math.min(90, b.north + dLat)), r(Math.min(180, b.east + dLon))]];
  }

  // Closes the stream and stops the timers
  stop() {
    super.stop();
    clearTimeout(this.reconnect);
    clearTimeout(this.boxTimer);
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      try {
        socket.close();
      } catch (error) {
        void 0;
      }
    }
  }

  // Connects, disconnects or changes the area as the view moves
  viewChanged() {
    const box = this._box();
    if (!box) {
      if (this.socket) this._disconnect('zoom in to see ships');
      return;
    }
    if (!this.socket) {
      this._refreshSoon(0.5);
      return;
    }
    // resubscribe once the view settles; AISStream accepts one change a second
    if (JSON.stringify(box) === JSON.stringify(this.box)) return;
    clearTimeout(this.boxTimer);
    this.boxTimer = setTimeout(() => this._subscribe(), 2000);
    if (this.boxTimer.unref) this.boxTimer.unref();
  }

  // Forgets old ships and connects if needed
  async refresh() {
    const now = Date.now();
    for (const [id, ship] of this.ships) {
      if (now - ship.heard > FORGET_AFTER) this.ships.delete(id);
    }
    const key = this.key('aisstream');
    if (!key) {
      this.status = 'needs a key (see mapscii --keys)';
      return;
    }
    if (!this._box()) {
      this._disconnect('zoom in to see ships');
      return;
    }
    if (!this.socket) this._connect(key);
  }

  // Closes the stream and sets the status
  _disconnect(status) {
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      try {
        socket.close();
      } catch (error) {
        void 0;
      }
    }
    this.status = status;
  }

  // Opens the stream; reconnects with growing delays when it closes
  _connect(key) {
    this.apiKey = key;
    this.status = 'connecting';
    let socket;
    try {
      socket = openSocket(this.url);
    } catch (error) {
      this.status = `can't connect: ${error.message}`;
      return;
    }
    if (!socket) {
      this.status = 'ships need Node.js 22 or later (or the ws package)';
      return;
    }
    this.socket = socket;
    const on = (event, fn) => (socket.on ? socket.on(event, fn) : socket.addEventListener(event, (e) => fn(e && e.data !== undefined ? e.data : e)));
    on('open', () => {
      if (this.socket !== socket) return;
      this.retry = 5;
      this._subscribe();
    });
    on('message', (data) => {
      if (this.socket !== socket) return;
      this._receive(data);
    });
    on('error', () => null);
    on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (!this.on) return;
      this.status = `the ship stream stopped - again in ${this.retry} s`;
      clearTimeout(this.reconnect);
      this.reconnect = setTimeout(() => this.on && this.refresh(), this.retry * 1000);
      if (this.reconnect.unref) this.reconnect.unref();
      this.retry = Math.min(120, this.retry * 2);
      this.manager.onChange();
    });
  }

  // Sends the key and the current area to AISStream
  _subscribe() {
    const box = this._box();
    if (!this.socket || !box) return;
    const open = this.socket.readyState === 1;
    if (!open) return;
    this.box = box;
    this.socket.send(JSON.stringify({
      APIKey: this.apiKey,
      BoundingBoxes: [box],
      FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport', 'ShipStaticData'],
    }));
    this.status = 'live';
  }

  // Handles one message of the stream
  _receive(data) {
    let msg;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'));
    } catch (error) {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.error) {
      // e.g. a wrong key; AISStream then closes the socket
      this.status = `AISStream: ${String(msg.error).slice(0, 60)}`;
      return;
    }
    const ship = Ships.read(msg);
    if (!ship) return;
    const known = this.ships.get(ship.mmsi) || {};
    // static data and positions arrive in separate messages
    this.ships.set(ship.mmsi, Object.assign(known, ...Object.entries(ship).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => ({[k]: v})), {heard: Date.now()}));
    if (this.ships.size > MAX_SHIPS) this.ships.delete(this.ships.keys().next().value);
    this.updated = Date.now();
    this.status = 'live';
    if (!this.changeTimer) {
      this.changeTimer = setTimeout(() => {
        this.changeTimer = null;
        this.manager.onChange();
      }, 1000);
      if (this.changeTimer.unref) this.changeTimer.unref();
    }
  }

  // An AISStream message to {mmsi, name, lat, lon, course, speed, heading, type, destination}, or null
  static read(msg) {
    const meta = msg.MetaData || {};
    const body = msg.Message || {};
    const mmsi = String(meta.MMSI || meta.MMSI_String || '').trim();
    if (!mmsi) return null;
    const name = String(meta.ShipName || '').trim();
    const report = body.PositionReport || body.StandardClassBPositionReport;
    if (report) {
      const lat = Number(report.Latitude !== undefined ? report.Latitude : meta.latitude);
      const lon = Number(report.Longitude !== undefined ? report.Longitude : meta.longitude);
      // 91 and 181 mean "not available"
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
      const course = Number(report.Cog);
      const heading = Number(report.TrueHeading);
      const speed = Number(report.Sog);
      return {
        mmsi, name, lat, lon,
        course: Number.isFinite(course) && course < 360 ? course : undefined,
        heading: Number.isFinite(heading) && heading < 360 ? heading : undefined,
        speed: Number.isFinite(speed) && speed < 102.3 ? speed : undefined,
      };
    }
    const data = body.ShipStaticData;
    if (data) {
      const type = Number(data.Type);
      return {
        mmsi, name: String(data.Name || name || '').replace(/@+$/, '').trim(),
        type: TYPES[Math.floor(type / 10)] || undefined,
        destination: String(data.Destination || '').replace(/@+$/, '').trim() || undefined,
      };
    }
    return null;
  }

  // An arrow per moving ship, a dot for those lying still
  overlays() {
    const groups = new Map();
    for (const s of this.ships.values()) {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
      const way = Number.isFinite(s.course) ? s.course : s.heading;
      const marker = s.speed >= 0.5 && Number.isFinite(way) ? ARROWS[Math.round(way / 45) % 8] : '•';
      if (!groups.has(marker)) groups.set(marker, []);
      groups.get(marker).push({lat: s.lat, lon: s.lon, name: s.name || ''});
    }
    return [...groups].map(([marker, points]) => ({points, color: '#87afff', marker}));
  }

  // The footer text: ships placed and under way
  footer() {
    const placed = [...this.ships.values()].filter((s) => Number.isFinite(s.lat)).length;
    if (this.status !== 'live' && !placed) return `ships: ${this.status}`;
    const moving = [...this.ships.values()].filter((s) => s.speed >= 0.5).length;
    return `ships: ${placed} (${moving} under way)${this.status === 'live' ? '' : ` - ${this.status}`} (AISStream)`;
  }

  // Ships whose name or MMSI matches the text
  search(text) {
    const q = String(text).toLowerCase().trim();
    if (!q) return [];
    return [...this.ships.values()].filter((s) => Number.isFinite(s.lat) && ((s.name || '').toLowerCase().includes(q) || s.mmsi.startsWith(q) || /^(ships?|boats?)$/.test(q)))
      .slice(0, 5).map((s) => ({
        name: `${s.name || s.mmsi}${s.type ? ` (${s.type})` : ''}${s.destination ? ` to ${s.destination}` : ''}${Number.isFinite(s.speed) ? `, ${s.speed.toFixed(1)} kn` : ''}`,
        kind: 'ship', lat: s.lat, lon: s.lon, zoom: 13,
      }));
  }
}

Ships.URL = URL;
module.exports = Ships;
