###
  mapscii - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  UI and central command center
###

keypress = require 'keypress'
TermMouse = require 'term-mouse'
Promise = require 'bluebird'

Renderer = require './Renderer'
TileSource = require './TileSource'
utils = require './utils'
config = require './config'

module.exports = class Mapscii
  width: null
  height: null
  canvas: null
  mouse: null

  mouseDragging: false
  mousePosition:
    x: 0, y: 0

  tileSource: null
  renderer: null

  zoom: 0
  center:
    # sf lat: 37.787946, lon: -122.407522
    # iceland lat: 64.124229, lon: -21.811552
    # rgbg
    # lat: 49.019493, lon: 12.098341
    lat: 52.51298, lon: 13.42012

  minZoom: null

  constructor: (options) ->
    config[key] = val for key, val of options

  init: ->
    Promise
    .resolve()
    .then =>
      unless config.headless
        @_initKeyboard()
        @_initMouse()

      @_initTileSource()

    .then =>
      @_initRenderer()

    .then =>
      @_draw()

  _initTileSource: ->
    @tileSource = new TileSource()
    @tileSource.init config.source

  _initKeyboard: ->
    keypress config.input
    config.input.setRawMode true
    config.input.resume()

    config.input.on 'keypress', (ch, key) => @_onKey key

  _initMouse: ->
    @mouse = TermMouse input: config.input, output: config.output
    @mouse.start()

    @mouse.on 'click', (event) => @_onClick event
    @mouse.on 'scroll', (event) => @_onMouseScroll event
    @mouse.on 'move', (event) => @_onMouseMove event

  _initRenderer: ->
    @renderer = new Renderer config.output, @tileSource
    @renderer.loadStyleFile config.styleFile

    config.output.on 'resize', =>
      @_resizeRenderer()
      @_draw()

    @_resizeRenderer()
    @zoom = if config.initialZoom isnt null then config.initialZoom else @minZoom

  _resizeRenderer: (cb) ->
    if config.size
      @width = config.size.width
      @height = config.size.height
    else
      @width = config.output.columns >> 1 << 2
      @height = config.output.rows * 4 - 4

    @minZoom = 4-Math.log(4096/@width)/Math.LN2

    @renderer.setSize @width, @height

  _onClick: (event) ->
    if @mouseDragging and event.button is "left"
      # TODO lat/lng based drag&drop
      # @view[0] -= (@mouseDragging.x-@mousePosition.x)<<1
      # @view[1] -= (@mouseDragging.y-@mousePosition.y)<<2
      @_draw()

      @mouseDragging = false

  _onMouseScroll: (event) ->
    # TODO: handle .x/y for directed zoom
    @zoomBy config.zoomStep * if event.button is "up" then -1 else 1
    @_draw()

  _onMouseMove: (event) ->
    projected =
      x: event.x * 2
      y: event.y * 4

    # start dragging
    if event.button is "left"
      if @mouseDragging
        # TODO lat/lng based drag&drop
        # @view[0] -= (@mouseDragging.x-event.x)<<1
        # @view[1] -= (@mouseDragging.y-event.y)<<2

        if not @renderer.isDrawing and @renderer.lastDrawAt < Date.now()-100
          @_draw()
          @mouseDragging = x: event.x, y: event.y
      else
        @mouseDragging = x: event.x, y: event.y

    # update internal mouse tracker
    @mousePosition = projected
    @notify @_getFooter()

  _onKey: (key) ->
    # check if the pressed key is configured
    draw = switch key?.name
      when "q"
        process.exit 0

      when "w" then @zoomy = 1
      when "s" then @zoomy = -1

      when "a" then @zoomBy config.zoomStep
      when "z" then @zoomBy -config.zoomStep

      when "left" then @moveBy 0, -8/Math.pow(2, @zoom)
      when "right" then @moveBy 0, 8/Math.pow(2, @zoom)
      when "up" then @moveBy 6/Math.pow(2, @zoom), 0
      when "down" then @moveBy -6/Math.pow(2, @zoom), 0

      else
        null

    if draw isnt null
      @_draw()
    else
      # display debug info for unhandled keys
      @notify JSON.stringify key

  _draw: ->
    @renderer
    .draw @center, @zoom
    .then (frame) =>
      @_write frame
      @notify @_getFooter()
    .catch =>
      @notify "renderer is busy"
    .then =>
      if @zoomy
        if (@zoomy > 0 and @zoom < config.maxZoom) or (@zoomy < 0 and @zoom > @minZoom)
          @zoom += @zoomy * config.zoomStep
        else
          @zoomy *= -1
        setImmediate => @_draw()

  _getFooter: ->
    # tile = utils.ll2tile @center.lon, @center.lat, @zoom
    # "tile: #{utils.digits tile.x, 3}, #{utils.digits tile.x, 3}   "+

    "center: #{utils.digits @center.lat, 3}, #{utils.digits @center.lon, 3}   "+
    "zoom: #{utils.digits @zoom, 2}   "+
    "mouse: #{@mousePosition.x-@width/2} #{@mousePosition.y-@height/2}   "

  notify: (text) ->
    @_write "\r\x1B[K"+text unless config.headless

  _write: (output) ->
    config.output.write output

  zoomBy: (step) ->
    return @zoom = @minZoom if @zoom+step < @minZoom
    return @zoom = config.maxZoom if @zoom+step > config.maxZoom

    @zoom += step

  moveBy: (lat, lon) ->
    @setCenter @center.lat+lat, @center.lon+lon

  setCenter: (lat, lon) ->
    lon += 360 if lon < -180
    lon -= 360 if lon > 180

    lat = 85.0511 if lat > 85.0511
    lat = -85.0511 if lat < -85.0511

    @center.lat = lat
    @center.lon = lon
