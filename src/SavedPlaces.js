// Saved places, in a plain text file:
//
//   Home = 52.52, 13.405 z14
'use strict';
const fs = require('fs');
const path = require('path');
const coordinates = require('./coordinates');
const PlaceIndex = require('./PlaceIndex');

class SavedPlaces {
  constructor(file) {
    this.file = file;
  }

  // All places in the file, [{name, lat, lon, zoom}]; unreadable lines are skipped
  list() {
    let text;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch (error) {
      return [];
    }
    const places = [];
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([^#=][^=]*?)\s*=\s*(.+?)\s*$/);
      if (!m) continue;
      try {
        const {lat, lon, zoom} = coordinates.parse(m[2]);
        places.push({name: m[1], lat, lon, zoom});
      } catch (error) {
        continue;
      }
    }
    return places;
  }

  // The place of that name (case and accents don't matter), or null
  get(name) {
    const key = PlaceIndex.normalize(name);
    return this.list().find((place) => PlaceIndex.normalize(place.name) === key) || null;
  }

  // replaces a place of the same name in its line; other lines stay as they are
  save(name, lat, lon, zoom) {
    const clean = String(name).replace(/[=\r\n#]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) {
      throw new Error('a place needs a name');
    }
    const line = `${clean} = ${+lat.toFixed(6)}, ${+lon.toFixed(6)}${zoom !== undefined ? ` z${+zoom.toFixed(1)}` : ''}`;
    let lines = [];
    try {
      lines = fs.readFileSync(this.file, 'utf8').split(/\r?\n/);
    } catch (error) {
      lines = ['# MapSCII saved places: name = latitude, longitude zoom', ''];
    }
    const key = PlaceIndex.normalize(clean);
    const at = lines.findIndex((l) => {
      const m = l.match(/^\s*([^#=][^=]*?)\s*=/);
      return m && PlaceIndex.normalize(m[1]) === key;
    });
    if (at === -1) {
      if (lines.length && lines[lines.length - 1] === '') {
        lines.splice(lines.length - 1, 0, line);
      } else {
        lines.push(line);
      }
    } else {
      lines[at] = line;
    }
    fs.mkdirSync(path.dirname(this.file), {recursive: true});
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, lines.join('\n').replace(/\n*$/, '\n'));
    fs.renameSync(tmp, this.file);
    return {name: clean, lat, lon, zoom};
  }

  // Saved places matching a search, best first
  search(text) {
    const query = PlaceIndex.normalize(text);
    if (!query) {
      return [];
    }
    const match = (key) => key === query ? 0 : key.startsWith(query) ? 1 : (' ' + key).includes(' ' + query) ? 2 : key.includes(query) ? 3 : -1;
    return this.list()
      .map((place) => ({place, m: match(PlaceIndex.normalize(place.name))}))
      .filter(({m}) => m >= 0)
      .sort((a, b) => a.m - b.m)
      .map(({place}) => ({name: place.name, kind: 'saved', lat: place.lat, lon: place.lon, zoom: place.zoom !== undefined ? place.zoom : 15}));
  }
}

module.exports = SavedPlaces;
