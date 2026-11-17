// The 3D view: a voxel landscape seen from above the map's centre, column by column, with haze in the distance.
'use strict';
const utils = require('./utils');

const EARTH = 40075016.7;

// options: {center, zoom, heading (0 = north), terrain, tint(h, light), columns, rows, detail, imagery}
function render(buffer, {center, zoom, heading = 0, terrain, tint, columns, rows, detail = 0, imagery = null}) {
  const width = columns;
  const height = rows * 2;
  const pixels = new Int32Array(width * height);
  const cos = Math.cos(center.lat * Math.PI / 180);
  const metresPerWorld = EARTH * cos;
  const c = utils.ll2tile(center.lon, center.lat, 0);
  const groundAt = (wx, wy, z) => {
    const h = terrain.heightAt(wx, wy, z);
    return h === null ? null : Math.max(0, h);
  };
  // heights slightly exaggerated so the landscape reads at a glance
  const exaggerate = 1.5;
  // at most 12 km up, so zoomed out it still shows land
  const along = EARTH * cos / Math.pow(2, zoom);
  const altitude = Math.min(12000, along * 0.12);
  const far = Math.min(250000, altitude * 40);
  // elevation tiles about half the distance seen across
  const z = Math.max(0, Math.min(terrain.maxZoom, Math.round(Math.log2(metresPerWorld / (far / 2))) + detail));
  const ground = groundAt(c.x, c.y, z);
  const pixelMetres = metresPerWorld / (256 * Math.pow(2, z));
  const eye = (ground === null ? 0 : ground) * exaggerate + altitude;
  const fov = 70 * Math.PI / 180;
  const horizon = Math.round(height * 0.3);
  const scale = width / 2 / Math.tan(fov / 2);
  const sky = (y) => {
    const t = y / Math.max(1, horizon);
    return mix(0x4a7ab5, 0xb8d0e8, t);
  };
  const haze = 0xb8d0e8;
  const unknownGround = 0x8a8f86;
  const farLand = 0x9aa4a8;
  const dir = heading * Math.PI / 180;
  const above = Math.max(50, eye - (ground === null ? 0 : ground * exaggerate));
  const near = Math.max(10, above * scale / Math.max(1, height - horizon) * 0.8);
  // photo colour, lit like the land; at most 4 zoom levels finer than the elevation
  const photo = (wx, wy, d, h, light) => {
    const zi = Math.max(z, Math.min(imagery.maxZoom, z + 4, Math.round(Math.log2(metresPerWorld / (256 * d * 0.006))) + detail));
    const c = imagery.rgbAt(wx, wy, zi);
    if (c === -1) return tint(h, light);
    return h < 0 ? c : mix(0, c, light / 0.9);
  };
  let missing = 0;
  for (let x = 0; x < width; x++) {
    const angle = dir + (x / width - 0.5) * fov;
    // world y grows to the south
    const ex = Math.sin(angle) / metresPerWorld;
    const ny = -Math.cos(angle) / metresPerWorld;
    // fill each column from the bottom, above the highest point so far
    let lowest = height;
    const missingBefore = missing;
    for (let d = near; d < far && lowest > 0; d *= 1.012) {
      const wx = c.x + ex * d;
      const wy = c.y + ny * d;
      // past a quarter of the distance, coarser tiles: a quarter of the data
      const zd = d < far * 0.25 || z === 0 ? z : z - 1;
      const h = terrain.heightAt(wx, wy, zd);
      if (h === null) {
        missing++;
        continue;
      }
      const land = Math.max(0, h) * exaggerate;
      const y = Math.round(horizon + (eye - land) / d * scale);
      if (y < lowest) {
        // hillshade lit from the north-west, over a step that grows with distance
        const stepMetres = Math.max(zd === z ? pixelMetres : pixelMetres * 2, d * 0.006);
        const step = stepMetres / metresPerWorld;
        const hx = terrain.heightAt(wx + step, wy, zd);
        const hy = terrain.heightAt(wx, wy + step, zd);
        const dx = hx === null ? 0 : (hx - h) / stepMetres * exaggerate * 2;
        const dy = hy === null ? 0 : (hy - h) / stepMetres * exaggerate * 2;
        const facing = Math.max(0, (dx * 0.5 + dy * 0.5 + Math.SQRT1_2) / Math.hypot(dx, dy, 1));
        // not below 0.45, so slopes away from the light stay readable
        const light = h < 0 ? 0.85 : Math.min(1.3, 0.45 + 0.45 * facing / Math.SQRT1_2);
        const fade = Math.min(1, Math.pow(d / far, 2));
        const colour = mix(imagery ? photo(wx, wy, d, h, light) : tint(h, light), haze, fade * 0.75);
        for (let yy = Math.max(0, y); yy < lowest; yy++) pixels[yy * width + x] = colour;
        lowest = Math.max(0, y);
      }
    }
    // above the horizon: sky; below: unknown land or distant haze
    const unknown = missing > missingBefore;
    for (let yy = 0; yy < lowest; yy++) {
      const below = Math.max(0, 1 - (yy - horizon) / Math.max(1, height - horizon));
      pixels[yy * width + x] = yy < horizon ? sky(yy) : unknown ? mix(unknownGround, haze, below * 0.6) : mix(farLand, haze, below);
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      buffer.setRaster(col, row, pixels[(row * 2) * width + col], pixels[(row * 2 + 1) * width + col]);
    }
  }
  return {missing, altitude, far};
}

// a and b (0xRRGGBB) mixed: t = 0 is a, 1 is b
function mix(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  const c = (s) => Math.max(0, Math.min(255, Math.round((a >> s & 255) * (1 - k) + (b >> s & 255) * k)));
  return (c(16) << 16) | (c(8) << 8) | c(0);
}

module.exports = {render};
