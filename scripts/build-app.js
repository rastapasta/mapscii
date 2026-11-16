// Bundles app/src/main.js and its requires into app/dist/app.js, with browser shims for Node modules,
// and writes app/dist/LICENSES.txt.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'app');
// The path of a browser shim
const shim = (name) => path.join(APP, 'src', 'shims', name);

const BUILTINS = {
  zlib: shim('zlib.js'), perf_hooks: shim('perf_hooks.js'), crypto: shim('crypto.js'), path: shim('path.js'), util: shim('util.js'),
  fs: shim('empty.js'), os: shim('empty.js'), http: shim('empty.js'), https: shim('empty.js'),
  child_process: shim('empty.js'), 'node:sqlite': shim('empty.js'), 'env-paths': shim('empty.js'),
  'node-fetch': shim('empty.js'), events: shim('empty.js'), readline: shim('empty.js'),
};
const REPLACED = {
  [path.join(ROOT, 'src', 'Net.js')]: shim('Net.js'),
  [path.join(ROOT, 'src', 'DataMeter.js')]: shim('empty.js'),
  [path.join(ROOT, 'src', 'MBTilesFile.js')]: shim('empty.js'),
};

// Whether a file exists
function exists(file) {
  try {
    return fs.statSync(file).isFile();
  } catch (error) {
    return false;
  }
}

