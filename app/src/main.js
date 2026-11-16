// Dotpath: MapSCII's maps on a touch screen, in the terminal look or a sharp drawn one.
'use strict';
const config = require('../../src/config');
const utils = require('../../src/utils');
const Renderer = require('../../src/Renderer');
const RasterSource = require('../../src/RasterSource');
const SvgMap = require('../../src/SvgMap');
const PlusCode = require('../../src/PlusCode');
const resolvePlace = require('../../src/resolvePlace');
const AppTileSource = require('./AppTileSource');
const CellPainter = require('./CellPainter');
const darkStyle = require('../../styles/dark.json');
const brightStyle = require('../../styles/bright.json');
const Terrain3D = require('../../src/Terrain3D');
const Router = require('../../src/Router');
const Navigator = require('../../src/Navigator');
const Guidance = require('../../src/Guidance');
const AppPlaceIndex = require('./AppPlaceIndex');
const {makeLayers} = require('./AppLayers');
const AppNotes = require('./AppNotes');
const AppTrack = require('./AppTrack');
const Gpx = require('../../src/Gpx');
const FieldNotes = require('../../src/FieldNotes');

// a character cell in CSS pixels (terminal cells are about 1:2)
const CELL_W = 8;
const CELL_H = 16;
// one Braille dot is 4 CSS pixels
const WORLD_CSS = 256 * 4;
const MIN_ZOOM = 1;
const MAX_ZOOM = 18;
const VIEWS = [['map', 'Map'], ['satellite', 'Satellite'], ['hybrid', 'Hybrid'], ['relief', 'Relief'], ['3d', '3D']];
const MAP_CREDIT = '© OpenMapTiles © OpenStreetMap contributors';

const params = new URLSearchParams(location.search);
// ?local: tiles and pictures from the local test server
const local = params.has('local');

config.prefetch = false;
config.useBraille = true;

// The element with this id
const $ = (id) => document.getElementById(id);
const DEFAULTS = {lat: 5.6037, lon: -0.187, zoom: 12, view: 'map', look: 'terminal', heading: 0, photo: false, mode: 'car', voice: true};
const state = checked(Object.assign({}, DEFAULTS, loadState(), fromAddress()));

// damaged saved settings or odd link values fall back to the default
function checked(s) {
  const out = Object.assign({}, DEFAULTS);
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  if (num(s.lat)) out.lat = Math.max(-85, Math.min(85, s.lat));
  if (num(s.lon)) out.lon = ((s.lon + 180) % 360 + 360) % 360 - 180;
  if (num(s.zoom)) out.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, s.zoom));
  if (num(s.heading)) out.heading = ((Math.round(s.heading) % 360) + 360) % 360;
  if (VIEWS.some(([v]) => v === s.view)) out.view = s.view;
  if (s.look === 'terminal' || s.look === 'sharp') out.look = s.look;
  if (['car', 'bike', 'foot'].includes(s.mode)) out.mode = s.mode;
  if (typeof s.photo === 'boolean') out.photo = s.photo;
  if (typeof s.voice === 'boolean') out.voice = s.voice;
  return out;
}

// The place and settings in the address of a shared link
function fromAddress() {
  const out = {};
  for (const key of ['lat', 'lon', 'zoom', 'heading']) {
    const value = parseFloat(params.get(key));
    if (Number.isFinite(value)) out[key] = value;
  }
  if (VIEWS.some(([v]) => v === params.get('view'))) out.view = params.get('view');
  if (['terminal', 'sharp'].includes(params.get('look'))) out.look = params.get('look');
  return out;
}
let me = null;
let follow = false;
let message = '';
let messageTimer = null;

const TILEJSON = local ? 'local/tilejson.json' : 'https://tiles.openfreemap.org/planet';
const tileSource = new AppTileSource({tilejson: TILEJSON});
// the sharp look reads the same cached bytes with another style, as its own source
const sharpSource = new AppTileSource({tilejson: TILEJSON, maxTiles: 80, memoryMB: 60});
const renderer = new Renderer({on() {}}, tileSource, darkStyle);
const rasters = {
  imagery: new RasterSource('imagery', {onLoad: () => requestDraw()}),
  terrain: new RasterSource('terrain', {onLoad: () => requestDraw()}),
};
if (local) {
  rasters.imagery.url = 'local/pictures/imagery/{z}/{x}-{y}.jpg';
  rasters.terrain.url = 'local/pictures/terrain/{z}/{x}-{y}.png';
}
// pictures are rendered PICTURE_LEVELS zoom levels finer than the cells, then smoothed
const PICTURE_LEVELS = 2;
const pictures = new Renderer({on() {}}, {useStyler() {}}, darkStyle);
renderer.skipPictures = true;
tileSource.onTileLoaded = () => requestDraw();
sharpSource.onTileLoaded = () => requestDraw();
const placeIndex = new AppPlaceIndex();
tileSource.onTileParsed = (z, x, y, tile) => placeIndex.addTile(z, x, y, tile);
const layers = makeLayers(() => {
  requestDraw();
  if (!$('panel').hidden) updatePanelLayers();
});
const notes = new AppNotes();
const track = new AppTrack();
let opened = loadOpened();

