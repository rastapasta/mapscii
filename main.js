/*#
  MapSCII - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>
  Discover the planet in your console!

  This scripts boots up the application.

  TODO: params parsing and so on
#*/
'use strict';
// older Node versions: say so plainly instead of crashing
if (+process.versions.node.split('.')[0] < 16) {
  console.error(`MapSCII needs Node.js 16 or later; this is ${process.version}. Get a newer one at https://nodejs.org/`);
  process.exit(1);
}
const fs = require('fs');
const path = require('path');
const config = require('./src/config');
const Mapscii = require('./src/Mapscii');
const TileSource = require('./src/TileSource');
const DataMeter = require('./src/DataMeter');

// "--goto -33.86,151.21": keep the value with --goto so it isn't taken for an option
const args = process.argv.slice(2);
const gotoIndex = args.indexOf('--goto');
if (gotoIndex !== -1 && gotoIndex + 1 < args.length) {
  args.splice(gotoIndex, 2, `--goto=${args[gotoIndex + 1]}`);
}

const argv = require('yargs')
  .option('latitude', {
    alias: 'lat',
    description: 'Latitude of initial centre',
    default: config.initialLat,
    type: 'number',
  })
  .option('longitude', {
    alias: 'lon',
    description: 'Longitude of initial centre',
    default: config.initialLon,
    type: 'number',
  })
  .option('zoom', {
    alias: 'z',
    description: 'Initial zoom',
    default: config.initialZoom,
    type: 'number',
  })
  .option('width', {
    alias: 'w',
    description: 'Fixed width of rendering',
    type: 'number',
  })
  .option('height', {
    alias: 'h',
    description: 'Fixed height of rendering',
    type: 'number',
  })
  .option('braille', {
    alias: 'b',
    description: 'Activate braille rendering',
    default: config.useBraille,
    type: 'boolean',
  })
  .option('pack', {
    description: 'Write a map pack (an .mbtiles file) to share: the area of --download, or the whole disk cache of the tile source',
    type: 'string',
  })
  .option('serve', {
    description: 'Share the tiles of the tile source (cache or map pack) with other computers on the network, on this port (8080 if none is given)',
    type: 'string',
  })
  .option('find', {
    description: 'Search the names of the maps seen so far (offline) and print the matches',
    type: 'string',
  })
  .option('index', {
    description: 'Add all names in the disk cache (or the map pack of --tile_source) to the search index',
    type: 'boolean',
  })
  .option('places', {
    description: 'List the places saved with s in the map, and the file they are kept in',
    type: 'boolean',
  })
  .option('print', {
    description: 'Print the map once as text and exit: "ansi" (with colours) or "plain"; the default is ansi in a terminal, plain otherwise',
    type: 'string',
  })
  .option('gpx', {
    description: 'Draw the tracks, routes and waypoints of a GPX file over the map (can be given several times)',
    type: 'array',
  })
  .option('notes', {
    description: 'The field notes to show and add to (a GeoJSON file, see tools/field-notes)',
    type: 'string',
  })
  .option('gps', {
    description: 'Show the live position from the GPS bridge (tools/gps-bridge), by default at http://localhost:2948',
    type: 'string',
  })
  .option('export', {
    description: 'Write the map as a page to print or share (map.html), or as a picture (map.svg), and exit',
    type: 'string',
  })
  .option('export-size', {
    description: 'With --export: the size of the map in pixels',
    type: 'string',
    default: '1200x800',
  })
  .option('title', {
    description: 'With --export: the title of the page',
    type: 'string',
  })
  .option('fleet', {
    description: 'Show the devices of a fleet server (tools/fleet), e.g. http://hq:2950',
    type: 'string',
  })
  .option('route', {
    description: 'Show the way along the roads: "from to destination", e.g. "Office to Alexanderplatz"',
    type: 'string',
  })
  .option('navigate', {
    description: 'With --gps: navigate to a place (coordinates, a plus code, a saved place or a name), live from the GPS position',
    type: 'string',
  })
  .option('voice', {
    description: 'Speak the turns when navigating (t in the map switches it; --no-voice starts silent)',
    type: 'boolean',
    default: true,
  })
  .option('by', {
    description: 'With --route and --navigate (and r in the map): by car, bike or foot',
    choices: ['car', 'bike', 'foot'],
    default: 'car',
  })
  .option('layers', {
    description: 'Live layers to show (remembered for next time; o in the map switches them): satellites, quakes, aircraft, weather, traffic, fires, ships - comma separated, or none (traffic, fires and ships need keys: see --keys)',
    type: 'string',
  })
  .option('keys', {
    description: 'Show which API keys are set (for ships, traffic, fires) and how to get them',
    type: 'boolean',
  })
  .option('set-key', {
    description: 'Set an API key, e.g. --set-key tomtom=YOUR_KEY (services: aisstream, tomtom, firms; an empty key removes it)',
    type: 'string',
  })
  .option('view', {
    description: 'Start in a view (v in the map cycles them): map, satellite, hybrid (satellite with roads), relief or 3d',
    choices: ['map', 'satellite', 'hybrid', 'relief', '3d'],
  })
  .option('picture-detail', {
    description: 'How sharp the pictures of the views are: low (a quarter of the data of normal), normal, or high (four times the data)',
    choices: ['low', 'normal', 'high'],
    default: 'normal',
  })
  .option('usage', {
    description: 'Show how much data MapSCII has downloaded, by day and month',
    type: 'boolean',
  })
  .option('prefetch', {
    description: 'Download the tiles around the view in the background (--no-prefetch saves data)',
    default: config.prefetch,
    type: 'boolean',
  })
  .option('headless', {
    alias: 'H',
    description: 'Activate headless mode',
    default: config.headless,
    type: 'boolean',
  })
  .option('tile_source', {
    alias: 'tileSource',
    description: `Tile source: ${Object.keys(config.sources).join(' or ')}, a TileJSON URL, a tile URL with {z}/{x}/{y}, or an .mbtiles file`,
    default: config.source,
    type: 'string',
  })
  .option('tile_schema', {
    alias: 'tileSchema',
    description: 'Data schema of the tile source (detected for TileJSON sources)',
    choices: ['osm2vectortiles', 'openmaptiles'],
    type: 'string',
  })
  .option('style_file', {
    alias: 'style',
    description: 'Style: dark, bright or the path of a JSON style file',
    default: config.styleFile,
    type: 'string',
  })
  .option('goto', {
    description: 'Start at a place and mark it: coordinates (e.g. "42.3601, -71.0942", optionally with a zoom level after them), a plus code, a saved place or a place name',
    type: 'string',
  })
  .option('download', {
    description: 'Download all tiles within this many km around the centre to the disk cache, then exit',
    type: 'number',
  })
  .option('download_max_zoom', {
    alias: 'downloadMaxZoom',
    description: 'Highest zoom level to download with --download',
    default: config.tileRange,
    type: 'number',
  })
  .strict()
  .parse(args);

