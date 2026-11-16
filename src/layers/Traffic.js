// Live traffic from TomTom (needs a key): road flow from zoom 10, incidents from zoom 8.
'use strict';
const {VectorTile} = require('@mapbox/vector-tile');
const Protobuf = require('pbf');
const {Layer} = require('./LayerManager');
const Gpx = require('../Gpx');

const API = 'https://api.tomtom.com';
// The URL of a flow tile
const flowUrl = (key, z, x, y) => `${API}/traffic/map/4/tile/flow/relative/${z}/${x}/${y}.pbf?key=${encodeURIComponent(key)}`;
const FIELDS = '{incidents{type,geometry{type,coordinates},properties{iconCategory,magnitudeOfDelay,events{description},from,to,delay,roadNumbers}}}';
// The URL of the incidents within bounds
const incidentsUrl = (key, b) => `${API}/traffic/services/5/incidentDetails?key=${encodeURIComponent(key)}` +
  `&bbox=${[b.west, b.south, b.east, b.north].map((v) => v.toFixed(5)).join(',')}&fields=${encodeURIComponent(FIELDS)}&language=en-GB&timeValidityFilter=present`;

const MAX_TILES = 12;
const FLOW = [['closed', '#870000'], ['jam', '#ff3030'], ['slow', '#ffd700'], ['free', '#5faf5f']];
const KINDS = {
  1: ['accident', '!'], 2: ['fog', '~'], 3: ['danger', '!'], 4: ['rain', '~'], 5: ['ice', '~'], 6: ['jam', '≡'],
  7: ['lane closed', '≠'], 8: ['road closed', 'X'], 9: ['roadworks', '#'], 10: ['wind', '~'], 11: ['flooding', '~'], 14: ['broken-down vehicle', '!'],
};

class Traffic extends Layer {
  constructor() {
    super('traffic', 'traffic', {aliases: ['tomtom', 'jams'], every: 180});
    this.flow = [];
    this.incidents = [];
    this.asked = null;
  }

