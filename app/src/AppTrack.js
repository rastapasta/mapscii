// Records the track in local storage and exports it as GPX.
'use strict';
const Gpx = require('../../src/Gpx');

const KEY = 'track';
// metres: standing still adds nothing
const MIN_METRES = 5;

class AppTrack {
  constructor() {
    this.points = [];
    this.recording = false;
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && Array.isArray(saved.points)) {
        this.points = saved.points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
        this.recording = !!saved.recording;
      }
    } catch (error) {
      void 0;
    }
  }

  // Adds a position; returns whether it was kept
  add(position) {
    if (!this.recording || !position || !Number.isFinite(position.lat) || !Number.isFinite(position.lon)) return false;
    const last = this.points[this.points.length - 1];
    if (last && Gpx.length([last, position]) * 1000 < MIN_METRES) return false;
    const point = {lat: +position.lat.toFixed(7), lon: +position.lon.toFixed(7), time: position.time || new Date().toISOString()};
    if (Number.isFinite(position.altitude)) point.altitude = +position.altitude.toFixed(1);
    this.points.push(point);
    this._save();
    return true;
  }

  // Starts recording
  start() {
    this.recording = true;
    this._save();
  }

  // Stops recording
  stop() {
    this.recording = false;
    this._save();
  }

  // Deletes the recorded points
  clear() {
    this.points = [];
    this._save();
  }

  // The track's length in km
  km() {
    return Gpx.length(this.points);
  }

  // The track as a GPX file
  gpx(name = 'Track') {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const points = this.points.map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}">${p.altitude !== undefined ? `<ele>${p.altitude}</ele>` : ''}${p.time ? `<time>${esc(p.time)}</time>` : ''}</trkpt>`);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Dotpath (built on MapSCII)" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>${esc(name)}</name><trkseg>\n${points.join('\n')}\n</trkseg></trk>\n</gpx>\n`;
  }

  // Saves the track in local storage
  _save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({recording: this.recording, points: this.points}));
    } catch (error) {
      // storage full: keep the points in memory for this visit
      void 0;
    }
  }
}

module.exports = AppTrack;
