// Draws a map as SVG for --export, in a paper palette.
'use strict';
const fs = require('fs');
const Renderer = require('./Renderer');
const Gpx = require('./Gpx');
const PlusCode = require('./PlusCode');

const PAPER = {
  background: '#f6f2ea',
  water: '#a9cdee',
  waterway: '#6fa7dd',
  park: '#d3e8c6',
  wood: '#c2deb2',
  landuse: '#ebe5d8',
  building: '#d9d0c6',
  admin: '#9b7ec8',
  roads: [
    // [style id match, colour, width at zoom 14, casing]
    [/motorway/, '#e8925a', 4.5, '#b8663a'],
    [/trunk|primary/, '#f2c35a', 3.8, '#c09033'],
    [/secondary|tertiary/, '#ffffff', 3.2, '#bdb3a4'],
    [/rail/, '#8a8a8a', 1.2, null],
    [/path|pedestrian|track/, '#a8957f', 1, null],
    [/./, '#ffffff', 2.4, '#c9c0b3'],
  ],
  text: '#2b2b2b',
  halo: '#f6f2ea',
};

// overlay colours are made for a dark terminal: light ones are darkened for paper
function onPaper(hex) {
  const m = String(hex).match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  const light = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (light < 0.55) return hex;
  const k = 0.55 / light;
  return '#' + [r, g, b].map((c) => Math.round(c * k).toString(16).padStart(2, '0')).join('');
}

// Escapes text for SVG
const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Rounds to one decimal
const num = (n) => Math.round(n * 10) / 10;

