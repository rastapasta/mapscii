# termap - Terminal Map Viewer

Discover the world in your console!

* Use your mouse or keyboard to navigate
* Watch the globe or zoom down to house numbers
* Use tile servers, local MBTiles or a single VectorTile

## How to get it?

* Make sure to have [node.js](https://nodejs.org/) installed

* Install `termap` with

  `npm install -g termap`

## How to use it?

* Start `termap` with

  ` termap`

## Behind the scenes
### Libraries
#### Mastering the console
  * [`drawille-canvas-blessed-contrib`](https://github.com/yaronn/drawille-canvas-blessed-contrib/) for braille rendering
  * [`term-mouse`](https://github.com/CoderPuppy/term-mouse) for mouse handling
  * [`keypress`](https://github.com/TooTallNate/keypress) for input handling

#### Discovering the map data
* [`node-mbtiles`](https://github.com/mapbox/node-mbtiles) for [MBTiles](https://github.com/mapbox/mbtiles-spec/blob/master/1.2/spec.md) parsing
* [`pbf`](https://github.com/mapbox/pbf) for [Protobuf](https://developers.google.com/protocol-buffers/) decoding
* [`vector-tile-js`](https://github.com/mapbox/vector-tile-js) for [VectorTile](https://github.com/mapbox/vector-tile-spec/tree/master/2.1) parsing

#### Juggling the vectors and numbers
* [`rbush`](https://github.com/mourner/rbush) for 2D spatial indexing based label and mouse collision detection
* [`sphericalmercator`](https://github.com/mapbox/node-sphericalmercator) for EPSG:3857 <> WGS84 conversions


## Wishlist

* node port of [libdrawille](https://github.com/Huulivoide/libdrawille) - well optimized library, supporting filled polygons

### TODOs
* [ ] cli linking
* [ ] mapping of view to tiles to show
* [ ] label drawing
  * [x] support for point labels
  * [x] dynamic decluttering of labels
  * [ ] centering text labels
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
* [ ] turn this into a [`blessed-contrib`](https://github.com/yaronn/blessed-contrib) widget

## License
####The MIT License (MIT)
Copyright (c) 2016 Michael Straßburger

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
