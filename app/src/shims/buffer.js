/* The parts of Node's Buffer that MapSCII uses, on a Uint8Array */
'use strict';
class AppBuffer extends Uint8Array {
  // A buffer of this size, filled
  static alloc(size, fill = 0) {
    const b = new AppBuffer(size);
    if (fill) b.fill(fill);
    return b;
  }

  // A buffer from an ArrayBuffer, a string or an array
  static from(source, offset, length) {
    if (source instanceof ArrayBuffer) return new AppBuffer(source, offset || 0, length === undefined ? source.byteLength - (offset || 0) : length);
    if (typeof source === 'string') return new AppBuffer(new TextEncoder().encode(source));
    const b = new AppBuffer(source.length);
    b.set(source);
    return b;
  }

  // The buffers joined
  static concat(list) {
    let size = 0;
    for (const part of list) size += part.length;
    const out = new AppBuffer(size);
    let at = 0;
    for (const part of list) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  // Whether the value is a buffer
  static isBuffer(value) {
    return value instanceof AppBuffer;
  }

  // Reads a big-endian 32-bit unsigned number
  readUInt32BE(at = 0) {
    return ((this[at] << 24) >>> 0) + ((this[at + 1] << 16) | (this[at + 2] << 8) | this[at + 3]);
  }

  // Writes a big-endian 32-bit unsigned number
  writeUInt32BE(value, at = 0) {
    this[at] = value >>> 24;
    this[at + 1] = value >>> 16;
    this[at + 2] = value >>> 8;
    this[at + 3] = value;
    return at + 4;
  }

  // Reads a big-endian 16-bit unsigned number
  readUInt16BE(at = 0) {
    return (this[at] << 8) | this[at + 1];
  }

  // The bytes as text: utf8, latin1 or hex
  toString(encoding = 'utf8', start = 0, end = this.length) {
    const part = this.subarray(start, end);
    if (encoding === 'latin1' || encoding === 'ascii' || encoding === 'binary') return String.fromCharCode(...part);
    if (encoding === 'hex') return Array.from(part, (b) => b.toString(16).padStart(2, '0')).join('');
    return new TextDecoder().decode(part);
  }

  // Whether two buffers hold the same bytes
  equals(other) {
    if (!other || other.length !== this.length) return false;
    for (let i = 0; i < this.length; i++) if (this[i] !== other[i]) return false;
    return true;
  }

  // Copies bytes into another buffer
  copy(target, targetStart = 0, start = 0, end = this.length) {
    target.set(this.subarray(start, end), targetStart);
    return end - start;
  }
}
module.exports = AppBuffer;
