###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>
###

keypress = require 'keypress'
TermMouse = require 'term-mouse'

mercator = new (require('sphericalmercator'))()

Renderer = require './Renderer'
utils = require './utils'

module.exports = class Termap
  config:
    styleFile: __dirname+"/../styles/bright.json"
    zoomStep: 0.4

  width: null
  height: null
  canvas: null
  mouse: null

  mousePosition: [0, 0]
  mouseDragging: false

  center:
    lat: 49.019855
    lng: 12.096956

  zoom: 2
  view: [0, 0]

  scale: 4

  constructor: ->
    @_initControls()
    @_initRenderer()

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

  _initRenderer: ->
    @renderer = new Renderer()
    @renderer.loadStyleFile @config.styleFile

    process.stdout.on 'resize', =>
      @_resizeRenderer()
      @_draw()

    @_resizeRenderer()
    @zoom = Math.log(4096/@width)/Math.LN2

  _resizeRenderer: (cb) ->
    @width = Math.floor((process.stdout.columns-1)/2)*2*2
    @height = Math.ceil(process.stdout.rows/4)*4*4

    @renderer.setSize @width, @height

  _onClick: (event) ->
    if @mouseDragging and event.button is "left"
      @view[0] -= (@mouseDragging.x-@mousePosition.x)*2
      @view[1] -= (@mouseDragging.y-@mousePosition.y)*4
      @_draw()

      @mouseDragging = false

  _onMouseScroll: (event) ->
    # TODO: handle .x/y for directed zoom
    @zoomBy @config.zoomStep * if event.button is "up" then 1 else -1
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

      when "z" then @zoomBy @config.zoomStep
      when "a" then @zoomBy -@config.zoomStep
      when "left" then @view[0] += 5
      when "right" then @view[0] -= 5
      when "up" then @view[1]+= 5
      when "down" then @view[1]-= 5

      else
        false

    if draw
      @_draw()
    # else
    #   # display debug info for unhandled keys
    #   @notify JSON.stringify key


  _draw: ->
    @renderer.draw @view, @zoom
    @renderer.write @_getFooter()

  _getBBox: ->
    [x, y] = mercator.forward [@center.lng, @center.lat]
    width = @width * Math.pow(2, @zoom)
    height = @height * Math.pow(2, @zoom)

    mercator.inverse([x - width/2, y + width/2]).concat mercator.inverse([x + width/2, y - width/2])

  _getFooter: ->
    "center: [#{utils.digits @center.lat, 2}, #{utils.digits @center.lng, 2}] zoom: #{utils.digits @zoom, 2}"
    # bbox: [#{@_getBBox().map((z) -> utils.digits(z, 2)).join(',')}]"

  notify: (text) ->
    return if @renderer.isDrawing
    @renderer.write "\r\x1B[K#{@_getFooter()} #{text}"

  zoomBy: (step) ->
    return unless @scale+step > 0

    before = @scale
    @scale += step
    @zoom += step

    @view[0] = @view[0]*before/@scale + if step > 0 then 8 else -8
    @view[1] = @view[1]*before/@scale + if step > 0 then 8 else -8
