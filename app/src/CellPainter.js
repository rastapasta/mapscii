// Paints a BrailleBuffer onto a canvas: Braille as round dots, names as text, pictures as two colours a cell.
'use strict';
const stringWidth = require('string-width');

const PALETTE = (() => {
  const base = ['#000000', '#cd0000', '#00cd00', '#cdcd00', '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5',
    '#7f7f7f', '#ff0000', '#00ff00', '#ffff00', '#5c5cff', '#ff00ff', '#00ffff', '#ffffff'];
  const steps = [0, 95, 135, 175, 215, 255];
  const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  for (let n = 16; n < 232; n++) {
    const i = n - 16;
    base.push(hex(steps[Math.floor(i / 36)], steps[Math.floor(i / 6) % 6], steps[i % 6]));
  }
  for (let n = 232; n < 256; n++) {
    const v = 8 + (n - 232) * 10;
    base.push(hex(v, v, v));
  }
  return base;
})();

// 0xRRGGBB as a CSS colour
const css = (rgb) => '#' + (rgb & 0xffffff).toString(16).padStart(6, '0');

// bit -> [column, row], as BrailleBuffer sets them
const DOTS = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [0, 3], [1, 3]];

// background: a CSS colour, or null to paint over what is there
function paint(ctx, buffer, {cellW, cellH, background = '#000000', font = 'monospace'}) {
  const columns = buffer.width / 2;
  const rows = buffer.height / 4;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, columns * cellW, rows * cellH);
  }
  const dot = Math.max(1, Math.min(cellW / 2, cellH / 4) * 0.72);
  ctx.font = `${Math.round(cellH * 0.78)}px ${font}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const raster = buffer.rasterTop;
  for (let row = 0; row < rows; row++) {
    const y = row * cellH;
    // a wide (CJK) character takes two cells; the empty cells after the name make up for it
    let ahead = 0;
    for (let col = 0; col < columns; col++) {
      const idx = row * columns + col;
      const char = buffer.charBuffer[idx];
      if (!char && ahead > 0) {
        ahead--;
        continue;
      }
      const x = (col + ahead) * cellW;
      if (char) {
        const width = charWidth(char);
        if (col + ahead + width > columns) continue;
        ahead += width - 1;
      }
      const pixels = buffer.pixelBuffer[idx];
      const picture = raster && raster[idx] !== -1;
      if (picture) {
        ctx.fillStyle = css(raster[idx]);
        ctx.fillRect(x, y, cellW + 0.5, cellH / 2 + 0.5);
        ctx.fillStyle = css(buffer.rasterBottom[idx]);
        ctx.fillRect(x, y + cellH / 2, cellW + 0.5, cellH / 2 + 0.5);
      } else if (buffer.backgroundBuffer[idx]) {
        ctx.fillStyle = PALETTE[buffer.backgroundBuffer[idx]];
        ctx.fillRect(x, y, cellW + 0.5, cellH + 0.5);
      }
      const fg = buffer.foregroundBuffer[idx];
      if (char) {
        if (picture || !background) {
          // a dark band under names on pictures, so they stay readable
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(x, y, cellW * charWidth(char) + 0.5, cellH + 0.5);
        }
        ctx.fillStyle = fg ? PALETTE[fg] : '#ffffff';
        ctx.fillText(char, x, y + cellH / 2, cellW * charWidth(char));
      } else if (pixels) {
        ctx.fillStyle = fg ? PALETTE[fg] : '#ffffff';
        for (let bit = 0; bit < 8; bit++) {
          if (!(pixels & (1 << bit))) continue;
          const [dx, dy] = DOTS[bit];
          ctx.beginPath();
          ctx.arc(x + (dx + 0.5) * cellW / 2, y + (dy + 0.5) * cellH / 4, dot / 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
}

// the cells' two colours, drawn smoothly
let scratch = null;
// The cells' picture colours, drawn smoothly over the canvas
function paintPicture(ctx, buffer, width, height) {
  const columns = buffer.width / 2;
  const rows = buffer.height / 4;
  if (!buffer.rasterTop) return;
  if (!scratch) scratch = document.createElement('canvas');
  scratch.width = columns;
  scratch.height = rows * 2;
  const sctx = scratch.getContext('2d');
  const image = sctx.createImageData(columns, rows * 2);
  const d = image.data;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const idx = row * columns + col;
      for (const [half, source] of [[0, buffer.rasterTop], [1, buffer.rasterBottom]]) {
        const c = source[idx];
        const i = ((row * 2 + half) * columns + col) * 4;
        if (c === -1) continue;
        d[i] = c >> 16 & 255;
        d[i + 1] = c >> 8 & 255;
        d[i + 2] = c & 255;
        d[i + 3] = 255;
      }
    }
  }
  sctx.putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(scratch, 0, 0, width, height);
}

const widths = new Map();
// How many cells a grapheme takes (cached)
function charWidth(char) {
  let width = widths.get(char);
  if (width === undefined) {
    width = Math.max(1, stringWidth(char));
    if (widths.size > 5000) widths.clear();
    widths.set(char, width);
  }
  return width;
}

module.exports = {paint, paintPicture, PALETTE};
