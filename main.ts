/*
  MapSCII - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>
  Discover the planet in your console!

  This scripts boots up the application.
*/

import config from './src/config';
import Mapscii from './src/Mapscii';
import { MarkerInput, parseMarkersFromText } from './src/Markers';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as readline from 'readline';
import * as fs from 'fs';

// Read initial stdin data (non-streaming)
async function readInitialStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }

    let data = '';
    const rl = readline.createInterface({
      input: process.stdin,
      terminal: false
    });

    rl.on('line', (line) => {
      data += line + '\n';
    });

    rl.on('close', () => {
      resolve(data);
    });

    // Timeout after 100ms if no data
    setTimeout(() => {
      if (!data) {
        rl.close();
        resolve('');
      }
    }, 100);
  });
}

const argv = await yargs(hideBin(process.argv))
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
    description: 'URL or path to osm2vectortiles source',
    default: config.source,
    type: 'string',
  })
  .option('style_file', {
    alias: 'style',
    description: 'path to json style file',
    default: config.styleFile,
    type: 'string',
  })
  .option('marker', {
    alias: 'm',
    description: 'Add marker at lat,lon (can be used multiple times)',
    type: 'array',
  })
  .option('geojson', {
    alias: 'g',
    description: 'Path to GeoJSON file with markers',
    type: 'string',
  })
  .option('locate', {
    alias: 'l',
    description: 'Center map on current location (via IP geolocation)',
    type: 'boolean',
    default: false,
  })
  .option('cellRatio', {
    alias: 'r',
    description: 'Cell width:height ratio (e.g., "2:4" for standard, "1:1" for square fonts)',
    type: 'string',
    default: '2:4',
  })
  .option('noLabels', {
    alias: ['minimal', 'n'],
    description: 'Disable text labels and POI markers for minimal rendering',
    type: 'boolean',
    default: false,
  })
  .strict()
  .parse();

// Collect markers from various sources
const markerInputs: MarkerInput[] = [];

// Parse --marker arguments (e.g., --marker "52.5,13.4" --marker "48.8,2.3")
if (argv.marker) {
  for (const m of argv.marker) {
    const parts = String(m).split(/[,\s]+/).map(p => parseFloat(p.trim()));
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      markerInputs.push({ lat: parts[0], lon: parts[1] });
    }
  }
}

// Read GeoJSON file if specified
if (argv.geojson) {
  try {
    const content = fs.readFileSync(argv.geojson, 'utf-8');
    markerInputs.push(...parseMarkersFromText(content));
  } catch (err) {
    console.error(`Failed to read GeoJSON file: ${argv.geojson}`);
    console.error(err);
  }
}

// Read from stdin if available (non-TTY mode)
const stdinData = await readInitialStdin();
if (stdinData) {
  markerInputs.push(...parseMarkersFromText(stdinData));
}

// Get current location if requested (Issue #2, #12)
let initialLat = argv.latitude;
let initialLon = argv.longitude;
let locateOnStart = false;
let locationSource = '';

if (argv.locate) {
  try {
    // Use ipinfo.io for free IP geolocation
    const response = await fetch('https://ipinfo.io/json');
    const data = await response.json() as { loc?: string; city?: string; country?: string };
    if (data.loc) {
      const [lat, lon] = data.loc.split(',').map(Number);
      initialLat = lat;
      initialLon = lon;
      locateOnStart = true;
      locationSource = `IP (${[data.city, data.country].filter(Boolean).join(', ') || 'Unknown'})`;
    }
  } catch {
    console.error('Failed to get current location, using default');
  }
}

// Parse cell ratio (Issue #26) - supports floats like 0.6:0.9
let cellWidth = 2;
let cellHeight = 4;
if (argv.cellRatio) {
  const parts = String(argv.cellRatio).split(':').map(n => parseFloat(n));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    cellWidth = parts[0];
    cellHeight = parts[1];
  }
}

const options = {
  initialLat: initialLat,
  initialLon: initialLon,
  initialZoom: argv.zoom,
  size: {
    width: argv.width,
    height: argv.height
  },
  useBraille: argv.braille,
  headless: argv.headless,
  source: argv.tile_source,
  styleFile: argv.style_file,
  markerInputs: markerInputs,
  cellGeometry: {
    width: cellWidth,
    height: cellHeight,
  },
  noLabels: argv.noLabels,
  locateOnStart: locateOnStart,
  locationSource: locationSource,
};

const mapscii = new Mapscii(options);
mapscii.init().catch((err) => {
  console.error('Failed to start MapSCII.');
  console.error(err);
});
