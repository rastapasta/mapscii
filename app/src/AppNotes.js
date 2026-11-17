// FieldNotes kept in local storage; exports the same notes.geojson as MapSCII.
'use strict';
const FieldNotes = require('../../src/FieldNotes');

const KEY = 'field-notes';

class AppNotes extends FieldNotes {
  constructor() {
    super(null);
  }

  // read once, then cached (the map asks every frame); copies, so edits don't leak in
  list() {
    if (!this.kept) {
      try {
        const text = localStorage.getItem(KEY);
        this.kept = text ? FieldNotes.fromGeoJSON(JSON.parse(text)) : [];
      } catch (error) {
        this.kept = [];
      }
    }
    return this.kept.map((note) => Object.assign({}, note, {tags: note.tags.slice()}));
  }

  // Saves the notes in local storage
  _write(notes) {
    try {
      localStorage.setItem(KEY, JSON.stringify(FieldNotes.toGeoJSON(notes)));
    } catch (error) {
      throw new Error('the phone\'s storage for this app is full: export the notes and remove some');
    }
    this.kept = null;
  }

  // The notebook as a GeoJSON file
  geojson() {
    return JSON.stringify(FieldNotes.toGeoJSON(this.list()), null, 1) + '\n';
  }
}

module.exports = AppNotes;
