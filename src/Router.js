// Offline routing on the map tiles' road lines. No turn restrictions or traffic, so routes are estimates.
'use strict';
const fs = require('fs');
const path = require('path');
const utils = require('./utils');
const Gpx = require('./Gpx');
const Styler = require('./Styler');

// km/h by road class; null: not allowed
const SPEEDS = {
  car: {motorway: 90, trunk: 70, primary: 55, secondary: 45, tertiary: 40, street: 25, service: 15, path: null, oneway: true},
  // town main roads have pavements and cycle lanes; only motorways are out
  bike: {motorway: null, trunk: 16, primary: 18, secondary: 18, tertiary: 18, street: 16, service: 14, path: 12},
  foot: {motorway: null, trunk: 4.5, primary: 4.5, secondary: 4.5, tertiary: 4.5, street: 4.5, service: 4.5, path: 4.5},
};

// A feature's road class, by its style id, or null if it isn't a road
function roadClass(feature) {
  const id = (feature.style && feature.style.id) || '';
  if (/rail|ferry|aeroway|runway|taxiway/.test(id)) return null;
  if (/motorway/.test(id) && !/link/.test(id)) return 'motorway';
  if (/trunk|primary/.test(id)) return /trunk/.test(id) ? 'trunk' : 'primary';
  if (/secondary|tertiary/.test(id)) return 'secondary';
  if (/path|pedestrian|footway|cycleway|steps/.test(id)) return 'path';
  if (/service|track/.test(id)) return 'service';
  return 'street';
}

class Router {
  constructor(tileSource) {
    this.tileSource = tileSource;
    if (!tileSource.styler) {
      tileSource.useStyler(new Styler(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'styles', 'bright.json'), 'utf8'))));
    }
  }

  // street level for short trips, main roads only for long ones
  static zoomFor(km) {
    return km < 12 ? 14 : km < 35 ? 13 : km < 100 ? 12 : km < 300 ? 10 : km < 800 ? 8 : 6;
  }

  // The tiles around a trip from a to b at zoom z: [{z, x, y}]
  static tilesFor(a, b, z) {
    const margin = Math.max(1, Gpx.length([a, b]) * 0.25);
    const dLat = margin / 111.32;
    const dLon = margin / (111.32 * Math.max(0.05, Math.cos((a.lat + b.lat) / 2 * Math.PI / 180)));
    const nw = utils.ll2tile(Math.min(a.lon, b.lon) - dLon, Math.min(85, Math.max(a.lat, b.lat) + dLat), z);
    const se = utils.ll2tile(Math.max(a.lon, b.lon) + dLon, Math.max(-85, Math.min(a.lat, b.lat) - dLat), z);
    const tiles = [];
    for (let y = Math.floor(nw.y); y <= Math.floor(se.y); y++) {
      for (let x = Math.floor(nw.x); x <= Math.floor(se.x); x++) {
        tiles.push({z, x, y});
      }
    }
    return tiles;
  }

  // options: {mode, download, maxTiles}. Returns {km, minutes, points, steps, tiles, missing, note}
  async route(a, b, {mode = 'car', download = true, maxTiles = 150, onProgress = () => null} = {}) {
    if (!SPEEDS[mode]) throw new Error('travel by car, bike or foot');
    this.mode = mode;
    const straight = Gpx.length([a, b]);
    const z = Math.min(Router.zoomFor(straight), this.tileSource.maxZoom());
    const tiles = Router.tilesFor(a, b, z);
    if (tiles.length > maxTiles) {
      throw new Error(`that is too far to route (${tiles.length} map tiles; at most ${maxTiles})`);
    }
    const graph = new Graph();
    let missing = 0;
    let done = 0;
    for (const {x, y} of tiles) {
      let tile = null;
      // a tile the server doesn't have is empty land or sea, not a download failure
      let empty = this.tileSource.isEmpty ? this.tileSource.isEmpty(z, x, y) : false;
      try {
        if (!empty && (download || await this._cached(z, x, y))) {
          tile = await this.tileSource.getTile(z, x, y);
        }
      } catch (error) {
        tile = null;
        if (error.status === 404) empty = true;
      }
      if (tile) graph.addTile(z, x, y, tile, SPEEDS[mode]);
      else if (!empty) missing++;
      onProgress(++done, tiles.length);
    }
    // both ends on the same connected network: small pieces lead nowhere
    const part = graph.partNear(a, b);
    const start = graph.nearest(a, part);
    const end = graph.nearest(b, part);
    const far = (node, place) => node === -1 || Gpx.length([graph.place(node), place]) > 1.5;
    if (far(start, a) || far(end, b)) {
      throw new Error(missing === tiles.length ? 'the map tiles for this trip are not here (offline?)' :
        part === -1 ? `no roads connecting both places were found in the map data${missing ? ` (${missing} of its ${tiles.length} tiles are missing)` : ''}` :
          `there is no road near the ${far(start, a) ? 'start' : 'destination'} in the map data`);
    }
    // join any road within 150 m: the nearest may be a dead end with a long way round
    const from = graph.connect(a, part, start);
    const to = graph.connect(b, part, end);
    const top = Math.max(...Object.values(SPEEDS[mode]).filter((v) => typeof v === 'number'));
    const found = graph.shortest(from, to, top);
    if (!found) {
      throw new Error('no way along the roads was found (the roads in the map data may not connect there)');
    }
    const nodes = found.nodes.slice(1, -1);
    const points = [a, ...nodes.map((n) => graph.place(n)), b];
    const km = Gpx.length(points);
    const steps = directions(graph, nodes);
    const lead = Gpx.length([a, points[1]]);
    for (const step of steps) step.at += lead;
    return {
      km, minutes: found.hours * 60,
      points, steps, tiles: tiles.length, missing, zoom: z,
      note: mode === 'car' ?
        'An estimate from the map\'s roads: it follows the one-way streets the map data marks; turn restrictions and traffic are not known.' :
        'An estimate from the map\'s roads: traffic and closed ways are not known.',
    };
  }

  // Whether a tile is on the computer (in the pack or the disk cache)
  async _cached(z, x, y) {
    const source = this.tileSource;
    if (source.mbtiles) return true;
    if (source.peekTile(z, x, y)) return true;
    try {
      return fs.existsSync(source._persistPath(z, x, y));
    } catch (error) {
      return false;
    }
  }
}

