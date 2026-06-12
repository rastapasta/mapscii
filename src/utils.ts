/*
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  methods used all around
*/
'use strict';
const config = require('./config');

const constants = {
  RADIUS: 6378137,
};

const utils = {
  clamp: (num, min, max) => {
    if (num <= min) {
      return min;
    } else if (num >= max) {
      return max;
    } else {
      return num;
    }
  },

  baseZoom: (zoom) => {
    return Math.min(config.tileRange, Math.max(0, Math.floor(zoom)));
  },

  tilesizeAtZoom: (zoom) => {
    return config.projectSize * Math.pow(2, zoom-utils.baseZoom(zoom));
  },

  deg2rad: (angle) => {
    // (angle / 180) * Math.PI
    return angle * 0.017453292519943295;
  },

  ll2tile: (lon, lat, zoom) => {
    return {
      x: (lon+180)/360*Math.pow(2, zoom),
      y: (1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*Math.pow(2, zoom),
      z: zoom,
    };
  },

  tile2ll: (x, y, zoom) => {
    const n = Math.PI - 2*Math.PI*y/Math.pow(2, zoom);

    return {
      lon: x/Math.pow(2, zoom)*360-180,
      lat: 180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))),
    };
  },

  metersPerPixel: (zoom, lat = 0) => {
    return (Math.cos(lat * Math.PI/180) * 2 * Math.PI * constants.RADIUS) / (256 * Math.pow(2, zoom));
  },

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

  digits: (number, digits) => {
    return Math.floor(number*Math.pow(10, digits))/Math.pow(10, digits);
  },

  normalize: (ll) => {
    if (ll.lon < -180) ll.lon += 360;
    if (ll.lon > 180) ll.lon -= 360;

    if (ll.lat > 85.0511) ll.lat = 85.0511;
    if (ll.lat < -85.0511) ll.lat = -85.0511;

    return ll;
  },

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
