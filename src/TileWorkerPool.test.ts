import { describe, expect, test } from 'bun:test';
import TileWorkerPool from './TileWorkerPool';
import Styler from './Styler';

const styler = new Styler({ name: 'test', layers: [] });

describe('TileWorkerPool', () => {
  test('rejects invalid tile buffers so callers can fall back to main-thread parsing', async () => {
    const garbage = Buffer.from('definitely not a vector tile');

    await expect(TileWorkerPool.parse(garbage, 0, styler, 'en')).rejects.toThrow();
  });

  test('a per-tile parse error does not disable the worker', async () => {
    const garbage = Buffer.from('still not a vector tile');

    try {
      await TileWorkerPool.parse(garbage, 0, styler, 'en');
      expect.unreachable('parse should have rejected');
    } catch (error) {
      // A bad tile must surface as a normal parse rejection, not as the
      // worker pool having shut itself down.
      expect((error as Error).message).not.toContain('disabled');
    }
  });
});
