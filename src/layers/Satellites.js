// Satellites from CelesTrak. Orbits are fetched daily; positions are computed locally (SGP4), so they move offline too.
'use strict';
const satellite = require('satellite.js');
const {Layer} = require('./LayerManager');

const GROUPS = ['stations', 'visual'];
// The CelesTrak TLE URL of a satellite group
const url = (group) => `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`;

// TLE text to [{name, satrec, id}]
function parseTle(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  const out = [];
  for (let i = 0; i + 2 < lines.length; i++) {
    if (lines[i + 1] && lines[i + 2] && lines[i + 1].startsWith('1 ') && lines[i + 2].startsWith('2 ')) {
      try {
        const satrec = satellite.twoline2satrec(lines[i + 1], lines[i + 2]);
        if (!satrec.error) out.push({name: lines[i].trim(), satrec, id: lines[i + 1].slice(2, 7).trim()});
      } catch (error) {
        void 0;
      }
      i += 2;
    }
  }
  return out;
}

// Where a satellite is at a time: {lat, lon, km}, or null
function positionAt(satrec, date) {
  const pv = satellite.propagate(satrec, date);
  if (!pv || !pv.position || typeof pv.position === 'boolean') return null;
  const geo = satellite.eciToGeodetic(pv.position, satellite.gstime(date));
  const lat = satellite.degreesLat(geo.latitude);
  const lon = satellite.degreesLong(geo.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {lat, lon, km: geo.height};
}

class Satellites extends Layer {
  constructor() {
    super('satellites', 'satellites', {aliases: ['sats', 'iss'], every: 6 * 3600});
    this.sats = [];
    this.followed = '25544';
  }

  // Starts a redraw every second, as satellites move
  start() {
    super.start();
    this.tick = setInterval(() => this.manager.onChange(), 1000);
    if (this.tick.unref) this.tick.unref();
  }

  // Stops the redraws
  stop() {
    super.stop();
    clearInterval(this.tick);
  }

  // Fetches the orbits, at most once a day, else uses the cached copy
  async refresh() {
    const texts = [];
    let oldest = Infinity;
    for (const group of GROUPS) {
      let [text, age] = this.manager.readCache(`celestrak-${group}.tle`);
      if (!text || age > 86400) {
        try {
          const fresh = await this.manager.fetchText(url(group));
          if (parseTle(fresh).length) {
            this.manager.writeCache(`celestrak-${group}.tle`, fresh);
            text = fresh;
            age = 0;
          }
        } catch (error) {
          if (!text) throw error;
        }
      }
      if (text) {
        texts.push(text);
        oldest = Math.min(oldest, age === null ? 0 : age);
      }
    }
    const seen = new Set();
    this.sats = parseTle(texts.join('\n')).filter((s) => !seen.has(s.id) && seen.add(s.id));
    this.updated = Date.now() - oldest * 1000;
    this.status = this.sats.length ? 'live' : 'no satellites';
  }

  // The current time (replaced in tests)
  _now() {
    return new Date();
  }

  // All satellites' positions at a time
  positions(date = this._now()) {
    const out = [];
    for (const s of this.sats) {
      const p = positionAt(s.satrec, date);
      if (p) out.push(Object.assign({name: s.name, id: s.id}, p));
    }
    return out;
  }

  // The satellites, and the followed one's path over the next orbit
  overlays() {
    const now = this._now();
    const points = this.positions(now).map((p) => ({lat: p.lat, lon: p.lon, name: shortName(p.name)}));
    const lines = [];
    const followed = this.sats.find((s) => s.id === this.followed);
    if (followed) {
      let line = [];
      for (let m = 0; m <= 95; m += 1) {
        const p = positionAt(followed.satrec, new Date(now.getTime() + m * 60000));
        if (!p) continue;
        // split the path where it crosses the date line
        if (line.length && Math.abs(p.lon - line[line.length - 1].lon) > 180) {
          lines.push(line);
          line = [];
        }
        line.push(p);
      }
      lines.push(line);
    }
    return [{lines, points, color: '#d7afff', marker: '✦'}];
  }

  // The footer text: how many satellites, and the followed one's height
  footer() {
    if (!this.sats.length) return `satellites: ${this.status}`;
    const old = (Date.now() - this.updated) / 86400000;
    const followed = this.sats.find((s) => s.id === this.followed);
    const p = followed && positionAt(followed.satrec, this._now());
    const where = p ? `, ${shortName(followed.name)} at ${Math.round(p.km)} km` : '';
    return `✦ ${this.sats.length} satellites${where}${old > 3 ? ` (orbits ${Math.round(old)} days old)` : ''}`;
  }

  // Satellites whose name contains the text; the one chosen is followed
  search(text) {
    const q = String(text).toLowerCase();
    if (!q) return [];
    return this.positions().filter((p) => p.name.toLowerCase().includes(q)).slice(0, 5).map((p) => {
      return {name: shortName(p.name), kind: 'satellite', lat: p.lat, lon: p.lon, zoom: 3, onSelect: () => {
        this.followed = p.id;
      }};
    });
  }
}

// "ISS (ZARYA)" -> "ISS"
function shortName(name) {
  return name.replace(/\s*\((ZARYA|TIANHE)\)$/, '').trim();
}

Satellites.parseTle = parseTle;
Satellites.positionAt = positionAt;
module.exports = Satellites;