// Stops with a message, without a stack trace
function fail(message) {
  console.error(message);
  process.exit(1);
}

// stray words, e.g. the 3 of "--download -- 3" ("--" ends the options)
if (argv._.length) {
  fail(`Not understood: ${argv._.join(' ')} (options start with --, e.g. --download 3)`);
}
for (const name of ['latitude', 'longitude', 'zoom', 'width', 'height', 'download', 'download_max_zoom']) {
  if (argv[name] !== undefined && argv[name] !== null && !Number.isFinite(argv[name])) {
    fail(`--${name} needs a number`);
  }
}
// "--download" without a number would otherwise start the map
if (argv.download === undefined && args.some((a) => a === '--download' || a.startsWith('--download='))) {
  fail('--download needs a radius in km greater than 0, e.g. --download 5');
}
if (Math.abs(argv.latitude) > 90) {
  fail('--latitude must be between -90 and 90');
}
for (const name of ['width', 'height']) {
  if (argv[name] !== undefined && argv[name] < 1) {
    fail(`--${name} must be at least 1`);
  }
}
if (argv.download !== undefined && !(argv.download > 0)) {
  fail('--download needs a radius in km greater than 0, e.g. --download 5');
}

if (!fs.existsSync(argv.style_file)) {
  const named = path.join(__dirname, 'styles', `${argv.style_file}.json`);
  if (!fs.existsSync(named)) {
    const names = fs.readdirSync(path.join(__dirname, 'styles')).map((file) => file.replace(/\.json$/, ''));
    fail(`--style: no style file "${argv.style_file}" (bundled styles: ${names.join(', ')})`);
  }
  argv.style_file = named;
}

