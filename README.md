# MapSCII - The Whole World In Your Console. [![Build Status](https://travis-ci.com/rastapasta/mapscii.svg?branch=master)](https://travis-ci.com/rastapasta/mapscii)

A node.js based [Vector Tile](http://wiki.openstreetmap.org/wiki/Vector_tiles) to [Braille](http://www.fileformat.info/info/unicode/block/braille_patterns/utf8test.htm) and [ASCII](https://de.wikipedia.org/wiki/American_Standard_Code_for_Information_Interchange) renderer for [xterm](https://en.wikipedia.org/wiki/Xterm)-compatible terminals.

<a href="https://asciinema.org/a/117813?autoplay=1" target="_blank">![asciicast](https://cloud.githubusercontent.com/assets/1259904/25480718/497a64e2-2b4a-11e7-9cf0-ed52ee0b89c0.png)</a>

## Try it out!

```sh
$ telnet mapscii.me
```

If you're on Windows, use the open source telnet client [PuTTY](https://www.chiark.greenend.org.uk/~sgtatham/putty/latest.html) to connect.

## Features

* Use your mouse to drag and zoom in and out!
* Discover Point-of-Interests around any given location
* Highly customizable layer styling with [Mapbox Styles](https://www.mapbox.com/mapbox-gl-style-spec/) support
* Connect to any public or private vector tile server
* Or just use the supplied and optimized [OSM2VectorTiles](https://github.com/osm2vectortiles) based one
* Work offline and discover local [VectorTile](https://github.com/mapbox/vector-tile-spec)/[MBTiles](https://github.com/mapbox/mbtiles-spec)
* Render standalone `.pbf` / `.mvt` vector tiles directly
* Hover labels, POIs, lines and polygons from mouse-enabled terminals
* Multi-line and Arabic/right-to-left labels
* Optional ANSI 16-color output for low-color terminals
* Optional terrain/elevation hillshade background
* Persistent OpenStreetMap attribution in the rendered frame
* Compatible with most Linux and OSX terminals
* Highly optimized algorithms for a smooth experience
* 100% pure JavaScript! :sunglasses:

## How to run it locally

With a modern node installation available, just start it with

```
npx mapscii
```

## How to install it locally

### With npm

If you haven't already got Node.js >= version 10, then [go get it](http://nodejs.org/).

```
npm install -g mapscii
```

If you're on OSX, or get an error about file permissions, you may need to do ```sudo npm install -g mapscii```

### With snap

In any of the [supported Linux distros](https://snapcraft.io/docs/core/install):

    sudo snap install mapscii
    
(This snap is maintained by [@nathanhaines](https://github.com/nathanhaines/))

## Running

This is pretty simple too.

```
mapscii
```

Useful options:

```sh
mapscii --tile_source ./tile.pbf
mapscii --tile_source ./tiles.mbtiles
mapscii --style_file ./styles/dark.json
mapscii --ansi16
mapscii --terrain
mapscii --terrain --terrainMode hillshade
mapscii --terrainSource "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
mapscii --ansiScreenshot ./map.ans --width 120 --height 40
mapscii --noAttribution
```

Downloaded HTTP tiles are cached under `~/.cache/mapscii/cache-2` when persistence is enabled. Existing tiles from the legacy `~/.mapscii/cache-2` location are read and migrated lazily.

## Keyboard shortcuts

* Arrows **up**, **down**, **left**, **right** to scroll around
* Press **a** or **z** to zoom in and out
* Press **c** to switch to block character mode
* Press **S** to save the current canvas as an ANSI `.ans` screenshot
* Press **R** to reset the tile cache if cached tiles become corrupted
* Press **q** to quit

## Mouse control

If your terminal supports mouse events you can drag the map and use your scroll wheel to zoom in and out.

## Library API

See the full [library API documentation](./docs/library-api.md).

MapSCII can also be embedded from Node.js:

```js
import Mapscii from 'mapscii';

const map = new Mapscii({
  initialLat: 48.8566,
  initialLon: 2.3522,
  initialZoom: 12,
  source: 'https://tiles.openfreemap.org/planet/map/',
  styleFile: './styles/dark.json',
  colorMode: 'ansi-16',
  showAttribution: true,
});

map.on('ready', (state) => {
  console.log('ready', state.center, state.zoom);
});

map.on('hover', (event) => {
  console.log(event.lat, event.lon, event.features);
});

map.on('click', (event) => {
  console.log('clicked features', event.features);
});

await map.init();
```

Public methods:

* `setCenter(lat, lon)` and `getCenter()`
* `setZoom(zoom)`, `zoomBy(step)` and `getZoom()`
* `moveBy(latDelta, lonDelta)`
* `addMarker(marker)`, `removeMarker(id)`, `clearMarkers()` and `getMarkers()`
* `featuresAt(column, row)` for programmatic label, POI, line and polygon hit-testing
* `getState()` for `{ center, zoom, markers }`
* `on(event, handler)` and `off(event, handler)` for events

Events:

* `ready`, `update`, `move`, `zoom`, `quit`
* `hover` and `click`, both with `{ x, y, lat, lon, features }`
* `marker:add`, `marker:remove`, `markers:clear`
* `error`

## Behind the scenes
### Libraries
#### Mastering the console
  * [`x256`](https://github.com/substack/node-x256) for converting RGB values to closest xterm-256 [color code](https://en.wikipedia.org/wiki/File:Xterm_256color_chart.svg)
  * [`term-mouse`](https://github.com/CoderPuppy/term-mouse) for mouse handling
  * [`keypress`](https://github.com/TooTallNate/keypress) for input handling
  * [`string-width`](https://github.com/sindresorhus/string-width) to determine visual string lengths

#### Discovering the map data
* [`vector-tile`](https://github.com/mapbox/vector-tile-js) for [VectorTile](https://github.com/mapbox/vector-tile-spec/tree/master/2.1) parsing
* [`pbf`](https://github.com/mapbox/pbf) for [Protobuf](https://developers.google.com/protocol-buffers/) decoding
* [`mbtiles`](https://github.com/mapbox/node-mbtiles) for [MBTiles](https://github.com/mapbox/mbtiles-spec/blob/master/1.2/spec.md) parsing

#### Juggling the vectors and numbers
* [`earcut`](https://github.com/mapbox/earcut) for polygon triangulation
* [`rbush`](https://github.com/mourner/rbush) for 2D spatial indexing of geo and label data
* [`bresenham`](https://github.com/madbence/node-bresenham) for line point calculations
* [`simplify-js`](https://github.com/mourner/simplify-js) for polyline simplifications

#### Handling the flow
* [`node-fetch`](https://github.com/bitinn/node-fetch) for HTTP requests
* [`env-paths`](https://github.com/sindresorhus/env-paths) to determine where to persist downloaded tiles

### TODOs
* MapSCII
  * [ ] GeoJSON support via [geojson-vt](https://github.com/mapbox/geojson-vt)
  * [ ] CLI support
    * [-] startup parameters
      * [X] TileSource
      * [X] Style
      * [X] center position
      * [X] zoom
      * [ ] demo mode?

  * [x] mouse control
    * [x] hover POIs/labels
    * [x] hover maybe even polygons/-lines?

* Styler
  * [x] respect zoom based style ranges

* Renderer
  * [x] download and process tiles in a different thread ([#3](https://github.com/rastapasta/mapscii/issues/3))
  * [ ] optimize renderer for large areas ([#6](https://github.com/rastapasta/mapscii/issues/6))
  * [ ] label drawing
    * [x] multi line label?

* TileSource
  * [x] implement single vector-tile handling

## Special thanks

* [lukasmartinelli](https://github.com/lukasmartinelli) & [manuelroth](https://github.com/manuelroth) for all their work on [OSM2VectorTiles](https://github.com/osm2vectortiles) (global vector tiles from [OSM Planet](https://wiki.openstreetmap.org/wiki/Planet.osm))
* [mourner](https://github.com/mourner) for all his work on mindblowing GIS algorithms (like the used [earcut](https://github.com/mapbox/earcut), [rbush](https://github.com/mourner/rbush), [simplify-js](https://github.com/mourner/simplify-js), ..)

## Licenses

### Map data

#### The Open Data Commons Open Database License (oDbl)

[OpenStreetMap](https://www.openstreetmap.org) is open data, licensed under the [Open Data Commons Open Database License](http://opendatacommons.org/licenses/odbl/) (ODbL) by the [OpenStreetMap Foundation](http://osmfoundation.org/) (OSMF).

You are free to copy, distribute, transmit and adapt our data, as long as you credit OpenStreetMap and its contributors. If you alter or build upon our data, you may distribute the result only under the same licence. The full [legal code](http://opendatacommons.org/licenses/odbl/1.0/) explains your rights and responsibilities.

The cartography in our map tiles, and our documentation, are licenced under the [Creative Commons Attribution-ShareAlike 2.0](http://creativecommons.org/licenses/by-sa/2.0/) licence (CC BY-SA).

### MapSCII
* [License](./LICENSE)
* [Authors](./AUTHORS)
