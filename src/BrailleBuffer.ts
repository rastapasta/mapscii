/*
  MapSCII - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Simple pixel to braille character mapper

  Implementation inspired by node-drawille (https://github.com/madbence/node-drawille)
  * added color support
  * added text label support
  * general optimizations
*/

import stringWidth from 'string-width';
import config from './config';
import { terminalColorSequence } from './color';
import { shapeTextForTerminal } from './textShaping';
import { population } from './utils';

interface AsciiMapEntry {
  mask: number;
  char: string;
}

const asciiMap: Record<string, number[]> = {
  '▀': [1 + 2 + 16 + 32],
  '▄': [4 + 8 + 64 + 128],
  '■': [2 + 4 + 32 + 64],
  '▌': [1 + 2 + 4 + 8],
  '▐': [16 + 32 + 64 + 128],
  '█': [255],
};

const termReset = '\x1B[39;49m';

export default class BrailleBuffer {
  private brailleMap: number[][] = [[0x1, 0x8], [0x2, 0x10], [0x4, 0x20], [0x40, 0x80]];
  private pixelBuffer: Buffer;
  private charBuffer: (string | undefined)[];
  private charWidthBuffer: Uint8Array;
  private foregroundBuffer: Buffer;
  private backgroundBuffer: Buffer;
  private asciiToBraille: string[] = [];
  private globalBackground: number = 0;
  private widthCache: Map<string, number> = new Map();
  private segmenter: Intl.Segmenter | null = null;

  public width: number;
  public height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;

    const size = width * height / 8;
    this.pixelBuffer = Buffer.alloc(size);
    this.foregroundBuffer = Buffer.alloc(size);
    this.backgroundBuffer = Buffer.alloc(size);
    this.charBuffer = new Array(size);
    this.charWidthBuffer = new Uint8Array(size);

