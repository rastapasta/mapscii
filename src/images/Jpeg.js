// Baseline JPEG decoder (any chroma subsampling, restart markers). Progressive JPEGs are refused.
'use strict';

const ZIGZAG = new Int32Array([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]);

// the inverse DCT's cosines: COS[x * 8 + u] = C(u) cos((2x + 1) u pi / 16) / 2
const COS = new Float64Array(64);
for (let x = 0; x < 8; x++) {
  for (let u = 0; u < 8; u++) {
    COS[x * 8 + u] = (u === 0 ? Math.SQRT1_2 : 1) * Math.cos((2 * x + 1) * u * Math.PI / 16) / 2;
  }
}

// A Huffman table from the code counts per length and the values:
// lookup by (length, code) through maxCode / valuePointer / minCode
function huffman(counts, values) {
  const maxCode = new Int32Array(18).fill(-1);
  const minCode = new Int32Array(17);
  const pointer = new Int32Array(17);
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length++) {
    pointer[length] = k;
    minCode[length] = code;
    code += counts[length - 1];
    k += counts[length - 1];
    if (counts[length - 1]) maxCode[length] = code - 1;
    code <<= 1;
  }
  maxCode[17] = 0x7fffffff;
  return {maxCode, minCode, pointer, values};
}

// A JPEG file's bytes to {width, height, data: RGBA}
function decode(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG image');
  const quant = [];
  const dcTables = [];
  const acTables = [];
  let frame = null;
  let restartInterval = 0;
  let pos = 2;
  const u16 = (p) => (bytes[p] << 8) | bytes[p + 1];

  while (pos < bytes.length) {
    if (bytes[pos] !== 0xff) {
      pos++;
      continue;
    }
    const marker = bytes[pos + 1];
    pos += 2;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
      if (marker === 0xff) pos--;
      continue;
    }
    if (marker === 0xd9) break;
    const length = u16(pos);
    const end = pos + length;
    if (marker === 0xdb) {
      // quantisation tables (8 or 16 bit)
      let p = pos + 2;
      while (p < end) {
        const precision = bytes[p] >> 4;
        const id = bytes[p] & 15;
        p++;
        const table = new Int32Array(64);
        for (let i = 0; i < 64; i++) {
          table[ZIGZAG[i]] = precision ? u16(p + i * 2) : bytes[p + i];
        }
        p += precision ? 128 : 64;
        quant[id] = table;
      }
    } else if (marker === 0xc0 || marker === 0xc1) {
      // baseline (or extended sequential, 8 bit): the frame
      if (bytes[pos + 2] !== 8) throw new Error(`JPEG with ${bytes[pos + 2]}-bit samples is not supported`);
      const height = u16(pos + 3);
      const width = u16(pos + 5);
      const n = bytes[pos + 7];
      const components = [];
      for (let i = 0; i < n; i++) {
        const p = pos + 8 + i * 3;
        components.push({id: bytes[p], h: bytes[p + 1] >> 4, v: bytes[p + 1] & 15, tq: bytes[p + 2]});
      }
      frame = {width, height, components};
    } else if (marker === 0xc2 || marker === 0xc3 || (marker >= 0xc5 && marker <= 0xcf && marker !== 0xc8 && marker !== 0xcc)) {
      throw new Error(marker === 0xc2 ? 'progressive JPEG is not supported' : 'this kind of JPEG is not supported');
    } else if (marker === 0xc4) {
      // Huffman tables
      let p = pos + 2;
      while (p < end) {
        const cls = bytes[p] >> 4;
        const id = bytes[p] & 15;
        const counts = bytes.subarray(p + 1, p + 17);
        const total = counts.reduce((a, b) => a + b, 0);
        const values = bytes.slice(p + 17, p + 17 + total);
        (cls ? acTables : dcTables)[id] = huffman(counts, values);
        p += 17 + total;
      }
    } else if (marker === 0xdd) {
      restartInterval = u16(pos + 2);
    } else if (marker === 0xda) {
      if (!frame) throw new Error('JPEG without a frame header');
      const n = bytes[pos + 2];
      const scan = [];
      for (let i = 0; i < n; i++) {
        const id = bytes[pos + 3 + i * 2];
        const t = bytes[pos + 4 + i * 2];
        const component = frame.components.find((c) => c.id === id);
        if (!component) throw new Error('JPEG scan of an unknown component');
        component.dc = dcTables[t >> 4];
        component.ac = acTables[t & 15];
        scan.push(component);
      }
      pos = decodeScan(bytes, end, frame, scan, quant, restartInterval);
      continue;
    }
    pos = end;
  }
  if (!frame || !frame.components[0].planes) throw new Error('JPEG without image data');
  return toRGBA(frame);
}

