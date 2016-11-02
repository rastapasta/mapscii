###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Source for VectorTiles - supports
  * remote TileServer
  * local MBTiles and VectorTiles
###

Promise = require 'bluebird'
MBTiles = require 'mbtiles'

Tile = require './Tile'

module.exports = class TileSource
  modes:
    MBTiles: 1
    VectorTile: 2

  mode: null
  cache: {}

  mbtiles: null

  init: (source) ->
    if source.endsWith ".mbtiles"
      @mode = @modes.MBTiles
      @loadMBtils source
    else
      throw new Error "source type isn't supported yet"

  loadMBtils: (source) ->
    new Promise (resolve, reject) =>
      new MBTiles source, (err, @mbtiles) =>
        return reject err if err
        resolve()

  getTile: (z, x, y) ->
    unless @mode
      throw new Error "no TileSource defined"

    z = Math.max 0, Math.floor z

    cacheKey = [z, x, y].join "-"

    return if cached = @cache[cacheKey]
      Promise.resolve cached
    else if @mode is @modes.MBTiles
      new Promise (resolve, reject) =>
        @mbtiles.getTile z, x, y, (err, tileData) =>
          return reject err if err
          resolve @cache[cacheKey] = new Tile tileData
