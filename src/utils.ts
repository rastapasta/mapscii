/*
  MapSCII - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Utility methods used throughout the application
*/

import config from './config';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface TileCoord {
  x: number;
  y: number;
  z: number;
}

const constants = {
  RADIUS: 6378137,
};

export function clamp(num: number, min: number, max: number): number {
  if (num <= min) {
    return min;
  } else if (num >= max) {
    return max;
  } else {
    return num;
  }
}

export function baseZoom(zoom: number): number {
  return Math.min(config.tileRange, Math.max(0, Math.floor(zoom)));
}

export function tilesizeAtZoom(zoom: number): number {
  return config.projectSize * Math.pow(2, zoom - baseZoom(zoom));
}

export function deg2rad(angle: number): number {
  return angle * 0.017453292519943295;
}

export function ll2tile(lon: number, lat: number, zoom: number): TileCoord {
  return {
    x: (lon + 180) / 360 * Math.pow(2, zoom),
    y: (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom),
    z: zoom,
  };
}

export function tile2ll(x: number, y: number, zoom: number): LatLon {
  const n = Math.PI - 2 * Math.PI * y / Math.pow(2, zoom);

  return {
    lon: x / Math.pow(2, zoom) * 360 - 180,
    lat: 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
  };
}

export function metersPerPixel(zoom: number, lat: number = 0): number {
  return (Math.cos(lat * Math.PI / 180) * 2 * Math.PI * constants.RADIUS) / (256 * Math.pow(2, zoom));
}

export function hex2rgb(color: string): [number, number, number] {
  if (typeof color !== 'string') return [255, 0, 0];

  if (!/^#[a-fA-F0-9]{3,6}$/.test(color)) {
    throw new Error(`${color} isn't a supported hex color`);
  }

  color = color.substring(1);
  const decimal = parseInt(color, 16);

  if (color.length === 3) {
    const rgb: [number, number, number] = [decimal >> 8, (decimal >> 4) & 15, decimal & 15];
    return rgb.map((c) => c + (c << 4)) as [number, number, number];
  } else {
    return [(decimal >> 16) & 255, (decimal >> 8) & 255, decimal & 255];
  }
}

export function digits(number: number, precision: number): number {
  return Math.floor(number * Math.pow(10, precision)) / Math.pow(10, precision);
}

export function normalize(ll: LatLon): LatLon {
  if (ll.lon < -180) ll.lon += 360;
  if (ll.lon > 180) ll.lon -= 360;

  if (ll.lat > 85.0511) ll.lat = 85.0511;
  if (ll.lat < -85.0511) ll.lat = -85.0511;

  return ll;
}

export function population(val: number): number {
  let bits = 0;
  while (val > 0) {
    bits += val & 1;
    val >>= 1;
  }
  return bits;
}

const utils = {
  clamp,
  baseZoom,
  tilesizeAtZoom,
  deg2rad,
  ll2tile,
  tile2ll,
  metersPerPixel,
  hex2rgb,
  digits,
  normalize,
  population,
};

export default utils;
