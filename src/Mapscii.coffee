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
      .then => @notify("Welcome to MapSCII! Use your cursors to navigate, a/z to zoom, q to quit.")

  _initTileSource: ->
    @tileSource = new TileSource()
    @tileSource.init config.source

  _initKeyboard: ->
    keypress config.input
    config.input.setRawMode true if config.input.setRawMode
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

  _updateMousePosition: (event) ->
    projected =
      x: (event.x-.5)*2
      y: (event.y-.5)*4

    size = utils.tilesizeAtZoom @zoom
    [dx, dy] = [projected.x-@width/2, projected.y-@height/2]

    z = utils.baseZoom @zoom
    center = utils.ll2tile @center.lon, @center.lat, z

    @mousePosition = utils.normalize utils.tile2ll center.x+(dx/size), center.y+(dy/size), z

  _onClick: (event) ->
    return if event.x < 0 or event.x > @width/2 or event.y < 0 or event.y > @height/4
    @_updateMousePosition event

    if @mouseDragging and event.button is "left"
      @mouseDragging = false
    else
      @setCenter @mousePosition.lat, @mousePosition.lon

    @_draw()

  _onMouseScroll: (event) ->
    @_updateMousePosition event
    # TODO: handle .x/y for directed zoom
    @zoomBy config.zoomStep * if event.button is "up" then 1 else -1
    @_draw()

  _onMouseMove: (event) ->
    return if event.x < 0 or event.x > @width/2 or event.y < 0 or event.y > @height/4
    return if config.mouseCallback and not config.mouseCallback event

    # start dragging
    if event.button is "left"
      if @mouseDragging
        dx = (@mouseDragging.x-event.x)*2
        dy = (@mouseDragging.y-event.y)*4

        size = utils.tilesizeAtZoom @zoom

        newCenter = utils.tile2ll @mouseDragging.center.x+(dx/size),
          @mouseDragging.center.y+(dy/size),
          utils.baseZoom(@zoom)

        @setCenter newCenter.lat, newCenter.lon

        @_draw()

      else
        @mouseDragging =
          x: event.x,
          y: event.y,
          center: utils.ll2tile @center.lon, @center.lat, utils.baseZoom(@zoom)

    @_updateMousePosition event
    @notify @_getFooter()

  _onKey: (key) ->
    if config.keyCallback and not config.keyCallback key
      return

    # check if the pressed key is configured
    draw = switch key?.name
      when "q"
        if config.quitCallback
          config.quitCallback()
        else
          process.exit 0

      when "a" then @zoomBy config.zoomStep
      when "z", "y"
        @zoomBy -config.zoomStep

      when "left" then @moveBy 0, -8/Math.pow(2, @zoom)
      when "right" then @moveBy 0, 8/Math.pow(2, @zoom)
      when "up" then @moveBy 6/Math.pow(2, @zoom), 0
      when "down" then @moveBy -6/Math.pow(2, @zoom), 0

      when "c"
        config.useBraille = !config.useBraille
        true

      else
        null

    if draw isnt null
      @_draw()

  _draw: ->
    @renderer
    .draw @center, @zoom
    .then (frame) =>
      @_write frame
      @notify @_getFooter()
    .catch =>
      @notify "renderer is busy"

  _getFooter: ->
    # tile = utils.ll2tile @center.lon, @center.lat, @zoom
    # "tile: #{utils.digits tile.x, 3}, #{utils.digits tile.x, 3}   "+

    "center: #{utils.digits @center.lat, 3}, #{utils.digits @center.lon, 3}   "+
    "zoom: #{utils.digits @zoom, 2}   "+
    "mouse: #{utils.digits @mousePosition.lat, 3}, #{utils.digits @mousePosition.lon, 3} "

  notify: (text) ->
    config.onUpdate() if config.onUpdate
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
    @center = utils.normalize lon: lon, lat: lat
