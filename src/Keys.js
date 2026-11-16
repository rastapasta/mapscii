// API keys, in a file only the user can read; environment variables (MAPSCII_TOMTOM_KEY ...) take precedence.
'use strict';
const fs = require('fs');
const path = require('path');

const SERVICES = {
  aisstream: {what: 'live ships', signUp: 'aisstream.io/authenticate (sign up, then API Keys)'},
  tomtom: {what: 'live traffic', signUp: 'developer.tomtom.com (register; the key is in the Dashboard under Keys)'},
  firms: {what: 'active fires', signUp: 'firms.modaps.eosdis.nasa.gov/api/map_key (the key comes by email)'},
};

class Keys {
  constructor(file) {
    this.file = file;
  }

  // The key file's contents, or {}
  _read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8')) || {};
    } catch (error) {
      return {};
    }
  }

  // A service's key from the environment or the file, or null
  get(service) {
    const fromEnv = process.env[`MAPSCII_${service.toUpperCase()}_KEY`];
    if (fromEnv) return fromEnv;
    const key = this._read()[service];
    return typeof key === 'string' && key ? key : null;
  }

  // Saves a service's key in the file
  set(service, key) {
    if (!SERVICES[service]) {
      throw new Error(`no service "${service}" - keys are for: ${Object.keys(SERVICES).join(', ')}`);
    }
    const clean = String(key).trim();
    if (!/^[\w.:-]{8,200}$/.test(clean)) {
      throw new Error('that doesn\'t look like a key (letters, digits, - _ . : only, at least 8)');
    }
    const keys = this._read();
    keys[service] = clean;
    fs.mkdirSync(path.dirname(this.file), {recursive: true});
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(keys, null, 2) + '\n', {mode: 0o600});
    fs.renameSync(tmp, this.file);
    fs.chmodSync(this.file, 0o600);
  }

  // Removes a key; returns whether there was one
  remove(service) {
    if (!SERVICES[service]) {
      throw new Error(`no service "${service}" - keys are for: ${Object.keys(SERVICES).join(', ')}`);
    }
    const keys = this._read();
    if (!(service in keys)) return false;
    delete keys[service];
    fs.writeFileSync(this.file, JSON.stringify(keys, null, 2) + '\n', {mode: 0o600});
    return true;
  }

  // For --keys: which keys are set, what they are for, and where to get them
  report() {
    const lines = Object.entries(SERVICES).map(([service, info]) => {
      const key = this.get(service);
      const shown = key ? `set (${key.slice(0, 4)}…${key.slice(-4)})` : 'not set';
      return `${service.padEnd(10)} ${shown.padEnd(18)} ${info.what}${key ? '' : ` - sign up at ${info.signUp}`}`;
    });
    return lines.join('\n') + `\n\nKeys are kept in ${this.file} (readable only by you). Set one with: mapscii --set-key tomtom=YOUR_KEY`;
  }
}

Keys.SERVICES = SERVICES;
module.exports = Keys;
