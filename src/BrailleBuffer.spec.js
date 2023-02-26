import BrailleBuffer from './BrailleBuffer.js';

const termReset = '\x1B[39;49m';

describe('BrailleBuffer', () => {
  test('starts a frame with term reset characters', async () => {
    const brailleBuffer = new BrailleBuffer(1, 1);
    expect(brailleBuffer.frame().startsWith(termReset)).toBe(true);
  });
});
