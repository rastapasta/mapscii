Canvas = require 'drawille-canvas-blessed-contrib'
VectorTile = require('vector-tile').VectorTile
Protobuf = require 'pbf'
keypress = require 'keypress'
fs = require 'fs'
zlib = require 'zlib'
TermMouse = require('term-mouse')

class Termap
  config:
    drawOrder: ["admin", "water", "landuse", "building", "road", "housenum_label"]

    icons:
      car: "🚗"
      school: "🏫"
      marker: "⭐"
      'art-gallery': "🎨"
      attraction: "❕"
      stadium: "🏈"
      toilet: "🚽"
      cafe: "☕"
      laundry: "👚"
      bus: "🚌"
      restaurant: "🍛"
      lodging: "🛏."
      'fire-station': "🚒"
      shop: "🛍"
      pharmacy: "💊"
      beer: "🍺"
      cinema: "🎦"

    layers:
      housenum_label:
        minZoom: 4
        color: 8
      building:
        minZoom: 12
        color: 8

      road:
        color: "white"

      landuse:
        color: "green"
      water:
        color: "blue"
      admin:
        color: "red"

  mouse: null
  width: null
  height: null
  canvas: null

  isDrawing: false
  lastDrawAt: 0

  mousePosition: [0, 0]
  mouseDragging: false

  view: [-400, -80]
  scale: 4

  constructor: ->
    @_initControls()
    @_initCanvas()

    @_onResize =>
      @_initCanvas()
      @_draw()

  _initControls: ->
    keypress process.stdin
    process.stdin.setRawMode true
    process.stdin.resume()

    process.stdin.on 'keypress', (ch, key) => @_onKey key

    @mouse = TermMouse()
    @mouse.start()

    @mouse.on 'click', (event) => @_onClick event
    @mouse.on 'scroll', (event) => @_onMouseScroll event
    @mouse.on 'move', (event) => @_onMouseMove event

  _initCanvas: ->
    @width = Math.floor((process.stdout.columns-1)/2)*2*2
    @height = Math.ceil(process.stdout.rows/4)*4*4
    @canvas = new Canvas @width, @height

  _onResize: (cb) ->
    process.stdout.on 'resize', cb

  _onClick: (event) ->
    if @mouseDragging and event.button is "left"
      @view[0] -= (@mouseDragging.x-@mousePosition.x)*2
      @view[1] -= (@mouseDragging.y-@mousePosition.y)*4
      @_draw()

      @mouseDragging = false

  _onMouseScroll: (event) ->
    # TODO: handle .x/y for directed zoom
    @zoomBy .5 * if event.button is "up" then 1 else -1
    @_draw()

  _onMouseMove: (event) ->
    # only continue if x/y are valid
    return unless event.x <= process.stdout.columns and event.y <= process.stdout.rows

    # start dragging
    if not @mouseDragging and event.button is "left"
      @mouseDragging = x: event.x, y: event.y

    # update internal mouse tracker
    @mousePosition = x: event.x, y: event.y

  _onKey: (key) ->
    # check if the pressed key is configured
    draw = switch key?.name
      when "q"
        process.exit 0

      when "z" then @zoomBy(.5)
      when "a" then @zoomBy(-.5)
      when "left" then @view[0] += 5
      when "right" then @view[0] -= 5
      when "up" then @view[1]+= 5
      when "down" then @view[1]-= 5

      else
        false

    if draw
      @_draw()
    else
      # display debug info for unhandled keys
      @notify JSON.stringify key

  _parseTile: (buffer) ->
    # extract, decode and parse a given tile buffer
    new VectorTile new Protobuf zlib.gunzipSync data

  _getFeatures: (tile) ->
    features = {}
    for name,layer of tile.layers
      continue unless @config.layers[name]

      features[name] = for i in [0...layer.length]
        feature = layer.feature i

        type: [undefined, "point", "line", "polygon"][feature.type]
        id: feature.id
        properties: feature.properties
        points: feature.loadGeometry()

    features

  _draw: ->
    return if @isDrawing
    @isDrawing = true
    @lastDrawAt = Date.now()

    @canvas.clearRect 0, 0, @width, @height
    #@_write @canvas._canvas.frame()

    @canvas.save()

    @canvas.translate @view[0], @view[1]

    for layer in @config.drawOrder
      continue unless @features?[layer]

      if @config.layers[layer].minZoom and @scale > @config.layers[layer].minZoom
        continue


      @canvas.strokeStyle = @canvas.fillStyle = @config.layers[layer].color

      for feature in @features[layer]
        for points in feature.points

          visible = false
          points = for point in points
            p = [point.x/@scale, point.y/@scale]
            if not visible and
              p[0]+@view[0]>=4 and
              p[0]+@view[0]<@width-4 and
              p[1]+@view[1]>=0 and
              p[1]+@view[1]<@height
                visible = true
            p
          continue unless visible

          switch feature.type
            when "polygon", "line"
              @canvas.beginPath()
              @canvas.moveTo points.shift()...
              @canvas.lineTo point... for point in points
              @canvas.stroke()

            when "point"
              text = feature.properties.house_num or @config.icons[feature.properties.maki] or "◉"
              @canvas.fillText text, point... for point in points

    @canvas.restore()

    @_write @canvas._canvas.frame()
    @_write @_getFooter()

    @isDrawing = false

  _write: (text) ->
    process.stdout.write text

  _getFooter: ->
    "scale: #{Math.floor(@scale*1000)/1000}"

  notify: ->
    return if @isDrawing
    @_write "\r\x1B[K#{@_getFooter()} #{text}"

  zoomBy: (step) ->
    return unless @scale+step > 0

    before = @scale
    @scale += step

    @view[0] = @view[0]*before/@scale + if step > 0 then 8 else -8
    @view[1] = @view[1]*before/@scale + if step > 0 then 8 else -8

termap = new Termap()

# TODO: abstracing this class, create loader class
data = fs.readFileSync __dirname+"/tiles/regensburg.pbf.gz"
termap.features = termap._getFeatures termap._parseTile data
termap._draw()
