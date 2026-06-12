import { describe, expect, test } from 'bun:test';
import { normalizeKeyName } from './InputHandler';

describe('normalizeKeyName', () => {
  test('keeps the case of single printable characters so uppercase bindings work', () => {
    expect(normalizeKeyName('S')).toBe('S');
    expect(normalizeKeyName('R')).toBe('R');
    expect(normalizeKeyName('s')).toBe('s');
    expect(normalizeKeyName('r')).toBe('r');
    expect(normalizeKeyName('a')).toBe('a');
    expect(normalizeKeyName('A')).toBe('A');
    expect(normalizeKeyName('?')).toBe('?');
  });

  test('maps terminal-kit special keys to canonical names', () => {
    expect(normalizeKeyName('UP')).toBe('up');
    expect(normalizeKeyName('DOWN')).toBe('down');
    expect(normalizeKeyName('LEFT')).toBe('left');
    expect(normalizeKeyName('RIGHT')).toBe('right');
    expect(normalizeKeyName('ESCAPE')).toBe('escape');
  });

  test('maps CTRL_C to the quit binding', () => {
    expect(normalizeKeyName('CTRL_C')).toBe('q');
  });

  test('lowercases other multi-character key names', () => {
    expect(normalizeKeyName('ENTER')).toBe('enter');
    expect(normalizeKeyName('BACKSPACE')).toBe('backspace');
    expect(normalizeKeyName('F1')).toBe('f1');
  });
});