const SavedPlaces = require('./src/SavedPlaces');
const savedPlacesFile = path.join(TileSource.paths.config, 'places.txt');

let marker = null;
if (argv.goto !== undefined) {
  let place;
  try {
    place = require('./src/resolvePlace')(argv.goto, {savedPlaces: new SavedPlaces(savedPlacesFile), placeIndex: openPlaceIndex()});
  } catch (error) {
    fail(`--goto: ${error.message}`);
  }
  argv.latitude = place.lat;
  argv.longitude = place.lon;
  // the command line's zoom, else the place's
  const zoomGiven = process.argv.some((a) => /^(-z|--zoom)\b/.test(a));
  if (!zoomGiven) {
    argv.zoom = place.zoom !== undefined ? place.zoom : config.goToZoom;
  }
  marker = {lat: place.lat, lon: place.lon};
}

// --gpx: without a place, fit the map to the tracks
const overlays = [];
const summaries = [];
if (argv.gpx) {
  const Gpx = require('./src/Gpx');
  const colors = ['#ff5f87', '#5fd7ff', '#ffd75f', '#87ff5f', '#d787ff'];
  let all = [];
  argv.gpx.forEach((file, i) => {
    let gpx;
    try {
      gpx = Gpx.parse(fs.readFileSync(String(file), 'utf8'));
    } catch (error) {
      fail(`--gpx ${file}: ${error.code === 'ENOENT' ? 'no such file' : error.message}`);
    }
    const lines = gpx.tracks.map((track) => track.points);
    const km = lines.reduce((sum, line) => sum + Gpx.length(line), 0);
    overlays.push({lines, points: gpx.waypoints, color: colors[i % colors.length]});
    summaries.push(`${path.basename(String(file))}: ${km >= 10 ? km.toFixed(0) : km.toFixed(1)} km${gpx.waypoints.length ? `, ${gpx.waypoints.length} waypoints` : ''}`);
    // concat: long tracks have too many points to spread into push
    all = all.concat(...lines, gpx.waypoints);
  });
  if (!all.length) {
    fail('--gpx: no tracks or waypoints in the file');
  }
  if (!positionGiven()) {
    const box = require('./src/Gpx').bounds(all);
    argv.latitude = (box[1] + box[3]) / 2;
    const middle = (box[0] + box[2]) / 2;
    argv.longitude = middle > 180 ? middle - 360 : middle;
    if (argv.zoom === null || argv.zoom === undefined) {
      argv.zoom = fitZoom(box);
    }
  }
}

const routeOverlays = [];
let routeSummary = '';
// Plans the route of --route ("A to B")
async function planRoute() {
  const m = String(argv.route).match(/^(.+?)\s+to\s+(.+)$/i);
  if (!m) {
    fail('--route: "from to destination", e.g. --route "Office to Alexanderplatz"');
  }
  const resolve = require('./src/resolvePlace');
  const opts = {savedPlaces: new SavedPlaces(savedPlacesFile), placeIndex: openPlaceIndex()};
  let a;
  let b;
  try {
    a = resolve(m[1], opts);
    b = resolve(m[2], opts);
  } catch (error) {
    fail(`--route: ${error.message}`);
  }
  const Router = require('./src/Router');
  const tileSource = new TileSource();
  await tileSource.init(argv.tile_source);
  process.stderr.write('Reading the roads for the route...');
  let result;
  try {
    result = await new Router(tileSource).route(a, b, {mode: argv.by});
  } catch (error) {
    fail(`\n--route: ${error.message}`);
  }
  await tileSource.flushWrites();
  process.stderr.write('\n');
  routeOverlays.push({lines: [result.points], points: [{lat: a.lat, lon: a.lon, name: a.name || m[1]}], color: config.routeColor});
  const minutes = result.minutes < 90 ? `${Math.max(1, Math.round(result.minutes))} min` : `${Math.floor(result.minutes / 60)} h ${Math.round(result.minutes % 60)} min`;
  routeSummary = `route ${result.km < 10 ? result.km.toFixed(1) : Math.round(result.km)} km, about ${minutes} by ${argv.by} (an estimate: see tools/routing)`;
  if (!marker) marker = {lat: b.lat, lon: b.lon};
  if (!positionGiven()) {
    const box = require('./src/Gpx').bounds(result.points);
    argv.latitude = (box[1] + box[3]) / 2;
    argv.longitude = (box[0] + box[2]) / 2;
    if (argv.zoom === null || argv.zoom === undefined) argv.zoom = fitZoom(box);
  }
}

