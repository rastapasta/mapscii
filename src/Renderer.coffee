###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  The Console Vector Tile renderer - bäm!
###
Promise = require 'bluebird'
x256 = require 'x256'
simplify = require 'simplify-js'

Canvas = require './Canvas'
LabelBuffer = require './LabelBuffer'
Styler = require './Styler'
Tile = require './Tile'
utils = require './utils'
config = require './config'

module.exports = class Renderer
  terminal:
    CLEAR: "\x1B[2J"
    MOVE: "\x1B[?6h"

  isDrawing: false
  lastDrawAt: 0

  labelBuffer: null
  tileSource: null
  tilePadding: 64

  constructor: (@output, @tileSource) ->
    @labelBuffer = new LabelBuffer()

  loadStyleFile: (file) ->
    @styler = new Styler file
    @tileSource.useStyler @styler

  setSize: (@width, @height) ->
    @canvas = new Canvas @width, @height

  draw: (center, zoom) ->
    return Promise.reject() if @isDrawing
    @isDrawing = true

    @labelBuffer.clear()
    @_seen = {}

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
    z = Math.min config.tileRange, Math.max 0, Math.floor zoom
    center = utils.ll2tile center.lon, center.lat, z

    tiles = []
    scale = @_scaleAtZoom zoom
    tileSize = config.tileSize / scale

    for y in [Math.floor(center.y)-1..Math.floor(center.y)+1]
      for x in [Math.floor(center.x)-1..Math.floor(center.x)+1]
        tile = x: x, y: y, z: z

        position =
          x: @width/2-(center.x-tile.x)*tileSize
          y: @height/2-(center.y-tile.y)*tileSize

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

    for layer in @_generateDrawOrder zoom
      continue unless tile.data.layers?[layer]
      features[layer] = tile.data.layers[layer].search box

    tile.features = features
    tile

  _renderTiles: (tiles) ->
    drawn = {}

    for layer in @_generateDrawOrder tiles[0].xyz.z
      for tile in tiles
        continue unless tile.features[layer]?.length
        for feature in tile.features[layer]
          # continue if feature.id and drawn[feature.id]
          # drawn[feature.id] = true

          @_drawFeature tile, feature

  _getFrame: ->
    frame = ""
    frame += @terminal.CLEAR unless @lastDrawAt
    frame += @terminal.MOVE
    frame += @canvas.frame()
    frame

  featuresAt: (x, y) ->
    @labelBuffer.featuresAt x, y

  _scaleAtZoom: (zoom) ->
    baseZoom = Math.min config.tileRange, Math.floor Math.max 0, zoom
    config.tileSize / config.projectSize / Math.pow(2, zoom-baseZoom)

  _drawFeature: (tile, feature) ->
    if feature.style.minzoom and tile.zoom < feature.style.minzoom
      return false
    else if feature.style.maxzoom and tile.zoom > feature.style.maxzoom
      return false

    switch feature.style.type
      when "line"
        width = feature.style.paint['line-width']
        width = width.stops[0][1] if width instanceof Object

        points = @_scaleAndReduce tile, feature, feature.points
        @canvas.polyline points, feature.color, width if points.length

      when "fill"
        points = (@_scaleAndReduce tile, feature, p, false for p in feature.points)
        @canvas.polygon points, feature.color
        # if points.length is 3
        #   @canvas._filledTriangle points[0], points[1], points[2], feature.color
        true

      when "symbol"
        text = feature.properties["name_"+config.language] or
          feature.properties["name_en"] or
          feature.properties["name"] or
          feature.properties.house_num or
          genericSymbol = "◉"

        return false if @_seen[text] and not genericSymbol

        placed = false
        for point in @_scaleAndReduce tile, feature, feature.points
          x = point.x - text.length
          margin = config.layers[feature.layer]?.margin or config.labelMargin

          if @labelBuffer.writeIfPossible text, x, point.y, feature, margin
            @canvas.text text, x, point.y, feature.color
            placed = true
            break

          else if config.layers[feature.layer]?.cluster and
          @labelBuffer.writeIfPossible "◉", point.x, point.y, feature, 3
            @canvas.text "◉", point.x, point.y, feature.color
            placed = true
            break

        @_seen[text] = true if placed

    true

  _scaleAndReduce: (tile, feature, points, filter = true) ->
    lastX = lastY = outside = null
    scaled = []

    minX = minY = -@tilePadding
    maxX = @width+@tilePadding
    maxY = @height+@tilePadding

    for point in points
      x = Math.floor tile.position.x+(point.x/tile.scale)
      y = Math.floor tile.position.y+(point.y/tile.scale)

      continue if lastX is x and lastY is y

      lastY = y
      lastX = x

      if filter
        if x < minX or x > maxX or y < minY or y > maxY
          continue if outside
          outside = true
        else
          if outside
            outside = null
            scaled.push x: lastX, y: lastY

      scaled.push x: x, y: y

    if feature.style.type isnt "symbol"
      if scaled.length < 2
        return []

      simplify scaled, .5
    else
      scaled

  _generateDrawOrder: (zoom) ->
    if zoom < 2
      [
        "admin"
        "water"
        "country_label"
        "marine_label"
      ]
    else
      [
        "landuse"
        "water"
        "marine_label"
        "building"
        "road"
        "admin"

        "country_label"
        "state_label"
        "water_label"
        "place_label"
        "rail_station_label"
        "poi_label"
        "road_label"
        "housenum_label"
      ]
