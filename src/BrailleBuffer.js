/*
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Simple pixel to braille character mapper

  Implementation inspired by node-drawille (https://github.com/madbence/node-drawille)
  * added color support
  * added text label support
  * general optimizations

  Will either be merged into node-drawille or become an own module at some point
*/
'use strict';
const stringWidth = require('string-width');

const graphemes = new Intl.Segmenter(undefined, {granularity: 'grapheme'});
const config = require('./config');
const x256 = require('x256');

// terminal codes of picture colours, and the marker for a picture colour in frameLines
const rgbParts38 = new Map();
const rgbParts48 = new Map();
const RASTER = {};
const utils = require('./utils');

const asciiMap = {
  // '▬': [2+32, 4+64],
  // '¯': [1+16],
  '▀': [1+2+16+32],
  '▄': [4+8+64+128],
  '■': [2+4+32+64],
  '▌': [1+2+4+8],
  '▐': [16+32+64+128],
  // '▓': [1+4+32+128, 2+8+16+64],
  '█': [255],
};
const termReset = '\x1B[39;49m';

// The average of two colours (0xRRGGBB), times light (0..1)
function blend(a, b, light) {
  const c = (shift) => Math.round(((a >> shift & 255) + (b >> shift & 255)) / 2 * light);
  return (c(16) << 16) | (c(8) << 8) | c(0);
}

// The RGB of one of the terminal's 256 colours
function x256rgb(n) {
  if (n < 16) {
    return [0x000000, 0xcd0000, 0x00cd00, 0xcdcd00, 0x0000ee, 0xcd00cd, 0x00cdcd, 0xe5e5e5,
      0x7f7f7f, 0xff0000, 0x00ff00, 0xffff00, 0x5c5cff, 0xff00ff, 0x00ffff, 0xffffff][n];
  }
  if (n < 232) {
    const steps = [0, 95, 135, 175, 215, 255];
    n -= 16;
    return (steps[Math.floor(n / 36)] << 16) | (steps[Math.floor(n / 6) % 6] << 8) | steps[n % 6];
  }
  const v = 8 + (n - 232) * 10;
  return (v << 16) | (v << 8) | v;
}

class BrailleBuffer {
  constructor(width, height) {
    this.brailleMap = [[0x1, 0x8],[0x2, 0x10],[0x4, 0x20],[0x40, 0x80]];

    this.pixelBuffer = null;
    this.charBuffer = null;
    this.foregroundBuffer = null;
    this.backgroundBuffer = null;

    this.asciiToBraille = [];

    this.globalBackground = null;

    this.width = width;
    this.height = height;

    const size = width*height/8;
    this.pixelBuffer = Buffer.alloc(size);
    this.foregroundBuffer = Buffer.alloc(size);
    this.backgroundBuffer = Buffer.alloc(size);

    this._mapBraille();
    this.setClip(null);
    this.clear();
  }

  // Restricts drawing to {minX, minY, maxX, maxY}, or lifts it with null
  setClip(clip) {
    this.clipMinX = clip ? Math.max(0, Math.ceil(clip.minX)) : 0;
    this.clipMinY = clip ? Math.max(0, Math.ceil(clip.minY)) : 0;
    this.clipMaxX = clip ? Math.min(this.width, Math.ceil(clip.maxX)) : this.width;
    this.clipMaxY = clip ? Math.min(this.height, Math.ceil(clip.maxY)) : this.height;
  }

  // Empties the buffer for a new frame
  clear() {
    this.pixelBuffer.fill(0);
    this.charBuffer = [];
    this.foregroundBuffer.fill(0);
    this.backgroundBuffer.fill(0);
    // picture colours per cell, top and bottom half, 0xRRGGBB (-1: none)
    this.rasterTop = null;
    this.rasterBottom = null;
  }

  // Sets the picture colours of a cell: top and bottom, 0xRRGGBB
  setRaster(column, row, top, bottom) {
    const columns = this.width / 2;
    if (!this.rasterTop) {
      const cells = columns * this.height / 4;
      this.rasterTop = new Int32Array(cells).fill(-1);
      this.rasterBottom = new Int32Array(cells).fill(-1);
    }
    if (column < 0 || column >= columns || row < 0 || row >= this.height / 4) return;
    const idx = row * columns + column;
    this.rasterTop[idx] = top;
    this.rasterBottom[idx] = bottom;
  }

