###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  The Console Vector Tile renderer - bäm!
###
x256 = require 'x256'
triangulator = new (require('pnltri')).Triangulator()

Canvas = require './Canvas'
LabelBuffer = require './LabelBuffer'
Styler = require './Styler'
utils = require './utils'

module.exports = class Renderer
  config:
    fillPolygons: true
    language: 'de'

    drawOrder: ["admin", "building", "road", "water", "poi_label", "place_label", "housenum_label"]

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
      housenum_label: minZoom: 1.5
      building: minZoom: 3.8

      place_label: true
      poi_label: minZoom: 3

      road: true
      water: true
      admin: true

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
    @canvas.clearRect 0, 0, @width, @height

    @canvas.save()
    @canvas.translate @view[0], @view[1]
    @_drawLayers()
    @canvas.restore()

    @_write @canvas._canvas.frame()

    @isDrawing = false

  _write: (output) ->
    process.stdout.write output

  _drawLayers: ->
    for layer in @config.drawOrder
      continue unless @features?[layer]

      @notify "rendering #{layer}..."
      scale = Math.pow 2, @zoom

      if @config.layers[layer].minZoom and @zoom > @config.layers[layer].minZoom
        continue

      for feature in @features[layer].tree.search(minX: 0, minY: 0, maxX: 4096, maxY: 4096)
        @_drawFeature layer, feature.data, scale

  _drawFeature: (layer, feature, scale) ->
    # TODO: this is ugly :) need to be fixed @style
    #return false if feature.properties.class is "ferry"
    feature.type = "LineString" if layer is "building" or layer is "road"

    # TODO: zoom level
    unless style = @styler.getStyleFor layer, feature, 14
      return false

    color = style.paint['line-color'] or style.paint['fill-color'] or style.paint['text-color']

    toDraw = for points in feature.points
      for point in points
        x: point.x/scale
        y: point.y/scale

    # TODO: zoom calculation todo for perfect styling
    if color instanceof Object
      color = color.stops[0][1]

    @canvas.fillStyle = @canvas.strokeStyle = x256 utils.hex2rgb color

    switch feature.type
      when "LineString"
        @_drawWithLines points for points in toDraw
        true

      when "Polygon"
        unless @config.fillPolygons and @_drawWithTriangles toDraw
          @_drawWithLines points for points in toDraw
        true

      when "Point"
        text = feature.properties["name_"+@config.language] or
          feature.properties["name"] or
          feature.properties.house_num or
          #@config.icons[feature.properties.maki] or
          "◉"

        wasDrawn = false
        # TODO: check in definition if points can actually own multiple geometries
        for points in toDraw
          for point in points
            x = point.x - text.length
            #continue if x-@view[0] < 0
            if @labelBuffer.writeIfPossible text, x, point.y
              @canvas.fillText text, x, point.y
              wasDrawn = true

        wasDrawn

  _drawWithTriangles: (points) ->
    try
      triangles = triangulator.triangulate_polygon points
    catch
      return false

    return false unless triangles.length

    # TODO: triangles are returned as vertex references to a flattened input.
    #       optimize it!

    arr = points.reduce (a, b) -> a.concat b
    for triangle in triangles
      try
        @canvas.fillTriangle arr[triangle[0]], arr[triangle[1]], arr[triangle[2]]
      catch
        return false
    true

  _drawWithLines: (points) ->
    @canvas.beginPath()
    first = points.shift()
    @canvas.moveTo first.x, first.y
    @canvas.lineTo point.x, point.y for point in points
    @canvas.stroke()

  _isOnScreen: (point) ->
    point.x+@view[0]>=4 and
    point.x+@view[0]<@width-4 and
    point.y+@view[1]>=0 and
    point.y+@view[1]<@height

  notify: (text) ->
    @_write "\r\x1B[K"+text