// returns where the scan's data ends
function decodeScan(bytes, start, frame, scan, quant, restartInterval) {
  const hmax = Math.max(...frame.components.map((c) => c.h));
  const vmax = Math.max(...frame.components.map((c) => c.v));
  const mcusX = Math.ceil(frame.width / (8 * hmax));
  const mcusY = Math.ceil(frame.height / (8 * vmax));
  for (const c of frame.components) {
    c.blocksX = mcusX * c.h;
    c.blocksY = mcusY * c.v;
    c.stride = c.blocksX * 8;
    c.planes = new Uint8ClampedArray(c.stride * c.blocksY * 8);
    c.pred = 0;
    c.q = quant[c.tq];
    if (!c.q) throw new Error('JPEG quantisation table is missing');
  }
  let pos = start;
  let bits = 0;
  let count = 0;
  const readBit = () => {
    if (count === 0) {
      if (pos >= bytes.length) return 0;
      bits = bytes[pos++];
      // a stuffed 0xFF00 is data; any other marker ends the bits (pad with 0)
      if (bits === 0xff) {
        const next = bytes[pos];
        if (next === 0) pos++;
        else {
          pos--;
          bits = 0;
        }
      }
      count = 8;
    }
    count--;
    return (bits >> count) & 1;
  };
  const receive = (length) => {
    let v = 0;
    for (let i = 0; i < length; i++) v = (v << 1) | readBit();
    return v;
  };
  const extend = (v, length) => (length && v < (1 << (length - 1)) ? v - (1 << length) + 1 : v);
  const decodeHuffman = (table) => {
    let code = readBit();
    let length = 1;
    while (length <= 16 && code > table.maxCode[length]) {
      code = (code << 1) | readBit();
      length++;
    }
    if (length > 16) throw new Error('JPEG data is damaged');
    return table.values[table.pointer[length] + code - table.minCode[length]];
  };

  const coefficients = new Float64Array(64);
  const temp = new Float64Array(64);
  const decodeBlock = (c, bx, by) => {
    coefficients.fill(0);
    const t = decodeHuffman(c.dc);
    const diff = t ? extend(receive(t), t) : 0;
    c.pred += diff;
    coefficients[0] = c.pred * c.q[0];
    for (let k = 1; k < 64;) {
      const rs = decodeHuffman(c.ac);
      const r = rs >> 4;
      const s = rs & 15;
      if (!s) {
        if (r !== 15) break;
        k += 16;
        continue;
      }
      k += r;
      if (k > 63) break;
      const z = ZIGZAG[k];
      coefficients[z] = extend(receive(s), s) * c.q[z];
      k++;
    }
    // inverse DCT: rows, then columns
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        let sum = 0;
        for (let u = 0; u < 8; u++) sum += COS[x * 8 + u] * coefficients[y * 8 + u];
        temp[y * 8 + x] = sum;
      }
    }
    const base = by * 8 * c.stride + bx * 8;
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        let sum = 0;
        for (let v = 0; v < 8; v++) sum += COS[y * 8 + v] * temp[v * 8 + x];
        c.planes[base + y * c.stride + x] = Math.round(sum + 128);
      }
    }
  };

  const single = scan.length === 1;
  const total = single ? Math.ceil(frame.width * scan[0].h / hmax / 8) * Math.ceil(frame.height * scan[0].v / vmax / 8) : mcusX * mcusY;
  for (let n = 0; n < total; n++) {
    if (restartInterval && n && n % restartInterval === 0) {
      // a restart: the bits start afresh after the RSTn marker
      count = 0;
      while (pos < bytes.length && !(bytes[pos] === 0xff && bytes[pos + 1] >= 0xd0 && bytes[pos + 1] <= 0xd7)) pos++;
      pos += 2;
      for (const c of scan) c.pred = 0;
    }
    if (single) {
      // a scan of one component goes block by block, without MCUs
      const c = scan[0];
      const perLine = Math.ceil(frame.width * c.h / hmax / 8);
      decodeBlock(c, n % perLine, Math.floor(n / perLine));
    } else {
      const mx = n % mcusX;
      const my = Math.floor(n / mcusX);
      for (const c of scan) {
        for (let v = 0; v < c.v; v++) {
          for (let h = 0; h < c.h; h++) decodeBlock(c, mx * c.h + h, my * c.v + v);
        }
      }
    }
  }
  // past the remaining bits, to the next marker
  while (pos < bytes.length && !(bytes[pos] === 0xff && bytes[pos + 1] !== 0 && !(bytes[pos + 1] >= 0xd0 && bytes[pos + 1] <= 0xd7))) pos++;
  return pos;
}

// The decoded components as RGBA pixels
function toRGBA(frame) {
  const {width, height, components} = frame;
  const hmax = Math.max(...components.map((c) => c.h));
  const vmax = Math.max(...components.map((c) => c.v));
  const data = new Uint8ClampedArray(width * height * 4);
  // a component's sample at an image pixel (subsampled ones are stretched)
  const sample = (c, x, y) => c.planes[Math.floor(y * c.v / vmax) * c.stride + Math.floor(x * c.h / hmax)];
  if (components.length === 1) {
    const c = components[0];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = sample(c, x, y);
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
  } else if (components.length === 3) {
    const [Y, Cb, Cr] = components;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const l = sample(Y, x, y);
        const b = sample(Cb, x, y) - 128;
        const r = sample(Cr, x, y) - 128;
        const i = (y * width + x) * 4;
        data[i] = l + 1.402 * r;
        data[i + 1] = l - 0.344136 * b - 0.714136 * r;
        data[i + 2] = l + 1.772 * b;
        data[i + 3] = 255;
      }
    }
  } else {
    throw new Error(`JPEG with ${components.length} components (CMYK?) is not supported`);
  }
  return {width, height, data: new Uint8Array(data.buffer)};
}

module.exports = {decode};
