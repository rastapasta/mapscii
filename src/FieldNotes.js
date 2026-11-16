// Field notes in a GeoJSON file. Ids are unique, so notebooks merge without duplicates.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PlaceIndex = require('./PlaceIndex');

class FieldNotes {
  constructor(file) {
    this.file = file;
  }

  // All notes: [{id, lat, lon, title, text, tags, photo, created, updated}]
  list() {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw new Error(`can't read ${this.file}: ${error.message}`);
    }
    return FieldNotes.fromGeoJSON(data);
  }

  // The note with this id or id prefix, or null
  get(id) {
    return this.list().find((note) => note.id === id || note.id.startsWith(id)) || null;
  }

  // Adds a note; returns it
  add({lat, lon, title, text = '', tags = [], photo = null}) {
    checkPosition(lat, lon);
    if (!title || !String(title).trim()) {
      throw new Error('a note needs a title');
    }
    const now = new Date().toISOString();
    const note = {
      id: newId(), lat: +(+lat).toFixed(6), lon: +(+lon).toFixed(6),
      title: oneLine(title), text: String(text), tags: cleanTags(tags), photo: photo || null,
      created: now, updated: now,
    };
    this._write(this.list().concat(note));
    return note;
  }

  // Changes the given fields of a note; returns it
  update(id, changes) {
    const notes = this.list();
    const note = findOne(notes, id);
    if (changes.lat !== undefined || changes.lon !== undefined) {
      checkPosition(changes.lat !== undefined ? changes.lat : note.lat, changes.lon !== undefined ? changes.lon : note.lon);
    }
    for (const field of ['lat', 'lon', 'title', 'text', 'tags', 'photo']) {
      if (changes[field] !== undefined) {
        note[field] = field === 'tags' ? cleanTags(changes.tags) : field === 'title' ? oneLine(changes.title) :
          field === 'lat' || field === 'lon' ? +(+changes[field]).toFixed(6) : changes[field];
      }
    }
    note.updated = new Date().toISOString();
    this._write(notes);
    return note;
  }

  // Removes a note; returns it
  remove(id) {
    const notes = this.list();
    const note = findOne(notes, id);
    this._write(notes.filter((other) => other !== note));
    return note;
  }

  // the newer edit wins; returns {added, updated}
  merge(others) {
    const notes = this.list();
    const byId = new Map(notes.map((note) => [note.id, note]));
    let added = 0;
    let updated = 0;
    for (const other of others) {
      const mine = byId.get(other.id);
      if (!mine) {
        notes.push(other);
        byId.set(other.id, other);
        added++;
      } else if ((other.updated || '') > (mine.updated || '')) {
        Object.assign(mine, other);
        updated++;
      }
    }
    if (added || updated) {
      this._write(notes);
    }
    return {added, updated};
  }

  // Notes matching a search in title, text and tags, best first
  search(text) {
    const query = PlaceIndex.normalize(text);
    if (!query) {
      return [];
    }
    const score = (note) => {
      const title = PlaceIndex.normalize(note.title);
      if (title === query) return 0;
      if (title.startsWith(query)) return 1;
      if ((' ' + title).includes(' ' + query)) return 2;
      if (note.tags.some((tag) => PlaceIndex.normalize(tag) === query)) return 3;
      if (title.includes(query) || PlaceIndex.normalize(note.text).includes(query)) return 4;
      return -1;
    };
    return this.list().map((note) => ({note, s: score(note)})).filter(({s}) => s >= 0)
      .sort((a, b) => a.s - b.s).map(({note}) => note);
  }

  // Writes the notes through a temporary file, so a crash never leaves half a file
  _write(notes) {
    fs.mkdirSync(path.dirname(this.file), {recursive: true});
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(FieldNotes.toGeoJSON(notes), null, 1) + '\n');
    fs.renameSync(tmp, this.file);
  }

  // Notes as a GeoJSON FeatureCollection
  static toGeoJSON(notes) {
    return {
      type: 'FeatureCollection',
      features: notes.map((note) => ({
        type: 'Feature',
        id: note.id,
        geometry: {type: 'Point', coordinates: [note.lon, note.lat]},
        properties: {
          title: note.title, text: note.text, tags: note.tags, photo: note.photo,
          created: note.created, updated: note.updated,
        },
      })),
    };
  }

  // Notes from GeoJSON, also from other programs: every point feature becomes a note
  static fromGeoJSON(data) {
    const features = data && data.type === 'FeatureCollection' ? data.features : data && data.type === 'Feature' ? [data] : null;
    if (!Array.isArray(features)) {
      throw new Error('not a GeoJSON feature collection');
    }
    const notes = [];
    for (const feature of features) {
      const geometry = feature && feature.geometry;
      if (!geometry || geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) continue;
      const [lon, lat] = geometry.coordinates.map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
      const p = feature.properties || {};
      const id = feature.id !== undefined ? String(feature.id) : p.id !== undefined ? String(p.id) :
        // stable id, so importing a file twice adds nothing
        crypto.createHash('sha1').update(`${lat},${lon},${p.title || p.name || ''}`).digest('hex').slice(0, 12);
      notes.push({
        id, lat, lon,
        title: oneLine(p.title || p.name || 'Untitled'),
        text: String(p.text || p.description || ''),
        tags: cleanTags(Array.isArray(p.tags) ? p.tags : typeof p.tags === 'string' ? p.tags.split(',') : []),
        photo: p.photo || null,
        created: p.created || null,
        updated: p.updated || p.created || null,
      });
    }
    return notes;
  }

  // Notes as CSV, for spreadsheets
  static toCSV(notes) {
    const cell = (value) => /[",\n\r]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value);
    const rows = [['id', 'latitude', 'longitude', 'title', 'text', 'tags', 'photo', 'created', 'updated']];
    for (const n of notes) {
      rows.push([n.id, n.lat, n.lon, n.title, n.text, n.tags.join(', '), n.photo || '', n.created || '', n.updated || '']);
    }
    return rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
  }

  // Notes as GPX waypoints, for GPS devices
  static toGPX(notes) {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const points = notes.map((n) => `  <wpt lat="${n.lat}" lon="${n.lon}">${n.created ? `<time>${esc(n.created)}</time>` : ''}<name>${esc(n.title)}</name>${n.text ? `<desc>${esc(n.text)}</desc>` : ''}</wpt>`);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="MapSCII field notes" xmlns="http://www.topografix.com/GPX/1/1">\n${points.join('\n')}\n</gpx>\n`;
  }
}

// A new note id
function newId() {
  // time first so ids sort by creation; random so two people never clash
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

// The one note with this id or prefix; throws if none or several match
function findOne(notes, id) {
  const found = notes.filter((note) => note.id === id || note.id.startsWith(String(id)));
  if (!found.length) {
    throw new Error(`no note ${id}`);
  }
  if (found.length > 1 && !found.some((note) => note.id === id)) {
    throw new Error(`${id} could be ${found.length} notes - give more of its id`);
  }
  return found.find((note) => note.id === id) || found[0];
}

// Throws unless lat and lon are valid
function checkPosition(lat, lon) {
  if (!Number.isFinite(+lat) || !Number.isFinite(+lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error('a note needs a position: latitude -90..90, longitude -180..180');
  }
}

// The text with runs of whitespace as single spaces
function oneLine(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

// Tags in lower case, without duplicates or empty ones
function cleanTags(tags) {
  return [...new Set(tags.map((tag) => oneLine(tag).toLowerCase()).filter(Boolean))];
}

module.exports = FieldNotes;
