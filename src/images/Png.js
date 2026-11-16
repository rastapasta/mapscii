// PNG decoder (8-bit, not interlaced) and a simple RGB(A) encoder.
'use strict';
const zlib = require('zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// A PNG file's bytes to {width, height, data: RGBA}
function decode(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG image');
  let pos = 8;
  let header = null;
  let palette = null;
  let transparency = null;
  const idat = [];
  while (pos + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('latin1', pos + 4, pos + 8);
    const body = buffer.subarray(pos + 8, pos + 8 + length);
    pos += 12 + length;
    if (type === 'IHDR') {
      header = {width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12]};
    } else if (type === 'PLTE') {
      palette = body;
    } else if (type === 'tRNS') {
      transparency = body;
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (!header) throw new Error('PNG without a header');
  const {width, height, depth, color, interlace} = header;
  if (depth !== 8 || interlace) throw new Error(`PNG with ${depth}-bit colour${interlace ? ', interlaced' : ''} is not supported`);
  const channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color];
  if (!channels) throw new Error(`PNG colour type ${color} is not supported`);
  if (color === 3 && !palette) throw new Error('PNG palette is missing');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error('PNG data is cut short');
  // undo the filters, line by line
  const pixels = Buffer.alloc(stride * height);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? out[i - channels] : 0;
      const up = previous[i];
      const upLeft = i >= channels ? previous[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += left;
      else if (filter === 2) v += up;
      else if (filter === 3) v += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        v += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) {
        throw new Error(`PNG filter ${filter} is not known`);
      }
      out[i] = v & 255;
    }
    previous = out;
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += 4) {
    const k = i * channels;
    if (color === 0) {
      data[j] = data[j + 1] = data[j + 2] = pixels[k];
      data[j + 3] = 255;
    } else if (color === 4) {
      data[j] = data[j + 1] = data[j + 2] = pixels[k];
      data[j + 3] = pixels[k + 1];
    } else if (color === 2) {
      data[j] = pixels[k];
      data[j + 1] = pixels[k + 1];
      data[j + 2] = pixels[k + 2];
      data[j + 3] = 255;
    } else if (color === 6) {
      data[j] = pixels[k];
      data[j + 1] = pixels[k + 1];
      data[j + 2] = pixels[k + 2];
      data[j + 3] = pixels[k + 3];
    } else {
      const index = pixels[k];
      data[j] = palette[index * 3];
      data[j + 1] = palette[index * 3 + 1];
      data[j + 2] = palette[index * 3 + 2];
      data[j + 3] = transparency && index < transparency.length ? transparency[index] : 255;
    }
  }
  return {width, height, data};
}

// RGBA pixels as a PNG file
function encode({width, height, data}) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

let table = null;
// The CRC-32 of the bytes
function crc32(buffer) {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buffer) c = table[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

module.exports = {decode, encode};
