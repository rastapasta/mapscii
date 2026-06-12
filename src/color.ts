import x256 from 'x256';

import config, { type ColorMode } from './config';
import { hex2rgb } from './utils';

const ANSI16_RGB = [
  [0, 0, 0],
  [128, 0, 0],
  [0, 128, 0],
  [128, 128, 0],
  [0, 0, 128],
  [128, 0, 128],
  [0, 128, 128],
  [192, 192, 192],
  [128, 128, 128],
  [255, 0, 0],
  [0, 255, 0],
  [255, 255, 0],
  [0, 0, 255],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255],
];

function distance(a: number[], b: number[]): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

function ansi16Index(rgb: number[]): number {
  let best = 0;
  let bestDistance = Infinity;

  ANSI16_RGB.forEach((candidate, index) => {
    const candidateDistance = distance(rgb, candidate);

    if (candidateDistance < bestDistance) {
      best = index;
      bestDistance = candidateDistance;
    }
  });

  return best;
}

// Hot path: called per feature at tile parse and per cell for terrain.
// Nearest-color search (x256/ansi16Index) is expensive, so memoize.
const colorCodeCache = new Map<string, number>();

export function colorFromHex(hex: string, mode: ColorMode = config.colorMode): number {
  const cacheKey = `${mode}|${hex}`;
  const cached = colorCodeCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const rgb = hex2rgb(hex);

  // Zero is the buffer sentinel for "no color", so ANSI indexes are offset.
  const code = mode === 'ansi-16' ? ansi16Index(rgb) + 1 : x256(rgb);

  if (colorCodeCache.size > 8192) colorCodeCache.clear();
  colorCodeCache.set(cacheKey, code);
  return code;
}

function ansi16Foreground(index: number): number {
  const normalized = index - 1;
  return normalized < 8 ? 30 + normalized : 90 + (normalized - 8);
}

function ansi16Background(index: number): number {
  const normalized = index - 1;
  return normalized < 8 ? 40 + normalized : 100 + (normalized - 8);
}

// Hot path: called once per character cell per frame. Build the escape
// sequence directly instead of going through intermediate arrays.
export function terminalColorSequence(
  foreground: number,
  background: number,
  mode: ColorMode = config.colorMode
): string {
  if (mode === 'ansi-16') {
    if (foreground && background) {
      return `\x1B[${ansi16Foreground(foreground)};${ansi16Background(background)}m`;
    } else if (foreground) {
      return `\x1B[49;${ansi16Foreground(foreground)}m`;
    } else if (background) {
      return `\x1B[39;${ansi16Background(background)}m`;
    }
    return '';
  }

  if (foreground && background) {
    return `\x1B[38;5;${foreground};48;5;${background}m`;
  } else if (foreground) {
    return `\x1B[49;38;5;${foreground}m`;
  } else if (background) {
    return `\x1B[39;48;5;${background}m`;
  }
  return '';
}
