// Live layers over the map (o in the map, --layers). Each keeps its last data on disk so it works offline.
'use strict';
const fs = require('fs');
const path = require('path');
const Net = require('../Net');

class LayerManager {
  // options: {cacheDir, stateFile, onChange, keys, fetchJson/fetchText/fetchBuffer (for tests)}
  constructor({cacheDir = null, stateFile = null, onChange = () => null, keys = null,
    fetchJson = Net.fetchJson, fetchText = Net.fetchText, fetchBuffer = Net.fetchBuffer} = {}) {
    this.cacheDir = cacheDir;
    this.stateFile = stateFile;
    this.onChange = onChange;
    this.keys = keys;
    this.fetchJson = fetchJson;
    this.fetchText = fetchText;
    this.fetchBuffer = fetchBuffer;
    this.layers = [];
    this.view = null;
  }

  // Adds a layer to the manager
  add(layer) {
    layer.manager = this;
    this.layers.push(layer);
    return layer;
  }

  // The layer with this id or alias, or null
  get(id) {
    return this.layers.find((layer) => layer.id === id || layer.aliases.includes(id)) || null;
  }

  // Switches on the layers that were on last time, or those given
  restore(ids = null) {
    let wanted = ids;
    if (!wanted && this.stateFile) {
      try {
        wanted = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')).on || [];
      } catch (error) {
        wanted = [];
      }
    }
    for (const id of wanted || []) {
      const layer = this.get(id);
      if (!layer) throw new Error(`no layer "${id}" (there are: ${this.layers.map((l) => l.id).join(', ')})`);
      layer.start();
    }
    if (ids) this._save();
  }

  // Switches a layer on or off and remembers it
  toggle(id) {
    const layer = this.get(id);
    if (!layer) return null;
    if (layer.on) layer.stop();
    else layer.start();
    this._save();
    this.onChange();
    return layer.on;
  }

  // Saves which layers are on
  _save() {
    if (!this.stateFile) return;
    try {
      fs.mkdirSync(path.dirname(this.stateFile), {recursive: true});
      fs.writeFileSync(this.stateFile, JSON.stringify({on: this.layers.filter((l) => l.on).map((l) => l.id)}) + '\n');
    } catch (error) {
      void 0;
    }
  }

  // Tells the layers the view changed
  setView(view) {
    const previous = this.view;
    this.view = view;
    for (const layer of this.layers) {
      if (layer.on) layer.viewChanged(previous, view);
    }
  }

  // The overlays of all layers that are on
  overlays() {
    return this.layers.filter((l) => l.on).flatMap((l) => l.overlays()).filter(Boolean);
  }

  // Layers with the same status share one entry: "traffic, fires: needs a key"
  footer() {
    const parts = [];
    const same = new Map();
    for (const layer of this.layers.filter((l) => l.on)) {
      const text = layer.footer();
      if (!text) continue;
      const status = text.startsWith(`${layer.name}: `) ? text.slice(layer.name.length + 2) : null;
      if (status === null) {
        parts.push(text);
      } else if (same.has(status)) {
        same.get(status).push(layer.name);
      } else {
        same.set(status, [layer.name]);
        parts.push(same.get(status));
      }
    }
    // live first, then fixable states, then waiting ones: a long footer is cut off at the end
    const rank = (part) => (!Array.isArray(part) ? 0 : /key/.test(statusOf(part)) ? 1 : 2);
    const statusOf = (part) => [...same].find(([, names]) => names === part)[0];
    return parts.map((part, i) => [part, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
      .map(([part]) => (Array.isArray(part) ? `${part.join(', ')}: ${statusOf(part)}` : part)).join('  ');
  }

  // Search results from all layers that are on
  search(text) {
    return this.layers.filter((l) => l.on).flatMap((l) => l.search(text));
  }

  // [data, age in seconds], or [null, null]
  readCache(name) {
    if (!this.cacheDir) return [null, null];
    try {
      const file = path.join(this.cacheDir, name);
      const age = (Date.now() - fs.statSync(file).mtimeMs) / 1000;
      return [fs.readFileSync(file, 'utf8'), age];
    } catch (error) {
      return [null, null];
    }
  }

  // Saves a layer's data for offline use
  writeCache(name, text) {
    if (!this.cacheDir) return;
    try {
      fs.mkdirSync(this.cacheDir, {recursive: true});
      fs.writeFileSync(path.join(this.cacheDir, name), text);
    } catch (error) {
      void 0;
    }
  }

  // Switches every layer off
  stop() {
    for (const layer of this.layers) {
      if (layer.on) layer.stop();
    }
  }
}

class Layer {
  constructor(id, name, {aliases = [], every = 600} = {}) {
    this.id = id;
    this.name = name;
    this.aliases = aliases;
    this.every = every;
    this.on = false;
    this.status = '';
    this.updated = null;
  }

  // Switches the layer on and fetches its data
  start() {
    if (this.on) return;
    this.on = true;
    this.status = 'loading';
    this._refreshSoon(0);
  }

  // Switches the layer off
  stop() {
    this.on = false;
    clearTimeout(this.timer);
  }

  // Schedules a refresh in this many seconds
  _refreshSoon(seconds) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._run(), seconds * 1000);
    if (this.timer.unref) this.timer.unref();
  }

  // Refreshes, sets the status, and schedules the next refresh
  async _run() {
    if (!this.on) return;
    try {
      await this.refresh();
    } catch (error) {
      this.status = this.updated ? `no update (${shortError(error)})` : shortError(error);
    }
    if (this.on) {
      this.manager.onChange();
      this._refreshSoon(this.every);
    }
  }

  // Fetches new data; layers override this
  async refresh() {}

  // Called when the view changed; layers override this
  viewChanged() {}

  // What to draw, in Renderer.setOverlays' form
  overlays() {
    return [];
  }

  // The layer's footer text, or null
  footer() {
    return null;
  }

  // Search results: [{name, kind, lat, lon, zoom}]
  search() {
    return [];
  }

  // "3 h old" for data that couldn't be updated, else ''
  age() {
    if (!this.updated) return '';
    const s = (Date.now() - this.updated) / 1000;
    return s < 120 ? '' : s < 5400 ? `${Math.round(s / 60)} min old` : s < 172800 ? `${Math.round(s / 3600)} h old` : `${Math.round(s / 86400)} days old`;
  }
}

// A short status for a failed refresh
function shortError(error) {
  if (error.type === 'system' || error.type === 'request-timeout') return 'no connection';
  if (error.status === 401 || error.status === 403) return 'the key was refused (see mapscii --keys)';
  if (error.status === 429) return 'the free requests are used up for now';
  if (error.status) return `server error ${error.status}`;
  return String(error.message).slice(0, 40);
}

// menu order: layers without a key first
LayerManager.ALL = () => ['Satellites', 'Earthquakes', 'Aircraft', 'Weather', 'Traffic', 'Fires', 'Ships'].map((name) => require(`./${name}`));

// The API key of a service, or null
Layer.prototype.key = function key(service) {
  const keys = this.manager && this.manager.keys;
  return keys ? keys.get(service) : null;
};

module.exports = {LayerManager, Layer, shortError};