  // 24-bit where supported, else the nearest of 256; cached, as pictures repeat colours
  _rgbPart(rgb, base) {
    const cache = base === 38 ? rgbParts38 : rgbParts48;
    const key = config.trueColor ? rgb + 16777216 : rgb;
    let part = cache.get(key);
    if (part === undefined) {
      const r = rgb >> 16 & 255;
      const g = rgb >> 8 & 255;
      const b = rgb & 255;
      part = config.trueColor ? `${base};2;${r};${g};${b}` : `${base};5;${x256(r, g, b)}`;
      if (cache.size > 200000) cache.clear();
      cache.set(key, part);
    }
    return part;
  }

  // The escape code for a cell's two picture colours
  _rgbCode(top, bottom) {
    return `\x1B[${this._rgbPart(top, 38)};${this._rgbPart(bottom, 48)}m`;
  }

  // Sets the background colour of the whole buffer
  setGlobalBackground(background) {
    this.globalBackground = background;
  }

  // Sets the background colour of the cell at a pixel
  setBackground(x, y, color) {
    if (0 <= x && x < this.width && 0 <= y && y < this.height) {
      const idx = this._project(x, y);
      this.backgroundBuffer[idx] = color;
    }
  }

  // Sets a Braille dot and its cell's colour
  setPixel(x, y, color) {
    this._locate(x, y, (idx, mask) => {
      this.pixelBuffer[idx] |= mask;
      this.foregroundBuffer[idx] = color;
    });
  }

  // Clears a Braille dot
  unsetPixel(x, y) {
    this._locate(x, y, (idx, mask) => {
      this.pixelBuffer[idx] &= ~mask;
    });
  }

  // The index of the cell holding a pixel
  _project(x, y) {
    return (x>>1) + (this.width>>1)*(y>>2);
  }

  // Calls cb with the cell index and dot mask of a pixel inside the clip
  _locate(x, y, cb) {
    if (x < this.clipMinX || x >= this.clipMaxX || y < this.clipMinY || y >= this.clipMaxY) {
      return;
    }
    const idx = this._project(x, y);
    const mask = this.brailleMap[y & 3][x & 1];
    return cb(idx, mask);
  }

  // Builds the tables from dot patterns to Braille characters and back
  _mapBraille() {
    this.asciiToBraille = [' '];

    const masks = [];
    for (const char in asciiMap) {
      const bits = asciiMap[char];
      if (!(bits instanceof Array)) continue;
      for (const mask of bits) {
        masks.push({
          mask: mask,
          char: char,
        });
      }
    }

    //TODO Optimize this part
    var i, k;
    const results = [];
    for (i = k = 1; k <= 255; i = ++k) {
      const braille = (i & 7) + ((i & 56) << 1) + ((i & 64) >> 3) + (i & 128);
      results.push(this.asciiToBraille[i] = masks.reduce((function(best, mask) {
        const covered = utils.population(mask.mask & braille);
        if (!best || best.covered < covered) {
          return {
            char: mask.char,
            covered: covered,
          };
        } else {
          return best;
        }
      }), void 0).char);
    }
    return results;
  }

  // The escape code for a foreground and background colour
  _termColor(foreground, background) {
    background |= this.globalBackground;
    if (foreground && background) {
      return `\x1B[38;5;${foreground};48;5;${background}m`;
    } else if (foreground) {
      return `\x1B[49;38;5;${foreground}m`;
    } else if (background) {
      return `\x1B[39;48;5;${background}m`;
    } else {
      return termReset;
    }
  }

  // The frame as one string
  frame() {
    return this.frameLines().join(config.delimeter) + termReset + config.delimeter;
  }

  // The share of the cells (0..1) with something drawn in them
  filledShare() {
    let filled = 0;
    for (let i = 0; i < this.pixelBuffer.length; i++) {
      if (this.pixelBuffer[i] || this.charBuffer[i] || (this.rasterTop && this.rasterTop[i] !== -1)) filled++;
    }
    return this.pixelBuffer.length ? filled / this.pixelBuffer.length : 0;
  }