// What is drawn over the map: files, notes, the track, the route and the layers
function overlays() {
  const list = [];
  for (const file of opened) list.push({lines: file.lines, points: file.points, color: '#ff8fb1', marker: '◆'});
  if (track.points.length > 1) list.push({lines: [track.points], color: '#f5a623'});
  const mine = notes.list();
  if (mine.length) list.push({points: mine.map((n) => ({lat: n.lat, lon: n.lon, name: n.title})), color: config.notesColor, marker: config.noteMarker});
  list.push(...layers.overlays());
  return list;
}

// The view, as the layers want it (see LayerManager.setView)
function layerView() {
  const box = $('map').getBoundingClientRect();
  const c = utils.ll2tile(state.lon, state.lat, 0);
  const corner = (dx, dy) => {
    const y = Math.max(0, Math.min(1, c.y + dy / scale()));
    return {lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI, lon: (c.x + dx / scale()) * 360 - 180};
  };
  const nw = corner(-box.width / 2, -box.height / 2);
  const se = corner(box.width / 2, box.height / 2);
  return {center: {lat: state.lat, lon: state.lon}, zoom: state.zoom, width: Math.round(box.width / 4), height: Math.round(box.height / 4),
    bounds: {north: nw.lat, west: nw.lon, south: se.lat, east: se.lon}};
}

// ---- drawing ----

const cells = $('cells');
const sharp = $('sharp');
let dirty = true;
let drawing = false;
let size = null;

// Draws with the next screen refresh, combining many requests into one frame
function requestDraw() {
  dirty = true;
  if (!drawing && !document.hidden) schedule(drawNow);
}

// a hidden tab or some embedded browsers have no animation frames
function schedule(fn) {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    fn();
  };
  requestAnimationFrame(run);
  setTimeout(run, 50);
}

const debug = params.has('debug') ? {draws: 0, step: 'start', error: ''} : null;

// Draws the map in the current look and view
async function drawNow() {
  if (debug) debug.draws++;
  if (drawing || !dirty) return;
  dirty = false;
  drawing = true;
  try {
    if (state.look === 'sharp' && state.view === 'map') await drawSharp();
    else await drawCells();
  } catch (error) {
    if (error) console.error(error);
    if (debug) debug.error = String((error && error.stack) || error).slice(0, 200);
  } finally {
    drawing = false;
    drawOverlay();
    updateBar();
    if (dirty) schedule(drawNow);
  }
}

// The renderer's markers: none, the overlay canvas draws them
function markers() {
  return [];
}