    // Node 18+ has this; it makes accents/emoji sequences behave correctly as one "glyph"
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      this.segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    }

    this._mapBraille();
    this.clear();
  }

  clear(): void {
    this.pixelBuffer.fill(0);
    this.charBuffer = new Array(this.pixelBuffer.length);
    this.charWidthBuffer.fill(0);
    this.foregroundBuffer.fill(0);
    this.backgroundBuffer.fill(0);
  }

  setGlobalBackground(background: number): void {
    this.globalBackground = background;
  }

  setBackground(x: number, y: number, color: number): void {
    if (0 <= x && x < this.width && 0 <= y && y < this.height) {
      const idx = this._project(x, y);
      this.backgroundBuffer[idx] = color;
    }
  }

  setPixel(x: number, y: number, color: number): void {
    this._locate(x, y, (idx, mask) => {
      this.pixelBuffer[idx] |= mask;
      this.foregroundBuffer[idx] = color;
    });
  }

  unsetPixel(x: number, y: number): void {
    this._locate(x, y, (idx, mask) => {
      this.pixelBuffer[idx] &= ~mask;
    });
  }

  private _project(x: number, y: number): number {
    return (x >> 1) + (this.width >> 1) * (y >> 2);
  }

  private _locate(x: number, y: number, cb: (idx: number, mask: number) => void): void {
    if (!((0 <= x && x < this.width) && (0 <= y && y < this.height))) {
      return;
    }
    const idx = this._project(x, y);
    const mask = this.brailleMap[y & 3][x & 1];
    cb(idx, mask);
  }

  private _mapBraille(): void {
    this.asciiToBraille = [' '];

    const masks: AsciiMapEntry[] = [];
    for (const char in asciiMap) {
      const bits = asciiMap[char];
      if (!Array.isArray(bits)) continue;
      for (const mask of bits) {
        masks.push({ mask, char });
      }
    }

    for (let i = 1; i <= 255; i++) {
      const braille = (i & 7) + ((i & 56) << 1) + ((i & 64) >> 3) + (i & 128);
      const best = masks.reduce((best: { char: string; covered: number } | undefined, mask) => {
        const covered = population(mask.mask & braille);
        if (!best || best.covered < covered) {
          return { char: mask.char, covered };
        }
        return best;
      }, undefined);
      this.asciiToBraille[i] = best?.char || ' ';
    }
  }

  private _termColor(foreground: number, background: number): string {
    // Cell background wins over the global one. (Bitwise OR would mash the
    // two palette indexes together into a wrong color when both are set.)
    background = background || this.globalBackground;
    return terminalColorSequence(foreground, background) || termReset;
  }

  frame(): string {
    const output: string[] = [];
    let currentColor: string | null = null;
    let skip = 0;

    for (let y = 0; y < this.height / 4; y++) {
      skip = 0;

      for (let x = 0; x < this.width / 2; x++) {
        const idx = y * this.width / 2 + x;

        if (idx && !x) {
          output.push(config.delimeter);
        }

        // If the previous printed glyph consumed multiple columns, do NOT emit anything here.
        // Emitting colors (or chars) during "skip" changes terminal state without advancing the cursor.
        if (skip > 0) {
          skip--;
          continue;
        }

        const char = this.charBuffer[idx];
        if (char) {
          const charWidth = this.charWidthBuffer[idx] || this._glyphWidth(char);

          const colorCode = this._termColor(this.foregroundBuffer[idx], this.backgroundBuffer[idx]);
          if (currentColor !== colorCode) {
            output.push(currentColor = colorCode);
          }

          // Match old behavior: still reserve the extra columns even if we don't print at EOL
          skip = Math.max(0, charWidth - 1);
          if (x + skip < this.width / 2) {
            output.push(char);
          }
        } else {
          const colorCode = this._termColor(this.foregroundBuffer[idx], this.backgroundBuffer[idx]);
          if (currentColor !== colorCode) {
            output.push(currentColor = colorCode);
          }

          if (config.useBraille) {
            output.push(String.fromCharCode(0x2800 + this.pixelBuffer[idx]));
          } else {
            output.push(this.asciiToBraille[this.pixelBuffer[idx]]);
          }
        }
      }
    }

    output.push(termReset + config.delimeter);
    return output.join('');
  }

  setChar(char: string, x: number, y: number, color: number, widthCols?: number): void {
    if (0 <= x && x < this.width && 0 <= y && y < this.height) {
      const idx = this._project(x, y);
      this.charBuffer[idx] = char;
      const w = Math.max(1, Math.min(255, widthCols ?? this._glyphWidth(char)));
      this.charWidthBuffer[idx] = w;
      this.foregroundBuffer[idx] = color;
    }
  }

  writeText(text: string, x: number, y: number, color: number, center: boolean = true): void {
    shapeTextForTerminal(text)
      .split('\n')
      .forEach((line, index) => {
        this._writeTextLine(line, x, y + index * 4, color, center);
      });
  }

  private _writeTextLine(text: string, x: number, y: number, color: number, center: boolean): void {
    // Big perf win: only measure full string width when we actually need centering
    if (center) {
      x -= stringWidth(text) + 1;
    }

    // Fast path: pure ASCII => each glyph is width 1
    let ascii = true;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) > 0x7f) { ascii = false; break; }
    }
    if (ascii) {
      for (let i = 0; i < text.length; i++) {
        this.setChar(text.charAt(i), x + i * 2, y, color, 1);
      }
      return;
    }

    // Unicode path: use grapheme clusters so accents/emoji sequences stay together
    const glyphs = this.segmenter
      ? Array.from(this.segmenter.segment(text), (s) => s.segment)
      : Array.from(text); // codepoints fallback

    let offsetCols = 0;
    for (const g of glyphs) {
      const w = this._glyphWidth(g);
      this.setChar(g, x + offsetCols * 2, y, color, w);
      offsetCols += w;
    }
  }

  private _glyphWidth(glyph: string): number {
    const cached = this.widthCache.get(glyph);
    if (cached !== undefined) return cached;

    // Very common case: 1-byte ASCII
    if (glyph.length === 1 && glyph.charCodeAt(0) <= 0x7f) {
      this.widthCache.set(glyph, 1);
      return 1;
    }

    // string-width is the correct source of truth for terminal column width
    const w = Math.max(1, stringWidth(glyph));
    if (this.widthCache.size > 2048) this.widthCache.clear();
    this.widthCache.set(glyph, w);
    return w;
  }
}
