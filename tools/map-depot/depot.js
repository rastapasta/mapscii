#!/usr/bin/env node
// mapscii-depot: keeps map packs of areas, downloading when it is cheap. See README.md.
'use strict';
const path = require('path');
const envPaths = require('env-paths');
const Depot = require('./Depot');
const TileSource = require('../../src/TileSource');
const DataMeter = require('../../src/DataMeter');
const SavedPlaces = require('../../src/SavedPlaces');
const resolvePlace = require('../../src/resolvePlace');
const config = require('../../src/config');

const paths = envPaths('mapscii');
const usageFile = path.join(paths.data, 'usage.json');
TileSource.meter.file = usageFile;
process.on('exit', () => TileSource.meter.save());

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

// Runs a command, showing its errors as a message
const run = (handler) => (argv) => Promise.resolve().then(() => handler(argv)).catch((error) => fail(error.message));
// MB with one decimal below 10
const mb = (value) => value >= 10 ? value.toFixed(0) : value.toFixed(1);

// Shows a download's progress now and then
function progressLine(area, done, total, failed) {
  if (done % 25 === 0 || done === total) {
    process.stdout.write(`\r\x1b[K${area.name}: ${done}/${total} tiles${failed ? `, ${failed} failed` : ''}, ${DataMeter.format(TileSource.meter.sessionBytes())} downloaded`);
  }
}

// Prints what each area got
function report(results) {
  process.stdout.write('\r\x1b[K');
  for (const r of results) {
    if (r.skipped) {
      console.log(`${r.area.name}: waits for the next time`);
      continue;
    }
    if (r.error) {
      console.log(`${r.area.name}: ${r.error}`);
      continue;
    }
    const state = r.complete ? 'complete' : `${Math.floor(r.cached / r.tiles * 100)}% (${r.cached} of ${r.tiles} tiles)${r.stopped ? ', stopped' : ''}${r.failed ? `, ${r.failed} tiles failed` : ''}`;
    console.log(`${r.area.name}: ${state}${r.pack ? ` - pack ${r.pack.file} (${DataMeter.format(r.pack.bytes)})` : ''}`);
  }
  console.log(`${DataMeter.format(TileSource.meter.sessionBytes())} downloaded.`);
}

// The download policy from the options
function policyOf(argv) {
  return {
    hours: argv.hours,
    wifi: argv.wifi ? String(argv.wifi).split(',').map((s) => s.trim()).filter(Boolean) : [],
    notMetered: !!argv['not-metered'],
    dailyMB: argv['daily-mb'],
  };
}

