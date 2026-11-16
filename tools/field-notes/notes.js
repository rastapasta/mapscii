#!/usr/bin/env node
// mapscii-notes: field notes on the command line. See README.md.
'use strict';
const fs = require('fs');
const path = require('path');
const envPaths = require('env-paths');
const FieldNotes = require('../../src/FieldNotes');
const SavedPlaces = require('../../src/SavedPlaces');
const resolvePlace = require('../../src/resolvePlace');
const Gpx = require('../../src/Gpx');

const paths = envPaths('mapscii');
const defaultFile = process.env.MAPSCII_NOTES || path.join(paths.data, 'notes.geojson');

// Stops with a message
function fail(message) {
  console.error(message);
  process.exit(1);
}

// The place a text means, using the saved places and the search index
function place(text) {
  let placeIndex = null;
  try {
    placeIndex = new (require('../../src/PlaceIndex'))(path.join(paths.data, 'places.sqlite'));
  } catch (error) {
    void 0;
  }
  try {
    const found = resolvePlace(text, {savedPlaces: new SavedPlaces(path.join(paths.config, 'places.txt')), placeIndex});
    if (found.kind && found.kind !== 'saved' && found.kind !== 'plus code') {
      console.error(`(${text}: ${found.name}, ${found.kind}, ${+found.lat.toFixed(5)}, ${+found.lon.toFixed(5)})`);
    }
    return found;
  } catch (error) {
    fail(`${text}: ${error.message}`);
  }
}

// Runs a command, showing its errors as a message, not a stack trace
const run = (handler) => (argv) => {
  try {
    handler(argv);
  } catch (error) {
    fail(error.message);
  }
};

// The distance between two places in km
function distanceKm(a, b) {
  return Gpx.length([a, b]);
}

// A note as a line for the list
function show(note, near) {
  const where = `${+note.lat.toFixed(5)}, ${+note.lon.toFixed(5)}`;
  const away = near ? `  ${distanceKm(near, note).toFixed(1)} km` : '';
  const tags = note.tags.length ? `  [${note.tags.join(', ')}]` : '';
  return `${note.id.slice(0, 10)}  ${note.title}${tags}  (${where})${away}`;
}

// The --tag values, comma-separated ones split
const tags = (argv) => (argv.tag || []).flatMap((t) => String(t).split(','));

