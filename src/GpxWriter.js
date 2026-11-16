// Records a track to GPX, rewriting the closing tags after each point so the file is always valid.
'use strict';
const fs = require('fs');
const path = require('path');
const Gpx = require('./Gpx');

const TAIL = '</trkseg></trk>\n</gpx>\n';

class GpxWriter {
  constructor(file, name = 'MapSCII track') {
    this.file = file;
    fs.mkdirSync(path.dirname(file), {recursive: true});
    let existing = null;
    try {
      existing = fs.readFileSync(file, 'utf8');
    } catch (error) {
      void 0;
    }
    if (existing && existing.endsWith(TAIL)) {
      this.fd = fs.openSync(file, 'r+');
      this.end = Buffer.byteLength(existing) - Buffer.byteLength(TAIL);
      this._write('</trkseg><trkseg>\n');
    } else {
      if (existing) {
        fs.renameSync(file, `${file}.${Date.now()}.old`);
      }
      this.fd = fs.openSync(file, 'w+');
      this.end = 0;
      this._write(`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="MapSCII GPS bridge" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>${escape(name)}</name><trkseg>\n`);
    }
    this.points = 0;
  }

  // Adds a point {lat, lon, time, altitude}
  add(point) {
    const ele = point.altitude !== undefined ? `<ele>${+point.altitude.toFixed(1)}</ele>` : '';
    const time = point.time ? `<time>${escape(point.time)}</time>` : '';
    this._write(`<trkpt lat="${+point.lat.toFixed(7)}" lon="${+point.lon.toFixed(7)}">${ele}${time}</trkpt>\n`);
    this.points++;
  }

  // Writes text before the closing tags, then the closing tags after it
  _write(text) {
    const buffer = Buffer.from(text + TAIL);
    fs.writeSync(this.fd, buffer, 0, buffer.length, this.end);
    this.end += Buffer.byteLength(text);
    fs.ftruncateSync(this.fd, this.end + Buffer.byteLength(TAIL));
  }

  // Closes the file
  close() {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }

  // The points recorded in a file, all segments
  static read(file) {
    return Gpx.parse(fs.readFileSync(file, 'utf8')).tracks.flatMap((track) => track.points);
  }
}

// Escapes text for XML
function escape(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = GpxWriter;
