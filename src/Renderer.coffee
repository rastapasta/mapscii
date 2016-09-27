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
    fillPolygons: true
    language: 'de'

    labelMargin: 5

    #"poi_label", "water",
    drawOrder: ["admin", "building", "road", "place_label", "poi_label", "housenum_label"]

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
        minZoom: 1.5
        margin: 3
      building: minZoom: 3.8
      poi_label:
        minZoom: 3
        margin: 5

  isDrawing: false
  lastDrawAt: 0

  labelBuffer: null

  constructor: ->
    @labelBuffer = new LabelBuffer()

  loadStyleFile: (file) ->
    @styler = new Styler file

  setSize: (@width, @height) ->
    @canvas = new Canvas @width, @height

  draw: (@view, @zoom) ->
    return if @isDrawing
    @isDrawing = true
    @lastDrawAt = Date.now()

    @notify "rendering..."

    @labelBuffer.clear()

    # TODO: better way for background color instead of setting filling FG?
    # if color = @styler.styleById['background']?.paint['background-color']
    #   @canvas.strokeStyle = x256 utils.hex2rgb(color)...
    #   @canvas.fillRect 0, 0, @width, @height
    # else
    @canvas.clear()
    @canvas.reset()

    @canvas.translate @view[0], @view[1]
    @_drawLayers()

    process.stdout.cursorTo 0, 0
    @canvas.print()

    @isDrawing = false

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
        @_drawFeature layer, feature.data, scale

  _drawFeature: (layer, feature, scale) ->
    # TODO: this is ugly :) need to be fixed @style
    #return false if feature.properties.class is "ferry"
    feature.type = "LineString" if layer is "building" or layer is "road"

    # TODO: zoom level
    unless style = @styler.getStyleFor layer, feature, 14
      return false

    toDraw = for points in feature.points
      [point.x/scale, point.y/scale] for point in points

    color = style.paint['line-color'] or style.paint['fill-color'] or style.paint['text-color']

    # TODO: zoom calculation todo for perfect styling
    if color instanceof Object
      color = color.stops[0][1]

    colorCode = x256 utils.hex2rgb color

    switch feature.type
      when "LineString"
        @canvas.polyline points, colorCode for points in toDraw

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
            if @labelBuffer.writeIfPossible text, x, point[1], (@config.layers[layer]?.margin or @config.labelMargin)
              @canvas.text text, x, point[1], colorCode, false

  notify: (text) ->
    @_write "\r\x1B[K"+text
