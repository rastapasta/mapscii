import { afterEach, describe, expect, test } from 'bun:test';
import config from './config';
import Mapscii from './Mapscii';

describe('Mapscii', () => {
  const originalSource = config.source;
  const originalColorMode = config.colorMode;

  afterEach(() => {
    config.source = originalSource;
    config.colorMode = originalColorMode;
  });

  test('constructor keeps options isolated from the global config singleton', () => {
    new Mapscii({ source: 'https://example.com/a/', colorMode: 'ansi-16', headless: true });
    new Mapscii({ source: 'https://example.com/b/', colorMode: 'xterm-256', headless: true });

    expect(config.source).toBe(originalSource);
    expect(config.colorMode).toBe(originalColorMode);
  });
});