const options = {
  initialLat: argv.latitude,
  initialLon: argv.longitude,
  initialZoom: argv.zoom,
  size: {
    width: argv.width,
    height: argv.height
  },
  useBraille: argv.braille,
  headless: argv.headless,
  prefetch: argv.prefetch,
  source: argv.tile_source,
  styleFile: argv.style_file,
  marker,
  savedPlacesFile,
  overlays,
  overlaySummary: summaries.join(', '),
  gpsUrl: argv.gps === undefined ? null : (argv.gps || 'http://localhost:2948').replace(/^(?!https?:\/\/)/, 'http://'),
  gpsZoomIn: argv.gps !== undefined && !positionGiven(),
  navigateBy: argv.by,
  voice: argv.voice,
  fleetUrl: argv.fleet === undefined ? null : (argv.fleet || 'http://localhost:2950').replace(/^(?!https?:\/\/)/, 'http://'),
  // config.layers is something else: the map's name layers
  liveLayers: argv.layers === undefined ? null : (argv.layers === 'none' ? [] : checkLayers(String(argv.layers).split(',').map((s) => s.trim()).filter(Boolean))),
  layersFile: path.join(TileSource.paths.config, 'layers.json'),
  keysFile: path.join(TileSource.paths.config, 'keys.json'),
  liveCacheDir: path.join(TileSource.paths.cache, 'live'),
  pictureCacheDir: path.join(TileSource.paths.cache, 'pictures'),
  view: argv.view,
  notesFile: argv.notes || process.env.MAPSCII_NOTES || path.join(TileSource.paths.data, 'notes.geojson'),
};
if (argv.tile_schema) {
  config.tileSchema = argv.tile_schema;
}
// each picture zoom level more is four times the data
{
  const detail = {low: -1, normal: 0, high: 1}[argv['picture-detail']] || 0;
  config.imageryDetail += detail;
  config.terrainDetail += detail;
}

const usageFile = path.join(TileSource.paths.data, 'usage.json');
const placeIndexFile = path.join(TileSource.paths.data, 'places.sqlite');
options.placeIndexFile = placeIndexFile;
TileSource.meter.file = usageFile;
process.on('exit', () => TileSource.meter.save());
setInterval(() => TileSource.meter.save(), 30000).unref();

if (argv.usage) {
  console.log(DataMeter.report(usageFile));
  process.exit(0);
} else if (argv.export !== undefined) {
  withRoute().then(runExport).catch((err) => fail(`Could not export the map: ${err.message}`));
} else if (argv.print !== undefined) {
  withRoute().then(runPrint).catch((err) => fail(`Could not print the map: ${err.message}`));
} else if (argv.keys || argv['set-key'] !== undefined) {
  const keys = new (require('./src/Keys'))(path.join(TileSource.paths.config, 'keys.json'));
  if (argv['set-key'] !== undefined) {
    const m = String(argv['set-key']).match(/^(\w+)=(.*)$/);
    if (!m) fail('--set-key service=KEY, e.g. --set-key tomtom=abc123...');
    let removed = false;
    try {
      if (m[2] === '') removed = keys.remove(m[1]);
      else keys.set(m[1], m[2]);
    } catch (error) {
      fail(`--set-key: ${error.message}`);
    }
    console.log(m[2] !== '' ? `Set the ${m[1]} key.` : removed ? `Removed the ${m[1]} key.` : `There was no ${m[1]} key to remove.`);
  }
  console.log(keys.report());
  process.exit(0);
} else if (argv.places) {
  const places = new SavedPlaces(savedPlacesFile).list();
  for (const place of places) {
    console.log(`${place.name} = ${place.lat}, ${place.lon}${place.zoom !== undefined ? ` z${place.zoom}` : ''}`);
  }
  console.log(`${places.length ? '\n' : ''}${places.length} saved place${places.length === 1 ? '' : 's'} in ${savedPlacesFile} (a text file: edit or share it as you like)`);
  process.exit(0);
} else if (argv.find !== undefined) {
  runFind();
} else if (argv.index) {
  runIndex().catch((err) => fail(`Could not index: ${err.message}`));
} else if (argv.serve !== undefined) {
  if (argv.serve !== '' && !/^\d+$/.test(argv.serve) || +argv.serve > 65535) fail(`--serve: a port number (1-65535), not "${argv.serve}"`);
  runServer().catch((err) => fail(`Could not share the tiles: ${err.message}`));
} else if (argv.download || argv.pack !== undefined) {
  runDownloadAndPack().then((code) => process.exit(code)).catch((err) => {
    console.error(`\n${err.message}`);
    process.exit(1);
  });
} else {
  withRoute().then(() => {
    let mapscii;
    try {
      mapscii = new Mapscii(options);
    } catch (err) {
      fail(`Failed to start MapSCII: ${err.message}`);
    }
    mapscii.init().catch((err) => {
      if (process.stdout.isTTY) {
        // leave the map screen so the message stays readable
        process.stdout.write('\x1B[?1003l\x1B[?1006l\x1B[?1015l\x1B[0m\n');
      }
      fail(`Failed to start MapSCII: ${err.message}`);
    });
  });
}

