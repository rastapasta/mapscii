#!/usr/bin/env node
// mapscii-gps: brings a GPS position to MapSCII and records the track. See README.md.
'use strict';
const path = require('path');
const envPaths = require('env-paths');
const GpsBridge = require('./GpsBridge');
const TileServer = require('../../src/TileServer');

const paths = envPaths('mapscii');

const argv = require('yargs')
  .usage('Usage: $0 [source] [options]\n\nWithout a source, phones can report their position over the network (see the page it serves).')
  .option('device', {describe: 'A USB GPS (NMEA), e.g. /dev/ttyACM0 or /dev/ttyUSB0', type: 'string'})
  .option('baud', {describe: 'With --device: the speed of the serial port, e.g. 4800 or 9600', type: 'number'})
  .option('gpsd', {describe: 'gpsd, the GPS service (host:port, default localhost:2947)', type: 'string'})
  .option('tcp', {describe: 'NMEA over TCP, e.g. from a phone app (host:port)', type: 'string'})
  .option('replay', {describe: 'Play back a recorded NMEA or GPX file', type: 'string'})
  .option('speed', {describe: 'With --replay: how many times faster', type: 'number', default: 1})
  .option('loop', {describe: 'With --replay: start over at the end', type: 'boolean'})
  .option('port', {describe: 'Port for MapSCII and phones', type: 'number', default: 2948})
  .option('record', {describe: 'Record the track (a GPX file per day) in this folder; --no-record to not record', default: path.join(paths.data, 'tracks')})
  .option('token', {describe: 'A secret phones must send along (as token=...), so nobody else on the network can send positions', type: 'string'})
  .option('fleet', {describe: 'Pass the position on to a fleet server (tools/fleet), e.g. http://hq:2950', type: 'string'})
  .option('name', {describe: 'With --fleet: the name of this device', type: 'string', default: require('os').hostname()})
  .option('fleet-token', {describe: 'With --fleet: the fleet server\'s token', type: 'string'})
  .option('min-distance', {describe: 'Record a point when moved this many metres', type: 'number', default: 5})
  .option('max-accuracy', {describe: 'Don\'t record points less accurate than this many metres', type: 'number', default: 50})
  .strict()
  .help()
  .argv;

// "host:port" as [host, port], with defaults
function hostPort(text, defaultHost, defaultPort) {
  const m = String(text || '').match(/^\[?([^\]]*?)\]?(?::(\d+))?$/);
  return [(m && m[1]) || defaultHost, +((m && m[2]) || defaultPort)];
}

// Starts the bridge with the sources given
async function main() {
  const bridge = new GpsBridge({
    record: argv.record === false ? null : String(argv.record),
    minDistance: argv['min-distance'],
    maxAccuracy: argv['max-accuracy'],
    token: argv.token || null,
  });
  const sources = [];
  if (argv.device) {
    bridge.device(argv.device, argv.baud);
    sources.push(argv.device);
  }
  if (argv.gpsd !== undefined) {
    const [host, port] = hostPort(argv.gpsd, '127.0.0.1', 2947);
    bridge.gpsd(host, port);
    sources.push(`gpsd ${host}:${port}`);
  }
  if (argv.tcp) {
    const [host, port] = hostPort(argv.tcp, '127.0.0.1', 10110);
    bridge.tcp(host, port);
    sources.push(`NMEA from ${host}:${port}`);
  }
  if (argv.replay) {
    const count = bridge.replay(argv.replay, {speed: argv.speed, loop: argv.loop});
    sources.push(`replay of ${count} positions`);
  }
  if (argv.fleet) {
    bridge.fleet(argv.fleet, argv.name, argv['fleet-token']);
    sources.push(`passed on to ${argv.fleet} as "${argv.name}"`);
  }
  const port = await bridge.listen(argv.port);
  const addresses = TileServer.addresses();
  const here = addresses.length ? addresses[0] : 'localhost';
  console.log(`GPS bridge on port ${port}, from: ${sources.length ? sources.join(', ') : 'phones on the network'}`);
  console.log(`  MapSCII on this computer:  mapscii --gps http://localhost:${port}`);
  console.log(`  phones and other computers: http://${here}:${port}/  (shows how to set up GPSLogger or OwnTracks)`);
  if (bridge.options.record) {
    console.log(`  recording into ${bridge.options.record}`);
  }
  console.log('Press Ctrl+C to stop.');
  const status = setInterval(() => {
    const p = bridge.position;
    const where = p ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}${p.accuracy !== undefined ? ` ±${p.accuracy} m` : ''}${p.speed !== undefined ? ` ${p.speed.toFixed(0)} km/h` : ''}` : '-';
    process.stdout.write(`\r\x1b[K${bridge.stats.status} | ${where} | ${bridge.stats.received} positions, ${bridge.stats.recorded} recorded | ${bridge.clients.size} watching${bridge.stats.fleet ? ` | fleet: ${bridge.stats.fleet}` : ''}`);
  }, 1000);
  const stop = () => {
    clearInterval(status);
    bridge.stop().then(() => {
      console.log(bridge.trackFile() ? `\nTrack saved: ${bridge.trackFile()}` : '');
      process.exit(0);
    });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
