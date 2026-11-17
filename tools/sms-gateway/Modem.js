// A GSM modem driven with AT commands in text mode, over any duplex stream.
'use strict';
const {EventEmitter} = require('events');

// the GSM 7-bit alphabet; other characters need UCS-2, 70 characters a message instead of 160
const GSM7 = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

class Modem extends EventEmitter {
  constructor(input, output, {log = () => null} = {}) {
    super();
    this.input = input;
    this.output = output;
    this.log = log;
    this.buffer = '';
    this.waiting = null;
    this.queue = Promise.resolve();
    input.on('data', (chunk) => this._data(chunk.toString('latin1')));
  }

  // resolves with the answer's lines, rejects on ERROR; prompt: text after "> " (for CMGS)
  command(text, {prompt = null, timeout = 15000} = {}) {
    const run = () => new Promise((resolve, reject) => {
      const lines = [];
      const timer = setTimeout(() => {
        this.waiting = null;
        reject(new Error(`no answer from the modem to ${text}`));
      }, timeout);
      this.waiting = {
        prompt,
        line: (line) => {
          if (line === 'OK') {
            clearTimeout(timer);
            this.waiting = null;
            resolve(lines);
          } else if (line === 'ERROR' || /^\+CM[ES] ERROR/.test(line)) {
            clearTimeout(timer);
            this.waiting = null;
            reject(new Error(`the modem answered ${line} to ${text}`));
          } else if (line !== text) {
            lines.push(line);
          }
        },
      };
      this.log(`> ${text}`);
      this.output.write(text + '\r');
    });
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => null);
    return result;
  }

  // Collects the modem's output and settles the waiting command
  _data(text) {
    this.buffer += text;
    if (this.waiting && this.waiting.prompt !== null && /(^|\n)> ?$/.test(this.buffer)) {
      const message = this.waiting.prompt;
      this.waiting.prompt = null;
      this.buffer = '';
      this.output.write(message + '\x1a');
      return;
    }
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop();
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '').trim();
      if (!line) continue;
      this.log(`< ${line}`);
      if (this.waiting) {
        this.waiting.line(line);
      } else if (/^\+CMTI:/.test(line)) {
        this.emit('incoming');
      }
    }
  }

  // Sets the modem up: no echo, text mode, UCS-2 if it can
  async init() {
    await this.command('AT');
    // no echo, text mode, notify new messages
    await this.command('ATE0').catch(() => null);
    await this.command('AT+CMGF=1');
    await this.command('AT+CNMI=2,1,0,0,0').catch(() => null);
    // UCS-2 so any script comes through; modems without it keep to the GSM alphabet
    this.ucs2 = await this.command('AT+CSCS="UCS2"').then(() => true, () => false);
    if (!this.ucs2) {
      await this.command('AT+CSCS="GSM"').catch(() => null);
    }
  }

  // The received messages: [{index, from, time, text}]
  async messages() {
    const lines = await this.command('AT+CMGL="ALL"');
    const messages = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\+CMGL:\s*(\d+),"([^"]*)","([^"]*)",[^,]*,"([^"]*)"/);
      if (!m) continue;
      if (!/REC/.test(m[2])) continue;
      const text = [];
      while (i + 1 < lines.length && !/^\+CMGL:/.test(lines[i + 1])) {
        text.push(lines[++i]);
      }
      const from = this.ucs2 ? fromHex(m[3]) : m[3];
      messages.push({index: +m[1], from, time: m[4], text: this.ucs2 ? fromHex(text.join('')) : text.join('\n')});
    }
    return messages;
  }

  // GSM alphabet (160 characters) if possible, else UCS-2 (70); without UCS-2 mode other letters become ?
  async send(to, text) {
    const number = String(to).replace(/[\s-]/g, '');
    if (!/^\+?\d{3,15}$/.test(number)) {
      throw new Error(`not a phone number: ${to}`);
    }
    const gsm = Modem.fit(text);
    const marks = (t) => (String(t).match(/\?/g) || []).length;
    const unicode = this.ucs2 && marks(gsm) > marks(text);
    if (!this.ucs2) {
      await this.command(`AT+CMGS="${number}"`, {prompt: gsm, timeout: 60000});
      return gsm;
    }
    const message = unicode ? Modem.fitUnicode(text) : gsm;
    // data coding: 0 GSM, 8 UCS-2
    await this.command(`AT+CSMP=17,167,0,${unicode ? 8 : 0}`).catch(() => null);
    await this.command(`AT+CMGS="${toHex(number)}"`, {prompt: toHex(message), timeout: 60000});
    return message;
  }

  // Deletes a message
  remove(index) {
    return this.command(`AT+CMGD=${index}`);
  }

  // accents dropped (Łódź: Lodz), others become ?, cut to 160
  static fit(text) {
    const plain = String(text).normalize('NFKD').replace(/\p{M}+/gu, '')
      .replace(/[ł]/g, 'l').replace(/[Ł]/g, 'L').replace(/[–—]/g, '-').replace(/[‘’]/g, '\'').replace(/[“”]/g, '"').replace(/…/g, '...')
      .replace(/[\s]+/g, ' ');
    const gsm = [...plain].map((c) => GSM7.includes(c) ? c : '?').join('');
    return gsm.length > 160 ? gsm.slice(0, 157) + '...' : gsm;
  }

  // A text as one Unicode message: at most 70 UTF-16 units
  static fitUnicode(text) {
    const plain = String(text).replace(/\s+/g, ' ');
    if (plain.length <= 70) return plain;
    let cut = plain.slice(0, 67);
    // not between a surrogate pair
    if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
    return cut + '...';
  }
}

// Text as UCS-2 hex, 4 digits per UTF-16 unit
function toHex(text) {
  let hex = '';
  for (let i = 0; i < text.length; i++) {
    hex += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  }
  return hex;
}

// UCS-2 hex as text, or the input if it isn't hex
function fromHex(hex) {
  const clean = String(hex).replace(/\s+/g, '');
  if (!/^([0-9A-Fa-f]{4})+$/.test(clean)) {
    // some modems give numbers as they are
    return String(hex);
  }
  let text = '';
  for (let i = 0; i < clean.length; i += 4) {
    text += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16));
  }
  return text;
}

Modem.toHex = toHex;
Modem.fromHex = fromHex;

module.exports = Modem;
