'use strict';
const Mapscii = require('./Mapscii');

const HELP = 'arrows/hjkl: move  a/zy: zoom  c: braille  q: quit';

const footerFor = (output) => new Mapscii({output})._getFooter();

describe('Mapscii footer key help', () => {
  it('right-aligns the help on a wide terminal', () => {
    const footer = footerFor({columns: 200});
    expect(footer.endsWith(HELP)).toBe(true);
    expect(footer.length).toBe(199);
  });

  it('omits the help on a narrow terminal', () => {
    const footer = footerFor({columns: 40});
    expect(footer).not.toContain(HELP);
    expect(footer.length).toBeLessThan(40);
  });

  it('appends the help when the width is unknown', () => {
    expect(footerFor({})).toContain(HELP);
  });
});
