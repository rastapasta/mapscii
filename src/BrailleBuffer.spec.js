'use strict';
const stringWidth = require('string-width');
const BrailleBuffer = require('./BrailleBuffer');

// the text of a frame line, without colour codes
// eslint-disable-next-line no-control-regex
const plain = (line) => line.replace(/\x1b\[[0-9;]*m/g, '');
// zero-width characters may stay attached to a letter - they don't show
const visible = (text) => text.replace(/[\u200b\u200d]/g, '');

describe('BrailleBuffer.writeText', () => {
  test.each([
    ['plain', 'Boston'],
    ['combining accents', 'T\u0142\u0131\u0328ch\u01eb Nd\u00e9'],
    ['an accent as its own code point', 'i\u0301ndustry road'],
    ['wide characters', '\u65b0\u6f5f\u5e02'],
    ['emoji made of several code points', 'Caf\u00e9 \uD83C\uDDEF\uD83C\uDDF5 \uD83D\uDC69\u200d\uD83D\uDC67'],
    ['zero-width characters', 'a\u200bb\u200dc'],
  ])('keeps the line as wide as the screen: %s', (what, text) => {
    const buffer = new BrailleBuffer(80, 16);
    buffer.writeText(text, 10, 4, 15, false);
    const lines = buffer.frameLines().map(plain);
    for (const line of lines) {
      expect(stringWidth(line)).toBe(40);
    }
    expect(visible(lines[1])).toContain(visible(text));
  });
});