if (argv.navigate !== undefined) {
  if (argv.gps === undefined) {
    fail('--navigate needs a GPS position: add --gps (see tools/gps-bridge)');
  }
  try {
    const place = require('./src/resolvePlace')(argv.navigate, {savedPlaces: new SavedPlaces(savedPlacesFile), placeIndex: openPlaceIndex()});
    options.navigateTo = {lat: place.lat, lon: place.lon, name: place.name || argv.navigate};
    options.marker = {lat: place.lat, lon: place.lon};
  } catch (error) {
    fail(`--navigate: ${error.message}`);
  }
}

// With --route: plans it and adds it to the map's options
async function withRoute() {
  if (argv.route === undefined) return;
  await planRoute();
  Object.assign(options, {
    initialLat: argv.latitude, initialLon: argv.longitude, initialZoom: argv.zoom, marker,
    overlays: routeOverlays.concat(overlays),
    overlaySummary: [routeSummary, options.overlaySummary].filter(Boolean).join(', '),
  });
}

// --download fills the disk cache for an area; --pack then writes it (or the whole cache) into one file
async function runDownloadAndPack() {
  const tileSource = new TileSource();
  await tileSource.init(argv.tile_source);
  const maxZoom = Math.min(argv.download_max_zoom, config.tileRange);
  let failed = 0;
  if (argv.download) {
    const count = tileSource.countAreaTiles(argv.latitude, argv.longitude, argv.download, maxZoom);
    console.log(`Downloading ${count} tiles (about ${Math.ceil(count * config.downloadTileKB / 1024)} MB at most) within ${argv.download} km of ${+argv.latitude.toFixed(5)}, ${+argv.longitude.toFixed(5)} (zoom 0-${maxZoom})...`);
    const result = await tileSource.downloadArea(argv.latitude, argv.longitude, argv.download, maxZoom, (done, total, failedSoFar) => {
      process.stdout.write(`\r${done}/${total} tiles${failedSoFar ? `, ${failedSoFar} failed` : ''}`);
    });
    failed = result.failed;
    console.log(`\nDone: ${result.total - failed} of ${result.total} tiles are in the disk cache (${DataMeter.format(TileSource.meter.sessionBytes())} downloaded).`);
  }
  if (argv.pack !== undefined) {
    if (!argv.pack) {
      fail('--pack needs a file name, e.g. --pack berlin.mbtiles');
    }
    const file = argv.pack.endsWith('.mbtiles') ? argv.pack : `${argv.pack}.mbtiles`;
    const area = argv.download ? {lat: argv.latitude, lon: argv.longitude, radiusKm: argv.download, maxZoom} : null;
    const {writePack} = require('./src/MapPack');
    const result = writePack(tileSource, file, area, (done, total) => process.stdout.write(`\rpacking ${done}/${total} tiles`));
    console.log(`\rWrote ${file}: ${result.tiles} tiles, zoom ${result.minZoom}-${result.maxZoom}, ${DataMeter.format(result.bytes)}.`);
    console.log(`Use it anywhere, without internet: mapscii --tile_source ${file}`);
  }
  return failed ? 1 : 0;
}

