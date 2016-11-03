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
  cache: {}
  modes:
    MBTiles: 1
    VectorTile: 2

  mode: null

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
        if err then reject err
        else resolve()

  getTile: (z, x, y) ->
    unless @mode
      throw new Error "no TileSource defined"

    z = Math.max 0, Math.floor z

    if cached = @cache[[z,x,y].join("-")]
      return Promise.resolve cached

    if @mode is @modes.MBTiles
      @_getMBTile z, x, y

  _getMBTile: (z, x, y) ->
    new Promise (resolve, reject) =>
      @mbtiles.getTile z, x, y, (err, tileData) =>
        return reject err if err

        tile = @cache[[z,x,y].join("-")] = new Tile()
        resolve tile.load tileData
