// Follows a route as the GPS moves: next instruction, distance and time left, rerouting and arrival.
'use strict';
const Gpx = require('./Gpx');

class Navigator {
  constructor(router, destination, {mode = 'car', onChange = () => null, offRoute = null, arriveWithin = 25} = {}) {
    this.router = router;
    this.destination = destination;
    this.mode = mode;
    this.onChange = onChange;
    // metres from the route which count as off it
    this.offRoute = offRoute || (mode === 'foot' ? 25 : 40);
    this.arriveWithin = arriveWithin;
    this.route = null;
    this.state = {status: 'planning'};
    this.offCount = 0;
    this.lastRoute = 0;
  }

  // Plans the route from a position
  async plan(from) {
    this.state = {status: this.route ? 'rerouting' : 'planning'};
    this.onChange();
    this.lastRoute = Date.now();
    try {
      this.route = await this.router.route(from, this.destination, {mode: this.mode});
      this.offCount = 0;
      this.update(from);
    } catch (error) {
      this.state = {status: 'failed', error: error.message};
    }
    this.onChange();
  }

  // Takes a new position: where on the route, what comes next, and rerouting
  update(position) {
    if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lon)) return this.state;
    this.position = position;
    if (!this.route) return this.state;
    if (Gpx.length([position, this.destination]) * 1000 <= this.arriveWithin) {
      this.state = {status: 'arrived'};
      return this.state;
    }
    const {along, off} = locate(this.route.points, position);
    if (off > this.offRoute) {
      // reroute only after two off-route fixes in a row
      this.offCount++;
      if (this.offCount >= 2 && Date.now() - this.lastRoute > 15000 && this.state.status !== 'rerouting') {
        this.plan(position);
        return this.state;
      }
    } else {
      this.offCount = 0;
    }
    const steps = this.route.steps.length ? this.route.steps : [{action: 'Arrive', at: this.route.km}];
    let next = steps.findIndex((s) => s.at > along + 0.005);
    if (next === -1) next = steps.length - 1;
    const left = Math.max(0, this.route.km - along);
    this.state = {
      status: off > this.offRoute ? 'off route' : 'on route',
      next: steps[next].action, step: next, in: Math.max(0, steps[next].at - along),
      left, minutes: this.route.km ? this.route.minutes * left / this.route.km : 0,
      off,
    };
    return this.state;
  }

  // The rest of the route from the position on, for drawing
  remaining() {
    if (!this.route) return [];
    if (!this.position) return this.route.points;
    const {index, point} = locate(this.route.points, this.position);
    return [point, ...this.route.points.slice(index + 1)];
  }

  // The footer line: "➜ In 120 m: Turn right | 1.1 km, 14 min left"
  summary() {
    const s = this.state;
    if (s.status === 'planning') return '➜ planning the route…';
    if (s.status === 'rerouting') return '➜ off the route - a new one…';
    if (s.status === 'failed') return `➜ no route: ${s.error}`;
    if (s.status === 'arrived') return `➜ You have arrived${this.destination.name ? ` at ${this.destination.name}` : ''}`;
    const when = s.in < 0.03 ? 'Now' : `In ${distance(s.in)}`;
    const time = s.minutes < 90 ? `${Math.max(1, Math.round(s.minutes))} min` : `${Math.floor(s.minutes / 60)} h ${Math.round(s.minutes % 60)} min`;
    return `➜ ${when}: ${s.next} | ${distance(s.left)}, ${time} left${s.status === 'off route' ? ' (off the route)' : ''}`;
  }
}

// {along (km), off (m), index, point}: where a position lies along a line
function locate(points, position) {
  const cos = Math.cos(position.lat * Math.PI / 180);
  // local flat metres, taking the short way across the date line
  const xy = (p) => [((p.lon - position.lon + 540) % 360 - 180) * cos * 111320, (p.lat - position.lat) * 111320];
  let best = {d: Infinity, index: 0, t: 0};
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, ay] = xy(points[i]);
    const [bx, by] = xy(points[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.d) best = {d, index: i, t};
  }
  let along = 0;
  for (let i = 0; i < best.index; i++) along += Gpx.length([points[i], points[i + 1]]);
  const a = points[best.index];
  const b = points[best.index + 1] || a;
  along += Gpx.length([a, b]) * best.t;
  const dLon = (b.lon - a.lon + 540) % 360 - 180;
  const point = {lat: a.lat + (b.lat - a.lat) * best.t, lon: (a.lon + dLon * best.t + 540) % 360 - 180};
  return {along, off: best.d, index: best.index, point};
}

// "120 m", "1.4 km"
function distance(km) {
  return km < 1 ? `${Math.max(10, Math.round(km * 100) * 10)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

Navigator.locate = locate;
module.exports = Navigator;
