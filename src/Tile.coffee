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

  constructor: (@styler) ->

  load: (buffer) ->
    @_unzipIfNeeded buffer
    .then (buffer) => @_loadTile buffer
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
      for i in [0...layer.length]
        # TODO: caching of similar attributes to avoid looking up the style each time
        #continue if @styler and not @styler.getStyleFor layer, feature

        feature = layer.feature i
        feature.properties.$type = type = [undefined, "Point", "LineString", "Polygon"][feature.type]

        if @styler
           style = @styler.getStyleFor name, feature
           continue unless style

        # TODO: monkey patching test case for tiles with a reduced extent 4096 / 8 -> 512
        # use feature.loadGeometry() again as soon as we got a 512 extent tileset
        geometries = @_reduceGeometry feature, 8

        if style.type is "fill"
          @_addToTree tree,
            id: feature.id
            layer: name
            style: style
            properties: feature.properties
            points: geometries[0]

        else
          for points in geometries
            @_addToTree tree,
              id: feature.id
              layer: name
              style: style
              properties: feature.properties
              points: points

      layers[name] = tree

    @layers = layers

  _addToTree: (tree, data) ->
    [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity]

    for p in data.points
      minX = p.x if p.x < minX
      maxX = p.x if p.x > maxX
      minY = p.y if p.y < minY
      maxY = p.y if p.y > maxY

    data.minX = minX
    data.maxX = maxX
    data.minY = minY
    data.maxY = maxY

    tree.insert data

  _reduceGeometry: (feature, factor) ->
    for points, i in feature.loadGeometry()
      reduced = []
      last = null
      for point in points
        p =
          x: Math.floor point.x/factor
          y: Math.floor point.y/factor

        if last and last.x is p.x and last.y is p.y
          continue

        reduced.push last = p

      reduced

module.exports = Tile
