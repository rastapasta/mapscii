#!/usr/bin/env node
// mapscii-fleet: the positions of many devices on one map. See README.md.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const envPaths = require('env-paths');
const FleetServer = require('./FleetServer');
const TileServer = require('../../src/TileServer');

const paths = envPaths('mapscii');

// Stops with a message
function fail(message) {
  console.error(message);
  process.exit(1);
}

// The names file ("id = Name" lines) as {id: name}
function readNames(file) {
  if (!file) return {};
  const names = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([^#=]+?)\s*=\s*(.+?)\s*$/);
      if (m) names[m[1]] = m[2];
    }
  } catch (error) {
    fail(`${file}: ${error.code === 'ENOENT' ? 'no such file' : error.message}`);
  }
  return names;
}

// "45 s", "12 min", "3 h"
const ago = (s) => s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;

require('yargs')
  .usage('Usage: $0 <command>')
  .command('serve', 'Collect the positions of the devices', (y) => y
    .option('port', {type: 'number', default: 2950})
    .option('token', {describe: 'A secret the devices must send (token=...)', type: 'string'})
    .option('names', {describe: 'A text file of "device id = name" lines', type: 'string'})
    .option('folder', {describe: 'Where positions and tracks are kept', type: 'string', default: path.join(paths.data, 'fleet')}),
  async (argv) => {
    const server = new FleetServer({folder: argv.folder, token: argv.token || null, names: readNames(argv.names)});
    if (!Number.isInteger(argv.port) || argv.port < 0 || argv.port > 65535) fail('--port: a port number (0-65535)');
    const port = await server.listen(argv.port).catch((error) => fail(error.message));
    const here = TileServer.addresses()[0] || 'localhost';
    console.log(`Fleet server on port ${port}, ${server.devices.size} devices known. Open http://${here}:${port}/ for how to add devices.`);
    console.log(`MapSCII: mapscii --fleet http://${here}:${port}   Tracks: ${path.join(argv.folder, 'tracks')}`);
    setInterval(() => {
      const list = server.list();
      process.stdout.write(`\r\x1b[K${list.length} devices, ${list.filter((d) => d.age <= 600).length} heard in the last 10 min`);
    }, 2000);
    const stop = () => server.stop().then(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  })
  .command('list [server]', 'The devices of a fleet server, the most recent first', () => {}, (argv) => {
    const url = (argv.server || 'http://localhost:2950').replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'http://') + '/devices';
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        let devices;
        try {
          devices = JSON.parse(body);
        } catch (error) {
          fail(`${url} did not answer with devices`);
        }
        for (const d of devices) {
          console.log(`${d.name.padEnd(18)} ${d.lat.toFixed(5)}, ${d.lon.toFixed(5)}  ${d.speed !== undefined ? `${String(Math.round(d.speed)).padStart(3)} km/h` : '        '}  ${ago(d.age)} ago`);
        }
        console.error(`${devices.length} devices`);
      });
    }).on('error', (error) => fail(`${url}: ${error.code === 'ECONNREFUSED' ? 'no fleet server there' : error.message}`));
  })
  .demandCommand(1, 'Say what to do: serve, or list')
  .strict()
  .help()
  .parse();
