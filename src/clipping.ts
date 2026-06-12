/*
  MapSCII - Terminal Map Viewer

  Shared screen-space clipping helpers used by both the flat Renderer and the Globe.

  Clipping before rasterization is essential: projected coordinates can be
  millions of pixels off-screen (especially on the globe at high zoom), and
  Bresenham/scanline rasterization cost scales with the unclipped size.
*/

export interface ClipPoint {
  x: number;
  y: number;
}

const INSIDE = 0;
const LEFT = 1;
const RIGHT = 2;
const TOP = 4;
const BOTTOM = 8;

/**
 * Cohen–Sutherland segment clipping against an axis-aligned rectangle.
 * Returns the clipped segment with rounded integer coordinates, or null if
 * the segment lies entirely outside the rectangle.
 */
export function clipSegmentToRect(
  p0: ClipPoint,
  p1: ClipPoint,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): [ClipPoint, ClipPoint] | null {
  const outCode = (x: number, y: number) => {
    let code = INSIDE;
    if (x < minX) code |= LEFT;
    else if (x > maxX) code |= RIGHT;
    if (y < minY) code |= TOP;
    else if (y > maxY) code |= BOTTOM;
    return code;
  };

  let x0 = p0.x, y0 = p0.y;
  let x1 = p1.x, y1 = p1.y;

  let c0 = outCode(x0, y0);
  let c1 = outCode(x1, y1);

  while (true) {
    if ((c0 | c1) === 0) {
      return [
        { x: Math.round(x0), y: Math.round(y0) },
        { x: Math.round(x1), y: Math.round(y1) },
      ];
    }
    if ((c0 & c1) !== 0) {
      return null;
    }

    const cOut = c0 !== 0 ? c0 : c1;

    let x = 0, y = 0;

    if (cOut & TOP) {
      const dy = y1 - y0;
      if (dy === 0) return null;
      x = x0 + (x1 - x0) * (minY - y0) / dy;
      y = minY;
    } else if (cOut & BOTTOM) {
      const dy = y1 - y0;
      if (dy === 0) return null;
      x = x0 + (x1 - x0) * (maxY - y0) / dy;
      y = maxY;
    } else if (cOut & RIGHT) {
      const dx = x1 - x0;
      if (dx === 0) return null;
      y = y0 + (y1 - y0) * (maxX - x0) / dx;
      x = maxX;
    } else if (cOut & LEFT) {
      const dx = x1 - x0;
      if (dx === 0) return null;
      y = y0 + (y1 - y0) * (minX - x0) / dx;
      x = minX;
    }

    if (cOut === c0) {
      x0 = x; y0 = y;
      c0 = outCode(x0, y0);
    } else {
      x1 = x; y1 = y;
      c1 = outCode(x1, y1);
    }
  }
}

/**
 * Clip a polyline to a rectangle, splitting it into visible parts.
 * Prevents "shortcut chords" when segments cross offscreen areas.
 */
export function clipPolylineToRect(
  pts: ClipPoint[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): ClipPoint[][] {
  const out: ClipPoint[][] = [];
  let current: ClipPoint[] = [];

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];

    const clipped = clipSegmentToRect(a, b, minX, minY, maxX, maxY);
    if (!clipped) {
      if (current.length >= 2) out.push(current);
      current = [];
      continue;
    }

    const [c0, c1] = clipped;

    // start a new part or continue current one
    if (current.length === 0) {
      current.push(c0, c1);
    } else {
      const last = current[current.length - 1];
      if (last.x === c0.x && last.y === c0.y) {
        current.push(c1);
      } else {
        if (current.length >= 2) out.push(current);
        current = [c0, c1];
      }
    }
  }

  if (current.length >= 2) out.push(current);

  // remove consecutive duplicates that clipping can introduce
  return out.map((part) => {
    const cleaned: ClipPoint[] = [];
    for (const p of part) {
      const prev = cleaned[cleaned.length - 1];
      if (!prev || prev.x !== p.x || prev.y !== p.y) cleaned.push(p);
    }
    return cleaned;
  }).filter((part) => part.length >= 2);
}