// Draws the position, the route and the destination over the map
function drawOverlay() {
  const overlay = $('overlay');
  const box = $('map').getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  overlay.width = Math.round(box.width * dpr);
  overlay.height = Math.round(box.height * dpr);
  overlay.style.width = `${box.width}px`;
  overlay.style.height = `${box.height}px`;
  const ctx = overlay.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, box.width, box.height);
  if (state.view === '3d') return;
  const c = utils.ll2tile(state.lon, state.lat, 0);
  // the short way round, near the date line
  const toScreen = (place) => {
    const p = utils.ll2tile(place.lon, place.lat, 0);
    return [box.width / 2 + (((p.x - c.x + 1.5) % 1) - 0.5) * scale(), box.height / 2 + (p.y - c.y) * scale()];
  };
  const line = nav ? (me ? nav.remaining() : nav.route ? nav.route.points : []) : [];
  if (line.length > 1) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const [width, colour] of [[10, '#ffffff'], [6, '#2f7cf6']]) {
      ctx.lineWidth = width;
      ctx.strokeStyle = colour;
      ctx.beginPath();
      line.forEach((place, i) => {
        const [px, py] = toScreen(place);
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      });
      ctx.stroke();
    }
  }
  if (dest) {
    const [px, py] = toScreen(dest);
    ctx.fillStyle = '#e53935';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py - 22, 10, Math.PI * 0.85, Math.PI * 2.15);
    ctx.lineTo(px, py);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px, py - 22, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!me) return;
  const [x, y] = toScreen(me);
  const metresPerPixel = 40075016.7 * Math.cos(me.lat * Math.PI / 180) / scale();
  const ring = Math.min(2000, (me.accuracy || 0) / metresPerPixel);
  if (ring > 10) {
    ctx.fillStyle = 'rgba(66, 133, 244, 0.15)';
    ctx.strokeStyle = 'rgba(66, 133, 244, 0.5)';
    ctx.beginPath();
    ctx.arc(x, y, ring, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = '#4285f4';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

// Draws the terminal look: MapSCII's cells, and the view's picture under them
async function drawCells() {
  const box = $('map').getBoundingClientRect();
  const columns = Math.max(4, Math.floor(box.width / CELL_W));
  const rows = Math.max(2, Math.floor(box.height / CELL_H));
  if (!size || size.columns !== columns || size.rows !== rows) {
    size = {columns, rows};
    renderer.setSize(columns * 2, rows * 4);
  }
  renderer.setView(state.view, rasters);
  renderer.heading = state.heading;
  renderer.photo3d = state.photo;
  layers.setView(layerView());
  renderer.setOverlays(overlays());
  const center = {lat: state.lat, lon: state.lon};
  if (state.view !== '3d') await renderer.draw(center, state.zoom, markers());
  const dpr = window.devicePixelRatio || 1;
  cells.width = Math.round(columns * CELL_W * dpr);
  cells.height = Math.round(rows * CELL_H * dpr);
  cells.style.width = `${columns * CELL_W}px`;
  cells.style.height = `${rows * CELL_H}px`;
  cells.style.left = `${(box.width - columns * CELL_W) / 2}px`;
  cells.style.top = `${(box.height - rows * CELL_H) / 2}px`;
  const ctx = cells.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const background = (renderer.styler.styleById.background || {paint: {}}).paint['background-color'] || '#000000';
  if (state.view === 'map') {
    CellPainter.paint(ctx, renderer.canvas.buffer, {cellW: CELL_W, cellH: CELL_H, background});
  } else {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, columns * CELL_W, rows * CELL_H);
    drawPicture(center, columns, rows);
    CellPainter.paintPicture(ctx, pictures.canvas.buffer, columns * CELL_W, rows * CELL_H);
    if (state.view !== '3d') CellPainter.paint(ctx, renderer.canvas.buffer, {cellW: CELL_W, cellH: CELL_H, background: null});
  }
  if (debug) debug.step = `painted ${columns}x${rows}, filled ${renderer.lastFrame ? renderer.lastFrame.filled.toFixed(3) : '-'}, missing ${renderer.missingTiles}, failed ${renderer.failedCount}, canvas ${cells.width}x${cells.height}`;
  cells.hidden = false;
  sharp.hidden = true;
}

// Renders the view's picture finer than the cells
function drawPicture(center, columns, rows) {
  const k = Math.pow(2, PICTURE_LEVELS);
  const width = columns * 2 * k;
  const height = rows * 4 * k;
  if (pictures.width !== width || pictures.height !== height) pictures.setSize(width, height);
  pictures.setView(state.view, rasters);
  pictures.canvas.clear();
  pictures.canvas.buffer.rasterTop = null;
  pictures.canvas.buffer.rasterBottom = null;
  if (state.view === '3d') {
    Terrain3D.render(pictures.canvas.buffer, {
      center, zoom: state.zoom, heading: state.heading, terrain: rasters.terrain, tint: Renderer.tint,
      columns: width >> 1, rows: height >> 2, detail: config.terrainDetail + 2, imagery: state.photo ? rasters.imagery : null,
    });
  } else {
    pictures._drawRaster(center, state.zoom + PICTURE_LEVELS);
  }
}

// never waits for the network: on a slow line the map fills in as tiles come
const sharpNow = {
  useStyler: (styler) => sharpSource.useStyler(styler),
  maxZoom: () => sharpSource.maxZoom(),
  // Tiles in memory at once; others load and count as missing for this frame
  getTile(z, x, y) {
    const tile = sharpSource.peekTile(z, x, y);
    if (tile) return Promise.resolve(tile);
    sharpSource.requestTile(z, x, y);
    // "no tile here" for this frame, not missing
    return Promise.reject(Object.assign(new Error('on its way'), {status: 404}));
  },
};

let sharpUrl = null;
// Draws the sharp look as SVG
async function drawSharp() {
  const box = $('map').getBoundingClientRect();
  const width = Math.round(box.width);
  const height = Math.round(box.height);
  // one SVG unit per CSS pixel: two zoom levels on from the cells
  layers.setView(layerView());
  sharpSource.beginFrame();
  const {svg} = await SvgMap.render(sharpNow, {center: {lat: state.lat, lon: state.lon}, zoom: state.zoom + 2, width, height, markers: markers(), overlays: overlays(), style: brightStyle});
  const url = URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml'}));
  await new Promise((resolve) => {
    sharp.onload = resolve;
    sharp.onerror = resolve;
    sharp.src = url;
  });
  if (sharpUrl) URL.revokeObjectURL(sharpUrl);
  sharpUrl = url;
  sharp.style.width = `${width}px`;
  sharp.style.height = `${height}px`;
  sharp.hidden = false;
  cells.hidden = true;
}

// ---- the bar: where, what loads, whose data ----

// Updates the bar: the plus code, what loads and the credits
function updateBar() {
  const code = PlusCode.encode(state.lat, state.lon);
  const loading = (state.look === 'sharp' && state.view === 'map' ? sharpSource.pending() : state.view === '3d' ? 0 : tileSource.pending()) +
    (state.view === 'map' ? 0 : pictures.pendingPictures());
  const credits = [];
  if (state.view === 'satellite' || state.view === 'hybrid' || (state.view === '3d' && state.photo)) credits.push('Imagery: Esri, Maxar, Earthstar Geographics');
  if (state.view === 'relief' || state.view === '3d') credits.push('Terrain: Mapzen/AWS');
  if (state.view !== '3d' && state.view !== 'satellite') credits.push(MAP_CREDIT);
  if (debug) {
    $('credits').textContent = JSON.stringify(Object.assign({}, debug, {cached: tileSource.cache.size, loading: tileSource.loading.size, failed: tileSource.failed.size, queue: tileSource.queue.length, template: tileSource.template}));
    $('credits').style.whiteSpace = 'normal';
  }
  $('where').textContent = message || `${code} · zoom ${state.zoom.toFixed(1)}${state.view === '3d' ? ` · looking ${compass(state.heading)}` : ''}${loading ? ` · loading ${loading}…` : ''}`;
  if (!debug) $('credits').textContent = credits.join(' · ');
  $('live').textContent = [layers.footer(), track.recording ? `● recording ${formatKm(track.km())}` : ''].filter(Boolean).join('  ');
  $('look').textContent = state.look === 'terminal' ? '▦ Terminal' : '◫ Sharp';
  $('view').value = state.view;
  $('turn').hidden = state.view !== '3d';
  $('locate').classList.toggle('on', follow);
  saveState();
}

// A heading as a compass point
function compass(heading) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(heading / 45) % 8];
}

