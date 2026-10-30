/*
  Reads coordinates as people write them, e.g.

    42.3601, -71.0942              decimal degrees, latitude first
    42.3601 -71.0942 16            ... with a zoom level (or "z16", "zoom 16")
    42.3601N 71.0942W              hemisphere letters, before or after the number
    42°21'36.4"N 71°05'39.1"W      degrees, minutes and seconds
    3 50 53 N 11 30 7 E            ... without the symbols
    geo:42.3601,-71.0942           geo URIs
    https://www.google.com/maps/@42.3601,-71.0942,15z
    https://www.openstreetmap.org/#map=16/42.3601/-71.0942

  parse(text) returns {lat, lon, zoom} (zoom is undefined if none was given),
  or throws an Error saying what is wrong with the text.
*/
'use strict';

const NUMBER = /[-+]?\d+(?:\.\d+)?/g;

function parse(text) {
  const input = String(text || '').trim();
  if (!input) {
    throw new Error('no coordinates given');
  }
  return fromUrl(input) || fromText(input);
}

// links from map websites
function fromUrl(input) {
  let m = input.match(/@([-+]?\d+(?:\.\d+)?),([-+]?\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?)z)?/);
  if (m) {
    return check(+m[1], +m[2], m[3] !== undefined ? +m[3] : undefined);
  }
  m = input.match(/map=(\d+(?:\.\d+)?)\/([-+]?\d+(?:\.\d+)?)\/([-+]?\d+(?:\.\d+)?)/);
  if (m) {
    return check(+m[2], +m[3], +m[1]);
  }
  m = input.match(/^geo:([-+]?\d+(?:\.\d+)?),([-+]?\d+(?:\.\d+)?)(?:.*[?&]z=(\d+(?:\.\d+)?))?/i);
  if (m) {
    return check(+m[1], +m[2], m[3] !== undefined ? +m[3] : undefined);
  }
  return null;
}

function fromText(input) {
  let text = input
    .replace(/[′’‘`´]/g, '\'')
    .replace(/[″“”]|''/g, '"')
    .replace(/[º˚]/g, '°');

  // a zoom level written as "z16" or "zoom 16"
  let zoom;
  text = text.replace(/\b(?:z|zoom)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*$/i, (all, value) => {
    zoom = +value;
    return '';
  }).trim();

  let parts = splitCoordinates(text);
  if (parts.length === 3 && zoom === undefined && /^\d+(?:\.\d+)?$/.test(parts[2].trim())) {
    zoom = +parts[2];
    parts = parts.slice(0, 2);
  }
  if (parts.length !== 2) {
    throw new Error('expected a latitude and a longitude, e.g. "42.3601, -71.0942"');
  }

  let [first, second] = parts.map(readCoordinate);
  // hemisphere letters say which one is which, whatever the order
  if (first.axis === 'lon' || second.axis === 'lat') {
    [first, second] = [second, first];
  }
  if (first.axis === 'lon' || second.axis === 'lat') {
    throw new Error('one coordinate needs to be N or S and the other E or W');
  }
  return check(first.value, second.value, zoom);
}

function splitCoordinates(text) {
  // separated by a comma or semicolon
  if (/[,;]/.test(text)) {
    return text.split(/\s*[,;]\s*/).filter(Boolean);
  }
  // split right after the first hemisphere letter which ends a coordinate ("..N 71..")
  let m = text.match(/^(.*?\d[^NSEW]*?[NSEW])(?=\s|$)\s*(\S.*)$/i);
  if (m && /\d/.test(m[2])) {
    return [m[1], m[2]];
  }
  // or right before the second leading hemisphere letter ("N42.36 W71.09")
  m = text.match(/^([NSEW].*?)\s+([NSEW]\s*\d.*)$/i);
  if (m) {
    return [m[1], m[2]];
  }
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 2 || tokens.length === 3) {
    return tokens;
  }
  // degrees, minutes (and seconds) without symbols: half for each coordinate
  if (tokens.length === 4 || tokens.length === 6) {
    return [tokens.slice(0, tokens.length / 2).join(' '), tokens.slice(tokens.length / 2).join(' ')];
  }
  return [text];
}

// one coordinate: decimal degrees or degrees/minutes/seconds, maybe with N/S/E/W
function readCoordinate(part) {
  const letters = part.toUpperCase().match(/[NSEW]/g) || [];
  if (letters.length > 1 || /[A-DF-MO-RT-VX-Z]/i.test(part.replace(/[NSEW]/gi, ''))) {
    throw new Error(`can't read "${part.trim()}" as a coordinate`);
  }
  const numbers = (part.match(NUMBER) || []).map(Number);
  if (numbers.length < 1 || numbers.length > 3) {
    throw new Error(`can't read "${part.trim()}" as a coordinate`);
  }
  const [degrees, minutes = 0, seconds = 0] = numbers;
  if (numbers.length > 1 && (!Number.isInteger(degrees) || minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60 ||
      (numbers.length > 2 && !Number.isInteger(minutes)))) {
    throw new Error(`"${part.trim()}": minutes and seconds must be between 0 and 60`);
  }
  let value = Math.abs(degrees) + minutes / 60 + seconds / 3600;
  const negative = degrees < 0 || Object.is(degrees, -0) || letters[0] === 'S' || letters[0] === 'W';
  if (negative) {
    value = -value;
  }
  const axis = letters[0] === 'N' || letters[0] === 'S' ? 'lat' : letters[0] ? 'lon' : null;
  return {value, axis};
}

function check(lat, lon, zoom) {
  if (!(Math.abs(lat) <= 90)) {
    throw new Error(`latitude ${lat} is not between -90 and 90`);
  }
  if (!(Math.abs(lon) <= 180)) {
    throw new Error(`longitude ${lon} is not between -180 and 180`);
  }
  if (zoom !== undefined && !(zoom >= 0 && zoom <= 22)) {
    throw new Error(`zoom ${zoom} is not between 0 and 22`);
  }
  return {lat, lon, zoom};
}

module.exports = {parse};
