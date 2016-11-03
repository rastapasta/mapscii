###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Source for VectorTiles - supports
  * remote TileServer
  * local MBTiles and VectorTiles
###

Promise = require 'bluebird'
MBTiles = require 'mbtiles'

request = require 'request'
rp = require 'request-promise'

Tile = require './Tile'

module.exports = class TileSource
  cache: {}
  modes:
    MBTiles: 1
    VectorTile: 2
    HTTP: 3

  mode: null

  mbtiles: null

  init: (@source) ->
    if @source.startsWith "http"
      @mode = @modes.HTTP

    else if @source.endsWith ".mbtiles"
      @mode = @modes.MBTiles
      @loadMBtils source

    else
      throw new Error "source type isn't supported yet"

  loadMBtils: (source) ->
    new Promise (resolve, reject) =>
      new MBTiles source, (err, @mbtiles) =>
        if err then reject err
        else resolve()

  getTile: (z, x, y) ->
    unless @mode
      throw new Error "no TileSource defined"

    z = Math.max 0, Math.floor z

    if cached = @cache[[z,x,y].join("-")]
      return Promise.resolve cached

    switch @mode
      when @modes.MBTiles then @_getMBTile z, x, y
      when @modes.HTTP then @_getHTTP z, x, y

  _getHTTP: (z, x, y) ->
    rp
      uri: @source+[z,x,y].join("/")+".pbf"
      encoding: null
    .then (buffer) =>
      @_createTile z, x, y, buffer

  _getMBTile: (z, x, y) ->
    new Promise (resolve, reject) =>
      @mbtiles.getTile z, x, y, (err, buffer) =>
        return reject err if err
        resolve @_createTile z, x, y, buffer

  _createTile: (z, x, y, buffer) ->
    tile = @cache[[z,x,y].join("-")] = new Tile()
    tile.load buffer
