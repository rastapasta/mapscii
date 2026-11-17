// A plus code, coordinates, a saved place or a searched name, the same way for --goto, g and the tools.
'use strict';
const coordinates = require('./coordinates');
const PlusCode = require('./PlusCode');

// options: {savedPlaces, placeIndex, near (for short plus codes)}
function resolvePlace(text, {savedPlaces = null, placeIndex = null, near = null} = {}) {
  const input = String(text).trim();
  if (!input) {
    throw new Error('say where: coordinates, a plus code or a place name');
  }
  const plus = PlusCode.find(input);
  if (plus) {
    let full = plus.code;
    if (PlusCode.isShort(plus.code)) {
      const ref = plus.rest ? byName(plus.rest, savedPlaces, placeIndex) : near;
      if (!ref) {
        throw new Error(plus.rest ? `${plus.code}: don't know "${plus.rest}" (a saved place or a place in the maps seen)` : `${plus.code} is a short plus code: give a town with it, e.g. "${plus.code} Accra"`);
      }
      full = PlusCode.recoverNearest(plus.code, ref.lat, ref.lon);
    }
    const area = PlusCode.decode(full);
    return {lat: area.lat, lon: area.lon, zoom: area.length >= 10 ? 18 : area.length >= 8 ? 15 : area.length >= 6 ? 11 : 6, name: full, kind: 'plus code'};
  }
  let coordinateError;
  try {
    return coordinates.parse(input);
  } catch (error) {
    coordinateError = error;
  }
  const named = byName(input, savedPlaces, placeIndex);
  if (named) {
    return named;
  }
  if (/\d/.test(input) && !/[a-z]{3}/i.test(input.replace(/https?:\/\/\S+/, ''))) {
    throw coordinateError;
  }
  throw new Error(`don't know "${input}": give coordinates (e.g. "5.6037, -0.187"), a plus code, a saved place or a place in the maps seen so far`);
}

// A saved place of that name, else the best match in the search index
function byName(name, savedPlaces, placeIndex) {
  const saved = savedPlaces ? savedPlaces.get(name) : null;
  if (saved) {
    return Object.assign({kind: 'saved'}, saved);
  }
  if (placeIndex) {
    try {
      const [best] = placeIndex.search(name, {limit: 1});
      if (best) return best;
    } catch (error) {
      void 0;
    }
  }
  return null;
}

module.exports = resolvePlace;