  // One string per row, each setting its own colours so it can be redrawn alone
  frameLines() {
    const lines = [];
    const columns = this.width/2;
    const colorCodes = {};

    for (let y = 0; y < this.height/4; y++) {
      const output = [];
      let currentColor = null;
      let rasterFg = -1;
      let rasterBg = -1;
      // columns written so far: wide characters run ahead of the cells, the empty cells after them make up
      let col = 0;

      for (let x = 0; x < columns; x++) {
        const idx = y*columns + x;

        const char = this.charBuffer[idx];
        if (!char && col > x) continue;
        let width = 1;
        if (char) {
          width = charWidth(char);
          // a wide character that would stick out is left out
          if (col + width > columns) continue;
        }
        col += width;
        const raster = this.rasterTop && this.rasterTop[idx] !== -1;
        if (raster) {
          // a half block of the picture's two colours; dots and names on the average, darkened under names
          const top = this.rasterTop[idx];
          const bottom = this.rasterBottom[idx];
          const pixels = this.pixelBuffer[idx];
          let fg;
          let bg;
          let out;
          if (char || pixels) {
            bg = blend(top, bottom, char ? 0.35 : 1);
            fg = this.foregroundBuffer[idx] ? x256rgb(this.foregroundBuffer[idx]) : 0xffffff;
            out = char || (config.useBraille ? String.fromCharCode(0x2800 + pixels) : this.asciiToBraille[pixels]);
          } else {
            fg = top;
            bg = bottom;
            out = '▀';
          }
          // only what changed from the previous cell
          if (currentColor !== RASTER) {
            output.push(this._rgbCode(fg, bg));
          } else if (fg !== rasterFg || bg !== rasterBg) {
            output.push(fg === rasterFg ? `\x1B[${this._rgbPart(bg, 48)}m` : bg === rasterBg ? `\x1B[${this._rgbPart(fg, 38)}m` : this._rgbCode(fg, bg));
          }
          currentColor = RASTER;
          rasterFg = fg;
          rasterBg = bg;
          output.push(out);
          continue;
        }

        const colorKey = (this.foregroundBuffer[idx] << 8) | this.backgroundBuffer[idx];
        const colorCode = colorCodes[colorKey] ||
          (colorCodes[colorKey] = this._termColor(this.foregroundBuffer[idx], this.backgroundBuffer[idx]));
        if (currentColor !== colorCode) {
          output.push(currentColor = colorCode);
        }
        if (char) {
          output.push(char);
        } else if (config.useBraille) {
          output.push(String.fromCharCode(0x2800+this.pixelBuffer[idx]));
        } else {
          output.push(this.asciiToBraille[this.pixelBuffer[idx]]);
        }
      }
      // padding for a left-out wide character
      if (col < columns) output.push(termReset + ' '.repeat(columns - col));
      lines.push(output.join(''));
    }
    return lines;
  }

  // Puts a character in the cell at a pixel
  setChar(char, x, y, color) {
    if (0 <= x && x < this.width && 0 <= y && y < this.height) {
      const idx = this._project(x, y);
      this.charBuffer[idx] = char;
      this.foregroundBuffer[idx] = color;
    }
  }

  // Writes text from a pixel, centred on it by default
  writeText(text, x, y, color, center = true) {
    text = cleanText(text);
    if (center) {
      x -= stringWidth(text)/2+1;
    }
    // one cell per grapheme: a letter with its accents, or a multi-code-point emoji
    let i = 0;
    for (const {segment} of graphemes.segment(text)) {
      if (stringWidth(segment) === 0) {
        continue;
      }
      this.setChar(segment, x+i*2, y, color);
      i++;
    }
  }
}

const widths = new Map();
// How many columns a grapheme takes on screen (cached)
function charWidth(char) {
  let width = widths.get(char);
  if (width === undefined) {
    width = stringWidth(char);
    if (widths.size > 20000) widths.clear();
    widths.set(char, width);
  }
  return width;
}

// strips control characters, line separators and lone surrogates
function cleanText(text) {
  // eslint-disable-next-line no-control-regex
  return String(text).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]|[\ud800-\udbff](?![\udc00-\udfff])|(^|[^\ud800-\udbff])[\udc00-\udfff]/g, '$1');
}

BrailleBuffer.cleanText = cleanText;
module.exports = BrailleBuffer;
