// Answers to SMS questions about places, offline, kept to one message where possible.
'use strict';
const PlusCode = require('../../src/PlusCode');
const Gpx = require('../../src/Gpx');
const resolvePlace = require('../../src/resolvePlace');

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

// e.g. "NE": the direction from a to b
function direction(a, b) {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lon - a.lon) * rad);
  const bearing = (Math.atan2(y, x) / rad + 360) % 360;
  return COMPASS[Math.round(bearing / 45) % 8];
}

// "120 m", "1.4 km"
function distance(km) {
  return km < 1 ? `${Math.round(km * 1000 / 10) * 10} m` : km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

// short: each message costs credit
function q(text) {
  const t = String(text);
  return t.length > 30 ? `${t.slice(0, 28)}…` : t;
}

const HELP = 'Send a place (Kumasi), a plus code (JR37+F6 Accra) or coordinates. Also: A TO B (distance), NEAR place (field notes), NOTE text AT place.';

class Answers {
  // notesFrom: numbers allowed to add notes (['*']: all); router: road distances from cached tiles only
  constructor({placeIndex = null, savedPlaces = null, fieldNotes = null, notesFrom = null, router = null} = {}) {
    this.router = router;
    this.placeIndex = placeIndex;
    this.savedPlaces = savedPlaces;
    this.fieldNotes = fieldNotes;
    this.notesFrom = notesFrom || [];
  }

  // The reply to a text message from a number
  async reply(text, from = '') {
    const message = String(text).replace(/\s+/g, ' ').trim();
    if (!message || /^(help|\?|info|menu)$/i.test(message)) {
      return HELP;
    }
    let m = message.match(/^note:?\s+(.+?)\s+(?:at|@)\s+(.+)$/i);
    if (m) {
      return this._note(m[1], m[2], from);
    }
    if (/^note\b/i.test(message)) {
      return 'To add a note: NOTE broken pump AT JR37+F6 Accra';
    }
    m = message.match(/^near:?\s+(.+)$/i);
    if (m) {
      return this._near(m[1]);
    }
    m = message.match(/^(?:from\s+)?(.+?)\s+to\s+(.+)$/i);
    if (m && !/^(where|how)\b/i.test(m[1])) {
      return this._between(m[1], m[2]);
    }
    return this._where(message.replace(/^(where is|where's|where|find|locate)\s+/i, '').replace(/\?$/, ''));
  }

  // The place a text means
  _place(text) {
    return resolvePlace(text, {placeIndex: this.placeIndex, savedPlaces: this.savedPlaces});
  }

  // "1.2 km NE of Accra" for a place, or '' if no town is known near it
  _relative(place) {
    let town = null;
    try {
      town = this.placeIndex ? this.placeIndex.nearest(place.lat, place.lon, {kinds: ['city', 'town', 'village'], maxKm: 50, limit: 1})[0] : null;
    } catch (error) {
      void 0;
    }
    if (!town || town.name === place.name) return '';
    const km = Gpx.length([town, place]);
    return km < 0.2 ? `in ${town.name}` : `${distance(km)} ${direction(town, place)} of ${town.name}`;
  }

  // The answer to "where is X"
  _where(text) {
    let place;
    try {
      place = this._place(text);
    } catch (error) {
      return `Sorry, "${q(text)}" is not known here. ${HELP}`;
    }
    const where = `${+place.lat.toFixed(5)}, ${+place.lon.toFixed(5)}`;
    const code = PlusCode.address(place.lat, place.lon, this._town(place));
    const near = this._relative(place);
    const name = place.kind === 'plus code' ? '' : `${place.name || text}${place.kind && place.kind !== 'saved' ? ` (${place.kind})` : ''}: `;
    return `${name}${where}, plus code ${code}${near ? `, ${near}` : ''}`;
  }

  // The town nearest a place, or null
  _town(place) {
    try {
      return this.placeIndex ? this.placeIndex.nearest(place.lat, place.lon, {limit: 1})[0] || null : null;
    } catch (error) {
      return null;
    }
  }

  // The answer to "A to B": the distance, by road where the tiles allow
  async _between(fromText, toText) {
    let a;
    let b;
    try {
      a = this._place(fromText);
    } catch (error) {
      return `Sorry, "${q(fromText)}" is not known here.`;
    }
    try {
      b = this._place(toText);
    } catch (error) {
      return `Sorry, "${q(toText)}" is not known here.`;
    }
    const km = Gpx.length([a, b]);
    const nameOf = (p, text) => p.kind === 'plus code' ? text.toUpperCase() : p.name || text;
    const line = `${nameOf(b, toText)} is ${distance(km)} ${direction(a, b)} of ${nameOf(a, fromText)}`;
    if (this.router) {
      try {
        const road = await this.router.route(a, b, {mode: 'car', download: false, maxTiles: 60});
        const minutes = road.minutes < 90 ? `${Math.max(1, Math.round(road.minutes))} min` : `${Math.floor(road.minutes / 60)} h ${Math.round(road.minutes % 60)} min`;
        return `${line}: ${distance(road.km)} by road, about ${minutes} by car (an estimate).`;
      } catch (error) {
        void 0;
      }
    }
    return `${line} (in a straight line; roads are longer).`;
  }

  // The answer to "near X": the field notes nearest it
  _near(text) {
    if (!this.fieldNotes) return 'There are no notes here.';
    let place;
    try {
      place = this._place(text);
    } catch (error) {
      return `Sorry, "${q(text)}" is not known here.`;
    }
    const notes = this.fieldNotes.list()
      .map((note) => ({note, km: Gpx.length([place, note])}))
      .filter(({km}) => km <= 10)
      .sort((a, b) => a.km - b.km);
    if (!notes.length) return `No notes within 10 km of ${q(text)}.`;
    const items = notes.slice(0, 3).map(({note, km}) => `${note.title} ${distance(km)} ${direction(place, note)}`);
    return `${notes.length} note${notes.length === 1 ? '' : 's'} near ${q(text)}: ${items.join('; ')}`;
  }

  // Adds a field note from a text message, if the number may
  _note(text, where, from) {
    if (!this.fieldNotes) return 'Notes can\'t be added here.';
    const allowed = this.notesFrom.includes('*') || this.notesFrom.some((number) => sameNumber(number, from));
    if (!allowed) return 'Sorry, this number may not add notes.';
    let place;
    try {
      place = this._place(where);
    } catch (error) {
      return `Sorry, "${q(where)}" is not known here. Use a plus code: NOTE ${text} AT JR37+F6 Accra`;
    }
    const note = this.fieldNotes.add({lat: place.lat, lon: place.lon, title: text.slice(0, 80), text: from ? `by SMS from ${from}` : 'by SMS', tags: ['sms']});
    return `Noted: ${note.title}, at ${PlusCode.address(note.lat, note.lon, this._town(place))}. Thank you.`;
  }
}

// compare by the last 9 digits (+233 24 123 4567 = 0241234567)
function sameNumber(a, b) {
  const digits = (n) => String(n).replace(/\D/g, '').slice(-9);
  return digits(a).length >= 6 && digits(a) === digits(b);
}

Answers.sameNumber = sameNumber;
Answers.direction = direction;
module.exports = Answers;
