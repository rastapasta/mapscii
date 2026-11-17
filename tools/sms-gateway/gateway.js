#!/usr/bin/env node
// mapscii-sms: answers text messages about places. See README.md.
'use strict';
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const envPaths = require('env-paths');
const Answers = require('./Answers');
const Gateway = require('./Gateway');
const Modem = require('./Modem');
const PlaceIndex = require('../../src/PlaceIndex');
const SavedPlaces = require('../../src/SavedPlaces');
const FieldNotes = require('../../src/FieldNotes');

const paths = envPaths('mapscii');
// A comma-separated list as an array
const list = (text) => text ? String(text).split(',').map((s) => s.trim()).filter(Boolean) : [];

const argv = require('yargs')
  .usage('Usage: $0 --modem /dev/ttyUSB0 | --http 8090 | --ask "Kumasi"')
  .option('modem', {describe: 'A GSM modem (USB dongle), e.g. /dev/ttyUSB0', type: 'string'})
  .option('baud', {describe: 'With --modem: the speed of the serial port', type: 'number', default: 115200})
  .option('http', {describe: 'For an Android SMS gateway app: take messages on this port (POST /sms)', type: 'number'})
  .option('ask', {describe: 'Try it: print the reply to this message', type: 'string'})
  .option('from', {describe: 'With --ask: the sender', type: 'string', default: '+000000000'})
  .option('allow', {describe: 'Only answer these numbers (comma separated)', type: 'string'})
  .option('notes-from', {describe: 'Numbers which may add field notes by SMS (comma separated, * for all)', type: 'string'})
  .option('notes', {describe: 'The field notes (GeoJSON)', type: 'string', default: process.env.MAPSCII_NOTES || path.join(paths.data, 'notes.geojson')})
  .option('max-per-hour', {describe: 'Replies to one number in an hour, at most', type: 'number', default: 10})
  .option('max-per-day', {describe: 'Replies in a day, at most (they cost credit)', type: 'number', default: 100})
  .option('token', {describe: 'With --http: a secret the app must send along', type: 'string'})
  .strict()
  .help()
  .argv;

// Stops with a message
function fail(message) {
  console.error(message);
  process.exit(1);
}

let placeIndex = null;
try {
  placeIndex = new PlaceIndex(path.join(paths.data, 'places.sqlite'));
} catch (error) {
  console.error(`(no search index: only coordinates and plus codes are understood - ${error.message})`);
}
const TileSource = require('../../src/TileSource');
const Router = require('../../src/Router');
const tileSource = new TileSource();
const ready = Promise.resolve(tileSource.init(require('../../src/config').source)).then(() => true, () => false);
const answers = new Answers({
  placeIndex,
  savedPlaces: new SavedPlaces(path.join(paths.config, 'places.txt')),
  fieldNotes: new FieldNotes(argv.notes),
  notesFrom: list(argv['notes-from']),
});
ready.then((ok) => {
  if (ok) answers.router = new Router(tileSource);
});
const gateway = new Gateway(answers, {
  allow: list(argv.allow), maxPerHour: argv['max-per-hour'], maxPerDay: argv['max-per-day'],
  logFile: path.join(paths.data, 'sms-log.jsonl'), token: argv.token || null,
});

// Answers --ask, or starts the gateway on a modem or over HTTP
async function main() {
  if (argv.ask !== undefined) {
    await ready.then((ok) => {
      if (ok) answers.router = new Router(tileSource);
    });
    const reply = await answers.reply(argv.ask, argv.from);
    console.log(`${reply}\n(${Modem.fit(reply).length} characters as SMS: "${Modem.fit(reply)}")`);
    return;
  }
  if (!argv.modem && argv.http === undefined) {
    fail('Say how messages come in: --modem /dev/ttyUSB0 (a GSM modem) or --http 8090 (an SMS gateway app), or try it: --ask "Kumasi"');
  }
  if (argv.http !== undefined) {
    const port = await gateway.listen(argv.http);
    console.log(`Taking messages on port ${port}: POST /sms with "from" and "text"; the reply is the response.`);
  }
  if (argv.modem) {
    try {
      execFileSync('stty', ['-F', argv.modem, String(argv.baud), 'raw', '-echo'], {stdio: 'ignore'});
    } catch (error) {
      void 0;
    }
    if (!fs.existsSync(argv.modem)) fail(`${argv.modem}: no such device - is the modem plugged in? (see: ls /dev/ttyUSB* /dev/ttyACM*)`);
    const input = fs.createReadStream(argv.modem);
    const output = fs.createWriteStream(argv.modem);
    input.on('error', (error) => fail(`${argv.modem}: ${error.code === 'EACCES' ? 'no permission (add yourself to the group "dialout")' : error.message}`));
    const modem = new Modem(input, output, {log: process.env.DEBUG ? (line) => console.error(line) : () => null});
    await gateway.useModem(modem, {onError: (error) => console.error(`modem: ${error.message}`)});
    console.log(`Answering messages on ${argv.modem}${modem.ucs2 ? '' : ' (GSM characters only)'}.`);
  }
  console.log(`Limits: ${argv['max-per-hour']} replies per number and hour, ${argv['max-per-day']} a day${argv.allow ? `, only to ${argv.allow}` : ''}. Log: ${gateway.logFile}`);
  setInterval(() => {
    process.stdout.write(`\r\x1b[K${gateway.stats.received} messages, ${gateway.stats.replied} answered, ${gateway.stats.refused} not`);
  }, 2000);
}

main().catch((error) => fail(error.message));