// --serve: shares the tiles with other computers on the network
async function runServer() {
  const TileServer = require('./src/TileServer');
  const tileSource = new TileSource();
  await tileSource.init(argv.tile_source);
  // a pack has what it has; from the cache, missing tiles are downloaded once
  const server = new TileServer(tileSource, {download: !argv.tile_source.endsWith('.mbtiles')});
  // --serve alone: 8080
  const port = await server.listen(argv.serve === '' ? 8080 : Number(argv.serve));
  const addresses = TileServer.addresses();
  console.log(`Sharing the tiles of ${argv.tile_source} on port ${port}.`);
  console.log('On other computers on this network, start MapSCII with:');
  for (const address of addresses.length ? addresses : ['localhost']) {
    console.log(`  mapscii --tile_source http://${address}:${port}/tilejson.json`);
  }
  console.log('Press Ctrl+C to stop.');
  setInterval(() => {
    const {tiles, bytes, missing, clients} = server.stats;
    process.stdout.write(`\r${tiles} tiles shared (${DataMeter.format(bytes)}) with ${clients.size} computer${clients.size === 1 ? '' : 's'}, ${missing} not available, ${DataMeter.format(TileSource.meter.sessionBytes())} downloaded   `);
  }, 2000).unref();
  process.on('SIGINT', () => {
    console.log('');
    process.exit(0);
  });
}

// --find: prints the matches in the search index
function runFind() {
  const PlaceIndex = require('./src/PlaceIndex');
  let index;
  try {
    index = new PlaceIndex(placeIndexFile);
  } catch (err) {
    fail(`Search is not available: ${err.message}`);
  }
  const near = positionGiven() ? {lat: argv.latitude, lon: argv.longitude} : null;
  const results = new SavedPlaces(savedPlacesFile).search(argv.find).concat(index.search(argv.find, {near, limit: 20})).slice(0, 20);
  if (!results.length) {
    console.error(`No "${argv.find}" in the ${index.size()} names of the maps seen so far (add more with --index).`);
    process.exit(1);
  }
  for (const place of results) {
    console.log(`${place.name}  (${place.kind})  ${+place.lat.toFixed(5)}, ${+place.lon.toFixed(5)}  zoom ${place.zoom}`);
  }
  process.exit(0);
}

// --index: adds the names of every cached tile (or the pack's) to the search index
async function runIndex() {
  const PlaceIndex = require('./src/PlaceIndex');
  const Styler = require('./src/Styler');
  const {cachedTiles} = require('./src/MapPack');
  const index = new PlaceIndex(placeIndexFile);
  const tileSource = new TileSource();
  await tileSource.init(argv.tile_source);
  tileSource.useStyler(new Styler(JSON.parse(fs.readFileSync(argv.style_file, 'utf8'))));
  const tiles = tileSource.mbtiles ? tileSource.mbtiles.listTiles() : cachedTiles(tileSource, null);
  const before = index.size();
  let done = 0;
  for (const {z, x, y} of tiles) {
    try {
      index.addTile(tileSource.source, z, x, y, await tileSource.getTile(z, x, y));
    } catch (err) {
      void 0;
    }
    if (++done % 20 === 0 || done === tiles.length) {
      process.stdout.write(`\r${done}/${tiles.length} tiles`);
    }
  }
  console.log(`\nThe index now has ${index.size()} names (${index.size() - before} new).`);
  process.exit(0);
}

// The search index, or null if it can't be opened
function openPlaceIndex() {
  try {
    const PlaceIndex = require('./src/PlaceIndex');
    return new PlaceIndex(path.join(TileSource.paths.data, 'places.sqlite'));
  } catch (error) {
    return null;
  }
}