// Shows a message in the bar for a while
function say(text, ms = 4000) {
  message = text;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    message = '';
    updateBar();
  }, ms);
  updateBar();
}

// ---- moving the map ----

// The world's width in CSS pixels at the current zoom
function scale() {
  return WORLD_CSS * Math.pow(2, state.zoom);
}

// Moves the map by CSS pixels
function moveBy(dx, dy) {
  const c = utils.ll2tile(state.lon, state.lat, 0);
  setCenter(c.x - dx / scale(), c.y - dy / scale());
}

// Centres the map on world coordinates (0..1)
function setCenter(wx, wy) {
  const y = Math.max(0, Math.min(1, wy));
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
  const lon = ((wx * 360 - 180) % 360 + 540) % 360 - 180;
  state.lat = lat;
  state.lon = lon;
  requestDraw();
}

// keeps the point at (sx, sy) in place
function zoomBy(levels, sx = null, sy = null) {
  const box = $('map').getBoundingClientRect();
  const ox = sx === null ? 0 : sx - box.left - box.width / 2;
  const oy = sy === null ? 0 : sy - box.top - box.height / 2;
  const c = utils.ll2tile(state.lon, state.lat, 0);
  const px = c.x + ox / scale();
  const py = c.y + oy / scale();
  state.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom + levels));
  setCenter(px - ox / scale(), py - oy / scale());
}

const pointers = new Map();
let pinch = null;
// a tap neither moves nor lasts
let touchStart = null;
let lastTap = null;
const surface = $('map');
// touches on the buttons are not map gestures
const onControl = (e) => !!(e.target && e.target.closest && e.target.closest('button, select, input, a'));
surface.addEventListener('pointerdown', (e) => {
  if (onControl(e)) return;
  // a first finger starts a new gesture; a lift that went unnoticed (after a pinch) is forgotten
  if (e.isPrimary) pointers.clear();
  surface.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
  touchStart = pointers.size === 1 ? {x: e.clientX, y: e.clientY, at: Date.now(), moved: false} : null;
  pinch = null;
});
surface.addEventListener('pointermove', (e) => {
  const before = pointers.get(e.pointerId);
  if (!before) return;
  const now = {x: e.clientX, y: e.clientY};
  if (touchStart && Math.hypot(now.x - touchStart.x, now.y - touchStart.y) > 10) touchStart.moved = true;
  if (pointers.size === 1) {
    if (follow && Math.hypot(now.x - before.x, now.y - before.y) > 2) follow = false;
    moveBy(now.x - before.x, now.y - before.y);
  } else if (pointers.size === 2) {
    pointers.set(e.pointerId, now);
    const [a, b] = [...pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
    if (pinch) {
      moveBy(mid.x - pinch.mid.x, mid.y - pinch.mid.y);
      zoomBy(Math.log2(distance / pinch.distance), mid.x, mid.y);
    }
    pinch = {distance, mid};
    return;
  }
  pointers.set(e.pointerId, now);
});
// A finger lifted or cancelled: forgets it and ends a pinch
const lift = (e) => {
  pointers.delete(e.pointerId);
  pinch = null;
};
surface.addEventListener('pointerup', (e) => {
  if (onControl(e)) return;
  const wasTap = touchStart && !touchStart.moved && Date.now() - touchStart.at < 300 && pointers.size === 1;
  lift(e);
  if (!wasTap) {
    touchStart = null;
    return;
  }
  if (lastTap && Date.now() - lastTap.at < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
    zoomBy(1, e.clientX, e.clientY);
    lastTap = null;
  } else {
    lastTap = {x: e.clientX, y: e.clientY, at: Date.now()};
  }
  touchStart = null;
});
surface.addEventListener('pointercancel', lift);
surface.addEventListener('lostpointercapture', lift);
surface.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomBy(-e.deltaY * 0.0025, e.clientX, e.clientY);
}, {passive: false});
window.addEventListener('resize', () => requestDraw());

// ---- the buttons ----