// options: {center, zoom, width, height, overlays, markers}; resolves with {svg, tiles, missing}
async function render(tileSource, {center, zoom, width = 1200, height = 800, overlays = [], markers = [], style}) {
  const layout = new Renderer({on() {}}, tileSource, style || JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'styles', 'bright.json'), 'utf8')));
  layout.setSize(width, height);
  const tiles = layout._visibleTiles(center, zoom);
  let missing = 0;
  for (const tile of tiles) {
    try {
      tile.data = await tileSource.getTile(tile.xyz.z, tile.xyz.x, tile.xyz.y);
    } catch (error) {
      tile.data = null;
      if (error.status !== 404) missing++;
    }
  }
  const scaleZoom = Math.pow(2, zoom - 14);
  const parts = {land: [], water: [], waterway: [], building: [], casing: [], road: [], admin: []};
  const labels = [];
  for (const tile of tiles) {
    if (!tile.data) continue;
    const toScreen = (layer) => {
      const k = tile.size / layer.extent;
      return (p) => [tile.position.x + p.x * k, tile.position.y + p.y * k];
    };
    for (const [name, layer] of Object.entries(tile.data.layers)) {
      const project = toScreen(layer);
      for (const feature of layer.tree.all()) {
        const id = (feature.style && feature.style.id) || name;
        const type = feature.style && feature.style.type;
        if (type === 'symbol') {
          const anchor = feature.points.length ? (Array.isArray(feature.points[0]) ? feature.points[0][0] : feature.points[0]) : null;
          // a name belongs to its own tile, so it doesn't show where a neighbour is missing
          if (feature.label && anchor && anchor.x >= 0 && anchor.y >= 0 && anchor.x < layer.extent && anchor.y < layer.extent) {
            const [x, y] = project(anchor);
            labels.push({text: feature.label, x, y, layer: name, id, sort: feature.sort || 99});
          }
          continue;
        }
        if (type === 'fill') {
          const d = feature.points.map((ring) => pathOf(ring.map(project), true)).join('');
          if (!d) continue;
          if (name === 'water') parts.water.push(`<path d="${d}"/>`);
          else if (name === 'building') {
            if (zoom >= 14.5) parts.building.push(`<path d="${d}"/>`);
          } else {
            const color = /park|national|garden|grass|cemetery/.test(id) ? PAPER.park : /wood|forest/.test(id) ? PAPER.wood : PAPER.landuse;
            if (color !== PAPER.landuse || zoom >= 12) parts.land.push(`<path d="${d}" fill="${color}"/>`);
          }
          continue;
        }
        if (type !== 'line') continue;
        const d = pathOf(feature.points.map(project), false);
        if (!d) continue;
        if (name === 'waterway') {
          const river = /river/.test(id);
          parts.waterway.push(`<path d="${d}" stroke-width="${num(Math.max(0.6, (river ? 2.2 : 0.9) * scaleZoom))}"/>`);
        } else if (name === 'admin') {
          parts.admin.push(`<path d="${d}"/>`);
        } else if (name === 'road' || name === 'aeroway') {
          const [, color, w, casing] = PAPER.roads.find(([re]) => re.test(id));
          const width = Math.max(0.5, w * Math.min(2.5, Math.max(0.25, scaleZoom)));
          if (casing && width > 1.2) parts.casing.push(`<path d="${d}" stroke="${casing}" stroke-width="${num(width + 1.4)}"/>`);
          parts.road.push(`<path d="${d}" stroke="${color}" stroke-width="${num(width)}"${/rail/.test(id) ? ' stroke-dasharray="4 3"' : /path|pedestrian|track/.test(id) ? ' stroke-dasharray="2 2"' : ''}/>`);
        } else if (name === 'building') {
          if (zoom >= 14.5) parts.building.push(`<path d="${d}" fill="none" stroke="${PAPER.building}"/>`);
        }
      }
    }
  }

  // their names first, so map names make room
  const taken = [];
  const free = (box) => box.x >= 0 && box.y >= 0 && box.x + box.w <= width && box.y + box.h <= height &&
    !taken.some((o) => box.x < o.x + o.w && o.x < box.x + box.w && box.y < o.y + o.h && o.y < box.y + box.h);
  const overlayParts = [];
  const pointParts = [];
  for (const overlay of overlays) {
    const color = onPaper(overlay.color || '#d6336c');
    for (const line of overlay.lines || []) {
      const points = [];
      let previous = null;
      for (const place of line) {
        const p = layout._project(center, zoom, place, previous);
        if (previous && Math.abs(p.x - previous.x) < 0.7 && Math.abs(p.y - previous.y) < 0.7) continue;
        points.push([p.x, p.y]);
        previous = p;
      }
      const d = pathOf(points, false);
      if (d) overlayParts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`);
    }
    for (const point of overlay.points || []) {
      const {x, y} = layout._project(center, zoom, point);
      if (x < -10 || y < -10 || x > width + 10 || y > height + 10) continue;
      pointParts.push(`<circle cx="${num(x)}" cy="${num(y)}" r="5" fill="${color}" stroke="#fff" stroke-width="1.5"/>`);
      taken.push({x: x - 6, y: y - 6, w: 12, h: 12});
      if (point.name) {
        const box = {x: x + 8, y: y - 8, w: textWidth(point.name, 12), h: 15};
        if (free(box)) {
          taken.push(box);
          pointParts.push(label(point.name, box.x, y + 4, 12, 'bold', color));
        }
      }
    }
  }
  for (const marker of markers) {
    const {x, y} = layout._project(center, zoom, marker);
    pointParts.push(`<g transform="translate(${num(x)} ${num(y)})"><path d="M-9 0H9M0 -9V9" stroke="#fff" stroke-width="6"/><path d="M-9 0H9M0 -9V9" stroke="#c92a2a" stroke-width="3"/></g>`);
    taken.push({x: x - 10, y: y - 10, w: 20, h: 20});
  }

  // the most important first, each name once nearby
  const ranks = {country_label: 0, state_label: 1, place_label: 2, marine_label: 3, water_label: 4, airport_label: 5, rail_station_label: 6, poi_label: 7, road_label: 8};
  const rank = (l) => l.layer in ranks ? ranks[l.layer] : 9;
  const sizeOf = (l) => l.layer === 'country_label' ? 15 : l.layer === 'place_label' ? (/city/.test(l.id) ? 15 : /town/.test(l.id) ? 13 : 11) : 10.5;
  labels.sort((a, b) => rank(a) - rank(b) || a.sort - b.sort);
  const placed = [];
  const labelParts = [];
  let pois = 0;
  for (const l of labels) {
    if (l.layer === 'road_label' && zoom < 15) continue;
    if ((l.layer === 'poi_label' || l.layer === 'rail_station_label') && (zoom < 16 || pois >= 30)) continue;
    if (l.layer === 'housenum_label') continue;
    if (placed.some((p) => p.text === l.text && Math.hypot(p.x - l.x, p.y - l.y) < 300)) continue;
    const size = sizeOf(l);
    const w = textWidth(l.text, size);
    const box = {x: l.x - w / 2 - 4, y: l.y - size - 3, w: w + 8, h: size * 1.3 + 6};
    if (!free(box)) continue;
    taken.push(box);
    placed.push(l);
    if (l.layer === 'poi_label' || l.layer === 'rail_station_label') pois++;
    const color = /water|marine/.test(l.layer) ? '#2f6aa8' : l.layer === 'poi_label' ? '#6b5e50' : PAPER.text;
    labelParts.push(label(l.text, l.x - w / 2, l.y, size, l.layer === 'place_label' || l.layer === 'country_label' ? 'bold' : 'normal', color, /water|marine/.test(l.layer)));
  }

  const scale = scaleBar(center, zoom, width, height);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="'DejaVu Sans', 'Noto Sans', Arial, sans-serif">
<defs><clipPath id="frame"><rect width="${width}" height="${height}"/></clipPath></defs>
<g clip-path="url(#frame)">
<rect width="${width}" height="${height}" fill="${PAPER.background}"/>
<g stroke="none">${parts.land.join('')}</g>
<g fill="${PAPER.water}" fill-rule="evenodd" stroke="none">${parts.water.join('')}</g>
<g fill="none" stroke="${PAPER.waterway}" stroke-linecap="round">${parts.waterway.join('')}</g>
<g fill="${PAPER.building}" fill-rule="evenodd" stroke="none">${parts.building.join('')}</g>
<g fill="none" stroke-linecap="round" stroke-linejoin="round">${parts.casing.join('')}${parts.road.join('')}</g>
<g fill="none" stroke="${PAPER.admin}" stroke-width="1.2" stroke-dasharray="6 3">${parts.admin.join('')}</g>
${overlayParts.join('')}
${labelParts.join('')}
${pointParts.join('')}
${scale}
</g>
</svg>`;
  return {svg, tiles: tiles.length, missing};
}

// An SVG path through the points
function pathOf(points, closed) {
  if (points.length < 2) return '';
  let d = `M${num(points[0][0])} ${num(points[0][1])}`;
  let last = points[0];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (Math.abs(p[0] - last[0]) < 0.6 && Math.abs(p[1] - last[1]) < 0.6 && i < points.length - 1) continue;
    d += `L${num(p[0])} ${num(p[1])}`;
    last = p;
  }
  return closed ? d + 'Z' : d;
}