require('yargs')
  .usage('Usage: $0 <command> [options]')
  .option('file', {describe: 'The list of areas', default: path.join(paths.config, 'depot.json'), type: 'string', global: true})
  .option('out', {describe: 'Where the packs go', default: path.join(paths.data, 'packs'), type: 'string', global: true})
  .command('add <name>', 'Add an area to keep (or change it)', (y) => y
    .option('at', {describe: 'Its centre: coordinates, a saved place or a place name', type: 'string', demandOption: true})
    .option('km', {describe: 'Its radius in km', type: 'number', default: 10})
    .option('zoom', {describe: 'The deepest zoom level (14: streets, 10: towns and main roads)', type: 'number', default: 14})
    .option('source', {describe: 'The tile source (mapscii, openfreemap or a URL)', type: 'string', default: 'mapscii'}),
  run(async (argv) => {
    const {lat, lon} = place(argv.at);
    const depot = new Depot(argv.file, usageFile);
    const area = depot.add({name: argv.name, lat, lon, km: argv.km, maxZoom: argv.zoom, source: argv.source});
    const [plan] = await depot.plan([area.name]);
    if (plan.error) {
      console.log(`Added ${area.name}, but its tile source can't be reached now (${plan.error}).`);
      return;
    }
    if (plan.tiles > config.maxDownloadTiles) {
      console.log(`Warning: ${plan.tiles} tiles are more than ${config.maxDownloadTiles} - make it smaller (--km, --zoom)`);
    }
    console.log(`Added ${area.name}: ${area.km} km around ${area.lat}, ${area.lon}, zoom 0-${area.maxZoom}: ${plan.tiles} tiles, about ${mb(plan.missingMB)} MB still to download.`);
  }))
  .command('remove <name>', 'Stop keeping an area (its pack stays)', () => {}, run((argv) => {
    new Depot(argv.file).remove(argv.name);
    console.log(`Removed ${argv.name}.`);
  }))
  .command(['list', 'plan'], 'The areas, and how much is still to download', () => {}, run(async (argv) => {
    const plans = await new Depot(argv.file, usageFile).plan();
    if (!plans.length) {
      console.log('No areas yet. Add one: depot add accra --at "5.6037, -0.187" --km 15');
      return;
    }
    let total = 0;
    for (const p of plans) {
      if (p.error) {
        console.log(`${p.area.name.padEnd(14)} can't be planned now: ${p.error}`);
        continue;
      }
      total += p.missingMB;
      const state = p.missing ? `${p.cached}/${p.tiles} tiles, about ${mb(p.missingMB)} MB to download` : `complete (${p.tiles} tiles)`;
      console.log(`${p.area.name.padEnd(14)} ${String(p.area.km).padStart(5)} km, zoom ${p.area.maxZoom}, ${p.area.source.replace(/^https?:\/\//, '').replace(/\/$/, '')}: ${state}`);
    }
    console.log(`Still to download: about ${mb(total)} MB (estimated from ${config.downloadTileKB} KB a tile). Used today: ${mb(new Depot(argv.file, usageFile).usedTodayMB())} MB.`);
  }))
  .command('build [names..]', 'Download what is missing now and write the packs', (y) => y
    .option('budget', {describe: 'Stop after this many MB', type: 'number'}),
  run(async (argv) => {
    const depot = new Depot(argv.file, usageFile);
    const results = await depot.build(argv.names, {out: argv.out, budgetMB: argv.budget === undefined ? Infinity : argv.budget, onProgress: progressLine});
    report(results);
  }))
  .command('sync [names..]', 'Download only when it is allowed (hours, Wi-Fi, metered, daily limit); --watch keeps doing so', (y) => y
    .option('hours', {describe: 'Only between these times, e.g. 00:00-06:00 (a night bundle)', type: 'string'})
    .option('wifi', {describe: 'Only on these Wi-Fi networks (comma separated names)', type: 'string'})
    .option('not-metered', {describe: 'Only when the connection is not metered (as NetworkManager says)', type: 'boolean'})
    .option('daily-mb', {describe: 'At most this many MB a day, counting MapSCII\'s own use', type: 'number'})
    .option('watch', {describe: 'Keep running, and check again every few minutes', type: 'boolean'})
    .option('every', {describe: 'With --watch: minutes between checks', type: 'number', default: 10}),
  run(async (argv) => {
    const depot = new Depot(argv.file, usageFile);
    const policy = policyOf(argv);
    const once = async () => {
      const allowed = depot.conditions(policy);
      const stamp = new Date().toTimeString().slice(0, 5);
      if (!allowed.ok) {
        console.log(`${stamp} not now: ${allowed.reasons.join(', ')}`);
        return false;
      }
      const plans = await depot.plan(argv.names);
      for (const p of plans.filter((p) => p.error)) {
        console.log(`${stamp} ${p.area.name}: ${p.error}`);
      }
      const todo = plans.filter((p) => p.missing > 0).map((p) => p.area.name);
      if (!todo.length) {
        console.log(`${stamp} all areas are complete`);
        return true;
      }
      // the daily limit also stops a download under way
      const left = policy.dailyMB === undefined ? Infinity : Math.max(0, policy.dailyMB - depot.usedTodayMB());
      // checked once a minute: asking NetworkManager per tile is too much
      let checked = {at: Date.now(), ok: true};
      const shouldStop = () => {
        if (Date.now() - checked.at > 60000) {
          checked = {at: Date.now(), ok: depot.conditions(Object.assign({}, policy, {dailyMB: undefined})).ok};
        }
        return !checked.ok;
      };
      const results = await depot.build(todo, {out: argv.out, budgetMB: left, onProgress: progressLine, shouldStop});
      report(results);
      return results.every((r) => r.complete);
    };
    const done = await once();
    if (!argv.watch) {
      process.exit(done ? 0 : 1);
    }
    console.log(`Checking again every ${argv.every} minutes. Ctrl+C to stop.`);
    setInterval(() => once().catch((error) => console.error(error.message)), argv.every * 60000);
  }))
  .demandCommand(1, 'Say what to do, e.g.: depot add accra --at "5.6037, -0.187" --km 15')
  .strict()
  .help()
  .parse();