require('yargs')
  .usage('Usage: $0 <command> [options]')
  .option('file', {describe: 'The notebook (a GeoJSON file)', default: defaultFile, type: 'string', global: true})
  .command('add <title>', 'Add a note at a place', (y) => y
    .option('at', {describe: 'Where: coordinates in any notation, or a saved place', type: 'string', demandOption: true})
    .option('text', {describe: 'The note itself', type: 'string', default: ''})
    .option('tag', {describe: 'A tag (can be given several times, or comma separated)', type: 'array'})
    .option('photo', {describe: 'Path of a photo of the place', type: 'string'}),
  run((argv) => {
    const {lat, lon} = place(argv.at);
    const note = new FieldNotes(argv.file).add({lat, lon, title: argv.title, text: argv.text, tags: tags(argv), photo: argv.photo});
    console.log(`Added ${show(note)}`);
  }))
  .command('list', 'List the notes (the nearest first with --near)', (y) => y
    .option('near', {describe: 'A place: list by distance from it', type: 'string'})
    .option('km', {describe: 'With --near: only notes within this distance', type: 'number'})
    .option('tag', {describe: 'Only notes with this tag', type: 'array'}),
  run((argv) => {
    let notes = new FieldNotes(argv.file).list();
    const wanted = tags(argv).map((t) => t.toLowerCase());
    if (wanted.length) notes = notes.filter((n) => wanted.every((t) => n.tags.includes(t)));
    const near = argv.near ? place(argv.near) : null;
    if (near) {
      notes.sort((a, b) => distanceKm(near, a) - distanceKm(near, b));
      if (argv.km !== undefined) notes = notes.filter((n) => distanceKm(near, n) <= argv.km);
    }
    for (const note of notes) console.log(show(note, near));
    console.error(`${notes.length} note${notes.length === 1 ? '' : 's'} (${argv.file})`);
  }))
  .command('show <id>', 'Show a note in full (the start of its id is enough)', () => {}, run((argv) => {
    const notes = new FieldNotes(argv.file);
    const note = notes.list().find((n) => n.id.startsWith(String(argv.id)));
    if (!note) fail(`no note ${argv.id}`);
    console.log([
      note.title, `${note.lat}, ${note.lon}`, note.tags.length ? `tags: ${note.tags.join(', ')}` : null,
      note.photo ? `photo: ${note.photo}` : null, `created ${note.created}, changed ${note.updated}`, `id ${note.id}`,
      note.text ? `\n${note.text}` : null,
    ].filter((line) => line !== null).join('\n'));
  }))
  .command('edit <id>', 'Change a note', (y) => y
    .option('title', {type: 'string'}).option('text', {type: 'string'})
    .option('tag', {describe: 'The new tags (replace the old ones)', type: 'array'})
    .option('at', {describe: 'A new position', type: 'string'}).option('photo', {type: 'string'}),
  run((argv) => {
    const changes = {title: argv.title, text: argv.text, photo: argv.photo, tags: argv.tag ? tags(argv) : undefined};
    if (argv.at) Object.assign(changes, (({lat, lon}) => ({lat, lon}))(place(argv.at)));
    try {
      console.log(`Changed ${show(new FieldNotes(argv.file).update(String(argv.id), changes))}`);
    } catch (error) {
      fail(error.message);
    }
  }))
  .command('remove <id>', 'Remove a note', () => {}, run((argv) => {
    try {
      console.log(`Removed ${show(new FieldNotes(argv.file).remove(String(argv.id)))}`);
    } catch (error) {
      fail(error.message);
    }
  }))
  .command('find <text>', 'Search titles, notes and tags', () => {}, run((argv) => {
    const found = new FieldNotes(argv.file).search(argv.text);
    for (const note of found) console.log(show(note));
    if (!found.length) fail(`no note matches "${argv.text}"`);
  }))
  .command('export', 'Write the notes for others or other programs', (y) => y
    .option('format', {choices: ['geojson', 'csv', 'gpx'], default: 'geojson'})
    .option('out', {describe: 'File to write (default: the screen)', type: 'string'}),
  run((argv) => {
    const notes = new FieldNotes(argv.file).list();
    const text = argv.format === 'csv' ? FieldNotes.toCSV(notes) : argv.format === 'gpx' ? FieldNotes.toGPX(notes) :
      JSON.stringify(FieldNotes.toGeoJSON(notes), null, 1) + '\n';
    if (argv.out) {
      fs.writeFileSync(argv.out, text);
      console.error(`Wrote ${notes.length} notes to ${argv.out}`);
    } else {
      process.stdout.write(text);
    }
  }))
  .command('import <from>', 'Add the notes of another notebook (GeoJSON) or the waypoints of a GPX file', () => {}, run((argv) => {
    let others;
    try {
      const text = fs.readFileSync(argv.from, 'utf8');
      if (/<gpx[\s>]/.test(text)) {
        const crypto = require('crypto');
        others = Gpx.parse(text).waypoints.map((w) => ({
          id: crypto.createHash('sha1').update(`${w.lat},${w.lon},${w.name || ''}`).digest('hex').slice(0, 12),
          lat: w.lat, lon: w.lon, title: w.name || 'Waypoint', text: '', tags: ['gpx'], photo: null,
          created: w.time || null, updated: w.time || null,
        }));
      } else {
        others = FieldNotes.fromGeoJSON(JSON.parse(text));
      }
      // GPX waypoints have no ids: one matching a note's place and title is that note
      const mine = new FieldNotes(argv.file).list();
      others = others.map((other) => {
        const same = mine.find((n) => n.title === other.title && Math.abs(n.lat - other.lat) < 1e-5 && Math.abs(n.lon - other.lon) < 1e-5);
        return same ? Object.assign({}, other, {id: same.id, updated: same.updated}) : other;
      });
    } catch (error) {
      fail(`${argv.from}: ${error.code === 'ENOENT' ? 'no such file' : error.message}`);
    }
    const {added, updated} = new FieldNotes(argv.file).merge(others);
    console.log(`${added} notes added, ${updated} updated, ${others.length - added - updated} already known (${argv.file})`);
  }))
  .demandCommand(1, 'Say what to do, e.g.: notes add "Water point" --at "5.6037, -0.187" --tag water')
  .strict()
  .help()
  .parse();
