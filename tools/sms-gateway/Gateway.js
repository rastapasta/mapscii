// Answers SMS through a GSM modem or an Android gateway app, within per-number and daily limits (replies cost credit).
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const Answers = require('./Answers');

class Gateway {
  // options: {allow (empty: all), maxPerHour, maxPerDay, logFile, token}; send(to, text) is set by a backend
  constructor(answers, {allow = [], maxPerHour = 10, maxPerDay = 100, logFile = null, token = null} = {}) {
    this.answers = answers;
    this.allow = allow;
    this.maxPerHour = maxPerHour;
    this.maxPerDay = maxPerDay;
    this.logFile = logFile;
    this.token = token;
    this.recent = new Map();
    this.day = null;
    this.today = 0;
    this.stats = {received: 0, replied: 0, refused: 0};
  }

  // null when blocked or over a limit: a refusal would cost credit too
  async handle(from, text, now = Date.now()) {
    this.stats.received++;
    let reply = null;
    let why = null;
    const day = new Date(now).toDateString();
    if (day !== this.day) {
      this.day = day;
      this.today = 0;
    }
    if (this.allow.length && !this.allow.some((number) => Answers.sameNumber(number, from))) {
      why = 'not on the list of numbers to answer';
    } else if (this.today >= this.maxPerDay) {
      why = `the ${this.maxPerDay} replies of the day are used up`;
    } else {
      const key = String(from).replace(/\D/g, '').slice(-9) || String(from);
      const times = (this.recent.get(key) || []).filter((t) => now - t < 3600000);
      if (times.length >= this.maxPerHour) {
        why = `${this.maxPerHour} replies to this number in the last hour`;
      } else {
        times.push(now);
        this.recent.set(key, times);
        // forget numbers not heard from in the last hour
        if (this.recent.size > 5000) {
          for (const [number, list] of this.recent) {
            if (!list.some((t) => now - t < 3600000)) this.recent.delete(number);
          }
        }
        this.today++;
        try {
          reply = await this.answers.reply(text, from);
        } catch (error) {
          reply = 'Sorry, something went wrong here.';
          why = error.message;
        }
      }
    }
    if (reply) this.stats.replied++;
    else this.stats.refused++;
    this._log({time: new Date(now).toISOString(), from, text, reply, why});
    return reply;
  }

  // Appends a line to the log file
  _log(entry) {
    if (!this.logFile) return;
    try {
      fs.mkdirSync(path.dirname(this.logFile), {recursive: true});
      fs.appendFileSync(this.logFile, JSON.stringify(entry) + '\n');
    } catch (error) {
      void 0;
    }
  }

  // each message is deleted before answering, so a crash never answers twice
  async useModem(modem, {pollSeconds = 30, onError = () => null} = {}) {
    await modem.init();
    let busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        for (const message of await modem.messages()) {
          await modem.remove(message.index);
          const reply = await this.handle(message.from, message.text);
          if (reply) {
            await modem.send(message.from, reply).catch(onError);
          }
        }
      } catch (error) {
        onError(error);
      }
      busy = false;
    };
    modem.on('incoming', check);
    this.poll = setInterval(check, pollSeconds * 1000);
    await check();
  }

  // POST /sms with from/phone/sender/number and text/message/body; replies as text, or {reply} with ?format=json
  listen(port = 8090, host = '0.0.0.0') {
    this.server = http.createServer((req, res) => {
      let url;
      try {
        url = new URL(req.url, 'http://localhost');
      } catch (error) {
        res.writeHead(400, {'Content-Type': 'text/plain'});
        return res.end('bad request');
      }
      if (url.pathname !== '/sms') {
        res.writeHead(404, {'Content-Type': 'text/plain'});
        return res.end('POST the messages to /sms');
      }
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 20000) req.destroy();
      });
      req.on('end', () => this._answerHttp(req, res, url, body).catch((error) => {
        // an error answering one message must not end the gateway
        if (!res.headersSent) res.writeHead(500, {'Content-Type': 'text/plain'});
        res.end(`could not do that: ${error.message}`);
      }));
    });
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => resolve(this.server.address().port));
    });
  }

  // Answers one HTTP request from a gateway app
  async _answerHttp(req, res, url, body) {
    const fields = Object.fromEntries(url.searchParams);
    if (/^\s*\{/.test(body)) {
      try {
        Object.assign(fields, flatten(JSON.parse(body)));
      } catch (error) {
        void 0;
      }
    } else if (body) {
      Object.assign(fields, Object.fromEntries(new URLSearchParams(body)));
    }
    const token = fields.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (this.token && token !== this.token) {
      res.writeHead(403, {'Content-Type': 'text/plain'});
      return res.end('wrong or missing token');
    }
    const from = fields.from || fields.phone || fields.phoneNumber || fields.sender || fields.number || fields.msisdn;
    const text = fields.text || fields.message || fields.body || fields.content || fields.msg;
    if (!from || text === undefined) {
      res.writeHead(400, {'Content-Type': 'text/plain'});
      return res.end('expected the sender (from) and the text (text)');
    }
    const reply = await this.handle(String(from), String(text));
    if (fields.format === 'json') {
      res.writeHead(200, {'Content-Type': 'application/json'});
      return res.end(JSON.stringify({reply}));
    }
    // an empty answer: the apps send nothing
    res.writeHead(reply ? 200 : 204, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end(reply || '');
  }

  // Stops polling and the server
  stop() {
    clearInterval(this.poll);
    return this.server ? new Promise((resolve) => this.server.close(resolve)) : Promise.resolve();
  }
}

// apps nest the fields differently: flatten the first level
function flatten(data) {
  const fields = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [inner, innerValue] of Object.entries(value)) {
        if (typeof innerValue !== 'object') fields[inner] = innerValue;
      }
    } else if (typeof value !== 'object') {
      fields[key] = value;
    }
  }
  return fields;
}

module.exports = Gateway;
