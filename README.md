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

If you haven't already got Node.js >= version 6.14, then [go get it](http://nodejs.org/).

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

## Keyboard shortcuts

* Arrows **up**, **down**, **left**, **right** to scroll around
* Press **a** or **z** to zoom in and out
* Press **c** to switch to block character mode
* Press **q** to quit

## Mouse control

If your terminal supports mouse events you can drag the map and use your scroll wheel to zoom in and out.

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
* [`bluebird`](https://github.com/petkaantonov/bluebird) for all the asynchronous [Promise](https://developer.mozilla.org/de/docs/Web/JavaScript/Reference/Global_Objects/Promise) magic
* [`node-fetch`](https://github.com/bitinn/node-fetch) for HTTP requests
* [`userhome`](https://github.com/shama/userhome) to determine where to persist downloaded tiles

### TODOs
* MapSCII
  * [ ] GeoJSON support via [geojson-vt](https://github.com/mapbox/geojson-vt)
  * [ ] CLI support
    * [ ] startup parameters
      * [ ] TileSource
      * [ ] Style
      * [ ] center position
      * [ ] zoom
      * [ ] demo mode?

  * [ ] mouse control
    * [ ] hover POIs/labels
    * [ ] hover maybe even polygons/-lines?

* Styler
  * [ ] respect zoom based style ranges

* Renderer
  * [ ] download and process tiles in a different thread ([#3](https://github.com/rastapasta/mapscii/issues/3))
  * [ ] optimize renderer for large areas ([#6](https://github.com/rastapasta/mapscii/issues/6))
  * [ ] label drawing
    * [ ] multi line label?

* TileSource
  * [ ] implement single vector-tile handling

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
