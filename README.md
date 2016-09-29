# termap - Terminal Map Viewer

No web browser around? No worries - discover the planet in your console!

<img src="http://i.imgur.com/yYVt7No.png" width="100%" />

* Use your mouse or keys to navigate
* Discover the globe or zoom in to explore your neighbourhood
* See Point-of-Interest around any given location
* Use an online map server or work offline with VectorTile/MBTiles
* Highly customizable styling (colors, feature visibility, ...)
* Compatible with Linux and OS X (Windows to be tested)
* 99% pure Coffee-/JavaScript! :sunglasses:



## How to get it?

* Make sure to have at least [node.js](https://nodejs.org/) version 4 installed
* Install `termap` with

  `npm install -g termap`

## How to use it?
#### Basic usage
* Start `termap` with

  ` termap`


## Behind the scenes
### Libraries
#### Mastering the console
  * [`x256`](https://github.com/substack/node-x256) for converting RGB values to closest xterm-256 [color code](https://en.wikipedia.org/wiki/File:Xterm_256color_chart.svg)
  * [`term-mouse`](https://github.com/CoderPuppy/term-mouse) for mouse handling
  * [`keypress`](https://github.com/TooTallNate/keypress) for input handling

#### Discovering the map data
* [`node-mbtiles`](https://github.com/mapbox/node-mbtiles) for [MBTiles](https://github.com/mapbox/mbtiles-spec/blob/master/1.2/spec.md) parsing
* [`pbf`](https://github.com/mapbox/pbf) for [Protobuf](https://developers.google.com/protocol-buffers/) decoding
* [`vector-tile-js`](https://github.com/mapbox/vector-tile-js) for [VectorTile](https://github.com/mapbox/vector-tile-spec/tree/master/2.1) parsing

#### Juggling the vectors and numbers
* [`earcut`](https://github.com/mapbox/earcut) for polygon triangulation
* [`rbush`](https://github.com/mourner/rbush) for 2D spatial indexing based label and mouse collision detection
* [`gl-matrix`](https://github.com/toji/gl-matrix) for vector and matrix operations
* [`breseham`](https://github.com/madbence/node-bresenham) for line calculations
* [`sphericalmercator`](https://github.com/mapbox/node-sphericalmercator) for [EPSG:3857](http://spatialreference.org/ref/sr-org/6864/) <> [WGS84](http://spatialreference.org/ref/epsg/wgs-84/) conversions

### TODOs
* [ ] mouse hover
  * [x] of POIs/labels
  * [ ] maybe even polygons/-lines?
* [ ] termap-server - telnet and ssh access
* [ ] cli linking
* [ ] mapping of view to tiles to show
* [x] abstracted MapBox style JSON support
* [ ] giving render priority to features across layers (collect before render vs. direct)?
* [ ] line drawing
  * [ ] support for stroke width
  * [ ] support for dashed/dotted lines?
* [ ] label drawing
  * [x] support for point labels
  * [x] dynamic decluttering of labels
  * [x] centering text labels
  * [x] clipping fix when x<0 after repositioning
  * [ ] multi line label
  * [ ] label margin to avoid POI overlap?
  * [ ] translatable raster fonts
* [x] filled polygons
  * [x] convert polygons to triangles
  * [x] implement fillTriangle into drawille-canvas-blessed-contrib
  * [ ] respect fill/line style file based setting
* [ ] lat/lng-center + zoom based viewport
  * [ ] bbox awareness
  * [ ] zoom -> scale calculation
* [ ] Tile parsing
  * [ ] directly throw away features that aren't covered by any style
* [ ] TileSource class (abstracting URL, mbtiles, single vector tile source)
* [ ] tile request system
  * [ ] from local mbtiles
  * [ ] from remote url
    * [ ] permanent caching of received files
* [ ] zoom while keeping center
* [ ] API
  * [ ] setCenter
  * [ ] setZoom
* [x] start with zoom level which shows full vector tile
* [x] accurate mouse drag&drop
* [x] handle console resize
* [x] styling

## License
#### The MIT License (MIT)
Copyright (c) 2016 Michael Straßburger

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
