// Active fires in the last 24 hours from NASA FIRMS (needs a key).
'use strict';
const {Layer} = require('./LayerManager');

const SOURCE = 'VIIRS_NOAA20_NRT';
// The FIRMS area API URL for a key and an area
const url = (key, area) => `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${SOURCE}/${area.west},${area.south},${area.east},${area.north}/1`;
// MW; fires at least this strong are drawn red
const STRONG = 50;

class Fires extends Layer {
  constructor() {
    super('fires', 'fires', {aliases: ['fire', 'firms'], every: 1800});
    this.fires = [];
    this.area = null;
  }

  // The view plus half its size, in whole degrees so small moves ask for nothing new.
  _area() {
    const view = this.manager.view;
    if (!view || view.zoom < 3) return null;
    const b = view.bounds;
    const dLat = (b.north - b.south) / 2;
    const dLon = (((b.east - b.west) + 360) % 360 || 360) / 2;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const area = {
      west: clamp(Math.floor(b.west - dLon), -180, 180), south: clamp(Math.floor(b.south - dLat), -90, 90),
      east: clamp(Math.ceil(b.east + dLon), -180, 180), north: clamp(Math.ceil(b.north + dLat), -90, 90),
    };
    // FIRMS needs west < east: across the date line, ask for the whole band
    if (area.west >= area.east) {
      area.west = -180;
      area.east = 180;
    }
    return area;
  }

  // Whether the view lies within the area
  _inside(area, view) {
    const b = view.bounds;
    return area && b.west >= area.west && b.east <= area.east && b.south >= area.south && b.north <= area.north;
  }

  // Asks again when the view leaves the area fetched
  viewChanged() {
    const view = this.manager.view;
    if (!view || view.zoom < 3 || this._inside(this.area, view)) return;
    if (!this.lastAsk || Date.now() - this.lastAsk > 10000) this._refreshSoon(1);
  }

  // Fetches the fires of the area, falling back to the cached copy offline
  async refresh() {
    const key = this.key('firms');
    if (!key) {
      this.fires = [];
      this.status = 'needs a key (see mapscii --keys)';
      return;
    }
    const area = this._area();
    if (!area) {
      this.status = 'zoom in to see fires (the whole world at once is several MB)';
      return;
    }
    this.lastAsk = Date.now();
    let text;
    try {
      text = await this.manager.fetchText(url(key, area));
      // a wrong key or bad request comes back as plain text, not CSV
      if (!/^latitude,/.test(text)) throw new Error(`FIRMS: ${String(text).split('\n')[0].slice(0, 60) || 'no answer'}`);
      this.manager.writeCache('firms.json', JSON.stringify({area, text}));
      this.updated = Date.now();
      this.status = 'live';
    } catch (error) {
      // offline: use the cached fires if they cover the view
      const [saved, age] = this.manager.readCache('firms.json');
      const copy = saved ? safeJson(saved) : null;
      if (!copy || !copy.area || !this._inside(copy.area, this.manager.view)) throw error;
      text = copy.text;
      Object.assign(area, copy.area);
      this.updated = Date.now() - age * 1000;
      this.status = 'offline';
    }
    this.area = area;
    this.fires = Fires.read(text);
  }

  // FIRMS CSV to [{lat, lon, power, confidence, time, night}], without low-confidence fires
  static read(text) {
    const lines = String(text || '').split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    const head = lines[0].split(',').map((h) => h.trim());
    const col = (name) => head.indexOf(name);
    const at = {lat: col('latitude'), lon: col('longitude'), frp: col('frp'), conf: col('confidence'), date: col('acq_date'), time: col('acq_time'), dn: col('daynight')};
    if (at.lat < 0 || at.lon < 0) return [];
    const fires = [];
    for (const line of lines.slice(1)) {
      const cells = line.split(',');
      const lat = parseFloat(cells[at.lat]);
      const lon = parseFloat(cells[at.lon]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
      const conf = at.conf >= 0 ? String(cells[at.conf]).trim() : '';
      if (conf === 'l' || conf === 'low' || (/^\d+$/.test(conf) && +conf < 30)) continue;
      const hhmm = at.time >= 0 ? String(cells[at.time]).trim().padStart(4, '0') : '';
      const time = at.date >= 0 && /^\d{4}$/.test(hhmm) ? Date.parse(`${String(cells[at.date]).trim()}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`) : NaN;
      fires.push({lat, lon, power: at.frp >= 0 ? parseFloat(cells[at.frp]) : NaN, confidence: conf, time, night: at.dn >= 0 && String(cells[at.dn]).trim() === 'N'});
    }
    return fires;
  }

  // A ▲ per fire, strong ones in red
  overlays() {
    const strong = this.fires.filter((f) => f.power >= STRONG);
    const other = this.fires.filter((f) => !(f.power >= STRONG));
    return [
      {points: other.map((f) => ({lat: f.lat, lon: f.lon, name: ''})), color: '#ffaf00', marker: '▲'},
      {points: strong.map((f) => ({lat: f.lat, lon: f.lon, name: ''})), color: '#ff3030', marker: '▲'},
    ];
  }

  // The footer text: how many fires are in view
  footer() {
    if (this.status !== 'live' && this.status !== 'offline') return `fires: ${this.status}`;
    const view = this.manager.view;
    const b = view && view.bounds;
    const seen = b ? this.fires.filter((f) => f.lat <= b.north && f.lat >= b.south && f.lon >= b.west && f.lon <= b.east).length : this.fires.length;
    const old = this.age();
    return `▲ ${seen} fire${seen === 1 ? '' : 's'} in view, last 24 h (NASA FIRMS)${old ? ` (${old})` : ''}`;
  }

  // The strongest fires, for a search for "fire"
  search(text) {
    if (!/^(fires?|wildfires?)$/i.test(String(text).trim())) return [];
    return this.fires.slice().sort((a, b) => (b.power || 0) - (a.power || 0)).slice(0, 5).map((f) => ({
      name: `fire${Number.isFinite(f.power) ? `, ${Math.round(f.power)} MW` : ''}`, kind: 'fire', lat: f.lat, lon: f.lon, zoom: 11,
    }));
  }
}

// Parses JSON, or returns null
function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

Fires.url = url;
module.exports = Fires;