$('zoomin').onclick = () => zoomBy(1);
$('zoomout').onclick = () => zoomBy(-1);
// Switches between the terminal and the sharp look
$('look').onclick = () => {
  state.look = state.look === 'terminal' ? 'sharp' : 'terminal';
  if (state.look === 'sharp' && state.view !== 'map') say('The sharp look draws the map view; the picture views stay in cells');
  requestDraw();
};
for (const [value, name] of VIEWS) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = name;
  $('view').appendChild(option);
}
// Switches the view
$('view').onchange = () => {
  state.view = $('view').value;
  const about = {satellite: 'Satellite imagery: about 25 KB a picture tile', hybrid: 'Satellite imagery with roads', relief: 'Relief: elevation tiles, about 150 KB each', '3d': '3D: turn with ⟲ ⟳; Photo for satellite colours'};
  if (about[state.view]) say(about[state.view]);
  requestDraw();
};
// Turns the 3D view left
$('left').onclick = () => {
  state.heading = (state.heading + 340) % 360;
  requestDraw();
};
// Turns the 3D view right
$('right').onclick = () => {
  state.heading = (state.heading + 20) % 360;
  requestDraw();
};
// Switches the 3D colours between height and satellite
$('photo').onclick = () => {
  state.photo = !state.photo;
  say(state.photo ? '3D in satellite colours' : '3D in height colours');
  requestDraw();
};

// asked for the first time ◎ is pressed
let watching = false;
// Follows the phone's position, asking for it the first time
$('locate').onclick = () => {
  if (!('geolocation' in navigator)) return say('This browser gives no position');
  follow = true;
  if (me) {
    state.lat = me.lat;
    state.lon = me.lon;
    state.zoom = Math.max(state.zoom, 15);
    requestDraw();
  } else {
    say('Finding your position…', 10000);
  }
  if (watching) return;
  watching = true;
  navigator.geolocation.watchPosition((pos) => {
    const first = !me;
    me = {lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy};
    track.add({lat: me.lat, lon: me.lon, altitude: pos.coords.altitude === null ? undefined : pos.coords.altitude, time: new Date(pos.timestamp || Date.now()).toISOString()});
    if (follow) {
      state.lat = me.lat;
      state.lon = me.lon;
      if (first) state.zoom = Math.max(state.zoom, 15);
    }
    if (first) say(`Found you (within ${Math.round(me.accuracy)} m)`);
    if (nav) {
      if (first) follow = true;
      nav.update(me);
      guide();
      updateNav();
    }
    if (dest) updateDest();
    requestDraw();
  }, (error) => {
    // only a refused permission stops watching; a lost signal keeps the last position
    if (error.code === 1) {
      watching = false;
      follow = false;
      say('No permission for the position: allow it in the browser\'s site settings', 8000);
    } else {
      say(me ? 'GPS signal lost: showing the last position' : 'No position yet (is location on?)', 5000);
    }
  }, {enableHighAccuracy: true, maximumAge: 5000});
};

const KINDS = {note: 'your note', country: 'country', state: 'region', city: 'city', town: 'town', village: 'village', water: 'water', airport: 'airport', station: 'station', place: 'place', sight: 'place', street: 'street'};
// Lists the search results for the query
function showResults() {
  const text = $('query').value.trim();
  const list = $('results');
  list.textContent = '';
  const found = text.length >= 2 ? [
    ...notes.search(text).slice(0, 3).map((n) => ({name: n.title, kind: 'note', lat: n.lat, lon: n.lon, zoom: 17})),
    ...layers.search(text).slice(0, 3),
    ...placeIndex.search(text, {near: {lat: state.lat, lon: state.lon}, limit: 8}),
  ].slice(0, 10) : [];
  for (const place of found) {
    const li = document.createElement('li');
    li.textContent = place.name;
    const kind = document.createElement('small');
    const km = distanceKm({lat: state.lat, lon: state.lon}, place);
    kind.textContent = `${KINDS[place.kind] || place.kind} · ${formatKm(km)}`;
    li.appendChild(kind);
    li.onclick = () => choose(place);
    list.appendChild(li);
  }
  list.hidden = !found.length;
}
let typing = null;
$('query').addEventListener('input', () => {
  clearTimeout(typing);
  typing = setTimeout(showResults, 150);
});
// Enter in the search: goes to the place typed (coordinates, a plus code or a name)
$('search').onsubmit = (e) => {
  e.preventDefault();
  const input = $('query');
  try {
    choose(resolvePlace(input.value, {near: {lat: state.lat, lon: state.lon}, placeIndex}));
  } catch (error) {
    say(/don't know/.test(error.message) ?
      `"${input.value}" isn't in the maps seen yet: names come from the maps you have looked at (${placeIndex.size()} so far)` : error.message, 7000);
  }
};

// Goes to a search result and makes it the destination, unless it is in the sky or underground
function choose(place) {
  state.lat = place.lat;
  state.lon = place.lon;
  state.zoom = place.zoom || Math.max(state.zoom, 15);
  follow = false;
  $('query').blur();
  $('results').hidden = true;
  if (place.onSelect) place.onSelect();
  // things in the sky or underground are shown, not routed to
  if (['satellite', 'earthquake', 'aircraft'].includes(place.kind)) {
    requestDraw();
    return;
  }
  setDest({lat: place.lat, lon: place.lon, name: place.name || null});
}

// ---- destination, route, navigation ----

let dest = null;
let nav = null;
let guidance = null;
let wakeLock = null;

