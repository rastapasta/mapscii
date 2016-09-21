# termap - Terminal Map Viewer

No web browser around? No worries - discover the planet in your console!

* Use your mouse or keys to navigate
* Discover the globe or zoom in to learn about house numbers
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
  * [`drawille-canvas-blessed-contrib`](https://github.com/yaronn/drawille-canvas-blessed-contrib/) for [braille](http://www.fileformat.info/info/unicode/block/braille_patterns/utf8test.htm) rendering
  * [`x256`](https://github.com/substack/node-x256) for finding nearest xterm-256 [color codes](https://en.wikipedia.org/wiki/File:Xterm_256color_chart.svg)
  * [`term-mouse`](https://github.com/CoderPuppy/term-mouse) for mouse handling
  * [`keypress`](https://github.com/TooTallNate/keypress) for input handling

#### Discovering the map data
* [`node-mbtiles`](https://github.com/mapbox/node-mbtiles) for [MBTiles](https://github.com/mapbox/mbtiles-spec/blob/master/1.2/spec.md) parsing
* [`pbf`](https://github.com/mapbox/pbf) for [Protobuf](https://developers.google.com/protocol-buffers/) decoding
* [`vector-tile-js`](https://github.com/mapbox/vector-tile-js) for [VectorTile](https://github.com/mapbox/vector-tile-spec/tree/master/2.1) parsing

#### Juggling the vectors and numbers
* [`pnltri`](https://github.com/jahting/pnltri.js) for polygon triangulation to draw them filled
* [`rbush`](https://github.com/mourner/rbush) for 2D spatial indexing based label and mouse collision detection
* [`sphericalmercator`](https://github.com/mapbox/node-sphericalmercator) for [EPSG:3857](http://spatialreference.org/ref/sr-org/6864/) <> [WGS84](http://spatialreference.org/ref/epsg/wgs-84/) conversions

### TODOs
* [ ] cli linking
* [ ] mapping of view to tiles to show
* [ ] label drawing
  * [x] support for point labels
  * [x] dynamic decluttering of labels
  * [ ] centering text labels
* [x] filled polygons
  * [x] convert polygons to triangles
  * [x] implement fillTriangle into drawille-canvas-blessed-contrib
* [ ] lat/lng-center + zoom based viewport
  * [ ] bbox awareness
  * [ ] zoom -> scale calculation
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
* [ ] styling
  * [ ] abstracted MapBox style JSON support
* [ ] turn this into a [`blessed-contrib`](https://github.com/yaronn/blessed-contrib) widget

## License
#### The MIT License (MIT)
Copyright (c) 2016 Michael Straßburger

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