// About how wide text is in pixels
function textWidth(text, size) {
  return [...String(text)].length * size * 0.58;
}

// An SVG text element with a light halo
function label(text, x, y, size, weight, color, italic = false) {
  return `<text x="${num(x)}" y="${num(y)}" font-size="${size}" font-weight="${weight}"${italic ? ' font-style="italic"' : ''} fill="${color}" stroke="${PAPER.halo}" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${esc(text)}</text>`;
}

// A scale bar in the corner: a round length of about a fifth of the width
function scaleBar(center, zoom, width, height) {
  const metresPerPixel = 156543.03392 * Math.cos(center.lat * Math.PI / 180) / Math.pow(2, zoom);
  const target = metresPerPixel * width / 5;
  const nice = [1, 2, 5].flatMap((m) => [1, 10, 100, 1000, 10000, 100000, 1000000].map((p) => m * p)).sort((a, b) => a - b);
  const metres = nice.filter((n) => n <= target).pop() || nice[0];
  const px = metres / metresPerPixel;
  const text = metres >= 1000 ? `${metres / 1000} km` : `${metres} m`;
  const x = 16;
  const y = height - 18;
  return `<g><rect x="${x - 6}" y="${y - 20}" width="${num(px + 12)}" height="30" fill="#fff" opacity="0.8" rx="3"/><path d="M${x} ${y - 5}V${y}H${num(x + px)}V${y - 5}" fill="none" stroke="#333" stroke-width="2"/><text x="${x}" y="${y - 9}" font-size="11" fill="#333">${text}</text></g>`;
}

// fits one landscape page
function page({title, svg, notes = [], tracks = [], center, zoom, attribution, town = null}) {
  const rows = notes.map((n) => `<tr><td>${esc(n.title)}${n.text ? `<div class="sub">${esc(n.text)}</div>` : ''}</td><td>${esc(PlusCode.address(n.lat, n.lon, town))}</td><td>${n.lat.toFixed(5)}, ${n.lon.toFixed(5)}</td></tr>`).join('');
  const trackRows = tracks.map((t) => `<li>${esc(t.name)}: ${Gpx.length(t.points) >= 10 ? Gpx.length(t.points).toFixed(0) : Gpx.length(t.points).toFixed(1)} km</li>`).join('');
  const where = `${center.lat.toFixed(5)}, ${center.lon.toFixed(5)}, zoom ${+zoom.toFixed(1)} - plus code ${PlusCode.encode(center.lat, center.lon)}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
body{margin:0;padding:16px;font:15px/1.45 'DejaVu Sans','Noto Sans',Arial,sans-serif;color:#222;background:#fff}
h1{font-size:20px;margin:0 0 2px}.where{color:#666;font-size:13px;margin-bottom:10px}
.map svg{width:100%;height:auto;border:1px solid #ccc;display:block}
table{border-collapse:collapse;margin-top:14px;width:100%;font-size:14px}th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #e3e3e3;vertical-align:top}
th{background:#f3f3f3}.sub{color:#666;font-size:13px}h2{font-size:16px;margin:16px 0 4px}
.foot{color:#777;font-size:12px;margin-top:14px}
@media print{body{padding:0}@page{size:A4 landscape;margin:12mm}.map svg{border:0}table{page-break-inside:auto}tr{page-break-inside:avoid}}
</style></head><body>
<h1>${esc(title)}</h1><div class="where">${esc(where)}</div>
<div class="map">${svg}</div>
${notes.length ? `<h2>Field notes on the map</h2><table><tr><th>Note</th><th>Plus code</th><th>Coordinates</th></tr>${rows}</table>` : ''}
${tracks.length ? `<h2>Tracks</h2><ul>${trackRows}</ul>` : ''}
<div class="foot">Made with MapSCII on ${new Date().toISOString().slice(0, 10)}. Map data: ${esc(attribution || '© OpenStreetMap contributors')}. To print or save as PDF, use the browser's Print.</div>
</body></html>
`;
}

module.exports = {render, page, onPaper};