// The distance between two places in km
function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// "120 m", "1.4 km"
function formatKm(km) {
  return km < 1 ? `${Math.max(10, Math.round(km * 100) * 10)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

// Sets the destination (null: none)
function setDest(place) {
  dest = place;
  if (dest && !dest.name) dest.name = PlusCode.encode(dest.lat, dest.lon);
  updateDest();
  requestDraw();
}

// Shows or hides the destination bar
function updateDest() {
  const bar = $('destbar');
  bar.hidden = !dest || !!nav;
  if (!dest) return;
  const from = me || {lat: state.lat, lon: state.lon};
  $('destname').textContent = `📍 ${dest.name} · ${formatKm(distanceKm(from, dest))}${me ? '' : ' from the middle'}`;
  $('mode').value = state.mode;
}

// The way of travelling for routes
$('mode').onchange = () => {
  state.mode = $('mode').value;
  saveState();
};
$('cleardest').onclick = () => setDest(null);
$('go').onclick = () => startRoute();
$('stop').onclick = () => stopRoute();
// Switches the voice on or off
$('voice').onclick = () => {
  state.voice = !state.voice;
  if (!state.voice && 'speechSynthesis' in window) speechSynthesis.cancel();
  if (state.voice && guidance) {
    guidance.said.clear();
    guide();
  }
  updateNav();
  saveState();
};

let pressTimer = null;
let pressAt = null;
surface.addEventListener('pointerdown', (e) => {
  clearTimeout(pressTimer);
  if (onControl(e)) return;
  pressAt = {x: e.clientX, y: e.clientY};
  pressTimer = setTimeout(() => {
    // not while navigating
    if (!pressAt || pointers.size !== 1 || nav) return;
    const box = surface.getBoundingClientRect();
    const c = utils.ll2tile(state.lon, state.lat, 0);
    const wx = c.x + (pressAt.x - box.left - box.width / 2) / scale();
    const wy = c.y + (pressAt.y - box.top - box.height / 2) / scale();
    if (navigator.vibrate) navigator.vibrate(30);
    setDest({lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) * 180 / Math.PI, lon: ((wx * 360 - 180) % 360 + 540) % 360 - 180, name: null});
  }, 600);
});
surface.addEventListener('pointermove', (e) => {
  if (pressAt && Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > 8) {
    clearTimeout(pressTimer);
    pressAt = null;
  }
});
surface.addEventListener('pointerup', () => {
  clearTimeout(pressTimer);
  pressAt = null;
});

// from the GPS position, else from the middle of the map
function startRoute() {
  if (!dest) return;
  // some phones only allow speech that starts from a tap: say something silent now
  if (state.voice && 'speechSynthesis' in window) {
    const unlock = new SpeechSynthesisUtterance(' ');
    unlock.volume = 0;
    speechSynthesis.speak(unlock);
  }
  if (nav) nav.stopped = true;
  const mode = state.mode;
  const navigatorObject = new Navigator(new Router(tileSource), dest, {
    mode,
    onChange: () => {
      if (navigatorObject.stopped) return;
      guide();
      updateNav();
      requestDraw();
    },
  });
  nav = navigatorObject;
  guidance = new Guidance(mode, dest.name);
  if (me) follow = true;
  nav.plan(me || {lat: state.lat, lon: state.lon});
  keepScreenOn(true);
  updateNav();
  updateDest();
}

// Ends the route and navigation
function stopRoute() {
  if (nav) nav.stopped = true;
  nav = null;
  guidance = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  keepScreenOn(false);
  updateNav();
  updateDest();
  requestDraw();
}

// Updates the navigation banner
function updateNav() {
  $('nav').hidden = !nav;
  $('search').hidden = !!nav;
  $('voice').textContent = state.voice ? '🔊' : '🔇';
  if (!nav) return;
  const s = nav.state;
  let top;
  let bottom = '';
  if (s.status === 'planning' || s.status === 'rerouting') {
    top = s.status === 'planning' ? 'Planning the route…' : 'Off the route: a new one…';
  } else if (s.status === 'failed') {
    top = 'No route';
    bottom = s.error;
  } else if (s.status === 'arrived') {
    top = `You have arrived${dest && dest.name ? ` at ${dest.name}` : ''}`;
  } else if (!me) {
    top = `${formatKm(nav.route.km)} · ${Math.max(1, Math.round(nav.route.minutes))} min by ${state.mode}`;
    bottom = 'The way from the middle of the map: ◎ for live navigation';
  } else {
    top = /^head /i.test(s.next) ? s.next : `${s.in < 0.03 ? 'Now' : `In ${formatKm(s.in)}`}: ${s.next}`;
    bottom = `${formatKm(s.left)} · ${Math.max(1, Math.round(s.minutes))} min left${s.status === 'off route' ? ' · off the route' : ''}`;
  }
  $('navnext').textContent = top;
  $('navleft').textContent = bottom;
}

// Says what is due now, with the phone's own speech
function guide() {
  if (!nav || !guidance) return;
  if (!me && nav.state.status !== 'failed') return;
  const text = guidance.update(nav.state, nav.route);
  if (!text || !state.voice || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en';
  speechSynthesis.speak(utterance);
}

// Keeps the screen on while navigating, where the browser allows it
async function keepScreenOn(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (error) {
    wakeLock = null;
  }
}

// ---- the menu: live layers, notes, the track, files ----

// Opens the menu
$('menu').onclick = () => {
  renderPanel();
  $('panel').hidden = false;
};
// Closes the menu
$('closepanel').onclick = () => {
  $('panel').hidden = true;
};

// Creates an element with attributes and children
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node[key] = value;
    else if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) if (child !== null && child !== undefined) node.append(child);
  return node;
}

// the pin, else your position, else the middle
function notePlace() {
  if (dest) return {place: dest, where: 'at the 📍'};
  if (me) return {place: me, where: 'at your position'};
  return {place: {lat: state.lat, lon: state.lon}, where: 'in the middle of the map'};
}

// Fills the menu: layers, notes, the track, files and credits
function renderPanel() {
  const body = $('panelbody');
  body.textContent = '';
  body.append(el('h3', {}, 'Live layers'));
  for (const layer of layers.layers) {
    const box = el('input', {type: 'checkbox'});
    box.checked = layer.on;
    box.disabled = !!layer.browserBlocked;
    box.onchange = () => {
      layers.toggle(layer.id);
      renderPanel();
    };
    body.append(el('label', {class: 'row'}, box, el('div', {class: 'text'}, layer.name.charAt(0).toUpperCase() + layer.name.slice(1),
      el('small', {'data-layer': layer.id}, layerText(layer)))));
  }
  const mine = notes.list();
  const {where} = notePlace();
  body.append(el('h3', {}, `Notes (${mine.length})`));
  body.append(el('div', {class: 'buttons'},
    el('button', {onclick: addNote}, `＋ Note ${where}`),
    mine.length ? el('button', {onclick: () => share('notes.geojson', notes.geojson(), 'application/geo+json')}, 'Export (GeoJSON)') : null,
    mine.length ? el('button', {onclick: () => share('notes.gpx', FieldNotes.toGPX(mine), 'application/gpx+xml')}, 'Export (GPX)') : null));
  for (const note of mine.slice().reverse().slice(0, 50)) {
    body.append(el('div', {class: 'row'},
      el('div', {class: 'text', onclick: () => goTo(note.lat, note.lon, 17)}, `${config.noteMarker} ${note.title}`, el('small', {}, `${note.text ? `${note.text} · ` : ''}${PlusCode.encode(note.lat, note.lon)}`)),
      el('button', {'aria-label': 'Delete', onclick: () => {
        if (!confirm(`Delete the note "${note.title}"?`)) return;
        notes.remove(note.id);
        renderPanel();
        requestDraw();
      }}, '✕')));
  }
  body.append(el('h3', {}, 'Your track'));
  body.append(el('p', {}, track.points.length ? `${track.points.length} points, ${formatKm(track.km())}${track.recording ? ', recording' : ''}` : track.recording ? 'Recording: points come with the GPS (◎)' : 'Records the way you go, as a GPX file.'));
  body.append(el('div', {class: 'buttons'},
    el('button', {class: track.recording ? 'on' : '', onclick: () => {
      if (track.recording) track.stop();
      else {
        track.start();
        if (!watching) $('locate').onclick();
      }
      renderPanel();
      updateBar();
    }}, track.recording ? '■ Stop recording' : '● Record'),
    track.points.length > 1 ? el('button', {onclick: () => share(`track-${new Date().toISOString().slice(0, 10)}.gpx`, track.gpx(), 'application/gpx+xml')}, 'Save (GPX)') : null,
    track.points.length ? el('button', {onclick: () => {
      if (!confirm('Clear the recorded track?')) return;
      track.clear();
      renderPanel();
      requestDraw();
    }}, 'Clear') : null));
  body.append(el('h3', {}, 'Files'));
  body.append(el('p', {}, 'Open GPX tracks and waypoints to see them on the map, or a notes.geojson (from MapSCII or another phone) to add its notes.'));
  body.append(el('div', {class: 'buttons'}, el('button', {onclick: () => $('file').click()}, 'Open GPX / GeoJSON…')));
  for (const file of opened) {
    body.append(el('div', {class: 'row'},
      el('div', {class: 'text', onclick: () => {
        const all = [...file.lines.flat(), ...file.points];
        if (all.length) goTo(all[0].lat, all[0].lon, 14);
      }}, `◆ ${file.name}`, el('small', {}, `${file.lines.length} track${file.lines.length === 1 ? '' : 's'}, ${file.points.length} point${file.points.length === 1 ? '' : 's'}`)),
      el('button', {'aria-label': 'Remove', onclick: () => {
        opened = opened.filter((other) => other !== file);
        saveOpened();
        renderPanel();
        requestDraw();
      }}, '✕')));
  }
  body.append(el('h3', {}, 'About'));
  body.append(el('p', {}, 'Built on MapSCII by Michael Straßburger and the MapSCII authors (MIT licence). Map data © OpenStreetMap contributors; tiles by OpenMapTiles and OpenFreeMap; imagery by Esri, Maxar, Earthstar Geographics; terrain from the Mapzen terrain tiles on AWS; satellites from CelesTrak, earthquakes from the USGS, weather by Open-Meteo.com. ',
    el('a', {href: 'dist/LICENSES.txt', target: '_blank', style: 'color: var(--accent)'}, 'Licences')));
}

const LAYER_ABOUT = {satellites: 'space stations and bright satellites, moving live (~30 KB a day)', quakes: 'earthquakes of M2.5 and up in the last 24 hours (USGS)',
  aircraft: 'only in the APK version: the servers don\'t allow browsers', weather: 'the weather in the middle of the map (Open-Meteo)'};
// A layer's line in the menu
function layerText(layer) {
  return layer.on && layer.footer() ? layer.footer() : LAYER_ABOUT[layer.id] || '';
}

// only the layer lines update, so the menu doesn't jump while scrolling
function updatePanelLayers() {
  for (const small of document.querySelectorAll('#panelbody small[data-layer]')) {
    const layer = layers.get(small.dataset.layer);
    if (layer) small.textContent = layerText(layer);
  }
}

// Centres the map on a place
function goTo(lat, lon, zoom) {
  state.lat = lat;
  state.lon = lon;
  state.zoom = Math.max(state.zoom, zoom);
  follow = false;
  $('panel').hidden = true;
  requestDraw();
}

// Adds a note at the pin, the position or the middle of the map
function addNote() {
  const {place, where} = notePlace();
  const title = prompt(`A note ${where} - its title:`);
  if (!title || !title.trim()) return;
  const text = prompt('Details (optional):') || '';
  try {
    notes.add({lat: place.lat, lon: place.lon, title, text});
    say(`Noted "${title.trim()}"`);
  } catch (error) {
    say(error.message, 6000);
  }
  renderPanel();
  requestDraw();
}

// the share sheet where there is one, else a download
async function share(name, text, type) {
  const file = new File([text], name, {type});
  try {
    if (navigator.canShare && navigator.canShare({files: [file]})) {
      await navigator.share({files: [file], title: name});
      return;
    }
  } catch (error) {
    if (error && error.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(file);
  const link = el('a', {href: url, download: name});
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Opens files: GPX onto the map, GeoJSON notes into the notebook
$('file').onchange = async () => {
  const files = [...$('file').files];
  $('file').value = '';
  for (const file of files) {
    try {
      const text = await file.text();
      if (/^\s*[{[]/.test(text)) {
        const {added, updated} = notes.merge(FieldNotes.fromGeoJSON(JSON.parse(text)));
        say(`${file.name}: ${added} new note${added === 1 ? '' : 's'}${updated ? `, ${updated} updated` : ''}`, 5000);
      } else {
        const gpx = Gpx.parse(text);
        const lines = [...gpx.tracks, ...(gpx.routes || [])].map((t) => t.points).filter((points) => points.length > 1);
        const points = (gpx.waypoints || []).map((w) => ({lat: w.lat, lon: w.lon, name: w.name || ''}));
        if (!lines.length && !points.length) throw new Error('no tracks or points in it');
        opened = opened.filter((other) => other.name !== file.name).concat({name: file.name, lines, points});
        saveOpened();
        const first = lines.length ? lines[0][0] : points[0];
        goTo(first.lat, first.lon, 13);
        say(`${file.name}: ${lines.length} track${lines.length === 1 ? '' : 's'}, ${points.length} point${points.length === 1 ? '' : 's'}`, 5000);
      }
    } catch (error) {
      say(`${file.name}: ${error.message}`, 7000);
    }
  }
  renderPanel();
  requestDraw();
};

// The files opened last time
function loadOpened() {
  try {
    const saved = JSON.parse(localStorage.getItem('opened-files') || '[]');
    return Array.isArray(saved) ? saved.filter((f) => f && Array.isArray(f.lines) && Array.isArray(f.points)) : [];
  } catch (error) {
    return [];
  }
}

// Saves the opened files
function saveOpened() {
  try {
    localStorage.setItem('opened-files', JSON.stringify(opened));
  } catch (error) {
    // too big to keep: shown until the app is closed
    say('The file is shown, but too big to keep for next time', 5000);
  }
}

// ---- remembered between visits ----

// The map's state from last time
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem('map-state') || '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch (error) {
    return {};
  }
}

let saveTimer = null;
// Saves the map's state a moment later
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem('map-state', JSON.stringify(state));
    } catch (error) {
      void 0;
    }
  }, 500);
}

// ---- start ----

// ?local tests run without it unless ?sw asks for it
if ('serviceWorker' in navigator && (!local || params.has('sw'))) {
  navigator.serviceWorker.register('sw.js').catch(() => null);
}

// the browser releases the wake lock when the app is hidden
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  requestDraw();
  if (nav) {
    wakeLock = null;
    keepScreenOn(true);
  }
});

placeIndex.open();
layers.restoreSaved();
if (debug) {
  window.app = {state, notes, track, layers, placeIndex, tileSource, renderer, overlays, share: (...args) => share(...args)};
  Object.defineProperty(window.app, 'nav', {get: () => nav});
  Object.defineProperty(window.app, 'dest', {get: () => dest});
  Object.defineProperty(window.app, 'me', {get: () => me});
  Object.defineProperty(window.app, 'debug', {get: () => debug});
}
// retried every 15 s while unreachable, e.g. a first start offline
function startSources() {
  Promise.all([tileSource.init(), sharpSource.init()]).then(() => requestDraw(), (error) => {
    say(`${error.message} - trying again`, 14000);
    setTimeout(startSources, 15000);
  });
}
startSources();
updateBar();
