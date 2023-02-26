import fsPromises from 'fs/promises';
import Renderer from './Renderer';
import TileSource from './TileSource.js';

const center = {
  lat: 52.51298,
  lon: 13.42012,
};

describe('Renderer', () => {
  describe('with a HTTP source', () => {
    test('does not crash when creating a Renderer', async () => {
      const tileSource = new TileSource();
      await tileSource.init('http://mapscii.me/');
      const style = JSON.parse(await fsPromises.readFile('./styles/dark.json'));
      const renderer = new Renderer(tileSource, style);
      renderer.setSize(30, 30);
      expect(await renderer.draw(center, 13)).toMatchSnapshot();
    });
  });
});
