// Plus codes (Open Location Code), following the standard's specification.
'use strict';

const ALPHABET = '23456789CFGHJMPQRVWX';
const SEPARATOR = '+';
const SEPARATOR_POSITION = 8;
const PAIR_LENGTH = 10;
const GRID_ROWS = 5;
const GRID_COLUMNS = 4;
const LAT_MAX = 90;
const LON_MAX = 180;
const PAIR_RESOLUTIONS = [20.0, 1.0, 0.05, 0.0025, 0.000125];

// Whether the text is a valid plus code, full or short
function isValid(code) {
  if (typeof code !== 'string' || !code) return false;
  code = code.toUpperCase();
  const sep = code.indexOf(SEPARATOR);
  if (sep === -1 || sep !== code.lastIndexOf(SEPARATOR) || sep > SEPARATOR_POSITION || sep % 2 === 1) return false;
  // padding (0) only before the separator, in pairs
  const pad = code.indexOf('0');
  if (pad !== -1) {
    if (pad === 0 || sep < SEPARATOR_POSITION) return false;
    const padding = code.match(/0+/g);
    if (padding.length > 1 || padding[0].length % 2 === 1 || code.length > sep + 1) return false;
  }
  if (code.length - sep - 1 === 1) return false;
  for (const c of code.replace(SEPARATOR, '').replace(/0/g, '')) {
    if (!ALPHABET.includes(c)) return false;
  }
  return true;
}

// Whether the code is a short one (e.g. JQ3W+FX)
function isShort(code) {
  return isValid(code) && code.indexOf(SEPARATOR) < SEPARATOR_POSITION;
}

// Whether the code is a full one
function isFull(code) {
  if (!isValid(code) || isShort(code)) return false;
  code = code.toUpperCase();
  if (ALPHABET.indexOf(code[0]) * PAIR_RESOLUTIONS[0] >= LAT_MAX * 2) return false;
  if (code.length > 1 && ALPHABET.indexOf(code[1]) * PAIR_RESOLUTIONS[0] >= LON_MAX * 2) return false;
  return true;
}

// length 10 is about 14 m, 11 about 3 m
function encode(lat, lon, length = 10) {
  if (length < 2 || (length < PAIR_LENGTH && length % 2 === 1) || length > 15) {
    throw new Error('a plus code has an even length of 2-10, or 11-15');
  }
  lat = Math.min(Math.max(lat, -LAT_MAX), LAT_MAX);
  lon = ((lon + LON_MAX) % 360 + 360) % 360 - LON_MAX;
  if (lat === LAT_MAX) lat -= latitudePrecision(length) / 2;
  // integer arithmetic, as the standard does, to avoid rounding errors
  const FINAL_LAT = 8000 * Math.pow(GRID_ROWS, 5);
  const FINAL_LON = 8000 * Math.pow(GRID_COLUMNS, 5);
  let latVal = Math.floor(Math.round((lat + LAT_MAX) * FINAL_LAT * 1e6) / 1e6);
  let lonVal = Math.floor(Math.round((lon + LON_MAX) * FINAL_LON * 1e6) / 1e6);
  let code = '';
  if (length > PAIR_LENGTH) {
    for (let i = 0; i < 5; i++) {
      const latDigit = latVal % GRID_ROWS;
      const lonDigit = lonVal % GRID_COLUMNS;
      code = ALPHABET[latDigit * GRID_COLUMNS + lonDigit] + code;
      latVal = Math.floor(latVal / GRID_ROWS);
      lonVal = Math.floor(lonVal / GRID_COLUMNS);
    }
  } else {
    latVal = Math.floor(latVal / Math.pow(GRID_ROWS, 5));
    lonVal = Math.floor(lonVal / Math.pow(GRID_COLUMNS, 5));
  }
  let pairs = '';
  for (let i = 0; i < 5; i++) {
    pairs = ALPHABET[latVal % 20] + ALPHABET[lonVal % 20] + pairs;
    latVal = Math.floor(latVal / 20);
    lonVal = Math.floor(lonVal / 20);
  }
  code = pairs.slice(0, SEPARATOR_POSITION) + SEPARATOR + pairs.slice(SEPARATOR_POSITION) + code;
  if (length >= SEPARATOR_POSITION) {
    return code.slice(0, length + 1);
  }
  return code.slice(0, length) + '0'.repeat(SEPARATOR_POSITION - length) + SEPARATOR;
}

