###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Handling of and access to single VectorTiles
###

VectorTile = require('vector-tile').VectorTile
Protobuf = require 'pbf'
Promise = require 'bluebird'
zlib = require 'zlib'
rbush = require 'rbush'

class Tile
  layers: {}

  load: (buffer) ->
    @_unzipIfNeeded buffer
    .then (data) => @_loadTile data
    .then (tile) => @_loadLayers tile
    .then => this

  _loadTile: (buffer) ->
    @tile = new VectorTile new Protobuf buffer

  _unzipIfNeeded: (buffer) ->
    new Promise (resolve, reject) =>
      if @_isGzipped buffer
        zlib.gunzip buffer, (err, data) ->
          return reject err if err
          resolve data
      else
        resolve buffer

  _isGzipped: (buffer) ->
    buffer.slice(0,2).indexOf(Buffer.from([0x1f, 0x8b])) is 0

  _loadLayers: (tile) ->
    layers = {}
    for name, layer of tile.layers
      tree = rbush()
      features = for i in [0...layer.length]
        # TODO: caching of similar attributes to avoid looking up the style each time
        #continue if @styler and not @styler.getStyleFor layer, feature

        feature = layer.feature i

        type = feature.properties.$type =
          [undefined, "Point", "LineString", "Polygon"][feature.type]

        data =
          points: feature.loadGeometry()
          properties: feature.properties
          id: feature.id
          type: type

        @_addToTree tree, data
        data

      layers[name] = tree: tree, features: features

    @layers = layers

  _addToTree: (tree, data) ->
    [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity]
    for outer in data.points
      for p in outer
        minX = p.x if p.x < minX
        maxX = p.x if p.x > maxX
        minY = p.y if p.y < minY
        maxY = p.y if p.y > maxY

    tree.insert
      minX: minX
      maxX: maxX
      minY: minY
      maxY: maxY
      data: data

module.exports = Tile
