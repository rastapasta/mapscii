#!/usr/bin/env node
// mapscii-route: offline directions along the map's roads. See README.md.
'use strict';
const fs = require('fs');
const path = require('path');
const envPaths = require('env-paths');
const TileSource = require('../../src/TileSource');
const DataMeter = require('../../src/DataMeter');
const Router = require('../../src/Router');
const PlaceIndex = require('../../src/PlaceIndex');
const SavedPlaces = require('../../src/SavedPlaces');
const resolvePlace = require('../../src/resolvePlace');
const config = require('../../src/config');

const paths = envPaths('mapscii');
TileSource.meter.file = path.join(paths.data, 'usage.json');
process.on('exit', () => TileSource.meter.save());

const argv = require('yargs')
  .usage('Usage: $0 <from> <to> [--by car|bike|foot]\n\nPlaces: coordinates, plus codes, saved places or names of places in the maps seen.')
  .demandCommand(2, 'Give where from and where to, e.g.: route "Office" "Alexanderplatz" --by foot')
  .option('by', {choices: ['car', 'bike', 'foot'], default: 'car'})
  .option('offline', {describe: 'Use only the tiles already on this computer', type: 'boolean'})
  .option('gpx', {describe: 'Also write the route as a GPX file', type: 'string'})
  .option('tile_source', {describe: 'The tile source (mapscii, openfreemap, a URL or a map pack)', type: 'string', default: config.source})
  .strict()
  .help()
  .argv;

// Stops with a message
function fail(message) {
  console.error(message);
  process.exit(1);
}

// Plans the route and prints the directions, or writes them as GPX
async function main() {
  let placeIndex = null;
  try {
    placeIndex = new PlaceIndex(path.join(paths.data, 'places.sqlite'));
  } catch (error) {
    void 0;
  }
  const savedPlaces = new SavedPlaces(path.join(paths.config, 'places.txt'));
  const place = (text) => {
    try {
      return resolvePlace(text, {savedPlaces, placeIndex});
    } catch (error) {
      return fail(`${text}: ${error.message}`);
    }
  };
  const [fromText, toText] = argv._.map(String);
  const a = place(fromText);
  const b = place(toText);
  const tileSource = new TileSource();
  await tileSource.init(argv.tile_source);
  const result = await new Router(tileSource).route(a, b, {
    mode: argv.by, download: !argv.offline,
    onProgress: (done, total) => process.stderr.write(`\r\x1b[Kreading the roads: ${done}/${total} tiles`),
  }).catch((error) => fail(`\r\x1b[K${error.message}`));
  process.stderr.write('\r\x1b[K');
  await tileSource.flushWrites();
  const minutes = result.minutes < 90 ? `${Math.max(1, Math.round(result.minutes))} min` : `${Math.floor(result.minutes / 60)} h ${Math.round(result.minutes % 60)} min`;
  console.log(`${a.name || fromText} to ${b.name || toText}: ${result.km < 10 ? result.km.toFixed(1) : Math.round(result.km)} km, about ${minutes} by ${argv.by}`);
  result.steps.forEach((step, i) => console.log(`${String(i + 1).padStart(3)}. ${step.text}`));
  console.log(result.note + (result.missing ? ` ${result.missing} of the ${result.tiles} map tiles were missing.` : ''));
  if (TileSource.meter.sessionBytes()) console.log(`(${DataMeter.format(TileSource.meter.sessionBytes())} downloaded)`);
  if (argv.gpx) {
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const points = result.points.map((p) => `<rtept lat="${+p.lat.toFixed(6)}" lon="${+p.lon.toFixed(6)}"/>`).join('\n');
    fs.writeFileSync(argv.gpx, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="MapSCII" xmlns="http://www.topografix.com/GPX/1/1">\n<rte><name>${esc(`${fromText} to ${toText}`)}</name>\n${points}\n</rte>\n</gpx>\n`);
    console.log(`Wrote ${argv.gpx}`);
  }
  process.exit(0);
}

main().catch((error) => fail(error.message));
