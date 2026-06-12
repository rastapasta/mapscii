import { Worker } from 'worker_threads';

import Styler from './Styler';
import { SerializedTileLayer } from './Tile';

type PendingJob = {
  resolve: (layers: Record<string, SerializedTileLayer>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

interface WorkerResponse {
  id: number;
  layers?: Record<string, SerializedTileLayer>;
  error?: string;
}

const WORKER_SOURCE = `
const { parentPort } = require('worker_threads');
const { gunzip } = require('zlib');
const { promisify } = require('util');
const gunzipAsync = promisify(gunzip);

let modulesPromise;
function loadModules() {
  if (!modulesPromise) {
    modulesPromise = Promise.all([
      import('@mapbox/vector-tile'),
      import('pbf')
    ]).then(([vectorTileModule, pbfModule]) => ({
      VectorTile: vectorTileModule.VectorTile,
      Pbf: pbfModule.default || pbfModule
    }));
  }
  return modulesPromise;
}

function isGzipped(buffer) {
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

function filterValueEquals(a, b) {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (typeof a !== typeof b && (typeof a !== 'object' && typeof b !== 'object')) {
    return String(a) === String(b);
  }
  return false;
}

function compileFilter(filter) {
  if (!filter || filter[0] === undefined) return () => true;
  let filters;
  switch (filter[0]) {
    case 'all':
      filters = filter.slice(1).map(compileFilter);
      return (feature) => !filters.find((appliesTo) => !appliesTo(feature));
    case 'any':
      filters = filter.slice(1).map(compileFilter);
      return (feature) => !!filters.find((appliesTo) => appliesTo(feature));
    case 'none':
      filters = filter.slice(1).map(compileFilter);
      return (feature) => !filters.find((appliesTo) => appliesTo(feature));
    case '==':
      return (feature) => filterValueEquals(feature.properties[filter[1]], filter[2]);
    case '!=':
      return (feature) => !filterValueEquals(feature.properties[filter[1]], filter[2]);
    case 'in':
      return (feature) => !!filter.slice(2).find((value) => filterValueEquals(feature.properties[filter[1]], value));
    case '!in':
      return (feature) => !filter.slice(2).find((value) => filterValueEquals(feature.properties[filter[1]], value));
    case 'has':
      return (feature) => !!feature.properties[filter[1]];
    case '!has':
      return (feature) => !feature.properties[filter[1]];
    case '>':
      return (feature) => feature.properties[filter[1]] > filter[2];
    case '>=':
      return (feature) => feature.properties[filter[1]] >= filter[2];
    case '<':
      return (feature) => feature.properties[filter[1]] < filter[2];
    case '<=':
      return (feature) => feature.properties[filter[1]] <= filter[2];
    default:
      return () => true;
  }
}

function replaceConstants(constants, tree) {
  if (!tree) return;
  if (Array.isArray(tree)) {
    for (let i = 0; i < tree.length; i++) {
      const node = tree[i];
      if (typeof node === 'object' && node !== null) replaceConstants(constants, node);
      else if (typeof node === 'string' && node.charAt(0) === '@') tree[i] = constants[node];
    }
    return;
  }
  if (typeof tree === 'object') {
    for (const id in tree) {
      const node = tree[id];
      if (typeof node === 'object' && node !== null) replaceConstants(constants, node);
      else if (typeof node === 'string' && node.charAt(0) === '@') tree[id] = constants[node];
    }
  }
}

function createStyler(style) {
  const styleById = {};
  const styleByLayer = {};
  if (style.constants) replaceConstants(style.constants, style.layers);
  for (const layer of style.layers) {
    if (layer.ref && styleById[layer.ref]) {
      const refLayer = styleById[layer.ref];
      for (const ref of ['type', 'source-layer', 'minzoom', 'maxzoom', 'filter']) {
        if (refLayer[ref] !== undefined && layer[ref] === undefined) layer[ref] = refLayer[ref];
      }
    }
    layer.appliesTo = compileFilter(layer.filter);
    const sourceLayer = layer['source-layer'];
    if (sourceLayer !== undefined) {
      if (!styleByLayer[sourceLayer]) styleByLayer[sourceLayer] = [];
      styleByLayer[sourceLayer].push(layer);
    }
    styleById[layer.id] = layer;
  }
  return {
    getStyleFor(layer, feature) {
      if (!styleByLayer[layer]) return false;
      for (const styleLayer of styleByLayer[layer]) {
        if (styleLayer.appliesTo && styleLayer.appliesTo(feature)) return styleLayer;
      }
      return false;
    }
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseHexColor(hex) {
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex;
  const value = normalized.length === 3
    ? normalized.split('').map((part) => part + part).join('')
    : normalized;
  if (!/^[0-9a-f]{6}$/i.test(value)) return null;
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function toHex(value) {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
}

function interpolateColor(a, b, t) {
  const start = parseHexColor(a);
  const end = parseHexColor(b);
  if (!start || !end) return t < 1 ? a : b;
  return '#' + toHex(start[0] + (end[0] - start[0]) * t)
    + toHex(start[1] + (end[1] - start[1]) * t)
    + toHex(start[2] + (end[2] - start[2]) * t);
}

function resolveStyleValue(value, zoom, fallback) {
  if (value === undefined) return fallback;
  if (!value || typeof value !== 'object' || !Array.isArray(value.stops)) return value;
  const stops = value.stops.slice().sort((a, b) => a[0] - b[0]);
  if (!stops.length) return fallback;
  if (zoom <= stops[0][0]) return stops[0][1];
  for (let index = 1; index < stops.length; index++) {
    const previous = stops[index - 1];
    const next = stops[index];
    if (zoom <= next[0]) {
      const range = next[0] - previous[0];
      const t = range === 0 ? 1 : clamp((zoom - previous[0]) / range, 0, 1);
      if (typeof previous[1] === 'number' && typeof next[1] === 'number') {
        return previous[1] + (next[1] - previous[1]) * t;
      }
      if (typeof previous[1] === 'string' && typeof next[1] === 'string') {
        return interpolateColor(previous[1], next[1], t);
      }
      return t < 1 ? previous[1] : next[1];
    }
  }
  return stops[stops.length - 1][1];
}

function addBoundaries(deep, data) {
  let minX = Number.MAX_VALUE;
  let maxX = -Number.MAX_VALUE;
  let minY = Number.MAX_VALUE;
  let maxY = -Number.MAX_VALUE;
  const rings = deep ? data.points : [data.points];
  for (const ring of rings) {
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  data.minX = minX;
  data.maxX = maxX;
  data.minY = minY;
  data.maxY = maxY;
  return data;
}

function parseTile(vectorTile, styler, zoom, language) {
  const layers = {};
  for (const name in vectorTile.layers) {
    const layer = vectorTile.layers[name];
    const features = [];
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      feature.properties.$type = [undefined, 'Point', 'LineString', 'Polygon'][feature.type];
      const geomType = feature.properties.$type;
      const styleLayer = styler.getStyleFor(name, feature);
      if (!styleLayer) continue;
      const rawColor = styleLayer.paint && (
        styleLayer.paint['line-color'] ||
        styleLayer.paint['fill-color'] ||
        styleLayer.paint['text-color']
      );
      if (!rawColor) continue;
      const colorHex = resolveStyleValue(rawColor, zoom, '#ffffff');
      const geometries = feature.loadGeometry();
      const sort = feature.properties.localrank || feature.properties.scalerank;
      const label = styleLayer.type === 'symbol'
        ? feature.properties['name_' + language] || feature.properties.name_en || feature.properties.name || feature.properties.house_num
        : undefined;
      // Features reference the style layer by id only: shipping a style
      // object per feature through structured clone is what made the worker
      // path slower than main-thread parsing.
      const base = {
        id: feature.id,
        layer: name,
        styleId: styleLayer.id,
        geomType,
        label,
        sort,
        colorHex,
        minX: 0,
        maxX: 0,
        minY: 0,
        maxY: 0,
      };
      if (styleLayer.type === 'fill') {
        features.push(addBoundaries(true, { ...base, points: geometries }));
      } else {
        for (const points of geometries) {
          features.push(addBoundaries(false, { ...base, points }));
        }
      }
    }
    if (features.length) {
      layers[name] = { extent: layer.extent, features };
    }
  }
  return layers;
}

// The style is sent ONCE (and again only when it changes); the compiled
// styler is reused for every subsequent parse message.
let compiledStyler = null;

parentPort.on('message', async (message) => {
  if (message.type === 'style') {
    try {
      compiledStyler = createStyler(message.style);
    } catch {
      compiledStyler = null;
    }
    return;
  }
  if (message.type !== 'parse') return;

  try {
    if (!compiledStyler) throw new Error('Tile worker has no style configured');
    const { VectorTile, Pbf } = await loadModules();
    let buffer = Buffer.from(message.buffer);
    if (isGzipped(buffer)) buffer = await gunzipAsync(buffer);
    const vectorTile = new VectorTile(new Pbf(buffer));
    const layers = parseTile(vectorTile, compiledStyler, message.zoom, message.language || 'en');
    parentPort.postMessage({ id: message.id, layers });
  } catch (error) {
    parentPort.postMessage({ id: message.id, error: error && error.message ? error.message : String(error) });
  }
});
`;

function serializableStyle(styler: Styler) {
  return JSON.parse(JSON.stringify(styler.style, (key, value) => {
    return key === 'appliesTo' ? undefined : value;
  }));
}

const JOB_TIMEOUT_MS = 10000;
const MAX_CONSECUTIVE_FAILURES = 3;

export default class TileWorkerPool {
  private static worker: Worker | null = null;
  private static nextId: number = 1;
  private static pending: Map<number, PendingJob> = new Map();
  private static disabled: boolean = false;
  private static consecutiveFailures: number = 0;
  // Styler instance the current worker has already received
  private static styleSentFor: Styler | null = null;

  static async parse(
    buffer: Buffer,
    zoom: number,
    styler: Styler,
    language: string
  ): Promise<Record<string, SerializedTileLayer>> {
    if (this.disabled) {
      throw new Error('Tile worker disabled');
    }

    const worker = this._getWorker();

    // Send the style only when it changes (or the worker was recreated):
    // serializing the whole style per tile made the worker path slower
    // than parsing on the main thread.
    if (this.styleSentFor !== styler) {
      worker.postMessage({ type: 'style', style: serializableStyle(styler) });
      this.styleSentFor = styler;
    }

    const id = this.nextId++;
    const arrayBuffer = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(arrayBuffer).set(buffer);

    return new Promise((resolve, reject) => {
      // A hung worker must not leave tile loads pending forever: time out,
      // fail everything in flight, and recycle the worker.
      const timer = setTimeout(() => {
        const wedged = this.worker;
        this._failAll(new Error('Tile worker timed out'));
        if (wedged) void wedged.terminate();
      }, JOB_TIMEOUT_MS);
      timer.unref?.();

      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({
        type: 'parse',
        id,
        buffer: arrayBuffer,
        zoom,
        language,
      }, [arrayBuffer]);
    });
  }

  private static _getWorker(): Worker {
    if (this.worker) return this.worker;

    this.worker = new Worker(WORKER_SOURCE, { eval: true });
    this.styleSentFor = null;
    this.worker.unref();
    this.worker.on('message', (message: WorkerResponse) => this._onMessage(message));
    this.worker.on('error', (error) => this._failAll(error));
    this.worker.on('exit', (code) => {
      if (code !== 0) this._failAll(new Error(`Tile worker exited with code ${code}`));
      this.worker = null;
      this.styleSentFor = null;
    });

    return this.worker;
  }

  private static _onMessage(message: WorkerResponse): void {
    const job = this.pending.get(message.id);
    if (!job) return;

    this.pending.delete(message.id);
    clearTimeout(job.timer);
    if (message.error) {
      // A single bad tile is not a worker-health problem; the caller falls
      // back to main-thread parsing for it.
      job.reject(new Error(message.error));
    } else {
      this.consecutiveFailures = 0;
      job.resolve(message.layers || {});
    }
  }

  private static _failAll(error: Error): void {
    // Idempotent: error + exit for the same incident must only count once.
    if (!this.worker && this.pending.size === 0) return;

    for (const job of this.pending.values()) {
      clearTimeout(job.timer);
      job.reject(error);
    }
    this.pending.clear();
    this.worker = null;
    this.styleSentFor = null;

    // Only give up on the worker after repeated failures - a one-off crash
    // shouldn't disable off-thread parsing for the whole session.
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.disabled = true;
    }
  }
}