  // The flow tiles covering the view: [{z, x, y}], at most MAX_TILES, or [] below zoom 10
  static tilesFor(view) {
    if (!view || view.zoom < 10) return [];
    const b = view.bounds;
    for (let z = Math.min(16, Math.floor(view.zoom)); z >= 8; z--) {
      const n = Math.pow(2, z);
      const tx = (lon) => Math.floor((lon + 180) / 360 * n);
      const ty = (lat) => Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
      const x0 = tx(b.west);
      const x1 = tx(b.east);
      const y0 = Math.max(0, ty(Math.min(85, b.north)));
      const y1 = Math.min(n - 1, ty(Math.max(-85, b.south)));
      if (x1 < x0) continue;
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES) continue;
      const tiles = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push({z, x: ((x % n) + n) % n, y});
      return tiles;
    }
    return [];
  }

  // km²; TomTom answers incidents for at most 10,000
  static areaKm2(view) {
    const b = view.bounds;
    const height = Gpx.length([{lat: b.south, lon: b.west}, {lat: b.north, lon: b.west}]);
    const width = Gpx.length([{lat: (b.north + b.south) / 2, lon: b.west}, {lat: (b.north + b.south) / 2, lon: b.east}]);
    return width * height;
  }

  // Asks again when the view shows other tiles or moved
  viewChanged() {
    const view = this.manager.view;
    if (!view || view.zoom < 8) return;
    const now = JSON.stringify(Traffic.tilesFor(view)) + Math.round(view.center.lat * 50) + Math.round(view.center.lon * 50);
    if (now === this.asked) return;
    if (!this.lastAsk || Date.now() - this.lastAsk > 10000) this._refreshSoon(1);
  }

  // Fetches the flow tiles and the incidents of the view
  async refresh() {
    const key = this.key('tomtom');
    if (!key) {
      this.flow = [];
      this.incidents = [];
      this.status = 'needs a key (see mapscii --keys)';
      return;
    }
    const view = this.manager.view;
    if (!view || view.zoom < 8) {
      this.flow = [];
      this.incidents = [];
      this.status = 'zoom in to see the traffic';
      return;
    }
    this.lastAsk = Date.now();
    const tiles = Traffic.tilesFor(view);
    this.asked = JSON.stringify(tiles) + Math.round(view.center.lat * 50) + Math.round(view.center.lon * 50);
    const flow = [];
    for (let i = 0; i < tiles.length; i += 4) {
      const answers = await Promise.all(tiles.slice(i, i + 4).map(({z, x, y}) => this.manager.fetchBuffer(flowUrl(key, z, x, y)).then(
        (buffer) => Traffic.readFlow(buffer, z, x, y),
        (error) => {
          if (error.status === 404) return [];
          throw error;
        })));
      for (const lines of answers) flow.push(...lines);
    }
    let incidents = [];
    if (Traffic.areaKm2(view) <= 10000) {
      incidents = Traffic.readIncidents(await this.manager.fetchJson(incidentsUrl(key, view.bounds)));
    }
    this.flow = flow;
    this.incidents = incidents;
    this.updated = Date.now();
    this.status = tiles.length ? 'live' : 'zoom in to see how the roads flow';
  }

  // A flow tile to [{level, closed, points}]
  static readFlow(buffer, z, x, y) {
    let tile;
    try {
      tile = new VectorTile(new Protobuf(buffer));
    } catch (error) {
      return [];
    }
    const layer = tile.layers['Traffic flow'];
    if (!layer) return [];
    const n = Math.pow(2, z);
    const toPlace = (p) => ({
      lon: (x + p.x / layer.extent) / n * 360 - 180,
      lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + p.y / layer.extent) / n))) * 180 / Math.PI,
    });
    const lines = [];
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      if (feature.type !== 2) continue;
      const props = feature.properties;
      const level = Number(props.traffic_level);
      const closed = props.road_closure === true || props.road_closure === 'true';
      for (const part of feature.loadGeometry()) {
        if (part.length > 1) lines.push({level: Number.isFinite(level) ? level : null, closed, points: part.map(toPlace)});
      }
    }
    return lines;
  }

  // TomTom's incidents to [{kind, sign, lat, lon, delay, magnitude, text, from, to, road}]
  static readIncidents(data) {
    const list = data && Array.isArray(data.incidents) ? data.incidents : [];
    const out = [];
    for (const incident of list) {
      if (!incident || typeof incident !== 'object') continue;
      const g = incident.geometry || {};
      const first = g.type === 'Point' ? g.coordinates : Array.isArray(g.coordinates) ? g.coordinates[0] : null;
      if (!Array.isArray(first) || !Number.isFinite(first[0]) || !Number.isFinite(first[1])) continue;
      const p = incident.properties || {};
      const [kind, sign] = KINDS[p.iconCategory] || ['incident', '!'];
      const events = Array.isArray(p.events) ? p.events : [];
      out.push({
        kind, sign, lon: first[0], lat: first[1], delay: Number.isFinite(p.delay) ? p.delay : 0, magnitude: p.magnitudeOfDelay,
        text: events.map((e) => e && e.description).filter(Boolean).join(', ') || kind,
        from: p.from || '', to: p.to || '', road: Array.isArray(p.roadNumbers) ? p.roadNumbers.join('/') : '',
      });
    }
    return out;
  }

  // 'free', 'slow', 'jam' or 'closed'
  static classOf(line) {
    if (line.closed) return 'closed';
    if (line.level === null) return 'free';
    return line.level < 0.4 ? 'jam' : line.level < 0.75 ? 'slow' : 'free';
  }

  // Roads coloured by flow, and a sign per incident
  overlays() {
    // old traffic would mislead
    if (!this.updated || Date.now() - this.updated > 15 * 60000) return [];
    const byClass = {free: [], slow: [], jam: [], closed: []};
    for (const line of this.flow) byClass[Traffic.classOf(line)].push(line.points);
    // free roads first, so jams are drawn on top
    const overlays = FLOW.slice().reverse().map(([cls, color]) => ({lines: byClass[cls], color}));
    const signs = new Map();
    for (const i of this.incidents) {
      if (!signs.has(i.sign)) signs.set(i.sign, []);
      const delay = i.delay >= 60 ? ` +${Math.round(i.delay / 60)} min` : '';
      signs.get(i.sign).push({lat: i.lat, lon: i.lon, name: `${i.kind}${delay}`});
    }
    for (const [sign, points] of signs) overlays.push({points, color: '#ff5f87', marker: sign});
    return overlays;
  }

  // The footer text: jams and incidents
  footer() {
    if (this.status !== 'live' && !this.incidents.length && !this.flow.length) return `traffic: ${this.status}`;
    if (Date.now() - this.updated > 15 * 60000) return `traffic: no update for ${this.age()}`;
    const jams = this.flow.filter((l) => Traffic.classOf(l) === 'jam').length;
    const closed = this.incidents.filter((i) => i.kind === 'road closed').length;
    return `traffic: ${jams} jammed stretch${jams === 1 ? '' : 'es'}, ${this.incidents.length} incident${this.incidents.length === 1 ? '' : 's'}${closed ? ` (${closed} closed)` : ''} (TomTom)`;
  }

  // Incidents matching the text, longest delay first
  search(text) {
    const q = String(text).toLowerCase().trim();
    if (!q) return [];
    return this.incidents.filter((i) => /^(traffic|jams?|incidents?|accidents?)$/.test(q) || `${i.kind} ${i.text} ${i.from} ${i.to} ${i.road}`.toLowerCase().includes(q))
      .sort((a, b) => b.delay - a.delay).slice(0, 5)
      .map((i) => ({name: `${i.kind}${i.road ? ` on ${i.road}` : ''}${i.from ? `: ${i.from}${i.to ? ` → ${i.to}` : ''}` : ''}`, kind: 'traffic', lat: i.lat, lon: i.lon, zoom: 15}));
  }
}

Traffic.flowUrl = flowUrl;
Traffic.incidentsUrl = incidentsUrl;
module.exports = Traffic;
