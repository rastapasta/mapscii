# Library API

MapSCII can be used as a Node.js library as well as a CLI.

```js
import Mapscii from 'mapscii';

const map = new Mapscii({
  initialLat: 48.8566,
  initialLon: 2.3522,
  initialZoom: 12,
  source: 'https://tiles.openfreemap.org/planet/map/',
  styleFile: './styles/dark.json',
  colorMode: 'xterm-256',
});

map.on('ready', (state) => {
  console.log(state.center, state.zoom);
});

map.on('hover', (event) => {
  console.log(event.lat, event.lon, event.features);
});

await map.init();
```

## Constructor Options

`new Mapscii(options)` accepts the same core settings as the CLI:

| Option | Type | Description |
| --- | --- | --- |
| `initialLat` / `initialLon` | `number` | Initial map center. |
| `initialZoom` | `number \| null` | Initial zoom. `null` uses the calculated minimum zoom. |
| `size` | `{ width?: number; height?: number }` | Fixed terminal-cell render size. |
| `source` | `string` | HTTP tile URL prefix, `.mbtiles`, `.pbf`, or `.mvt` source. |
| `styleFile` | `string` | Mapbox-style JSON file path. |
| `useBraille` | `boolean` | Use Braille rendering instead of block ASCII fallback. |
| `colorMode` | `'xterm-256' \| 'ansi-16'` | Terminal color palette. |
| `useTileWorker` | `boolean` | Parse vector tiles in a worker thread when possible. |
| `showAttribution` | `boolean` | Render bottom-right attribution. |
| `attribution` | `string` | Attribution text. |
| `ansiScreenshotFile` | `string \| null` | Optional path for saving the first rendered frame as ANSI. |
| `exitAfterAnsiScreenshot` | `boolean` | Exit after saving `ansiScreenshotFile`. Intended for CLI one-shot exports. |
| `terrain` | `TerrainConfig` | Optional elevation hillshade settings. |
| `markerInputs` | `MarkerInput[]` | Initial overlay markers. |
| `cellGeometry` | `{ width: number; height: number }` | Terminal cell aspect-ratio correction. |
| `noLabels` | `boolean` | Hide labels and POI markers. |
| `headless` | `boolean` | Disable interactive terminal input/output behavior. |

## Methods

| Method | Description |
| --- | --- |
| `init()` | Initializes tile source, renderer, input handling, and first draw. |
| `setCenter(lat, lon)` | Moves the map center. |
| `getCenter()` | Returns the current center. |
| `setZoom(zoom)` | Sets zoom clamped to valid limits. |
| `getZoom()` | Returns current zoom. |
| `zoomBy(step)` | Adjusts zoom by a relative step and returns the new zoom. |
| `moveBy(latDelta, lonDelta)` | Moves the center by latitude/longitude deltas. |
| `addMarker(marker)` | Adds or updates a marker. |
| `removeMarker(id)` | Removes a marker by id. |
| `clearMarkers()` | Removes all markers. |
| `getMarkers()` | Returns current markers. |
| `resetTileCache()` | Clears in-memory tile cache plus persisted HTTP tile caches, then redraws. |
| `exportAnsiScreenshot(filePath?)` | Saves the current canvas as ANSI terminal output and returns the absolute path. |
| `featuresAt(column, row)` | Returns labels, POIs, lines, and polygons under a terminal-cell coordinate. |
| `getState()` | Returns `{ center, zoom, markers }`. |
| `on(event, handler)` | Subscribes to an event and returns an unsubscribe function. |
| `off(event, handler)` | Removes an event handler. |

## Events

| Event | Payload |
| --- | --- |
| `ready` | `{ center, zoom, markers }` |
| `update` | `{ center, zoom, markers }` after a frame is drawn |
| `move` | `{ center, zoom, markers }` |
| `zoom` | `{ center, zoom, markers }` |
| `hover` | `{ x, y, lat, lon, features }` |
| `click` | `{ x, y, lat, lon, features }` |
| `marker:add` | Added marker |
| `marker:remove` | `{ id }` |
| `markers:clear` | `undefined` |
| `quit` | `{ center, zoom, markers }` |
| `error` | `Error` |

## Terrain Rendering

Terrain is optional and disabled by default. When enabled, MapSCII fetches Terrarium elevation PNG tiles, samples elevation around each terminal cell, and writes a background color before vector features are drawn.

Two render modes are available:

| Mode | Description |
| --- | --- |
| `elevation` | Default. Uses a hypsometric color ramp, so color depends on elevation. |
| `hillshade` | Uses grayscale shaded relief. Brightness depends on how the terrain slope faces the configured light azimuth/altitude, not on absolute elevation. |
