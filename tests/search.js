'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');
const {Search, coordinates, sqliteProvider, clip} = require('../src/Search');
const Mapscii = require('../src/Mapscii');
const width = require('string-width');

const results = [{label: 'München, BY, DE', lat: 48.14, lon: 11.58},
  {label: 'Munich, US', lat: 48.67, lon: -98.83}];
const tick = () => new Promise(resolve => setImmediate(resolve));
const tests = [];
function test(name, run) { tests.push({name, run}); }
function setup(provider = async () => results, timeout = 1000) {
  const selected = [];
  const search = new Search({provider, select: p => selected.push(p), changed: () => {}, timeout});
  search.open();
  return {search, selected};
}

test('coordinate grammar and bounds', () => {
  assert.deepStrictEqual(coordinates(' -12.5, 130.25, 8 '), {lat: -12.5, lon: 130.25, zoom: 8, label: '-12.5, 130.25'});
  assert.equal(coordinates('Berlin'), null);
  assert.equal(coordinates('1,2 rubbish'), null);
  assert.throws(() => coordinates('91,0'));
  assert.throws(() => coordinates('0,181'));
  assert.throws(() => coordinates('0,0,-1'));
});

test('coordinates need no provider', async () => {
  const {search, selected} = setup(() => { throw new Error('must not be called'); });
  search.key({}, '48,11,9');
  await search.submit();
  assert.equal(selected[0].zoom, 9);
  assert.equal(search.active, false);
});

test('Unicode editing and size limit', () => {
  const {search} = setup();
  search.key({}, '東京🙂');
  search.key({name: 'left'});
  search.key({name: 'backspace'});
  assert.equal(search.text.join(''), '東🙂');
  search.key({ctrl: true, name: 'u'});
  search.key({}, 'x'.repeat(1000));
  assert.equal(search.text.length, 256);
  assert(width(search.footer(12)) <= 12);
  search.cancel();
});

test('result navigation, selection and editing', async () => {
  const {search, selected} = setup();
  search.key({}, 'Munich');
  await search.submit();
  assert.equal(search.mode, 'results');
  search.key({name: 'down'});
  assert.equal(search.index, 1);
  search.key({name: 'return'});
  assert.deepStrictEqual(selected, [results[1]]);
});

test('stale responses cannot replace a newer search', async () => {
  let resolveFirst;
  const {search} = setup(query => query === 'old' ? new Promise(r => { resolveFirst = r; }) : results);
  search.key({}, 'old');
  const first = search.submit();
  await tick();
  search.key({name: 'escape'});
  search.open();
  search.key({}, 'new');
  await search.submit();
  resolveFirst([{lat: 0, lon: 0, label: 'stale'}]);
  await first;
  assert.equal(search.results[0].label, results[0].label);
  search.cancel();
});

test('provider timeout recovers input', async () => {
  const {search} = setup(() => new Promise(() => {}), 10);
  search.key({}, 'test');
  await search.submit();
  assert.equal(search.mode, 'input');
  assert(search.message.includes('timed out'));
  search.cancel();
});

test('invalid results and terminal controls', async () => {
  const {search} = setup(async () => [{lat: NaN, lon: 0, label: 'bad'},
    {lat: 1, lon: 2, label: '\x1b[31mGood\nplace'}]);
  search.key({}, 'test');
  await search.submit();
  assert.equal(search.results.length, 1);
  assert(!/[\x00-\x1f\x7f-\x9f]/.test(search.footer(200)));
  assert(width(clip('東京🙂abcdef', 7)) <= 7);
  search.cancel();
});

test('modal keys do not zoom, pan or quit; mouse does not move map', () => {
  const output = {columns: 40, write() {}};
  let quit = false;
  const map = new Mapscii({output, headless: false, quitCallback() { quit = true; }});
  map._draw = () => {};
  map._onKey({}, '/');
  const center = {...map.center};
  const zoom = map.zoom;
  for (const ch of 'qazhjk+-') map._onKey({name: ch}, ch);
  map._onKey({name: 'left'});
  map._onMouseScroll({x: 10, y: 10, button: 'up'});
  assert.equal(quit, false);
  assert.equal(map.zoom, zoom);
  assert.deepStrictEqual(map.center, center);
  assert.equal(map.search.text.join(''), 'qazhjk+-');
  map.search.cancel();
});

test('late map frames retain search prompt and footer does not wrap', async () => {
  let complete;
  const writes = [];
  const map = new Mapscii({output: {columns: 14, write: text => writes.push(text)}, headless: false});
  map.renderer = {draw: () => new Promise(r => { complete = r; })};
  map._draw();
  map.search.open();
  map.search.key({}, 'London');
  complete('frame');
  await tick();
  assert(writes[writes.length - 1].includes('/London|'));
  assert(width(writes[writes.length - 1]) <= 13);
  map.search.cancel();
});

test('real SQLite index: UTF-8, aliases, ranking and SQL/FTS metacharacters', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'mapscii-search-test-'));
  try {
    const source = path.join(folder, 'cities.txt');
    const database = path.join(folder, 'search.sqlite');
    const row = (id, name, ascii, aliases, lat, lon, pop) =>
      [id, name, ascii, aliases, lat, lon, 'P', 'PPL', 'DE', '', 'BY', '', '', '', pop, '', '', 'Europe/Berlin', '2026-01-01'].join('\t');
    fs.writeFileSync(source, [row(1, 'München', 'Munchen', 'Munich,慕尼黑', 48.14, 11.58, 1500000),
      row(2, 'Munich', 'Munich', '', 48.67, -98.83, 200),
      row(3, "L'Aquila", 'LAquila', '', 42.35, 13.4, 70000)].join('\n'));
    execFileSync('python3', [path.join(__dirname, '../tools/maps-search-index'), source, '--output', database]);
    const provider = sqliteProvider(database, process.env.MAPSCII_SQLITE || 'sqlite3');
    assert.equal((await provider('munich'))[0].name, 'München');
    assert.equal((await provider('München'))[0].name, 'München');
    assert.equal((await provider('慕尼黑'))[0].name, 'München');
    assert.equal((await provider("L'Aquila"))[0].name, "L'Aquila");
    await provider("x' OR 1=1; DROP TABLE places; --");
    await provider('" OR * NOT (');
    assert.equal((await provider('Munich')).length, 2);
    await assert.rejects(sqliteProvider(path.join(folder, 'absent'))('test'), /No offline index/);
  } finally {
    for (const file of fs.readdirSync(folder)) fs.unlinkSync(path.join(folder, file));
    fs.rmdirSync(folder);
  }
});

(async () => {
  for (const {name, run} of tests) {
    await run();
    process.stdout.write(`ok - ${name}\n`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
