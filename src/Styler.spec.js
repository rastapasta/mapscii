import fsPromises from 'fs/promises';
import Styler from './Styler';

describe('Styler', () => {
  describe('getStyleFor', () => {
    test('returns false for landuse_park, line', async () => {
      const style = JSON.parse(await fsPromises.readFile('./styles/dark.json'));
      const styler = new Styler(style);
      expect(styler.getStyleFor('landuse_park', 'line')).toBe(false);
    });
  });
});
