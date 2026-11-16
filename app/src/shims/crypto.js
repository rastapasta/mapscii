/* Random bytes and SHA-1 (the same note ids as on the computer) */
'use strict';
const AppBuffer = require('./buffer');

// Random bytes
function randomBytes(size) {
  const bytes = new AppBuffer(size);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

// The SHA-1 of the bytes
function sha1(bytes) {
  const words = [];
  const length = bytes.length;
  const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[length] = 0x80;
  const bits = length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(padded.length - 4, bits >>> 0);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  for (const h of [h0, h1, h2, h3, h4]) words.push(h.toString(16).padStart(8, '0'));
  return words.join('');
}

// A SHA-1 hash, as Node's createHash('sha1')
function createHash(algorithm) {
  if (algorithm !== 'sha1') throw new Error(`no ${algorithm} in the app`);
  const parts = [];
  const hash = {
    update(data) {
      parts.push(typeof data === 'string' ? new TextEncoder().encode(data) : data);
      return hash;
    },
    digest(encoding) {
      if (encoding !== 'hex') throw new Error('only hex digests in the app');
      return sha1(AppBuffer.concat(parts));
    },
  };
  return hash;
}

module.exports = {randomBytes, createHash, sha1};
