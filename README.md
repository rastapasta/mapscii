# termap - Terminal Map Viewer

Discover the world in your console! termap allows you to render and navigate
VectorTile based maps in your console.

* No native dependencies, 100% JavaScript/CoffeeScript
* Use tile servers or local MBTiles and VectorTiles

## How to install it?

`npm install -g termap`

## Behind the scenes

### Libraries
* [`pbf`](https://github.com/mapbox/pbf) for Protobuf parsing
* [`vector-tile`](https://github.com/mapbox/vector-tile-js) for [VectorTile](https://github.com/mapbox/vector-tile-spec/tree/master/2.1) parsing
* [`term-mouse`](https://github.com/CoderPuppy/term-mouse) for mouse handling
* [`keypress`](https://github.com/TooTallNate/keypress) for input handling
* [`node-drawille`](https://github.com/madbence/node-drawille/) for braille rendering (to be replaced)


## TODOs
* [ ] mapping of view to tiles to show
* [ ] tile request system
  * [ ] from local mbtiles
  * [ ] from remote url
* [ ] label drawing
* [ ] lat/lng-center + zoom based viewport
* [ ] TileSource class (abstracting URL, mbtiles, single vector tile source)
* [ ] zoom while keeping center
* [ ] API
  * [ ] setCenter
  * [ ] setZoom
* [x] accurate mouse drag&drop
* [x] handle console resize

## Wishlist
* node-gyp binding to [libdrawille](https://github.com/Huulivoide/libdrawille) for speed refactor possibilities + filled polygons
