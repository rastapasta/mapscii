# MapSCII - Map Viewer for your console

No web browser around? Don't worry - and discover the planet in your console!

<img src="http://i.imgur.com/yYVt7No.png" width="100%" />

* Use your mouse or keys to navigate
* Discover the globe or zoom in to explore your neighbourhood
* See Point-of-Interest around any given location
* Use an online map server or work offline with VectorTile/MBTiles
* Highly customizable styling (reuse your [mapbox-gl-style](https://github.com/mapbox/mapbox-gl-styles)s)
* Compatible with Linux' and OS X' terminals, Windows support via [PuTTY](http://www.putty.org/)
* 99% pure Coffee-/JavaScript! :sunglasses:

## How to get it?

* Make sure to have at least [node.js](https://nodejs.org/) version 4 installed
* Open your terminal!
* Install `mapscii` with

  `npm install -g mapscii`

## How to use it?
#### Basic usage
* Start `mapscii` with

  ` mapscii`


## Behind the scenes
### Libraries
#### Mastering the console
  * [`x256`](https://github.com/substack/node-x256) for converting RGB values to closest xterm-256 [color code](https://en.wikipedia.org/wiki/File:Xterm_256color_chart.svg)
  * [`term-mouse`](https://github.com/CoderPuppy/term-mouse) for mouse handling
  * [`keypress`](https://github.com/TooTallNate/keypress) for input handling

#### Discovering the map data
* [`vector-tile`](https://github.com/mapbox/vector-tile-js) for [VectorTile](https://github.com/mapbox/vector-tile-spec/tree/master/2.1) parsing
* [`pbf`](https://github.com/mapbox/pbf) for [Protobuf](https://developers.google.com/protocol-buffers/) decoding
* [`mbtiles`](https://github.com/mapbox/node-mbtiles) for [MBTiles](https://github.com/mapbox/mbtiles-spec/blob/master/1.2/spec.md) parsing

#### Juggling the vectors and numbers
* [`earcut`](https://github.com/mapbox/earcut) for polygon triangulation
* [`rbush`](https://github.com/mourner/rbush) for 2D spatial indexing based label and mouse collision detection
* [`gl-matrix`](https://github.com/toji/gl-matrix) for vector and matrix operations
* [`breseham`](https://github.com/madbence/node-bresenham) for line calculations
* [`sphericalmercator`](https://github.com/mapbox/node-sphericalmercator) for [EPSG:3857](http://spatialreference.org/ref/sr-org/6864/) <> [WGS84](http://spatialreference.org/ref/epsg/wgs-84/) conversions
* [`tilebelt`](https://github.com/mapbox/tilebelt) for some [slippy map tilename](https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames) calculations

#### Handling the flow
* [`bluebird`](https://github.com/petkaantonov/bluebird) for all the asynchronous [Promise](https://developer.mozilla.org/de/docs/Web/JavaScript/Reference/Global_Objects/Promise) magic
* [`request-promise`](https://github.com/request/request-promise) for promisified HTTP request handling

### TODOs
* MapSCII
  * [ ] CLI support
    * [ ] global linking for npm install -g
    * [ ] startup parameters
      * [ ] Style
      * [ ] center position
      * [ ] POI filter?
      * [ ] VectorTile
      * [ ] MBTile
      * [ ] Tileserver
  * [ ] mapscii-server
    * [ ] telnet
    * [ ] ssh
  * [ ] Viewport
    * [x] start with zoom level which shows full vector tile
    * [X] boundary based on current zoom & size
    * [X] determain tiles to show
    * [X] zoom while keeping center
    * [ ] calculate tile areas
    * [X] center based on mercator
    * [x] handle console resize
  * [x] handle console resize
  * [ ] mouse control
    * [x] accurate mouse drag&drop with instant update
    * [x] hover POIs/labels
    * [ ] hover maybe even polygons/-lines?
    * [ ] get hover lat/lng
    * [ ] zoom into mouse pos
  * [ ] API
    * [ ] setCenter
    * [ ] setZoom

* Styler
  * [x] compile filters to function chains
  * [x] support constants

* Renderer
  * [x] position tiles accordingly
  * [ ] line drawing
    * [x] support for stroke width
    * [ ] support for dashed/dotted lines?
  * [ ] feature selection for priority rerendering (roads -> warter -> roads:bridges)

  * [ ] label drawing
    * [x] support for point labels
    * [x] dynamic decluttering of labels
    * [x] centering text labels
    * [x] clipping fix when x<0 after repositioning
    * [ ] multi line label
    * [x] label margin to avoid POI overlap?
    * [ ] translatable raster fonts

  * [x] filled polygons
    * [x] convert polygons to triangles
    * [x] use triangulation for filling
    * [ ] respect fill/line style file based setting

* Tile
  * [x] directly throw away features that aren't covered by any style
  * [x] TileSource class (abstracting URL, mbtiles, single vector tile source)
  * [x] tile request system
    * [ ] from single vector-tile
    * [x] from local mbtiles
    * [x] from remote url
      * [ ] permanent caching of received files

## License
#### The MIT License (MIT)
Copyright (c) 2016 Michael Straßburger

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
