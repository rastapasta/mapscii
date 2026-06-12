import { describe, expect, test } from 'bun:test';
import { colorFromHex, terminalColorSequence } from './color';

describe('terminalColorSequence', () => {
  test('emits reset-aware xterm 256-color foreground/background sequences', () => {
    expect(terminalColorSequence(160, 22, 'xterm-256')).toBe('\x1B[38;5;160;48;5;22m');
    expect(terminalColorSequence(160, 0, 'xterm-256')).toBe('\x1B[49;38;5;160m');
    expect(terminalColorSequence(0, 22, 'xterm-256')).toBe('\x1B[39;48;5;22m');
  });

  test('emits reset-aware ANSI 16-color foreground/background sequences', () => {
    expect(terminalColorSequence(2, 3, 'ansi-16')).toBe('\x1B[31;42m');
    expect(terminalColorSequence(2, 0, 'ansi-16')).toBe('\x1B[49;31m');
    expect(terminalColorSequence(0, 3, 'ansi-16')).toBe('\x1B[39;42m');
  });
});

describe('colorFromHex', () => {
  test('offsets ANSI 16 black so zero can stay the no-color sentinel', () => {
    expect(colorFromHex('#000000', 'ansi-16')).toBe(1);
  });
});