class Graph {
  constructor() {
    this.lat = [];
    this.lon = [];
    this.edges = [];
    this.grid = new Map();
    this.nodeName = new Map();
  }

  // The node within ~1.5 m of a place, or -1
  find(lat, lon) {
    const cell = 1.5 / 111320;
    const gx = Math.floor(lat / cell);
    const gy = Math.floor(lon / cell);
    const cos = Math.cos(lat * Math.PI / 180);
    let best = -1;
    let bestD = 2;
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        for (const n of this.grid.get(`${gx + i}:${gy + j}`) || []) {
          const d = Math.hypot(this.lat[n] - lat, (this.lon[n] - lon) * cos) * 111320;
          if (d < bestD) {
            bestD = d;
            best = n;
          }
        }
      }
    }
    return best;
  }

  // A node's {lat, lon}
  place(node) {
    return {lat: this.lat[node], lon: this.lon[node]};
  }

  // reuses a node within ~1.5 m, so lines meeting across tile borders connect
  node(lat, lon) {
    const cell = 1.5 / 111320;
    const gx = Math.floor(lat / cell);
    const gy = Math.floor(lon / cell);
    const cos = Math.cos(lat * Math.PI / 180);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const n of this.grid.get(`${gx + i}:${gy + j}`) || []) {
          if (Math.hypot(this.lat[n] - lat, (this.lon[n] - lon) * cos) * 111320 < 1.5) return n;
        }
      }
    }
    const n = this.lat.length;
    this.lat.push(lat);
    this.lon.push(lon);
    this.edges.push([]);
    const key = `${gx}:${gy}`;
    if (!this.grid.has(key)) this.grid.set(key, []);
    this.grid.get(key).push(n);
    return n;
  }

  // Adds a tile's roads to the network
  addTile(z, x, y, tile, speeds) {
    const n = Math.pow(2, z);
    const toPlace = (layer) => (p) => {
      const lon = (x + p.x / layer.extent) / n * 360 - 180;
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + p.y / layer.extent) / n))) * 180 / Math.PI;
      return [lat, lon];
    };
    const road = tile.layers.road;
    if (road) {
      const place = toPlace(road);
      for (const feature of road.tree.all()) {
        const cls = roadClass(feature);
        const speed = cls && speeds[cls];
        if (!speed || !feature.points || feature.points.length < 2 || Array.isArray(feature.points[0])) continue;
        // one-way only by car
        const oneway = speeds.oneway ? feature.oneway || 0 : 0;
        let previous = null;
        for (const p of feature.points) {
          const [lat, lon] = place(p);
          const node = this.node(lat, lon);
          if (previous !== null && previous !== node) {
            const km = Gpx.length([this.place(previous), this.place(node)]);
            if (oneway !== -1) this.edges[previous].push({to: node, km, speed});
            if (oneway !== 1) this.edges[node].push({to: previous, km, speed});
          }
          previous = node;
        }
      }
    }
    // a name line's points lie on its road's points
    const labels = tile.layers.road_label;
    if (labels) {
      const place = toPlace(labels);
      for (const feature of labels.tree.all()) {
        if (!feature.label || !feature.points || Array.isArray(feature.points[0])) continue;
        for (const p of feature.points) {
          const node = this.find(...place(p));
          if (node !== -1 && !this.nodeName.has(node)) this.nodeName.set(node, feature.label);
        }
      }
    }
  }

  // The street name of the way from node a to node b, if known
  nameOf(a, b) {
    const na = this.nodeName.get(a);
    const nb = this.nodeName.get(b);
    return na && nb ? (na === nb ? na : nb) : na || nb || null;
  }

  // The connected parts of the network: {part[node], size[part]}
  parts() {
    if (this.partOf) return this.partOf;
    const part = new Int32Array(this.lat.length).fill(-1);
    const size = [];
    // undirected: one-way edges would split one network into pieces
    const touching = this.edges.map((list) => list.map((e) => e.to));
    this.edges.forEach((list, from) => {
      for (const e of list) touching[e.to].push(from);
    });
    for (let s = 0; s < this.lat.length; s++) {
      if (part[s] >= 0 || !touching[s].length) continue;
      const stack = [s];
      part[s] = size.length;
      let count = 0;
      while (stack.length) {
        const v = stack.pop();
        count++;
        for (const to of touching[v]) {
          if (part[to] < 0) {
            part[to] = size.length;
            stack.push(to);
          }
        }
      }
      size.push(count);
    }
    this.partOf = {part, size};
    return this.partOf;
  }

  // The biggest part with nodes within ~1.5 km of both places
  partNear(a, b) {
    const {part, size} = this.parts();
    const near = (place) => {
      const found = new Set();
      const cos = Math.cos(place.lat * Math.PI / 180);
      for (let n = 0; n < this.lat.length; n++) {
        if (part[n] >= 0 && Math.hypot(this.lat[n] - place.lat, (this.lon[n] - place.lon) * cos) * 111.32 < 1.5) found.add(part[n]);
      }
      return found;
    };
    const atB = near(b);
    let best = -1;
    for (const p of near(a)) {
      if (atB.has(p) && (best === -1 || size[p] > size[best])) best = p;
    }
    return best;
  }

  // The node nearest a place, in a part of the network or any; -1 if none
  nearest(place, inPart = -1) {
    const part = inPart >= 0 ? this.parts().part : null;
    let best = -1;
    let bestD = Infinity;
    for (let n = 0; n < this.lat.length; n++) {
      if (!this.edges[n].length || (part && part[n] !== inPart)) continue;
      const d = (this.lat[n] - place.lat) ** 2 + ((this.lon[n] - place.lon) * Math.cos(place.lat * Math.PI / 180)) ** 2;
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  // joins a place on foot (4.5 km/h) to the part's nodes within 150 m, and always to fallback
  connect(place, part, fallback) {
    const {part: partOf} = this.parts();
    const n = this.lat.length;
    this.lat.push(place.lat);
    this.lon.push(place.lon);
    this.edges.push([]);
    const cos = Math.cos(place.lat * Math.PI / 180);
    const near = [];
    for (let i = 0; i < n; i++) {
      if (partOf[i] !== part) continue;
      const km = Math.hypot(this.lat[i] - place.lat, (this.lon[i] - place.lon) * cos) * 111.32;
      if (km < 0.15 || i === fallback) near.push([i, km]);
    }
    for (const [i, km] of near) {
      this.edges[n].push({to: i, km, speed: 4.5});
      this.edges[i].push({to: n, km, speed: 4.5});
    }
    return n;
  }

  // A*: {nodes, hours}, or null
  shortest(start, end, maxSpeed) {
    const target = this.place(end);
    const h = (n) => Gpx.length([this.place(n), target]) / maxSpeed;
    const cost = new Map([[start, 0]]);
    const from = new Map();
    const heap = new Heap();
    heap.push(start, h(start));
    const done = new Set();
    while (heap.size) {
      const node = heap.pop();
      if (node === end) {
        const nodes = [end];
        while (from.has(nodes[0])) nodes.unshift(from.get(nodes[0]));
        return {nodes, hours: cost.get(end)};
      }
      if (done.has(node)) continue;
      done.add(node);
      for (const edge of this.edges[node]) {
        const c = cost.get(node) + edge.km / edge.speed;
        if (c < (cost.has(edge.to) ? cost.get(edge.to) : Infinity)) {
          cost.set(edge.to, c);
          from.set(edge.to, node);
          heap.push(edge.to, c + h(edge.to));
        }
      }
    }
    return null;
  }
}

class Heap {
  constructor() {
    this.items = [];
  }
  // How many items are queued
  get size() {
    return this.items.length;
  }
  // Adds a value with a priority
  push(value, priority) {
    const items = this.items;
    items.push([priority, value]);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent][0] <= items[i][0]) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }
  // Removes and returns the value with the lowest priority
  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && items[l][0] < items[m][0]) m = l;
        if (r < items.length && items[r][0] < items[m][0]) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i], items[m]];
        i = m;
      }
    }
    return top[1];
  }
}

