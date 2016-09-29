###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  The Console Vector Tile renderer - bäm!
###
x256 = require 'x256'

Canvas = require './Canvas'
LabelBuffer = require './LabelBuffer'
Styler = require './Styler'
utils = require './utils'

module.exports = class Renderer
  config:
    baseZoom: 4
    fillPolygons: true
    language: 'de'

    labelMargin: 5

    #"poi_label", "water",
    drawOrder: [
      "water"
      "admin"
      "building"
      "road"

      "place_label"
      "poi_label"
      "housenum_label"
      "country_label"
      "state_label"
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

  isDrawing: false
  lastDrawAt: 0

  labelBuffer: null

  constructor: ->
    @labelBuffer = new LabelBuffer()

  loadStyleFile: (file) ->
    @styler = new Styler file

  setSize: (@width, @height) ->
    @canvas = new Canvas @width, @height

  draw: (@view, @zoom, @degree) ->
    return if @isDrawing
    @isDrawing = true
    @lastDrawAt = Date.now()

    @notify "rendering..."

    @labelBuffer.clear()

    # TODO: better way for background color instead of setting filling FG?
    if color = @styler.styleById['background']?.paint['background-color']
      @canvas.setBackground x256 utils.hex2rgb color

    @canvas.clear()
    @canvas.reset()

    @canvas.translate @view[0], @view[1]
    @_drawLayers()

    process.stdout.cursorTo 0, 0
    @canvas.print()

    @isDrawing = false

  featuresAt: (x, y) ->
    @labelBuffer.featuresAt x, y


  _write: (output) ->
    process.stdout.write output

  _drawLayers: ->
    for layer in @config.drawOrder
      continue unless @features?[layer]

      scale = Math.pow 2, @zoom

      if @config.layers[layer]?.minZoom and @zoom > @config.layers[layer].minZoom
        continue

      box =
        minX: -@view[0]*scale
        minY: -@view[1]*scale
        maxX: (@width-@view[0])*scale
        maxY: (@height-@view[1])*scale

      features = @features[layer].tree.search box
      @notify "rendering #{features.length} #{layer} features.."
      for feature in features
        @_drawFeature layer, feature, scale

  _drawFeature: (layer, data, scale) ->
    feature = data.data

    # TODO: this is ugly :) need to be fixed @style
    #return false if feature.properties.class is "ferry"
    feature.type = "LineString" if layer is "building" or layer is "road"

    # TODO: zoom level
    unless style = @styler.getStyleFor layer, feature, 19-@zoom
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
        @canvas.polygon toDraw[0], colorCode

      when "Point"
        text = feature.properties["name_"+@config.language] or
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


  notify: (text) ->
    @_write "\r\x1B[K"+text
