###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  The Console Vector Tile renderer - bäm!
###
x256 = require 'x256'
mercator = new (require('sphericalmercator'))()
tilebelt = require 'tilebelt'
Promise = require 'bluebird'

Canvas = require './Canvas'
LabelBuffer = require './LabelBuffer'
Styler = require './Styler'
Tile = require './Tile'
utils = require './utils'

module.exports = class Renderer
  cache: {}
  config:
    fillPolygons: true
    language: 'de'

    labelMargin: 5

    tileSize: 512
    projectSize: 256
    maxZoom: 14

    #"poi_label", "water",
    drawOrder: [
      "admin"
      "water"
      "marine_label"
      "building"
      "road"
      "country_label"
      "state_label"
      "water_label"
      "place_label"
      "rail_station_label"
      "poi_label"
      "housenum_label"
    ]

    icons:
      car: "🚗"
      school: "S" #{}"🏫"
      marker: "⭐"
      'art-gallery': "A" #"🎨"
      attraction: "❕"
      stadium: "🏈"
      toilet: "🚽"
      cafe: "☕"
      laundry: "👚"
      bus: "🚌"
      restaurant: "R" #🍛"
      lodging: "B" #🛏"
      'fire-station': "🚒"
      shop: "🛍"
      pharmacy: "💊"
      beer: "H" #"🍺"
      cinema: "C" #"🎦"

    layers:
      housenum_label:
        margin: 3
      poi_label:
        margin: 5
        cluster: true

      place_label: cluster: true
      state_label: cluster: true

  terminal:
    CLEAR: "\x1B[2J"
    MOVE: "\x1B[?6h"

  isDrawing: false
  lastDrawAt: 0

  labelBuffer: null
  tileSource: null

  constructor: (@output, @tileSource) ->
    @labelBuffer = new LabelBuffer()

  loadStyleFile: (file) ->
    @styler = new Styler file

  setSize: (@width, @height) ->
    @canvas = new Canvas @width, @height

  draw: (center, zoom) ->
    return Promise.reject() if @isDrawing
    @isDrawing = true

    @labelBuffer.clear()

    if color = @styler.styleById['background']?.paint['background-color']
      @canvas.setBackground x256 utils.hex2rgb color

    @canvas.clear()

    Promise
    .resolve @_visibleTiles center, zoom
    .map (tile) => @_getTile tile
    .map (tile) => @_getTileFeatures tile
    .then (tiles) => @_renderTiles tiles
    .then => @_getFrame()

    .catch (e) ->
      console.log e

    .finally (frame) =>
      @isDrawing = false
      @lastDrawAt = Date.now()

      frame

  _visibleTiles: (center, zoom) ->
    z = Math.min @config.maxZoom, Math.max 0, Math.floor zoom
    xyz = tilebelt.pointToTileFraction center.lon, center.lat, z

    tiles = []
    scale = @_scaleAtZoom zoom
    tileSize = @config.tileSize / scale

    for y in [Math.floor(xyz[1])-1..Math.floor(xyz[1])+1]
      for x in [Math.floor(xyz[0])-1..Math.floor(xyz[0])+1]
        tile = x: x, y: y, z: z

        position =
          x: @width/2-(xyz[0]-tile.x)*tileSize
          y: @height/2-(xyz[1]-tile.y)*tileSize

        gridSize = Math.pow 2, z

        tile.x %= gridSize
        if tile.x < 0
          tile.x = if z is 0 then 0 else tile.x+gridSize

        if tile.y < 0 or
        tile.y >= gridSize or
        position.x+tileSize < 0 or
        position.y+tileSize < 0 or
        position.x>@width or
        position.y>@height
          continue

        tiles.push xyz: tile, zoom: zoom, position: position, scale: scale

    tiles

  _getTile: (tile) ->
    @tileSource
    .getTile tile.xyz.z, tile.xyz.x, tile.xyz.y
    .then (data) =>
      tile.data = data
      tile

  _getTileFeatures: (tile) ->
    zoom = tile.xyz.z
    position = tile.position
    scale = tile.scale

    box =
      minX: -position.x*scale
      minY: -position.y*scale
      maxX: (@width-position.x)*scale
      maxY: (@height-position.y)*scale

    features = {}
    for layer in @config.drawOrder
      continue unless tile.data.layers?[layer]
      features[layer] = tile.data.layers[layer].tree.search box

    tile.features = features
    tile

  _renderTiles: (tiles) ->
    drawn = {}

    for layer in @config.drawOrder
      short = layer.split(":")[0]

      for tile in tiles
        continue unless tile.features[layer]?.length

        @canvas.save()
        @canvas.translate tile.position.x, tile.position.y

        for feature in tile.features[layer]
          continue if feature.data.id and drawn[feature.data.id]
          drawn[feature.data.id] = true

          @_drawFeature short, feature, tile.scale, tile.zoom

        @canvas.restore()

  _getFrame: ->
    frame = ""
    frame += @terminal.CLEAR unless @lastDrawAt
    frame += @terminal.MOVE
    frame += @canvas.frame()
    frame

  featuresAt: (x, y) ->
    @labelBuffer.featuresAt x, y

  _scaleAtZoom: (zoom) ->
    baseZoom = Math.min @config.maxZoom, Math.floor Math.max 0, zoom
    (@config.tileSize/@config.projectSize)/Math.pow(2, zoom-baseZoom)

  _drawFeature: (layer, data, scale, zoom) ->
    feature = data.data

    # TODO: this is ugly :) need to be fixed @style
    #return false if feature.properties.class is "ferry"
    feature.type = "LineString" if layer is "building" or layer is "road"

    unless style = @styler.getStyleFor layer, feature, zoom
      return false

    toDraw = (@_scaleAndReduce points, scale for points in feature.points)

    color = style.paint['line-color'] or style.paint['fill-color'] or style.paint['text-color']

    # TODO: zoom calculation todo for perfect styling
    if color instanceof Object
      color = color.stops[0][1]

    colorCode = x256 utils.hex2rgb color

    switch feature.type
      when "LineString"
        width = style.paint['line-width']?.base*1.4 or 1
        @canvas.polyline points, colorCode, width for points in toDraw

      when "Polygon"
        @canvas.polygon toDraw, colorCode

      when "Point"
        text = feature.properties["name_"+@config.language] or
          feature.properties["name_en"] or
          feature.properties["name"] or
          feature.properties.house_num or
          #@config.icons[feature.properties.maki] or
          "◉"

        # TODO: check in definition if points can actually own multiple geometries
        for points in toDraw
          for point in points
            x = point[0] - text.length
            margin = @config.layers[layer]?.margin or @config.labelMargin

            if @labelBuffer.writeIfPossible text, x, point[1], feature, margin
              @canvas.text text, x, point[1], colorCode
            else if @config.layers[layer]?.cluster and @labelBuffer.writeIfPossible "X", point[0], point[1], feature, 3
              @canvas.text "◉", point[0], point[1], colorCode

  _scaleAndReduce: (points, scale) ->
    lastX = null
    lastY = null
    scaled = []

    for point in points
      x = Math.floor point.x/scale
      y = Math.floor point.y/scale

      if lastX isnt x or lastY isnt y
        lastY = y
        lastX = x
        scaled.push [x, y]

    scaled
