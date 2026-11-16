// Areas kept as map packs, downloaded when allowed (hours, Wi-Fi, unmetered, daily budget).
// Tiles go through MapSCII's disk cache, so a download can resume without fetching anything twice.
'use strict';
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const TileSource = require('../../src/TileSource');
const DataMeter = require('../../src/DataMeter');
const {writePack, cachedTiles} = require('../../src/MapPack');
const config = require('../../src/config');

class Depot {
  constructor(file, usageFile = null) {
    this.file = file;
    this.usageFile = usageFile;
  }

  // The areas in the file
  areas() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8')).areas || [];
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new Error(`can't read ${this.file}: ${error.message}`);
    }
  }

  // Adds or replaces an area {name, lat, lon, km, maxZoom, source}
  add(area) {
    const name = String(area.name || '').trim();
    if (!/^[\w.-]+$/.test(name)) {
      throw new Error('an area needs a name of letters, digits, - and _ (it names the pack file)');
    }
    if (!(area.km > 0)) {
      throw new Error('an area needs a radius in km greater than 0');
    }
    const entry = {
      name, lat: +(+area.lat).toFixed(6), lon: +(+area.lon).toFixed(6), km: +area.km,
      maxZoom: Math.min(Math.max(0, Math.round(area.maxZoom === undefined ? 14 : area.maxZoom)), 14),
      source: area.source || 'mapscii',
    };
    const areas = this.areas().filter((other) => other.name !== name).concat(entry);
    this._write(areas);
    return entry;
  }

  // Removes an area
  remove(name) {
    const areas = this.areas();
    if (!areas.some((area) => area.name === name)) {
      throw new Error(`no area "${name}"`);
    }
    this._write(areas.filter((area) => area.name !== name));
  }

  // Writes the areas through a temporary file
  _write(areas) {
    fs.mkdirSync(path.dirname(this.file), {recursive: true});
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({areas}, null, 2) + '\n');
    fs.renameSync(tmp, this.file);
  }

  // missingMB is estimated
  async plan(names = null) {
    const result = [];
    for (const area of this._pick(names)) {
      let tileSource;
      try {
        tileSource = await this._source(area.source);
      } catch (error) {
        result.push({area, error: error.message});
        continue;
      }
      const tiles = tileSource.countAreaTiles(area.lat, area.lon, area.km, area.maxZoom);
      const cached = tiles <= config.maxDownloadTiles ? cachedTiles(tileSource, this._areaOf(area)).length : 0;
      result.push({area, tiles, cached, missing: tiles - cached, missingMB: (tiles - cached) * config.downloadTileKB / 1024});
    }
    return result;
  }

  // budgetMB: stop after this much data this run. Returns one result per area.
  async build(names, {out, budgetMB = Infinity, shouldStop = () => false, onProgress = () => null} = {}) {
    fs.mkdirSync(out, {recursive: true});
    const start = TileSource.meter.sessionBytes();
    const overBudget = () => (TileSource.meter.sessionBytes() - start) / 1024 / 1024 >= budgetMB;
    const results = [];
    for (const area of this._pick(names)) {
      let tileSource;
      try {
        tileSource = await this._source(area.source);
      } catch (error) {
        results.push({area, error: error.message});
        continue;
      }
      let download = {total: 0, failed: 0, done: 0, stopped: false};
      if (!overBudget() && !shouldStop()) {
        download = await tileSource.downloadArea(area.lat, area.lon, area.km, area.maxZoom,
          (done, total, failed) => onProgress(area, done, total, failed),
          {shouldStop: () => overBudget() || shouldStop()});
      }
      const tiles = tileSource.countAreaTiles(area.lat, area.lon, area.km, area.maxZoom);
      const cached = cachedTiles(tileSource, this._areaOf(area)).length;
      let pack = null;
      if (cached) {
        const file = path.join(out, `${area.name}.mbtiles`);
        pack = Object.assign({file}, writePack(tileSource, file, this._areaOf(area)));
      }
      results.push({area, tiles, cached, complete: cached >= tiles, failed: download.failed, stopped: download.stopped || overBudget(), pack});
      if (overBudget() || shouldStop()) {
        for (const rest of this._pick(names).slice(results.length)) {
          results.push({area: rest, skipped: true});
        }
        break;
      }
    }
    TileSource.meter.save();
    return results;
  }

  // policy: {hours: '00:00-06:00', wifi: ['Home'], notMetered, dailyMB}; network is for tests
  conditions(policy, now = new Date(), network = null) {
    const reasons = [];
    if (policy.hours) {
      const m = String(policy.hours).match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
      if (!m) throw new Error('hours: e.g. 00:00-06:00');
      const from = +m[1] * 60 + +m[2];
      const to = +m[3] * 60 + +m[4];
      const minute = now.getHours() * 60 + now.getMinutes();
      const inside = from <= to ? minute >= from && minute < to : minute >= from || minute < to;
      if (!inside) reasons.push(`outside ${policy.hours}`);
    }
    if ((policy.wifi && policy.wifi.length) || policy.notMetered) {
      const net = network || Depot.network();
      if (policy.wifi && policy.wifi.length && !policy.wifi.includes(net.ssid)) {
        reasons.push(net.ssid ? `on Wi-Fi "${net.ssid}", not ${policy.wifi.map((w) => `"${w}"`).join(' or ')}` : 'not on one of the Wi-Fi networks given');
      }
      if (policy.notMetered && net.metered !== false) {
        reasons.push(net.metered ? 'the connection is metered' : 'can\'t tell whether the connection is metered');
      }
    }
    if (policy.dailyMB !== undefined && this.usageFile) {
      const used = this.usedTodayMB();
      if (used >= policy.dailyMB) reasons.push(`${used.toFixed(1)} MB used today, the limit is ${policy.dailyMB} MB`);
    }
    return {ok: reasons.length === 0, reasons};
  }

  // MB used today by MapSCII and its tools, saved plus this run
  usedTodayMB() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const saved = DataMeter.read(this.usageFile).days[today] || 0;
    const unsaved = TileSource.meter.sessionBytes() - TileSource.meter.savedBytes;
    return (saved + unsaved) / 1024 / 1024;
  }

  // The Wi-Fi and whether the connection is metered, from NetworkManager: {ssid, metered}
  static network() {
    const run = (args) => {
      try {
        return execFileSync('nmcli', args, {encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']});
      } catch (error) {
        return null;
      }
    };
    // --rescan no: a rescan can leave the list empty for a moment
    const wifi = run(['-t', '-f', 'active,ssid', 'dev', 'wifi', 'list', '--rescan', 'no']);
    const active = wifi ? wifi.split('\n').find((line) => line.startsWith('yes:')) : null;
    const ssid = active ? active.slice(4).replace(/\\:/g, ':') : null;
    const devices = run(['-t', '-f', 'GENERAL.METERED', 'dev', 'show']);
    let metered = null;
    if (devices) {
      const values = devices.split('\n').filter((line) => line.startsWith('GENERAL.METERED:')).map((line) => line.slice(16));
      // a connection NetworkManager was told is metered (or guesses so) counts
      if (values.some((v) => v.startsWith('yes'))) metered = true;
      else if (values.some((v) => v.startsWith('no'))) metered = false;
    }
    return {ssid, metered};
  }

  // The areas with these names, or all
  _pick(names) {
    const areas = this.areas();
    if (!names || !names.length) return areas;
    return names.map((name) => {
      const area = areas.find((a) => a.name === name);
      if (!area) throw new Error(`no area "${name}" (see: depot list)`);
      return area;
    });
  }

  // An area in TileSource's form
  _areaOf(area) {
    return {lat: area.lat, lon: area.lon, radiusKm: area.km, maxZoom: area.maxZoom};
  }

  // The tile source of an area, opened once
  async _source(source) {
    this.sources = this.sources || {};
    if (!this.sources[source]) {
      const tileSource = new TileSource();
      await tileSource.init(source === 'mapscii' ? config.source : source);
      this.sources[source] = tileSource;
    }
    return this.sources[source];
  }
}

module.exports = Depot;
