import bidiFactory from 'bidi-js';
import { ArabicShaper } from 'arabic-persian-reshaper';
import stringWidth from 'string-width';

const bidi = bidiFactory();
const RTL_RE = /[\u0590-\u08ff\ufb1d-\ufefc]/;
const ARABIC_RE = /[\u0600-\u06ff\ufb50-\ufefc]/;

export function hasRightToLeftText(text: string): boolean {
  return RTL_RE.test(text);
}

export function shapeLineForTerminal(line: string): string {
  if (!hasRightToLeftText(line)) return line;

  const shaped = ARABIC_RE.test(line) ? ArabicShaper.convertArabic(line) : line;
  const levels = bidi.getEmbeddingLevels(shaped);
  const chars = shaped.split('');
  const mirrored = bidi.getMirroredCharactersMap(shaped, levels);

  mirrored.forEach((value, key) => {
    chars[key] = value;
  });

  bidi.getReorderSegments(shaped, levels).forEach(([start, end]) => {
    const reversed = chars.slice(start, end + 1).reverse();
    chars.splice(start, reversed.length, ...reversed);
  });

  return chars.join('');
}

export function shapeTextForTerminal(text: string): string {
  return String(text)
    .split('\n')
    .map((line) => shapeLineForTerminal(line))
    .join('\n');
}

export function displayLines(text: string): string[] {
  return shapeTextForTerminal(text).split('\n');
}

export function wrapText(text: string, maxWidth: number): string {
  if (!maxWidth || maxWidth < 1) return text;

  return String(text)
    .split('\n')
    .flatMap((paragraph) => {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (!words.length) return [''];

      const lines: string[] = [];
      let line = '';

      words.forEach((word) => {
        const candidate = line ? `${line} ${word}` : word;

        if (line && stringWidth(candidate) > maxWidth) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      });

      if (line) lines.push(line);
      return lines;
    })
    .join('\n');
}

export function formatLabelText(text: string, maxWidth: number): string {
  return shapeTextForTerminal(wrapText(text, maxWidth));
}
