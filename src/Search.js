'use strict';
const fs = require('fs');
const path = require('path');
const {execFile} = require('child_process');
const stringWidth = require('string-width');

// No control sequences from a query, database or provider reach the terminal.
function clean(text) {
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  return String(text).replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ' ');
}

function clip(text, width) {
  let out = '';
  let used = 0;
  for (const ch of clean(text)) {
    const cells = stringWidth(ch);
    if (used + cells > width) break;
    out += ch;
    used += cells;
  }
  return out;
}

function coordinates(query) {
  const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
  const match = query.trim().match(new RegExp(`^(${number})(?:\\s*,\\s*|\\s+)(${number})(?:(?:\\s*,\\s*|\\s+)(${number}))?$`));
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  const zoom = match[3] === undefined ? undefined : Number(match[3]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (zoom !== undefined && (zoom < 0 || zoom > 22))) {
    throw new Error('Coordinates: latitude -90..90, longitude -180..180, optional zoom 0..22');
  }
  return {lat, lon, zoom, label: `${lat}, ${lon}`};
}

function sqliteProvider(database, command = 'sqlite3') {
  return query => new Promise((resolve, reject) => {
    if (!database || !fs.existsSync(database)) {
      return reject(new Error('No offline index. Run maps-search-index first; lat,lon works without it.'));
    }
    // FTS receives quoted tokens, and SQL receives an escaped literal. Never a shell.
    const tokens = query.slice(0, 256).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .split(/\s+/).filter(Boolean).slice(0, 12);
    if (!tokens.length) return resolve([]);
    const match = tokens.map(token => `"${token.replace(/"/g, '""')}"*`).join(' AND ').replace(/'/g, '\'\'');
    const sql = `SELECT p.name, p.label, p.lat, p.lon FROM place_names AS f
      JOIN places AS p ON p.id = f.rowid WHERE place_names MATCH '${match}'
      ORDER BY p.population DESC, p.name, p.id LIMIT 10;`;
    execFile(command, ['-readonly', '-json', path.resolve(database), sql],
      {timeout: 3000, maxBuffer: 128 * 1024}, (error, stdout) => {
        if (error) return reject(new Error(error.code === 'ENOENT' ?
          'Offline search needs sqlite3 in PATH.' : 'Cannot search index (invalid schema, busy database or timeout).'));
        try { resolve(JSON.parse(stdout || '[]')); } catch (_) { reject(new Error('Invalid search response.')); }
      });
  });
}

class Search {
  constructor({provider, select, changed, timeout = 5000}) {
    this.provider = provider;
    this.select = select;
    this.changed = changed;
    this.timeout = timeout;
    this.active = false;
    this.generation = 0;
    this.timer = null;
  }

  open() {
    this.cancel();
    this.active = true;
    this.mode = 'input';
    this.text = [];
    this.cursor = 0;
    this.message = '';
    this.changed();
  }

  cancel() {
    this.active = false;
    this.generation++;
    clearTimeout(this.timer);
    this.timer = null;
  }

  key(key = {}, ch) {
    key = key || {};
    if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
      this.cancel();
      this.changed();
      return;
    }
    if (this.mode === 'loading') return;
    if (this.mode === 'results') {
      if (key.name === 'up' || key.name === 'down') {
        this.index = (this.index + (key.name === 'up' ? -1 : 1) + this.results.length) % this.results.length;
      } else if (key.name === 'return' || key.name === 'enter') {
        const result = this.results[this.index];
        this.cancel();
        this.select(result);
      } else if (key.name === 'backspace') {
        this.mode = 'input';
      }
      this.changed();
      return;
    }
    if (key.name === 'return' || key.name === 'enter') return this.submit();
    if (key.name === 'left') this.cursor = Math.max(0, this.cursor - 1);
    else if (key.name === 'right') this.cursor = Math.min(this.text.length, this.cursor + 1);
    else if (key.name === 'home' || (key.ctrl && key.name === 'a')) this.cursor = 0;
    else if (key.name === 'end' || (key.ctrl && key.name === 'e')) this.cursor = this.text.length;
    else if (key.ctrl && key.name === 'u') { this.text = []; this.cursor = 0; }
    else if (key.name === 'backspace' && this.cursor) this.text.splice(--this.cursor, 1);
    else if (key.name === 'delete') this.text.splice(this.cursor, 1);
    // eslint-disable-next-line no-control-regex -- control characters are not typed text
    else if (ch && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f-\x9f]/.test(ch)) {
      const chars = Array.from(clean(ch)).slice(0, 256 - this.text.length);
      this.text.splice(this.cursor, 0, ...chars);
      this.cursor += chars.length;
    }
    this.message = '';
    this.changed();
  }

  async submit() {
    const query = this.text.join('').trim();
    if (!query) return;
    const generation = ++this.generation;
    try {
      const point = coordinates(query);
      if (point) { this.cancel(); this.select(point); this.changed(); return; }
      this.mode = 'loading';
      this.changed();
      // Timeouts also settle a provider which never resolves. Late results are ignored.
      const timedOut = new Promise((_, reject) => {
        this.timer = setTimeout(() => reject(new Error('Search timed out.')), this.timeout);
      });
      const results = await Promise.race([Promise.resolve().then(() => this.provider(query)), timedOut]);
      if (!this.active || generation !== this.generation) return;
      clearTimeout(this.timer);
      this.timer = null;
      if (!Array.isArray(results)) throw new Error('Invalid search response.');
      this.results = results.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) &&
        Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && typeof p.label === 'string')
        .slice(0, 10).map(p => ({lat: p.lat, lon: p.lon, label: clean(p.label).slice(0, 512)}));
      if (!this.results.length) throw new Error('No matching places. Try another name or lat,lon.');
      this.mode = 'results';
      this.index = 0;
      this.message = '';
    } catch (error) {
      if (!this.active || generation !== this.generation) return;
      clearTimeout(this.timer);
      this.timer = null;
      this.mode = 'input';
      this.message = clean(error.message || 'Search failed.');
    }
    this.changed();
  }

  footer(width) {
    if (this.mode === 'loading') return clip('Searching local index... Esc cancels', width);
    if (this.mode === 'results') {
      const p = this.results[this.index];
      return clip(`${this.index + 1}/${this.results.length} ${p.label} | Up/Down choose, Enter go, Backspace edit, Esc cancel`, width);
    }
    if (this.message) return clip(this.message + ' | Edit query or Esc', width);
    // Scroll the input around a visible cursor; reserve a column to avoid terminal wrapping.
    const before = this.text.slice(0, this.cursor);
    const budget = Math.max(0, width - 3);
    while (before.length && stringWidth(before.join('')) >= budget) before.shift();
    return clip('/' + before.join('') + '|' + this.text.slice(this.cursor).join(''), width);
  }
}

module.exports = {Search, sqliteProvider, coordinates, clip, clean};
