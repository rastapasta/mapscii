/*
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  methods used all around
*/
'use strict';
const stringWidth = require('string-width');
const config = require('./config');

const graphemes = new Intl.Segmenter(undefined, {granularity: 'grapheme'});

const constants = {
  RADIUS: 6378137,
};

const utils = {
  // wide characters (e.g. Japanese) take two columns
  fitWidth: (text, columns, ellipsis = '') => {
    if (stringWidth(text) <= columns) {
      return text;
    }
    const room = columns - stringWidth(ellipsis);
    let result = '';
    let width = 0;
    // graphemes: a flag or an emoji family is one
    for (const {segment: char} of graphemes.segment(text)) {
      width += stringWidth(char);
      if (width > room) break;
      result += char;
    }
    return result + ellipsis;
  },

  // cut after a whole word when that keeps most of the room
  shortenName: (name, columns) => {
    if (stringWidth(name) <= columns) {
      return name;
    }
    const cut = utils.fitWidth(name, columns - 1);
    const wordEnd = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('-'));
    const text = wordEnd > 0 && stringWidth(cut.slice(0, wordEnd)) >= columns * 0.6 ? cut.slice(0, wordEnd) : cut;
    return text.replace(/[\s\-–,.(]+$/, '') + '…';
  },

  // The number within [min, max]
  clamp: (num, min, max) => {
    if (num <= min) {
      return min;
    } else if (num >= max) {
      return max;
    } else {
      return num;
    }
  },

  // The zoom level of the tiles for a zoom
  baseZoom: (zoom) => {
    return Math.min(config.tileRange, Math.max(0, Math.floor(zoom)));
  },

  // How big a tile is drawn at a zoom, in pixels
  tilesizeAtZoom: (zoom) => {
    return config.projectSize * Math.pow(2, zoom-utils.baseZoom(zoom));
  },

  // Degrees to radians
  deg2rad: (angle) => {
    // (angle / 180) * Math.PI
    return angle * 0.017453292519943295;
  },

  // A place to tile coordinates (fractional) at a zoom
  ll2tile: (lon, lat, zoom) => {
    // the map ends at ±85.0511; at -90 the tile loops never ended
    lat = Math.max(-85.0511, Math.min(85.0511, lat));
    return {
      x: (lon+180)/360*Math.pow(2, zoom),
      y: (1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*Math.pow(2, zoom),
      z: zoom,
    };
  },

  // Tile coordinates to a place
  tile2ll: (x, y, zoom) => {
    const n = Math.PI - 2*Math.PI*y/Math.pow(2, zoom);

    return {
      lon: x/Math.pow(2, zoom)*360-180,
      lat: 180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))),
    };
  },

  // Metres per pixel at a zoom and latitude
  metersPerPixel: (zoom, lat = 0) => {
    return (Math.cos(lat * Math.PI/180) * 2 * Math.PI * constants.RADIUS) / (256 * Math.pow(2, zoom));
  },

  // "#rrggbb" or "#rgb" to [r, g, b]
  hex2rgb: (color) => {
    if (typeof color !== 'string') return [255, 0, 0];

    if (!/^#[a-fA-F0-9]{3,6}$/.test(color)) {
      throw new Error(`${color} isn't a supported hex color`);
    }

    color = color.substr(1);
    const decimal = parseInt(color, 16);

    if (color.length === 3) {
      const rgb = [decimal>>8, (decimal>>4)&15, decimal&15];
      return rgb.map((c) => {
        return c + (c<<4);
      });
    } else {
      return [(decimal>>16)&255, (decimal>>8)&255, decimal&255];
    }
  },

  // The number rounded to this many decimals
  digits: (number, digits) => {
    return Math.round(number*Math.pow(10, digits))/Math.pow(10, digits);
  },

  // The place with its longitude wrapped into -180..180 and its latitude clamped to the map
  normalize: (ll) => {
    if (ll.lon < -180 || ll.lon > 180) {
      ll.lon = ((ll.lon + 180) % 360 + 360) % 360 - 180;
    }

    if (ll.lat > 85.0511) ll.lat = 85.0511;
    if (ll.lat < -85.0511) ll.lat = -85.0511;

    return ll;
  },

  // How many bits of the number are set
  population: (val) => {
    let bits = 0;
    while (val > 0) {
      bits += val & 1;
      val >>= 1;
    }
    return bits;
  },
};

module.exports = utils;
