// NMEA 0183: RMC and GGA sentences from any talker (GP, GN, GL, ...).
'use strict';

// sentences without a checksum pass
function checksumOk(sentence) {
  const m = sentence.match(/^\$([^*]*)\*([0-9A-Fa-f]{2})\s*$/);
  if (!m) {
    return /^\$[^*]*$/.test(sentence.trim());
  }
  let sum = 0;
  for (const c of m[1]) {
    sum ^= c.charCodeAt(0);
  }
  return sum === parseInt(m[2], 16);
}

// ddmm.mmmm with N/S (or dddmm.mmmm with E/W) as degrees
function degrees(value, hemisphere) {
  if (!value || !hemisphere) {
    return null;
  }
  const dot = value.indexOf('.');
  const head = dot === -1 ? value.length : dot;
  const deg = parseInt(value.slice(0, head - 2), 10);
  const min = parseFloat(value.slice(head - 2));
  if (!Number.isFinite(deg) || !Number.isFinite(min)) {
    return null;
  }
  const result = deg + min / 60;
  return hemisphere === 'S' || hemisphere === 'W' ? -result : result;
}

// hhmmss and ddmmyy as an ISO time
function isoTime(time, date) {
  if (!/^\d{6}/.test(time || '') || !/^\d{6}$/.test(date || '')) {
    return null;
  }
  // 80-99 are 1980-1999 (GPS started in 1980)
  const yy = +date.slice(4, 6);
  const year = yy >= 80 ? 1900 + yy : 2000 + yy;
  const iso = `${year}-${date.slice(2, 4)}-${date.slice(0, 2)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4)}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : new Date(iso).toISOString();
}

// A sentence as {type: 'RMC' or 'GGA', ...fields}, or null if it isn't a usable fix
function parse(sentence) {
  const line = String(sentence).trim();
  if (!line.startsWith('$') || !checksumOk(line)) {
    return null;
  }
  const fields = line.replace(/\*[0-9A-Fa-f]{2}$/, '').split(',');
  const type = fields[0].slice(3);
  if (type === 'RMC') {
    if (fields[2] !== 'A') return null;
    const lat = degrees(fields[3], fields[4]);
    const lon = degrees(fields[5], fields[6]);
    if (lat === null || lon === null) return null;
    const result = {type, lat, lon, time: isoTime(fields[1], fields[9])};
    if (fields[7] !== '' && Number.isFinite(+fields[7])) result.speed = +fields[7] * 1.852;
    if (fields[8] !== '' && Number.isFinite(+fields[8])) result.course = +fields[8];
    return result;
  }
  if (type === 'GGA') {
    const quality = +fields[6];
    if (!quality) return null;
    const lat = degrees(fields[2], fields[3]);
    const lon = degrees(fields[4], fields[5]);
    if (lat === null || lon === null) return null;
    const result = {type, lat, lon, quality, satellites: +fields[7] || 0};
    if (fields[8] !== '' && Number.isFinite(+fields[8])) result.hdop = +fields[8];
    if (fields[9] !== '' && Number.isFinite(+fields[9])) result.altitude = +fields[9];
    return result;
  }
  return null;
}

// RMC and GGA of the same moment usually come together; GGA alone gives a position too (some receivers send only GGA)
class NmeaReader {
  constructor(onPosition) {
    this.onPosition = onPosition;
    this.buffer = '';
    this.gga = null;
    this.pending = null;
  }

  // Feeds raw data in any chunks
  write(chunk) {
    this.buffer += chunk.toString('latin1');
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop();
    // a stream without line ends mustn't fill the memory
    if (this.buffer.length > 4096) this.buffer = '';
    for (const line of lines) {
      this.line(line);
    }
  }

  // Handles one sentence
  line(text) {
    const fix = parse(text);
    if (!fix) return;
    if (fix.type === 'GGA') {
      if (this.pending) {
        this.onPosition(this._position(this.pending));
      }
      this.gga = fix;
      this.pending = fix;
      return;
    }
    this.pending = null;
    this.onPosition(this._position(fix));
  }

  // A fix (with the GGA's details if it had one) as a position
  _position(fix) {
    const position = {lat: fix.lat, lon: fix.lon, time: fix.time || new Date().toISOString()};
    if (fix.speed !== undefined) position.speed = fix.speed;
    if (fix.course !== undefined) position.course = fix.course;
    const gga = this.gga;
    if (gga && Math.abs(gga.lat - fix.lat) < 1e-4 && Math.abs(gga.lon - fix.lon) < 1e-4) {
      position.satellites = gga.satellites;
      // HDOP × ~5 m, the usual rough error estimate
      if (gga.hdop !== undefined) position.accuracy = Math.round(gga.hdop * 5);
      if (gga.altitude !== undefined) position.altitude = gga.altitude;
    }
    return position;
  }
}

module.exports = {parse, checksumOk, NmeaReader};
