// Positions from the GPS bridge's stream of JSON lines; reconnects when it drops.
'use strict';
const http = require('http');
const https = require('https');

// the bridge sends at least a blank line every 15 s; silence this long means the connection is gone

class GpsFeed {
  // url: e.g. http://localhost:2948; what: a name for messages
  constructor(url, onPosition, onStatus = () => null, what = {name: 'GPS bridge', tool: 'tools/gps-bridge'}) {
    this.what = what;
    this.url = url.replace(/\/+$/, '') + '/stream';
    this.onPosition = onPosition;
    this.onStatus = onStatus;
    this.stopped = false;
    this.status = 'connecting';
    this._connect();
  }

  // Sets the status and reports a change
  _setStatus(status) {
    if (status !== this.status) {
      this.status = status;
      this.onStatus(status);
    }
  }

  // Connects to the stream; reconnects after an error or silence
  _connect() {
    if (this.stopped) return;
    let buffer = '';
    let watchdog = null;
    const heard = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        this._setStatus(`the ${this.what.name} went silent - connecting again`);
        this.request.destroy();
      }, GpsFeed.silentMs);
      if (watchdog.unref) watchdog.unref();
    };
    try {
      this.request = (this.url.startsWith('https:') ? https : http).get(this.url, (res) => {
        if (res.statusCode !== 200) {
          this._setStatus(`the ${this.what.name} answered ${res.statusCode}`);
          res.resume();
          return;
        }
        this._setStatus('waiting for a position');
        heard();
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          heard();
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop();
          if (buffer.length > 100000) buffer = '';
          for (const line of lines) {
            if (!line.trim()) continue;
            let position;
            try {
              position = JSON.parse(line);
            } catch (error) {
              continue;
            }
            if (position && Number.isFinite(position.lat) && Number.isFinite(position.lon)) {
              this._setStatus('live');
              this.onPosition(position);
            }
          }
        });
      });
    } catch (error) {
      this._setStatus(`${this.what.name}: ${error.message}`);
      return;
    }
    this.request.on('error', (error) => {
      this._setStatus(error.code === 'ECONNREFUSED' ? `no ${this.what.name} (start ${this.what.tool})` : `${this.what.name}: ${error.message}`);
    });
    this.request.on('close', () => {
      clearTimeout(watchdog);
      if (this.stopped) return;
      if (this.status === 'live' || this.status === 'waiting for a position') {
        this._setStatus(`the ${this.what.name} stopped - connecting again`);
      }
      this.timer = setTimeout(() => this._connect(), 3000);
      if (this.timer.unref) this.timer.unref();
    });
  }

  // Disconnects for good
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.request) this.request.destroy();
  }
}

GpsFeed.silentMs = 45000;
module.exports = GpsFeed;
