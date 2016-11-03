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
    zoomStep: 0.2

  width: null
  height: null
  canvas: null
  mouse: null

  mousePosition: [0, 0]
  mouseDragging: false

  tileSource: null

  zoom: 0
  rotation: 0
  center:
    # sf
    # lat: 37.787946
    # lon: -122.407522
    # iceland
    # lat: 64.124229
    # lon: -21.811552
    # rgbg
    lat: 49.0189
    lon: 12.0990

  minZoom: null
  maxZoom: 18

  constructor: (options) ->
    @config[key] = val for key, val of options

  init: ->
    Promise
    .resolve()
    .then =>
      @_initKeyboard()
      @_initMouse()

      console.log "loading tilesource"
      @_initTileSource()

    .then =>
      console.log "loaded"
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
    @zoom = @minZoom

  _resizeRenderer: (cb) ->
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
    @renderer.notify @_getFooter()


  _onKey: (key) ->
    # check if the pressed key is configured
    draw = switch key?.name
      when "q"
        process.exit 0

      when "a" then @zoomBy @config.zoomStep
      when "z" then @zoomBy -@config.zoomStep

      when "k" then @rotation += 15
      when "l" then @rotation -= 15

      when "left" then @center.lon -= 8/Math.pow(2, @zoom)
      when "right" then @center.lon += 8/Math.pow(2, @zoom)
      when "up" then @center.lat += 6/Math.pow(2, @zoom)
      when "down" then @center.lat -= 6/Math.pow(2, @zoom)

      else
        null

    if draw isnt null
      @_draw()
    else
      # display debug info for unhandled keys
      @renderer.notify JSON.stringify key

  _draw: ->
    @renderer
    .draw @center, @zoom, @rotation
    .then =>
      @renderer.notify @_getFooter()
    .catch =>
      @renderer.notify "renderer is busy"

  _getFooter: ->
    # features = @renderer.featuresAt @mousePosition.x-1-(@view[0]>>1), @mousePosition.y-1-(@view[1]>>2)
    # "features: ["+features.map((f) ->
    #   JSON.stringify
    #     name: f.feature.properties.name
    #     type: f.feature.properties.type
    #     rank: f.feature.properties.scalerank
    # ).join(", ")+"] "+
    # "#{@mousePosition.x} #{@mousePosition.y}"
    #"center: [#{utils.digits @center.lat, 2}, #{utils.digits @center.lng, 2}]}"
    # bbox = @_getBBox()
    # tiles = @_tilesInBBox(bbox)
    "zoom: #{utils.digits @zoom, 2} "
    #{}"bbox: [#{bbox.map((z) -> utils.digits(z, 2)).join(', ')}]"+
    # "tiles: "+("#{k}: #{v}" for k,v of @_tilesInBBox(bbox) when typeof v is "number").join(",")


    #features.map((f) -> JSON.stringify f.feature.properties).join(" - ")

  zoomBy: (step) ->
    return @zoom = @minZoom if @zoom+step < @minZoom
    return @zoom = @maxZoom if @zoom+step > @maxZoom

    @zoom += step
