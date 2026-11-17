// What the navigation voice says and when: each turn ahead of it and as it comes, and the route's events once.
'use strict';

// km before a turn to announce it: early enough to change lanes by car, late enough on foot to know which corner
const CUES = {
  car: {ahead: 0.3, now: 0.06},
  bike: {ahead: 0.15, now: 0.03},
  foot: {ahead: 0.08, now: 0.02},
};

class Guidance {
  constructor(mode = 'car', destinationName = null) {
    this.cues = CUES[mode] || CUES.car;
    this.destinationName = destinationName;
    this.route = null;
    this.said = new Map();
    this.status = null;
  }

  // The sentence to say for the navigator's new state, or null
  update(state, route = null) {
    if (!state) return null;
    const before = this.status;
    this.status = state.status;
    if (route !== this.route) {
      const first = this.route === null;
      this.route = route;
      this.said.clear();
      if (route && (state.status === 'on route' || state.status === 'off route')) {
        const found = first ? `Route found: ${spokenDistance(route.km)}, about ${spokenTime(route.minutes)}.` : 'New route.';
        return `${found} ${this._turn(state, true) || ''}`.trim();
      }
    }
    if (state.status !== before) {
      if (state.status === 'arrived') return `You have arrived${this.destinationName ? ` at ${this.destinationName}` : ''}.`;
      if (state.status === 'rerouting') return 'Off the route. Finding a new one.';
      if (state.status === 'failed') return 'No route found.';
    }
    if (state.status === 'on route') return this._turn(state, false);
    return null;
  }

  // The next turn, if it is time to announce it
  _turn(state, first) {
    if (state.step === undefined || !state.next) return null;
    const action = lower(state.next);
    if (/^head /i.test(state.next)) {
      if (this.said.has(state.step)) return null;
      this.said.set(state.step, 'now');
      return `${state.next}.`;
    }
    const straightOn = /^continue/i.test(state.next);
    if (state.in <= this.cues.now) {
      if (straightOn) return null;
      if (this.said.get(state.step) === 'now') return null;
      this.said.set(state.step, 'now');
      return /^arrive/i.test(state.next) ? null : `Now ${action}.`;
    }
    // repeated close to the turn if the first notice was from far away
    const toldAt = this.said.get(state.step);
    const due = first || (state.in <= this.cues.ahead && (toldAt === undefined || (!straightOn && typeof toldAt === 'number' && toldAt > this.cues.ahead * 2)));
    if (due && toldAt !== 'now') {
      this.said.set(state.step, state.in);
      if (/^arrive/i.test(state.next)) return `In ${spokenDistance(state.in)}, you arrive.`;
      return `In ${spokenDistance(state.in)}, ${action}.`;
    }
    return null;
  }
}

// The text with its first letter in lower case
function lower(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// Distances as said aloud: "300 metres", "1.5 kilometres"
function spokenDistance(km) {
  if (km < 1) {
    const m = km < 0.1 ? Math.max(10, Math.round(km * 100) * 10) : Math.round(km * 20) * 50;
    return m >= 1000 ? '1 kilometre' : `${m} metres`;
  }
  const rounded = km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
  return `${rounded} kilometre${rounded === 1 ? '' : 's'}`;
}

// Times as said aloud: "12 minutes", "1 hour 20 minutes"
function spokenTime(minutes) {
  if (minutes < 60) {
    const m = Math.max(1, Math.round(minutes));
    return `${m} minute${m === 1 ? '' : 's'}`;
  }
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h} hour${h === 1 ? '' : 's'}${m ? ` ${m} minute${m === 1 ? '' : 's'}` : ''}`;
}

Guidance.CUES = CUES;
Guidance.spokenDistance = spokenDistance;
Guidance.spokenTime = spokenTime;
module.exports = Guidance;
