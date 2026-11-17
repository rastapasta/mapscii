// Counts the bytes on the wire (compressed, with TLS) and keeps a total per day.
'use strict';
const fs = require('fs');
const path = require('path');

class DataMeter {
  constructor(file = null) {
    this.file = file;
    this.sockets = new Set();
    this.closedBytes = 0;
    this.savedBytes = 0;
  }

  // Counts the bytes of every connection this agent opens from now on
  watch(agent) {
    const create = agent.createConnection.bind(agent);
    agent.createConnection = (...args) => {
      const socket = create(...args);
      this.sockets.add(socket);
      socket.once('close', () => {
        this.closedBytes += socketBytes(socket);
        this.sockets.delete(socket);
      });
      return socket;
    };
  }

  // Bytes sent and received this session
  sessionBytes() {
    let bytes = this.closedBytes;
    for (const socket of this.sockets) {
      bytes += socketBytes(socket);
    }
    return bytes;
  }

  // Adds what came since the last save to today's total in the file
  save() {
    if (!this.file) {
      return;
    }
    const session = this.sessionBytes();
    const added = session - this.savedBytes;
    if (added <= 0) {
      return;
    }
    const usage = DataMeter.read(this.file);
    const day = today();
    usage.days[day] = (usage.days[day] || 0) + added;
    try {
      fs.mkdirSync(path.dirname(this.file), {recursive: true});
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(usage));
      fs.renameSync(tmp, this.file);
      this.savedBytes = session;
    } catch (error) {
      void 0;
    }
  }

  // The totals in a file: {days: {'2026-11-09': bytes, ...}}
  static read(file) {
    try {
      const usage = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (usage && usage.days && typeof usage.days === 'object' && !Array.isArray(usage.days)) {
        const days = {};
        for (const [day, bytes] of Object.entries(usage.days)) {
          if (/^\d{4}-\d\d-\d\d$/.test(day) && Number.isFinite(bytes) && bytes >= 0) days[day] = bytes;
        }
        return {days};
      }
    } catch (error) {
      void 0;
    }
    return {days: {}};
  }

  // A report of the totals by day for the last week and by month
  static report(file) {
    const days = DataMeter.read(file).days;
    const keys = Object.keys(days).sort();
    if (!keys.length) {
      return 'No data used yet.';
    }
    const months = {};
    for (const day of keys) {
      months[day.slice(0, 7)] = (months[day.slice(0, 7)] || 0) + days[day];
    }
    const lines = ['Data used by MapSCII (on the line, including TLS):', '', 'Last days:'];
    for (const day of keys.slice(-7)) {
      lines.push(`  ${day}  ${DataMeter.format(days[day]).padStart(9)}`);
    }
    lines.push('', 'Months:');
    for (const month of Object.keys(months)) {
      lines.push(`  ${month}     ${DataMeter.format(months[month]).padStart(9)}`);
    }
    return lines.join('\n');
  }

  // "840 KB", "12.5 MB"
  static format(bytes) {
    if (bytes < 1024 * 1024) {
      return `${Math.round(bytes / 1024)} KB`;
    }
    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }
}

// Bytes a socket has read and written
function socketBytes(socket) {
  return (socket.bytesRead || 0) + (socket.bytesWritten || 0);
}

// The local date as YYYY-MM-DD
function today() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

module.exports = DataMeter;
