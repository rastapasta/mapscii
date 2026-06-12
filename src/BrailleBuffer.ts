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
const config = require('./config');
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
    this.clear();
  }

  clear() {
    this.pixelBuffer.fill(0);
    this.charBuffer = [];
    this.foregroundBuffer.fill(0);
    this.backgroundBuffer.fill(0);
  }

  setGlobalBackground(background) {
    this.globalBackground = background;
  }

  setBackground(x, y, color) {
    if (0 <= x && x < this.width && 0 <= y && y < this.height) {
      const idx = this._project(x, y);
      this.backgroundBuffer[idx] = color;
    }
  }

  setPixel(x, y, color) {
    this._locate(x, y, (idx, mask) => {
      this.pixelBuffer[idx] |= mask;
      this.foregroundBuffer[idx] = color;
    });
  }

  unsetPixel(x, y) {
    this._locate(x, y, (idx, mask) => {
      this.pixelBuffer[idx] &= ~mask;
    });
  }

  _project(x, y) {
    return (x>>1) + (this.width>>1)*(y>>2);
  }

  _locate(x, y, cb) {
    if (!((0 <= x && x < this.width) && (0 <= y && y < this.height))) {
      return;
    }
    const idx = this._project(x, y);
    const mask = this.brailleMap[y & 3][x & 1];
    return cb(idx, mask);
  }

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

  frame() {
    const output = [];
    let currentColor = null;
    let skip = 0;

    for (let y = 0; y < this.height/4; y++) {
      skip = 0;

      for (let x = 0; x < this.width/2; x++) {
        const idx = y*this.width/2 + x;

        if (idx && !x) {
          output.push(config.delimeter);
        }

        const colorCode = this._termColor(this.foregroundBuffer[idx], this.backgroundBuffer[idx]);
        if (currentColor !== colorCode) {
          output.push(currentColor = colorCode);
        }

        const char = this.charBuffer[idx];
        if (char) {
          skip += stringWidth(char)-1;
          if (skip+x < this.width/2) {
            output.push(char);
          }
        } else {
          if (!skip) {
            if (config.useBraille) {
              output.push(String.fromCharCode(0x2800+this.pixelBuffer[idx]));
            } else {
              output.push(this.asciiToBraille[this.pixelBuffer[idx]]);
            }
          } else {
            skip--;
          }
        }
      }
    }

    output.push(termReset+config.delimeter);
    return output.join('');
  }

  setChar(char, x, y, color) {
    if (0 <= x && x < this.width && 0 <= y && y < this.height) {
      const idx = this._project(x, y);
      this.charBuffer[idx] = char;
      this.foregroundBuffer[idx] = color;
    }
  }

  writeText(text, x, y, color, center = true) {
    if (center) {
      x -= text.length/2+1;
    }
    for (let i = 0; i < text.length; i++) {
      this.setChar(text.charAt(i), x+i*2, y, color);
    }
  }
}

module.exports = BrailleBuffer;
