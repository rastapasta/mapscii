#!/usr/bin/env node
// mapscii-codes: plus codes as addresses. See README.md.
'use strict';
const fs = require('fs');
const path = require('path');
const envPaths = require('env-paths');
const PlusCode = require('../../src/PlusCode');
const PlaceIndex = require('../../src/PlaceIndex');
const SavedPlaces = require('../../src/SavedPlaces');
const resolvePlace = require('../../src/resolvePlace');

const paths = envPaths('mapscii');

// Stops with a message
function fail(message) {
  console.error(message);
  process.exit(1);
}

let index = null;
// MapSCII's search index, opened once, or null
function placeIndex() {
  if (index === null) {
    try {
      index = new PlaceIndex(path.join(paths.data, 'places.sqlite'));
    } catch (error) {
      index = false;
    }
  }
  return index || null;
}

// The place a text means, or stops with why not
function place(text) {
  try {
    return resolvePlace(text, {savedPlaces: new SavedPlaces(path.join(paths.config, 'places.txt')), placeIndex: placeIndex()});
  } catch (error) {
    fail(`${text}: ${error.message}`);
  }
}

// The address form: the short code with the nearest town
function addressOf(lat, lon) {
  const [town] = placeIndex() ? placeIndex().nearest(lat, lon, {limit: 1}) : [];
  return PlusCode.address(lat, lon, town || null);
}

// One CSV line into cells
function cells(line) {
  const out = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"' && cell === '') {
      // quotes count at the start of a cell only
      quoted = true;
    } else if (c === ',') {
      out.push(cell);
      cell = '';
    } else {
      cell += c;
    }
  }
  out.push(cell);
  return out;
}

// A value as a CSV cell
const csvCell = (value) => /[",\n\r]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value);

require('yargs')
  .usage('Usage: $0 <command>')
  .command('encode <place..>', 'The plus code of a place (coordinates, a saved place or a place name)', () => {}, (argv) => {
    const {lat, lon} = place(argv.place.join(' '));
    console.log(`${addressOf(lat, lon)}`);
    console.log(`full code: ${PlusCode.encode(lat, lon)} (about 14 x 14 m), ${PlusCode.encode(lat, lon, 11)} (about 3 x 3 m)`);
  })
  .command('decode <code..>', 'Where a plus code is (a short one with its town: JR37+F6 Accra)', () => {}, (argv) => {
    const found = place(argv.code.join(' '));
    if (found.kind !== 'plus code') fail(`${argv.code.join(' ')} has no plus code`);
    const area = PlusCode.decode(found.name);
    console.log(`${+found.lat.toFixed(6)}, ${+found.lon.toFixed(6)}`);
    console.log(`full code: ${found.name}, an area of ${area.south.toFixed(6)}..${area.north.toFixed(6)}, ${area.west.toFixed(6)}..${area.east.toFixed(6)}`);
  })
  .command('csv <file>', 'Add plus codes to a CSV file with latitude and longitude columns - or coordinates to one with a plus code column', (y) => y
    .option('out', {describe: 'The file to write (default: the screen)', type: 'string'}),
  (argv) => {
    let text;
    try {
      text = fs.readFileSync(argv.file, 'utf8');
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    } catch (error) {
      fail(`${argv.file}: ${error.code === 'ENOENT' ? 'no such file' : error.message}`);
    }
    const lines = text.split(/\r?\n/).filter((line, i, all) => line !== '' || i < all.length - 1);
    const header = cells(lines[0]).map((h) => h.trim());
    const find = (re) => header.findIndex((h) => re.test(h));
    const latCol = find(/^(lat|latitude|y)$/i);
    const lonCol = find(/^(lon|lng|long|longitude|x)$/i);
    const codeCol = find(/^(plus.?code|pluscode|olc|code)$/i);
    const out = [];
    let done = 0;
    let bad = 0;
    if (latCol !== -1 && lonCol !== -1) {
      out.push([...header, 'plus_code', 'address'].map(csvCell).join(','));
      for (const line of lines.slice(1)) {
        const row = cells(line);
        const lat = parseFloat(row[latCol]);
        const lon = parseFloat(row[lonCol]);
        if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
          row.push(PlusCode.encode(lat, lon), addressOf(lat, lon));
          done++;
        } else {
          row.push('', '');
          bad++;
        }
        out.push(row.map(csvCell).join(','));
      }
    } else if (codeCol !== -1) {
      out.push([...header, 'latitude', 'longitude'].map(csvCell).join(','));
      for (const line of lines.slice(1)) {
        const row = cells(line);
        try {
          const found = resolvePlace(row[codeCol], {placeIndex: placeIndex()});
          row.push(+found.lat.toFixed(6), +found.lon.toFixed(6));
          done++;
        } catch (error) {
          row.push('', '');
          bad++;
        }
        out.push(row.map(csvCell).join(','));
      }
    } else {
      fail('the first line needs columns "latitude" and "longitude" (or "lat", "lon"), or "plus_code"');
    }
    const result = out.join('\r\n') + '\r\n';
    if (argv.out) {
      fs.writeFileSync(argv.out, result);
    } else {
      process.stdout.write(result);
    }
    console.error(`${done} row${done === 1 ? '' : 's'} converted${bad ? `, ${bad} could not be read (left empty)` : ''}`);
  })
  .demandCommand(1, 'Say what to do, e.g.: codes encode 5.6037, -0.187')
  .strict()
  .help()
  .parse();
