/*
  MapSCII - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Configuration module
*/

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get directory path for style file resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface MouseEvent {
  x: number;
  y: number;
  button?: string;
  action?: string;
}

export interface KeyEvent {
  name: string;
}

export interface LayerConfig {
  margin?: number;
  cluster?: boolean;
}

export interface CellGeometry {
  width: number;
  height: number;
}

export type ColorMode = 'xterm-256' | 'ansi-16';
export type TerrainMode = 'elevation' | 'hillshade';

export interface TerrainConfig {
  enabled: boolean;
  mode: TerrainMode;
  source: string;
  minZoom: number;
  maxZoom: number;
  opacity: number;
  azimuth: number;
  altitude: number;
}

export interface MapsciiConfig {
  language: string;
  source: string;
  styleFile: string;
  initialZoom: number | null;
  maxZoom: number;
  zoomStep: number;
  initialLat: number;
  initialLon: number;
  simplifyPolylines: boolean;
  useBraille: boolean;
  colorMode: ColorMode;
  useTileWorker: boolean;
  persistDownloadedTiles: boolean;
  tileRange: number;
  projectSize: number;
  labelMargin: number;
  labelMaxWidth: number;
  showAttribution: boolean;
  attribution: string;
  ansiScreenshotFile: string | null;
  exitAfterAnsiScreenshot: boolean;
  terrain: TerrainConfig;
  layers: Record<string, LayerConfig>;
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
  headless: boolean;
  delimeter: string;
  poiMarker: string;
  size?: { width?: number; height?: number };
  mouseCallback?: (event: MouseEvent) => boolean;
  keyCallback?: (key: KeyEvent) => boolean;
  quitCallback?: () => void;
  onUpdate?: () => void;
  // Cell geometry for aspect ratio support (Issue #26)
  cellGeometry: CellGeometry;
  // Enable current location feature (Issue #2)
  enableLocation: boolean;
  // Disable text labels and POI markers for minimal rendering
  noLabels: boolean;
}

const config: MapsciiConfig = {
  language: 'en',

  source: 'https://tiles.openfreemap.org/planet/map/',

  // Style file path - resolve from src directory
  styleFile: join(__dirname, '..', 'styles', 'dark.json'),

  initialZoom: null,
  maxZoom: 18,
  zoomStep: 0.2,

  // Default coordinates (Berlin)
  initialLat: 52.51298,
  initialLon: 13.42012,

  simplifyPolylines: false,

  useBraille: true,
  colorMode: 'xterm-256',
  // Off-thread tile parsing (opt-in via --tileWorker): the worker keeps the
  // main thread free but structured-cloning parsed geometry makes each tile
  // take ~3x longer to appear, so main-thread parsing is the better default.
  useTileWorker: false,

  // Downloaded files get persisted in ~/.cache/mapscii
  persistDownloadedTiles: true,

  tileRange: 14,
  projectSize: 256,

  labelMargin: 5,
  labelMaxWidth: 24,

  showAttribution: true,
  attribution: '(c) OpenStreetMap contributors',
  ansiScreenshotFile: null,
  exitAfterAnsiScreenshot: false,

  terrain: {
    enabled: false,
    mode: 'elevation',
    source: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    minZoom: 0,
    maxZoom: 15,
    opacity: 0.65,
    azimuth: 315,
    altitude: 45,
  },

  layers: {
    housenumber: {
      margin: 4
    },
    poi: {
      cluster: true,
      margin: 5,
    },
    place: {
      cluster: true,
    }
  },

  input: process.stdin,
  output: process.stdout,

  headless: false,

  delimeter: '\r\n',

  poiMarker: '◉',

  // Cell geometry for braille rendering (2x4 by default)
  cellGeometry: {
    width: 2,
    height: 4,
  },

  // Location feature disabled by default for privacy
  enableLocation: false,

  // Labels and POI markers enabled by default
  noLabels: false,
};

export default config;