// The compass bearing from a to b, in degrees
function bearing(a, b) {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lon - a.lon) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

const HEADINGS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

// "120 m", "1.4 km"
function distance(km) {
  return km < 1 ? `${Math.max(10, Math.round(km * 100) * 10)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

// A step where the way turns more than ~35° over ~30 m or the street name changes
function directions(graph, nodes) {
  if (nodes.length < 2) return [{text: 'Arrive', action: 'Arrive', km: 0, at: 0}];
  const places = nodes.map((n) => graph.place(n));
  const ahead = (i) => {
    let j = i + 1;
    while (j < places.length - 1 && Gpx.length([places[i], places[j]]) < 0.03) j++;
    return bearing(places[i], places[j]);
  };
  const steps = [];
  let name = graph.nameOf(nodes[0], nodes[1]);
  let km = 0;
  let direction = ahead(0);
  steps.push({text: `Head ${HEADINGS[Math.round(direction / 45) % 8]}${name ? ` on ${name}` : ''}`, km: 0});
  for (let i = 1; i < places.length - 1; i++) {
    km += Gpx.length([places[i - 1], places[i]]);
    const next = ahead(i);
    const turn = ((next - direction + 540) % 360) - 180;
    const here = graph.nameOf(nodes[i], nodes[i + 1]);
    const renamed = here && here !== name;
    if (Math.abs(turn) > 35 || (renamed && km > 0.05)) {
      const how = Math.abs(turn) <= 35 ? 'Continue' : Math.abs(turn) < 60 ? `Bear ${turn > 0 ? 'right' : 'left'}` :
        Math.abs(turn) < 135 ? `Turn ${turn > 0 ? 'right' : 'left'}` : `Turn sharp ${turn > 0 ? 'right' : 'left'}`;
      steps[steps.length - 1].km = km;
      steps.push({text: `${how}${here ? (here === name ? ` to stay on ${here}` : ` onto ${here}`) : ''}`, km: 0});
      km = 0;
      name = here || name;
    }
    direction = next;
  }
  km += Gpx.length([places[places.length - 2], places[places.length - 1]]);
  steps[steps.length - 1].km = km;
  // merge steps of a few metres (e.g. a jog at a junction) into the one before
  const merged = [];
  for (const step of steps) {
    if (merged.length && step.km < 0.02 && !/onto|stay on/.test(step.text)) {
      merged[merged.length - 1].km += step.km;
    } else {
      merged.push(step);
    }
  }
  let at = 0;
  const out = merged.map((step) => {
    const result = {text: `${step.text}, for ${distance(step.km)}`, action: step.text, km: step.km, at};
    at += step.km;
    return result;
  });
  return out.concat({text: 'Arrive', action: 'Arrive', km: 0, at});
}

Router.roadClass = roadClass;
Router.directionsFor = directions;
Router.Graph = Graph;
Router.SPEEDS = SPEEDS;
module.exports = Router;
