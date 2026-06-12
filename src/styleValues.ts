type Stop<T> = [number, T];

export type StoppedValue<T> =
  | T
  | {
      stops: Stop<T>[];
    };

function isStoppedValue<T>(value: StoppedValue<T>): value is { stops: Stop<T>[] } {
  return !!value && typeof value === 'object' && 'stops' in value && Array.isArray(value.stops);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseHexColor(hex: string): number[] | null {
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex;
  const value =
    normalized.length === 3
      ? normalized
        .split('')
        .map((part) => part + part)
        .join('')
      : normalized;

  if (!/^[0-9a-f]{6}$/i.test(value)) return null;

  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function toHex(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
}

function interpolateColor(a: string, b: string, t: number): string {
  const start = parseHexColor(a);
  const end = parseHexColor(b);

  if (!start || !end) return t < 1 ? a : b;

  return `#${toHex(start[0] + (end[0] - start[0]) * t)}${toHex(
    start[1] + (end[1] - start[1]) * t
  )}${toHex(start[2] + (end[2] - start[2]) * t)}`;
}

function interpolateValue<T>(a: T, b: T, t: number): T {
  if (typeof a === 'number' && typeof b === 'number') {
    return (a + (b - a) * t) as T;
  }

  if (typeof a === 'string' && typeof b === 'string') {
    return interpolateColor(a, b, t) as T;
  }

  return t < 1 ? a : b;
}

export function resolveStyleValue<T>(value: StoppedValue<T> | undefined, zoom: number, fallback: T): T {
  if (value === undefined) return fallback;
  if (!isStoppedValue(value)) return value;

  // Hot path (per feature per frame for line widths): style stops are
  // virtually always pre-sorted, so only clone+sort when they aren't.
  let stops = value.stops;
  if (!stops.length) return fallback;
  for (let index = 1; index < stops.length; index += 1) {
    if (stops[index - 1][0] > stops[index][0]) {
      stops = [...value.stops].sort((a, b) => a[0] - b[0]);
      break;
    }
  }
  if (zoom <= stops[0][0]) return stops[0][1];

  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1];
    const next = stops[index];

    if (zoom <= next[0]) {
      const range = next[0] - previous[0];
      const t = range === 0 ? 1 : clamp((zoom - previous[0]) / range, 0, 1);
      return interpolateValue(previous[1], next[1], t);
    }
  }

  return stops[stops.length - 1][1];
}
