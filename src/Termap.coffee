###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  UI and central command center
###

keypress = require 'keypress'
TermMouse = require 'term-mouse'
Promise = require 'bluebird'

Renderer = require './Renderer'
TileSource = require './TileSource'
utils = require './utils'

module.exports = class Termap
  config:
    input: process.stdin
    output: process.stdout

    source: "http://nachbar.io/data/osm2vectortiles/"
    #source: __dirname+"/../mbtiles/regensburg.mbtiles"
    styleFile: __dirname+"/../styles/bright.json"

    initialZoom: null
    maxZoom: 18
    zoomStep: 0.25
    headless: false

    # size:
    #   width: 40*2
    #   height: 10*4

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
    lat: 49.0189
    lon: 12.0990

  minZoom: null

  constructor: (options) ->
    @config[key] = val for key, val of options

  init: ->
    Promise
    .resolve()
    .then =>
      unless @config.headless
        @_initKeyboard()
        @_initMouse()

      @_initTileSource()

    .then =>
      @_initRenderer()

    .then =>
      @_draw()

  _initTileSource: ->
    @tileSource = new TileSource()
    @tileSource.init @config.source

  _initKeyboard: ->
    keypress @config.input
    @config.input.setRawMode true
    @config.input.resume()

    @config.input.on 'keypress', (ch, key) => @_onKey key

  _initMouse: ->
    @mouse = TermMouse input: @config.input, output: @config.output
    @mouse.start()

    @mouse.on 'click', (event) => @_onClick event
    @mouse.on 'scroll', (event) => @_onMouseScroll event
    @mouse.on 'move', (event) => @_onMouseMove event

  _initRenderer: ->
    @renderer = new Renderer @config.output, @tileSource
    @renderer.loadStyleFile @config.styleFile

    @config.output.on 'resize', =>
      @_resizeRenderer()
      @_draw()

    @_resizeRenderer()
    @zoom = if @config.initialZoom isnt null then @config.initialZoom else @minZoom

  _resizeRenderer: (cb) ->
    if @config.size
      @width = @config.size.width
      @height = @config.size.height
    else
      @width = @config.output.columns >> 1 << 2
      @height = @config.output.rows * 4 - 4

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
    @zoomBy @config.zoomStep * if event.button is "up" then -1 else 1
    @_draw()

  _onMouseMove: (event) ->
    # only continue if x/y are valid
    return unless event.x <= @config.output.columns and event.y <= @config.output.rows

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
    @mousePosition = x: event.x, y: event.y
    @notify @_getFooter()

  _onKey: (key) ->
    # check if the pressed key is configured
    draw = switch key?.name
      when "q"
        process.exit 0

      when "w" then @zoomy = true
      when "a" then @zoomBy @config.zoomStep
      when "z" then @zoomBy -@config.zoomStep

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
      if @zoomy and @zoom < @config.maxZoom
        @zoom += @config.zoomStep
        @_draw()
      else
        @zoomy = false

  _getFooter: ->
    # features = @renderer.featuresAt @mousePosition.x-1-(@view[0]>>1), @mousePosition.y-1-(@view[1]>>2)
    # "features: ["+features.map((f) ->
    #   JSON.stringify
    #     name: f.feature.properties.name
    #     type: f.feature.properties.type
    #     rank: f.feature.properties.scalerank
    # ).join(", ")+"] "+
    "#{@mousePosition.x} #{@mousePosition.y} " +
    #"center: [#{utils.digits @center.lat, 2}, #{utils.digits @center.lng, 2}]}"
    # bbox = @_getBBox()
    # tiles = @_tilesInBBox(bbox)
    "zoom: #{utils.digits @zoom, 2} "
    #{}"bbox: [#{bbox.map((z) -> utils.digits(z, 2)).join(', ')}]"+
    # "tiles: "+("#{k}: #{v}" for k,v of @_tilesInBBox(bbox) when typeof v is "number").join(",")


    #features.map((f) -> JSON.stringify f.feature.properties).join(" - ")

  notify: (text) ->
    @_write "\r\x1B[K"+text unless @config.headless

  _write: (output) ->
    @config.output.write output

  zoomBy: (step) ->
    return @zoom = @minZoom if @zoom+step < @minZoom
    return @zoom = @config.maxZoom if @zoom+step > @config.maxZoom

    @zoom += step

  moveBy: (lat, lon) ->
    @center.lat += lat
    @center.lon += lon

    @center.lon = (@center.lon+180)%360-180
    @center.lat = 85.0511 if @center.lat > 85.0511
    @center.lat = -85.0511 if @center.lat < -85.0511