// The file a require() path means: as is, .js, .json or its index.js
function asFile(base) {
  for (const candidate of [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')]) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

// Where require(spec) from a file leads, like Node finds it
function resolve(spec, from) {
  if (BUILTINS[spec]) return BUILTINS[spec];
  let found = null;
  if (spec.startsWith('.') || spec.startsWith('/')) {
    found = asFile(path.resolve(path.dirname(from), spec));
  } else {
    const parts = spec.split('/');
    const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    const rest = parts.slice(spec.startsWith('@') ? 2 : 1).join('/');
    for (let dir = path.dirname(from); ; dir = path.dirname(dir)) {
      const pkgDir = path.join(dir, 'node_modules', name);
      if (fs.existsSync(pkgDir)) {
        if (rest) {
          found = asFile(path.join(pkgDir, rest));
        } else {
          const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
          found = asFile(path.join(pkgDir, pkg.main || 'index.js'));
        }
        break;
      }
      if (dir === path.dirname(dir)) break;
    }
  }
  if (!found) throw new Error(`can't find "${spec}" (required in ${path.relative(ROOT, from)})`);
  return REPLACED[found] || found;
}

// Bundles the entry and every module it requires into one script
function build(entry, out) {
  const modules = new Map();
  const ids = new Map();
  const todo = [shim('buffer.js'), entry];
  while (todo.length) {
    const file = todo.pop();
    if (modules.has(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    const map = {};
    if (!file.endsWith('.json')) {
      // static requires only
      const strip = source.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`])\/\/.*$/gm, '$1');
      for (const [, spec] of strip.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const target = resolve(spec, file);
        map[spec] = target;
        todo.push(target);
      }
    }
    modules.set(file, {source, map});
    ids.set(file, ids.size);
  }
  const entryId = ids.get(entry);
  const bufferId = ids.get(shim('buffer.js'));
  const parts = [];
  for (const [file, {source, map}] of modules) {
    const deps = JSON.stringify(Object.fromEntries(Object.entries(map).map(([spec, target]) => [spec, ids.get(target)])));
    const name = path.relative(ROOT, file);
    const body = file.endsWith('.json') ? `module.exports = ${source.trim()};` : source;
    parts.push(`/* ${name} */ [function (require, module, exports, process, Buffer, global, setImmediate, __dirname, __filename) {\n${body}\n}, ${deps}, ${JSON.stringify(path.dirname(name))}]`);
  }
  const code = `/* built by scripts/build-app.js from MapSCII and the libraries listed in LICENSES.txt */
(function () {
'use strict';
var process = {env: {}, argv: [], platform: 'browser', versions: {}, exitCode: 0,
  stdin: {isTTY: false, on: function () {}}, stdout: {isTTY: false, columns: 0, rows: 0, on: function () {}, write: function () {}},
  on: function () {}, exit: function () {}, cwd: function () { return '/'; },
  nextTick: function (f) { var a = [].slice.call(arguments, 1); Promise.resolve().then(function () { f.apply(null, a); }); },
  hrtime: {bigint: function () { return BigInt(Math.round(performance.now() * 1e6)); }}};
var Buffer;
var channel = new MessageChannel(), waiting = [];
channel.port1.onmessage = function () { var f = waiting.shift(); if (f) f(); };
var setImmediate = function (f) { waiting.push(f); channel.port2.postMessage(0); };
var defs = [
${parts.join(',\n')}
];
var cache = [];
function load(id) {
  if (cache[id]) return cache[id].exports;
  var def = defs[id], module = {exports: {}};
  cache[id] = module;
  def[0].call(module.exports, function (spec) {
    if (!(spec in def[1])) throw new Error('not bundled: ' + spec);
    return load(def[1][spec]);
  }, module, module.exports, process, Buffer, globalThis, setImmediate, def[2], '');
  return module.exports;
}
Buffer = load(${bufferId});
load(${entryId});
})();
`;
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, code);
  return [...modules.keys()];
}

// The licences of MapSCII and of every package bundled
function licences(files) {
  const packages = new Map();
  for (const file of files) {
    // the innermost node_modules folder
    const m = file.match(/^(.*\/node_modules\/((?:@[^/]+\/)?[^/]+))\/(?!.*\/node_modules\/)/);
    if (m) packages.set(m[2], m[1]);
  }
  const text = [`This app is built on MapSCII (https://github.com/rastapasta/mapscii).\n\n${fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8')}`];
  for (const [name, dir] of [...packages].sort()) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const file = fs.readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
    text.push(`----\n${name} ${pkg.version} (${pkg.license || 'see below'})\n\n${file ? fs.readFileSync(path.join(dir, file), 'utf8') : '(no licence file in the package)'}`);
  }
  return text.join('\n\n');
}

// The app icon: a location pin in dots on a dark tile, as a PNG
function icon(size) {
  const Png = require('../src/images/Png');
  const data = new Uint8Array(size * size * 4);
  const k = size / 512;
  const set = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) set(x, y, [11, 15, 12]);
  const inPin = (x, y) => {
    const dx = x - 256;
    const dy = y - 210;
    const r = Math.hypot(dx, dy);
    const tip = y > 210 && y < 430 && Math.abs(dx) < (430 - y) * 0.62;
    return (r < 130 || tip) && r > 48;
  };
  const step = 32;
  for (let cy = step / 2; cy < 512; cy += step) {
    for (let cx = step / 2; cx < 512; cx += step) {
      const on = inPin(cx, cy);
      const colour = on ? [127, 209, 127] : [36, 52, 40];
      const radius = (on ? 11 : 6) * k;
      for (let y = Math.floor((cy - 12) * k); y <= (cy + 12) * k; y++) {
        for (let x = Math.floor((cx - 12) * k); x <= (cx + 12) * k; x++) {
          if (Math.hypot(x - cx * k, y - cy * k) <= radius) set(x, y, colour);
        }
      }
    }
  }
  return Png.encode({width: size, height: size, data});
}

for (const size of [192, 512]) fs.writeFileSync(path.join(APP, `icon-${size}.png`), icon(size));

const files = build(path.join(APP, 'src', 'main.js'), path.join(APP, 'dist', 'app.js'));
fs.writeFileSync(path.join(APP, 'dist', 'LICENSES.txt'), licences(files));
const size = fs.statSync(path.join(APP, 'dist', 'app.js')).size;
console.log(`app/dist/app.js: ${files.length} modules, ${(size / 1024).toFixed(0)} KB`);