// --print: the map once as text, when its tiles are in (or after a timeout)
async function runPrint() {
  const format = argv.print || (process.stdout.isTTY ? 'ansi' : 'plain');
  if (!['ansi', 'plain'].includes(format)) {
    fail('--print takes "ansi" or "plain"');
  }
  const Renderer = require('./src/Renderer');
  const columns = argv.width || process.stdout.columns || 80;
  const rows = argv.height || (process.stdout.rows ? process.stdout.rows - 2 : 24);
  config.useBraille = argv.braille;
  const tileSource = new TileSource();
  await tileSource.init(argv.tile_source);
  const style = JSON.parse(fs.readFileSync(argv.style_file, 'utf8'));
  const renderer = new Renderer(process.stdout, tileSource, style);
  let fieldNotes = [];
  try {
    fieldNotes = new (require('./src/FieldNotes'))(options.notesFile).list();
  } catch (error) {
    void 0;
  }
  if (argv.view && argv.view !== 'map') {
    const RasterSource = require('./src/RasterSource');
    let wakePictures = () => null;
    const onLoad = () => wakePictures();
    renderer.setView(argv.view, {
      imagery: new RasterSource('imagery', {cacheDir: options.pictureCacheDir, onLoad}),
      terrain: new RasterSource('terrain', {cacheDir: options.pictureCacheDir, onLoad}),
    });
    renderer.onPictures = (fn) => {
      wakePictures = fn;
    };
  }
  renderer.setOverlays(options.overlays.concat({points: fieldNotes.map((n) => ({lat: n.lat, lon: n.lon, name: n.title})), color: config.notesColor, marker: config.noteMarker}));
  renderer.setSize(Math.max(2, columns >> 1 << 2), Math.max(4, rows * 4));
  const center = {lat: argv.latitude, lon: argv.longitude};
  const zoom = argv.zoom !== null && argv.zoom !== undefined ? argv.zoom : config.goToZoom;
  const markers = marker ? [marker] : [];
  let wake = null;
  tileSource.onTileLoaded = () => wake && wake();
  const until = Date.now() + config.printTimeout;
  // failed tiles get one more try
  let retryAt = null;
  for (;;) {
    await renderer.draw(center, zoom, markers);
    const pending = renderer.pendingTiles() + renderer.pendingPictures();
    const failed = renderer.failedTiles().count;
    if (Date.now() > until || (!pending && !failed)) break;
    if (!pending && failed) {
      if (retryAt === null) {
        retryAt = Date.now() + config.tileRetryDelay + 500;
      } else if (Date.now() > retryAt) {
        break;
      }
    }
    await new Promise((resolve) => {
      wake = resolve;
      if (renderer.onPictures) renderer.onPictures(resolve);
      setTimeout(resolve, 1000);
    });
  }
  let lines = renderer.canvas.frameLines();
  // eslint-disable-next-line no-control-regex
  lines = format === 'plain' ? lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, '')) : lines.map((line) => line + '\x1b[0m');
  const notes = [];
  const missing = renderer.pendingTiles() + renderer.pendingPictures() + renderer.failedTiles().count;
  if (missing) {
    notes.push(`${missing} tile${missing === 1 ? '' : 's'} missing${renderer.failedTiles().reason ? ` (${renderer.failedTiles().reason})` : ''}`);
  }
  const missingPictures = renderer.failedPictures ? renderer.failedPictures() : 0;
  if (missingPictures) {
    notes.push(`${missingPictures} picture${missingPictures === 1 ? '' : 's'} missing (not on the computer, and could not be downloaded)`);
  }
  const pictures = renderer.rasters || {};
  if ((argv.view === 'satellite' || argv.view === 'hybrid') && pictures.imagery) notes.push(pictures.imagery.attribution);
  if ((argv.view === 'relief' || argv.view === '3d') && pictures.terrain) notes.push(pictures.terrain.attribution);
  if (tileSource.attribution && argv.view !== 'satellite' && argv.view !== '3d') {
    notes.push(tileSource.attribution);
  }
  process.stdout.write(lines.join('\n') + '\n' + (notes.length ? notes.join(' - ') + '\n' : ''));
  process.exit(missing || missingPictures ? 1 : 0);
}

// Stops with a message if --layers names an unknown layer
function checkLayers(ids) {
  const known = require('./src/layers/LayerManager').LayerManager.ALL().map((Layer) => new Layer());
  for (const id of ids) {
    if (!known.some((layer) => layer.id === id || layer.aliases.includes(id))) {
      fail(`--layers: no layer "${id}" (there are: ${known.map((layer) => layer.id).join(', ')}, or none)`);
    }
  }
  return ids;
}

// Whether the command line gives a place to show
function positionGiven() {
  return process.argv.some((a) => /^--(lat|latitude|lon|longitude|goto)\b/.test(a));
}

