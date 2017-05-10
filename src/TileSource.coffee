###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Source for VectorTiles - supports
  * remote TileServer
  * local MBTiles and VectorTiles
###

Promise = require 'bluebird'
userhome = require 'userhome'
fetch = require 'node-fetch'
fs = require 'fs'

Tile = require './Tile'
config = require './config'

# https://github.com/mapbox/node-mbtiles has native build dependencies (sqlite3)
# To maximize mapscii's compatibility, MBTiles support must be manually added via
# $> npm install -g mbtiles
MBTiles = try
  require 'mbtiles'
catch
  null

module.exports = class TileSource
  cache: {}
  cacheSize: 16
  cached: []

  modes:
    MBTiles: 1
    VectorTile: 2
    HTTP: 3

  mode: null
  mbtiles: null
  styler: null

  init: (@source) ->
    if @source.startsWith "http"
      @_initPersistence() if config.persistDownloadedTiles

      @mode = @modes.HTTP

    else if @source.endsWith ".mbtiles"
      unless MBTiles
        throw new Error "MBTiles support must be installed with following command: 'npm install -g mbtiles'"

      @mode = @modes.MBTiles
      @loadMBtils source

    else
      throw new Error "source type isn't supported yet"

  loadMBtils: (source) ->
    new Promise (resolve, reject) =>
      new MBTiles source, (err, @mbtiles) =>
        if err then reject err
        else resolve()

  useStyler: (@styler) ->

  getTile: (z, x, y) ->
    unless @mode
      throw new Error "no TileSource defined"

    z = Math.max 0, Math.floor z

    if cached = @cache[[z,x,y].join("-")]
      return Promise.resolve cached

    if @cached.length > @cacheSize
      for tile in @cached.splice 0, Math.abs(@cacheSize-@cached.length)
        delete @cache[tile]

    switch @mode
      when @modes.MBTiles then @_getMBTile z, x, y
      when @modes.HTTP then @_getHTTP z, x, y

  _getHTTP: (z, x, y) ->
    promise =
      if config.persistDownloadedTiles and tile = @_getPersited z, x, y
        Promise.resolve tile
      else
        fetch @source+[z,x,y].join("/")+".pbf"
        .then (res) => res.buffer()
        .then (buffer) =>
          @_persistTile z, x, y, buffer if config.persistDownloadedTiles
          buffer

    promise
    .then (buffer) =>
      @_createTile z, x, y, buffer

  _getMBTile: (z, x, y) ->
    new Promise (resolve, reject) =>
      @mbtiles.getTile z, x, y, (err, buffer) =>
        return reject err if err
        resolve @_createTile z, x, y, buffer

  _createTile: (z, x, y, buffer) ->
    name = [z,x,y].join("-")
    @cached.push name

    tile = @cache[name] = new Tile @styler
    tile.load buffer

  _initPersistence: ->
    try
      @_createFolder userhome ".mapscii"
      @_createFolder userhome ".mapscii", "cache"
    catch error
      config.persistDownloadedTiles = false
      return

  _persistTile: (z, x, y, buffer) ->
    zoom = z.toString()
    @_createFolder userhome ".mapscii", "cache", zoom
    fs.writeFile userhome(".mapscii", "cache", zoom, "#{x}-#{y}.pbf"), buffer, -> null

  _getPersited: (z, x, y) ->
    try
      fs.readFileSync userhome ".mapscii", "cache", z.toString(), "#{x}-#{y}.pbf"
    catch error
      false

  _createFolder: (path) ->
    try
      fs.mkdirSync path
      true
    catch e
      e.code is "EEXIST"
