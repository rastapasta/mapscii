/*
  Reads coordinates as people write them, e.g.

    42.3601, -71.0942              decimal degrees, latitude first
    42.3601 -71.0942 16            ... with a zoom level (or "z16", "zoom 16")
    42.3601N 71.0942W              hemisphere letters, before or after the number
    42°21'36.4"N 71°05'39.1"W      degrees, minutes and seconds
    3 50 53 N 11 30 7 E            ... without the symbols
    N 42° 21.606 W 071° 05.650     degrees and decimal minutes (geocaching)
    42,3601 -71,0942               decimal commas
    lat 42.3601 lon -71.0942       labelled, in either order
    geo:42.3601,-71.0942           geo URIs
    https://www.google.com/maps/@42.3601,-71.0942,15z
    https://www.openstreetmap.org/#map=16/42.3601/-71.0942
    ... and links with ?q=, ?query=, ?ll=, ?mlat=&mlon= or ?cp= (Google, Apple, OSM, Bing)

  parse(text) returns {lat, lon, zoom} (zoom is undefined if none was given),
  or throws an Error saying what is wrong with the text.
*/
'use strict';

// a number such as 42, -71.0942, 42. or .5
const NUM = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
const NUMBER = new RegExp(NUM, 'g');

function parse(text) {
  const input = String(text || '')
    // minus signs as typeset on web pages
    .replace(/[\u2212\u2012\u2013\uFE63\uFF0D](?=\s*[\d.])/g, '-')
    .trim();
  if (!input) {
    throw new Error('no coordinates given');
  }
  return fromUrl(input) || fromLabels(input) || fromText(input);
}

// links from map websites
function fromUrl(input) {
  let m = input.match(/@([-+]?\d+(?:\.\d+)?),([-+]?\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?)z)?/);
  if (m) {
    return check(+m[1], wrapLongitude(+m[2]), m[3] !== undefined ? +m[3] : undefined);
  }
  m = input.match(/map=(\d+(?:\.\d+)?)\/([-+]?\d+(?:\.\d+)?)\/([-+]?\d+(?:\.\d+)?)/);
  if (m) {
    return check(+m[2], wrapLongitude(+m[3]), +m[1]);
  }
  m = input.match(/^geo:([-+]?\d+(?:\.\d+)?),([-+]?\d+(?:\.\d+)?)(?:.*[?&]z=(\d+(?:\.\d+)?))?/i);
  if (m) {
    return check(+m[1], +m[2], m[3] !== undefined ? +m[3] : undefined);
  }
  if (!/^(?:https?:\/\/|www\.)/i.test(input)) {
    return null;
  }
  const zoom = input.match(/[?&](?:z|zoom|lvl)=(\d+(?:\.\d+)?)/i);
  const zoomLevel = zoom ? +zoom[1] : undefined;
  // ?q=lat,lon (Google), ?ll= (Apple), ?cp=lat~lon (Bing) and the like
  m = input.match(new RegExp(`[?&](?:q|query|ll|sll|center|destination|daddr|cp)=(${NUM})(?:,|%2C|~)\\s*(${NUM})`, 'i'));
  if (m) {
    return check(+m[1], +m[2], zoomLevel);
  }
  // ?mlat=..&mlon=.. (OpenStreetMap)
  const lat = input.match(new RegExp(`[?&]mlat=(${NUM})`, 'i'));
  const lon = input.match(new RegExp(`[?&]mlon=(${NUM})`, 'i'));
  if (lat && lon) {
    return check(+lat[1], +lon[1], zoomLevel);
  }
  throw new Error('this link has no coordinates in it - copy them from the map instead');
}

// "lat 42.3601 lon -71.0942", "lng: -71.0942, lat: 42.3601"
function fromLabels(input) {
  const lat = input.match(new RegExp(`\\blat(?:itude)?\\s*[:=]?\\s*(${NUM})`, 'i'));
  const lon = input.match(new RegExp(`\\b(?:lon|lng|long|longitude)\\s*[:=]?\\s*(${NUM})`, 'i'));
  if (!lat || !lon) {
    return null;
  }
  const zoom = input.match(/\b(?:z|zoom)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  return check(+lat[1], +lon[1], zoom ? +zoom[1] : undefined);
}

function fromText(input) {
  if (!/\d/.test(input)) {
    throw new Error('place names can\'t be looked up - type coordinates, e.g. "42.3601, -71.0942"');
  }
  let text = input
    .replace(/[′’‘`´]/g, '\'')
    .replace(/[″“”]|''/g, '"')
    .replace(/[º˚]/g, '°');

  // decimal commas: "48,8584 2,2945"
  text = text.replace(/^([-+]?\d+),(\d+)(\s*[\s;]\s*)([-+]?\d+),(\d+)$/, '$1.$2$3$4.$5');

  // a zoom level written as "z16", "zoom 16" or "16z"
  let zoom;
  text = text.replace(/(?:\b(?:z|zoom)\s*[:=]?\s*(\d+(?:\.\d+)?)|[,;\s]\s*(\d+(?:\.\d+)?)z)\s*$/i, (all, value, suffixed) => {
    zoom = +(value || suffixed);
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
  // letters in front of the numbers: split before the second one ("N42.36 W71.09")
  const leading = /^[NSEW]/i.test(text);
  let m = text.match(/^([NSEW].*?)\s*([NSEW]\s*\d.*)$/i);
  if (leading && m) {
    return [m[1], m[2]];
  }
  // letters after the numbers: split after the first one ("42.36N 71.09W", "42.36N71.09W")
  const end = leading ? '(?=\\s|$)' : '(?=\\s|$|[-+\\d.])';
  m = text.match(new RegExp(`^(.*?\\d[^NSEW]*?[NSEW])${end}\\s*(\\S.*)$`, 'i'));
  if (m && /\d/.test(m[2])) {
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

// Map websites put longitudes beyond 180 into their links after panning across
// the date line (e.g. @21.3,-202.1) - those are the same places, once round
function wrapLongitude(lon) {
  if (Math.abs(lon) <= 180 || Math.abs(lon) > 720) {
    return lon;
  }
  return ((lon + 180) % 360 + 360) % 360 - 180;
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
