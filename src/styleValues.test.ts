import { describe, expect, test } from 'bun:test';
import { resolveStyleValue } from './styleValues';

describe('resolveStyleValue', () => {
  test('interpolates numeric stops', () => {
    expect(resolveStyleValue({ stops: [[4, 1], [8, 5]] }, 6, 0)).toBe(3);
  });

  test('interpolates color stops', () => {
    expect(resolveStyleValue({ stops: [[0, '#000000'], [10, '#ffffff']] }, 5, '#000000')).toBe('#808080');
  });

  test('uses edge stop values outside the stop range', () => {
    expect(resolveStyleValue({ stops: [[4, '#111111'], [8, '#999999']] }, 2, '#000000')).toBe('#111111');
    expect(resolveStyleValue({ stops: [[4, '#111111'], [8, '#999999']] }, 10, '#000000')).toBe('#999999');
  });
});
