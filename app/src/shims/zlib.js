/* gunzip via DecompressionStream; inflate in plain JavaScript for PNGs, which are read synchronously */
'use strict';
const AppBuffer = require('./buffer');

// Unzips gzip data with the browser's DecompressionStream
async function gunzipBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

// a Huffman code from its code lengths
function table(lengths) {
  const counts = new Uint16Array(16);
  for (const l of lengths) counts[l]++;
  counts[0] = 0;
  const offsets = new Uint16Array(16);
  for (let i = 1; i < 16; i++) offsets[i] = offsets[i - 1] + counts[i - 1];
  const symbols = new Uint16Array(lengths.length);
  lengths.forEach((l, i) => {
    if (l) symbols[offsets[l]++] = i;
  });
  return {counts, symbols};
}

let fixed = null;

// RFC 1951
function inflateRaw(src) {
  let pos = 0;
  let bitbuf = 0;
  let bitcnt = 0;
  let out = new Uint8Array(Math.max(1024, src.length * 4));
  let size = 0;
  const room = (n) => {
    if (size + n <= out.length) return;
    let length = out.length * 2;
    while (length < size + n) length *= 2;
    const bigger = new Uint8Array(length);
    bigger.set(out.subarray(0, size));
    out = bigger;
  };
  const bits = (n) => {
    while (bitcnt < n) {
      if (pos >= src.length) throw new Error('inflate: the data ends early');
      bitbuf |= src[pos++] << bitcnt;
      bitcnt += 8;
    }
    const v = bitbuf & ((1 << n) - 1);
    bitbuf >>>= n;
    bitcnt -= n;
    return v;
  };
  const decode = (t) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = t.counts[len];
      if (code - count < first) return t.symbols[index + (code - first)];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('inflate: damaged data');
  };
  let last = 0;
  while (!last) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitbuf = 0;
      bitcnt = 0;
      const length = src[pos] | (src[pos + 1] << 8);
      pos += 4;
      room(length);
      out.set(src.subarray(pos, pos + length), size);
      size += length;
      pos += length;
      continue;
    }
    let lit;
    let dist;
    if (type === 1) {
      if (!fixed) {
        const l = [];
        for (let i = 0; i < 288; i++) l.push(i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8);
        fixed = {lit: table(l), dist: table(new Array(30).fill(5))};
      }
      ({lit, dist} = fixed);
    } else if (type === 2) {
      const hlit = bits(5) + 257;
      const hdist = bits(5) + 1;
      const hclen = bits(4) + 4;
      const codeLengths = new Array(19).fill(0);
      for (let i = 0; i < hclen; i++) codeLengths[ORDER[i]] = bits(3);
      const lengthCode = table(codeLengths);
      const lengths = [];
      while (lengths.length < hlit + hdist) {
        const sym = decode(lengthCode);
        if (sym < 16) lengths.push(sym);
        else if (sym === 16) {
          if (!lengths.length) throw new Error('inflate: damaged data');
          const prev = lengths[lengths.length - 1];
          for (let n = 3 + bits(2); n > 0; n--) lengths.push(prev);
        } else {
          for (let n = sym === 17 ? 3 + bits(3) : 11 + bits(7); n > 0; n--) lengths.push(0);
        }
      }
      lit = table(lengths.slice(0, hlit));
      dist = table(lengths.slice(hlit, hlit + hdist));
    } else {
      throw new Error('inflate: damaged data');
    }
    for (;;) {
      let sym = decode(lit);
      if (sym < 256) {
        room(1);
        out[size++] = sym;
      } else if (sym === 256) {
        break;
      } else {
        sym -= 257;
        if (sym >= 29) throw new Error('inflate: damaged data');
        const length = LBASE[sym] + bits(LEXT[sym]);
        const d = decode(dist);
        const back = DBASE[d] + bits(DEXT[d]);
        if (back > size) throw new Error('inflate: damaged data');
        room(length);
        for (let i = 0; i < length; i++, size++) out[size] = out[size - back];
      }
    }
  }
  return out.subarray(0, size);
}

// zlib: a 2-byte header, deflate, a checksum
function inflateSync(bytes) {
  if ((bytes[0] & 15) !== 8 || ((bytes[0] << 8) | bytes[1]) % 31) throw new Error('inflate: not zlib data');
  return AppBuffer.from(inflateRaw(bytes.subarray(2)));
}

module.exports = {
  gunzipBytes,
  gunzip: (bytes, done) => gunzipBytes(bytes).then((data) => done(null, data), done),
  inflateSync,
  inflateRaw,
};
