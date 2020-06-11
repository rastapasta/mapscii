/*#
  MapSCII - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>
  Discover the planet in your console!

  This scripts boots up the application.

  TODO: params parsing and so on
#*/
'use strict';
const Mapscii = require('./src/Mapscii');
const argv = require('yargs')
  .option('latitude', {
    alias: 'lat',
    description: 'Latitude of initial centre',
    type: 'number',
  })
  .option('longitude', {
    alias: 'lon',
    description: 'Longitude of initial centre',
    type: 'number',
  })
  .option('zoom', {
    alias: 'z',
    description: 'Initial zoom',
    type: 'number',
  })
  .option('width', {
    alias: 'w',
    description: 'Width of rendering in dot units',
    type: 'number',
  })
  .option('height', {
    alias: 'h',
    description: 'Height of rendering in dot units',
    type: 'number',
  })
  .option('braille', {
    alias: 'b',
    description: 'Activate braille rendering',
    type: 'boolean',
  })
  .option('headless', {
    alias: 'H',
    description: 'Activate headless mode',
    type: 'boolean',
  })
  .option('tile_source', {
    alias: 'tileSource',
    description: 'URL or path to osm2vectortiles source',
    type: 'string',
  })
  .option('style_file', {
    alias: 'style',
    description: 'path to json style file',
    type: 'string',
  })
  .implies('width', 'height')
  .implies('height', 'width')
  .strict()
  .argv;

const optionEntries = Object.entries({
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
}).filter( ([key, value]) =>
  typeof value !== 'undefined'
  && (key != 'size' || typeof value.width !== 'undefined'
                    && typeof value.height !== 'undefined'));

const mapscii = new Mapscii(Object.fromEntries(optionEntries));
mapscii.init().catch((err) => {
  console.error('Failed to start MapSCII.');
  console.error(err);
});