// The height in degrees of a code's cell of this length
function latitudePrecision(length) {
  if (length <= PAIR_LENGTH) return Math.pow(20, Math.floor(length / -2 + 2));
  return Math.pow(20, -3) / Math.pow(GRID_ROWS, length - PAIR_LENGTH);
}

// A full code's area: {lat, lon (centre), south, west, north, east, length}
function decode(code) {
  if (!isFull(code)) {
    throw new Error(isShort(code) ? `${code} is a short plus code: it needs a town or place with it` : `${code} is not a plus code`);
  }
  const digits = code.toUpperCase().replace(SEPARATOR, '').replace(/0+/, '').slice(0, 15);
  let south = -LAT_MAX;
  let west = -LON_MAX;
  let latSize = 400;
  let lonSize = 400;
  for (let i = 0; i < Math.min(digits.length, PAIR_LENGTH); i += 2) {
    latSize /= 20;
    lonSize /= 20;
    south += ALPHABET.indexOf(digits[i]) * latSize;
    west += ALPHABET.indexOf(digits[i + 1]) * lonSize;
  }
  for (let i = PAIR_LENGTH; i < digits.length; i++) {
    latSize /= GRID_ROWS;
    lonSize /= GRID_COLUMNS;
    const value = ALPHABET.indexOf(digits[i]);
    south += Math.floor(value / GRID_COLUMNS) * latSize;
    west += (value % GRID_COLUMNS) * lonSize;
  }
  return {
    lat: Math.min(south + latSize / 2, LAT_MAX), lon: Math.min(west + lonSize / 2, LON_MAX),
    south, west, north: south + latSize, east: west + lonSize, length: digits.length,
  };
}

// the nearest matching cell to a reference place
function recoverNearest(short, refLat, refLon) {
  if (!isShort(short)) {
    if (isFull(short)) return short.toUpperCase();
    throw new Error(`${short} is not a plus code`);
  }
  short = short.toUpperCase();
  refLat = Math.min(Math.max(refLat, -LAT_MAX), LAT_MAX);
  refLon = ((refLon + LON_MAX) % 360 + 360) % 360 - LON_MAX;
  const padding = SEPARATOR_POSITION - short.indexOf(SEPARATOR);
  const resolution = Math.pow(20, 2 - padding / 2);
  const half = resolution / 2;
  const area = decode(encode(refLat, refLon).slice(0, padding) + short);
  let {lat, lon} = area;
  if (refLat + half < lat && lat - resolution >= -LAT_MAX) lat -= resolution;
  else if (refLat - half > lat && lat + resolution <= LAT_MAX) lat += resolution;
  if (refLon + half < lon) lon -= resolution;
  else if (refLon - half > lon) lon += resolution;
  return encode(lat, lon, area.length);
}

// drops the first four characters within ~30 km of the reference
function shorten(code, refLat, refLon) {
  const area = decode(code);
  const range = Math.max(Math.abs(area.lat - refLat), Math.abs(area.lon - refLon));
  // the standard's safety factor
  return range < 1.0 * 0.3 ? code.toUpperCase().slice(4) : code.toUpperCase();
}

// "JR37+F6 Accra", or the full code with no town nearby
function address(lat, lon, town) {
  const full = encode(lat, lon);
  if (!town) return full;
  const short = shorten(full, town.lat, town.lon);
  return short === full ? full : `${short} ${town.name}`;
}

// {code, rest}, or null
function find(text) {
  const m = String(text).match(/(^|[\s,(])([23456789CFGHJMPQRVWX]{2,8}0*\+[23456789CFGHJMPQRVWX]{0,7})(?=$|[\s,)])/i);
  if (!m || !isValid(m[2])) return null;
  const rest = (String(text).slice(0, m.index + m[1].length) + ' ' + String(text).slice(m.index + m[0].length)).replace(/^[\s,]+|[\s,]+$/g, '').replace(/\s+/g, ' ');
  return {code: m[2].toUpperCase(), rest};
}

module.exports = {encode, decode, isValid, isShort, isFull, recoverNearest, shorten, find, address};
