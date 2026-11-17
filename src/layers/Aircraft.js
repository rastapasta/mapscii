// Aircraft from adsb.lol (ODbL), from zoom 5, every 30 s.
'use strict';
const {Layer} = require('./LayerManager');
const Gpx = require('../Gpx');

const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

class Aircraft extends Layer {
  constructor() {
    super('aircraft', 'aircraft', {aliases: ['planes', 'flights'], every: 30});
    this.planes = [];
  }

  // The centre and radius in nm to ask adsb.lol for, or null below zoom 5
  _area() {
    const view = this.manager.view;
    if (!view || view.zoom < 5) return null;
    const km = Gpx.length([view.center, {lat: view.bounds.north, lon: view.bounds.east}]);
    return {lat: view.center.lat, lon: view.center.lon, nm: Math.min(250, Math.ceil(km / 1.852))};
  }

  // Asks again when the view moved to a new area
  viewChanged() {
    // at most every 5 s
    const area = this._area();
    if (!area) return;
    const last = this.asked;
    if (!last || Gpx.length([last, area]) > last.nm * 1.852 * 0.5 || Math.abs(last.nm - area.nm) > last.nm * 0.5) {
      if (!this.lastAsk || Date.now() - this.lastAsk > 5000) this._refreshSoon(0.3);
    }
  }

  // Fetches the aircraft in the area
  async refresh() {
    const area = this._area();
    if (!area) {
      this.planes = [];
      this.status = 'zoom in to see aircraft';
      return;
    }
    this.lastAsk = Date.now();
    const data = await this.manager.fetchJson(`https://api.adsb.lol/v2/lat/${area.lat.toFixed(3)}/lon/${area.lon.toFixed(3)}/dist/${area.nm}`);
    this.asked = area;
    this.planes = Aircraft.read(data);
    this.updated = Date.now();
    this.status = 'live';
  }

  // adsb.lol's answer to [{id, callsign, lat, lon, track, alt, speed, type}]
  static read(data) {
    const list = data && (data.ac || data.aircraft);
    return (Array.isArray(list) ? list : []).filter((a) => a && typeof a === 'object').map((a) => ({
      id: a.hex, callsign: String(a.flight || a.r || a.hex || '').trim(), lat: a.lat, lon: a.lon,
      track: a.track, alt: a.alt_baro, speed: a.gs, type: a.t,
    })).filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon) && a.alt !== 'ground');
  }

  // An arrow per aircraft, pointing where it flies, with its callsign
  overlays() {
    // one overlay per arrow direction
    const byArrow = new Map();
    for (const a of this.planes) {
      const arrow = Number.isFinite(a.track) ? ARROWS[Math.round(a.track / 45) % 8] : '✈';
      if (!byArrow.has(arrow)) byArrow.set(arrow, []);
      byArrow.get(arrow).push({lat: a.lat, lon: a.lon, name: a.callsign});
    }
    return [...byArrow].map(([marker, points]) => ({points, color: '#5fd7ff', marker}));
  }

  // The footer text: how many aircraft are in view
  footer() {
    if (this.status !== 'live' && !this.planes.length) return `aircraft: ${this.status}`;
    const old = this.updated && Date.now() - this.updated > 120000 ? ` (${this.age() || 'old'})` : '';
    return `✈ ${this.planes.length} aircraft${old}`;
  }

  // Aircraft whose callsign starts with the text
  search(text) {
    const q = String(text).toLowerCase();
    return this.planes.filter((a) => q && a.callsign.toLowerCase().startsWith(q)).slice(0, 5).map((a) => ({
      name: `${a.callsign}${a.type ? ` (${a.type})` : ''}${Number.isFinite(a.alt) ? `, ${Math.round(a.alt).toLocaleString('en')} ft` : ''}`,
      kind: 'aircraft', lat: a.lat, lon: a.lon, zoom: 10,
    }));
  }
}

module.exports = Aircraft;
