/*#
  MapSCII - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>
  Discover the planet in your console!

  This scripts boots up the application.

  TODO: params parsing and so on
#*/
'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./src/config');
const Mapscii = require('./src/Mapscii');
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
  .argv;

// stops with a message, without a stack trace
function fail(message) {
  console.error(message);
  process.exit(1);
}

for (const name of ['latitude', 'longitude', 'zoom', 'width', 'height', 'download', 'download_max_zoom']) {
  if (argv[name] !== undefined && argv[name] !== null && !Number.isFinite(argv[name])) {
    fail(`--${name} needs a number`);
  }
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

// a style can be given by name ("bright") or as a file
if (!fs.existsSync(argv.style_file)) {
  const named = path.join(__dirname, 'styles', `${argv.style_file}.json`);
  if (!fs.existsSync(named)) {
    const names = fs.readdirSync(path.join(__dirname, 'styles')).map((file) => file.replace(/\.json$/, ''));
    fail(`--style: no style file "${argv.style_file}" (bundled styles: ${names.join(', ')})`);
  }
  argv.style_file = named;
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
  source: argv.tile_source,
  styleFile: argv.style_file,
};
if (argv.tile_schema) {
  config.tileSchema = argv.tile_schema;
}

if (argv.download) {
  // Fill the disk cache for an area, so it can later be viewed fast and offline
  const TileSource = require('./src/TileSource');
  const tileSource = new TileSource();
  Promise.resolve(tileSource.init(argv.tile_source)).then(() => {
    const maxZoom = Math.min(argv.download_max_zoom, config.tileRange);
    const count = tileSource.countAreaTiles(argv.latitude, argv.longitude, argv.download, maxZoom);
    console.log(`Downloading ${count} tiles (about ${Math.ceil(count * config.downloadTileKB / 1024)} MB) within ${argv.download} km of ${+argv.latitude.toFixed(5)}, ${+argv.longitude.toFixed(5)} (zoom 0-${maxZoom})...`);
    return tileSource.downloadArea(argv.latitude, argv.longitude, argv.download, maxZoom, (done, total, failed) => {
      process.stdout.write(`\r${done}/${total} tiles${failed ? `, ${failed} failed` : ''}`);
    });
  }).then(({total, failed}) => {
    console.log(`\nDone: ${total - failed} of ${total} tiles are in the disk cache.`);
    process.exit(failed ? 1 : 0);
  }).catch((err) => {
    console.error(`\n${err.message}`);
    process.exit(1);
  });
} else {
  let mapscii;
  try {
    mapscii = new Mapscii(options);
  } catch (err) {
    fail(`Failed to start MapSCII: ${err.message}`);
  }
  mapscii.init().catch((err) => {
    if (process.stdout.isTTY) {
      // leave the map screen, so the message stays readable
      process.stdout.write('\x1B[?1003l\x1B[?1006l\x1B[?1015l\x1B[0m\n');
    }
    fail(`Failed to start MapSCII: ${err.message}`);
  });
}
