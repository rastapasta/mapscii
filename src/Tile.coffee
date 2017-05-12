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
x256 = require 'x256'
earcut = require 'earcut'

config = require "./config"
utils = require "./utils"

class Tile
  layers: {}

  constructor: (@styler) ->

  load: (buffer) ->
    @_unzipIfNeeded buffer
    .then (buffer) => @_loadTile buffer
    .then => @_loadLayers()
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

  _loadLayers: () ->
    layers = {}
    colorCache = {}

    for name, layer of @tile.layers
      nodes = []
      #continue if name is "water"
      for i in [0...layer.length]
        # TODO: caching of similar attributes to avoid looking up the style each time
        #continue if @styler and not @styler.getStyleFor layer, feature

        feature = layer.feature i
        feature.properties.$type = type = [undefined, "Point", "LineString", "Polygon"][feature.type]

        if @styler
          style = @styler.getStyleFor name, feature
          continue unless style

        color =
          style.paint['line-color'] or
          style.paint['fill-color'] or
          style.paint['text-color']

        # TODO: style zoom stops handling
        if color instanceof Object
          color = color.stops[0][1]

        colorCode = colorCache[color] or colorCache[color] = x256 utils.hex2rgb color

        # TODO: monkey patching test case for tiles with a reduced extent 4096 / 8 -> 512
        # use feature.loadGeometry() again as soon as we got a 512 extent tileset
        geometries = feature.loadGeometry() #@_reduceGeometry feature, 8

        sort = feature.properties.localrank or feature.properties.scalerank
        label = if style.type is "symbol"
          feature.properties["name_"+config.language] or
          feature.properties.name_en or
          feature.properties.name or
          feature.properties.house_num
        else
          undefined

        if style.type is "fill"
          nodes.push @_addBoundaries true,
#            id: feature.id
            layer: name
            style: style
            label: label
            sort: sort
            points: geometries
            color: colorCode

        else

          for points in geometries
            nodes.push @_addBoundaries false,
#             id: feature.id
              layer: name
              style: style
              label: label
              sort: sort
              points: points
              color: colorCode


      tree = rbush 18
      tree.load nodes

      layers[name] =
        extent: layer.extent
        tree: tree

    @layers = layers

  _addBoundaries: (deep, data) ->
    minX = Infinity
    maxX = -Infinity
    minY = Infinity
    maxY = -Infinity

    for p in (if deep then data.points[0] else data.points)
      minX = p.x if p.x < minX
      maxX = p.x if p.x > maxX
      minY = p.y if p.y < minY
      maxY = p.y if p.y > maxY

    data.minX = minX
    data.maxX = maxX
    data.minY = minY
    data.maxY = maxY
    data

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