// The zoom at which [west, south, east, north] fits the terminal, or the --export picture
function fitZoom(box) {
  const utils = require('./src/utils');
  const size = argv.export !== undefined && String(argv['export-size']).match(/^(\d+)x(\d+)$/);
  const pixelsX = size ? +size[1] : (argv.width || process.stdout.columns || 80) * 2;
  const pixelsY = size ? +size[2] : (argv.height || (process.stdout.rows || 24) - 1) * 4;
  // ll2tile handles longitudes beyond 180 (see Gpx.bounds)
  const nw = utils.ll2tile(box[0], box[3], 0);
  const se = utils.ll2tile(box[2], box[1], 0);
  const spanX = Math.max(se.x - nw.x, 1e-9);
  const spanY = Math.max(se.y - nw.y, 1e-9);
  const zoom = Math.log2(Math.min(pixelsX * 0.85 / (spanX * config.projectSize), pixelsY * 0.85 / (spanY * config.projectSize)));
  return Math.max(0, Math.min(17, Math.floor(zoom * 10) / 10));
}

// --export: the map as an HTML page or SVG, with notes and tracks
async function runExport() {
  const file = argv.export;
  if (!file || !/\.(html?|svg)$/i.test(file)) {
    fail('--export needs a file ending in .html or .svg, e.g. --export map.html');
  }
  const m = String(argv['export-size']).match(/^(\d+)x(\d+)$/);
  if (!m || +m[1] < 100 || +m[2] < 100 || +m[1] > 10000 || +m[2] > 10000) {
    fail('--export-size: width x height in pixels, e.g. 1200x800');
  }
  const FieldNotes = require('./src/FieldNotes');
  const SvgMap = require('./src/SvgMap');
  const tileSource = new TileSource();
  await tileSource.init(argv.tile_source);
  tileSource.useStyler(new (require('./src/Styler'))(JSON.parse(fs.readFileSync(argv.style_file, 'utf8'))));
  let notes = [];
  try {
    notes = new FieldNotes(options.notesFile).list();
  } catch (error) {
    void 0;
  }
  const center = {lat: argv.latitude, lon: argv.longitude};
  const zoom = argv.zoom !== null && argv.zoom !== undefined ? argv.zoom : config.goToZoom;
  const noteOverlay = {points: notes.map((n) => ({lat: n.lat, lon: n.lon, name: n.title})), color: '#e8590c'};
  const {svg, missing} = await SvgMap.render(tileSource, {
    center, zoom, width: +m[1], height: +m[2],
    overlays: options.overlays.concat(noteOverlay),
    markers: marker ? [marker] : [],
  });
  await tileSource.flushWrites();
  let text = svg + '\n';
  if (/\.html?$/i.test(file)) {
    const box = {west: center.lon, east: center.lon, south: center.lat, north: center.lat};
    const k = 360 / (256 * Math.pow(2, zoom));
    box.west -= +m[1] / 2 * k;
    box.east += +m[1] / 2 * k;
    box.north += +m[2] / 2 * k * Math.cos(center.lat * Math.PI / 180);
    box.south -= +m[2] / 2 * k * Math.cos(center.lat * Math.PI / 180);
    const inside = (p) => p.lat >= box.south && p.lat <= box.north && p.lon >= box.west && p.lon <= box.east;
    const index = openPlaceIndex();
    let town = null;
    try {
      town = index ? index.nearest(center.lat, center.lon, {limit: 1})[0] || null : null;
    } catch (error) {
      void 0;
    }
    const tracks = [];
    (argv.gpx || []).forEach((gpxFile, i) => (overlays[i].lines || []).forEach((points) => points.length && tracks.push({name: path.basename(String(gpxFile)), points})));
    text = SvgMap.page({
      title: argv.title || (marker ? `Map of ${argv.goto}` : 'Map'),
      svg, notes: notes.filter(inside), tracks, center, zoom, attribution: tileSource.attribution, town,
    });
  }
  fs.writeFileSync(file, text);
  console.log(`Wrote ${file} (${DataMeter.format(Buffer.byteLength(text))})${missing ? `, ${missing} tiles missing (no connection?)` : ''}.`);
  process.exit(missing ? 1 : 0);
}
