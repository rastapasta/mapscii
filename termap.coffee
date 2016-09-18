Canvas = require 'drawille-canvas-blessed-contrib'
VectorTile = require('vector-tile').VectorTile
Protobuf = require 'pbf'
keypress = require 'keypress'
fs = require 'fs'
zlib = require 'zlib'
mouse = require('term-mouse')()

keypress process.stdin
process.stdin.setRawMode(true)
process.stdin.resume()

mouse.start()

width = null
height = null

config =
  drawOrder: ["admin", "water", "landuse", "building", "road"]

  layers:
    road:
      color: "white"
    landuse:
      color: "green"
    water:
      color: "blue"
    admin:
      color: "red"
    building:
      color: 8

canvas = null

init = ->
  width = Math.floor((process.stdout.columns-1)/2)*2*2
  height = Math.ceil(process.stdout.rows/4)*4*4
  canvas = new Canvas width, height
init()

features = {}
data = fs.readFileSync __dirname+"/tiles/regensburg.pbf.gz"
zlib.gunzip data, (err, buffer) ->
  throw new Error err if err

  tile = new VectorTile new Protobuf buffer

  # Load all layers and preparse the included geometries
  for name,layer of tile.layers
    if config.layers[name]
      features[name] = []

      for i in [0...layer.length]
        feature = layer.feature i
        features[name].push
          type: feature.type
          id: feature.id
          properties: feature.properties
          points: feature.loadGeometry()

  draw()

view = [-400, -80]
scale = 4

flush = ->
  process.stdout.write canvas._canvas.frame()

lastDraw = null
drawing = false
draw = ->
  return if drawing
  lastDraw = Date.now()
  drawing = true
  canvas.clearRect(0, 0, width, height)

  canvas.save()

  canvas.translate view[0], view[1]
  for layer in config.drawOrder
    continue unless features[layer]

    canvas.strokeStyle = config.layers[layer].color
    for feature in features[layer]
      for line in feature.points
        found = false
        points = for point in line
          p = [point.x/scale, point.y/scale]
          if not found and p[0]+view[0]>=0 and p[0]+view[0]<width and p[1]+view[1]>=0 and p[1]+view[1]<height
            found = true
          p
        continue unless found

        canvas.beginPath()
        canvas.moveTo points.shift()...
        canvas.lineTo point... for point in points
        canvas.stroke()

  canvas.fillStyle = "white"
  canvas.fillText "test", 0, 0
  canvas.stroke()
  canvas.restore()

  flush()
  process.stdout.write getStatus()

  drawing = false

getStatus = ->
  "TerMap up and running!"

notify = (text) ->
  return if drawing
  process.stdout.write "\r\x1B[K#{getStatus()} #{text}"

# moving = null
# process.stdin.on 'mousepress', (info) ->
#   # TODO: file bug @keypress, fails after x>95 / sequence: '\u001b[M#B'
#   if info.x > 2048
#     info.x = 100
#
#   if info.button is "left"
#     moving = info
#
#   else if moving and info.release
#
#  draw()

zoomBy = (step) ->
  return unless scale+step > 0

  before = scale
  scale += step

  view[0] = view[0]*before/scale + if step > 0 then 8 else -8
  view[1] = view[1]*before/scale + if step > 0 then 8 else -8

process.stdin.on 'keypress', (ch, key) ->
  result = switch key?.name
    when "q"
      process.exit 0

    when "a" then zoomBy(.5)
    when "z" then zoomBy(-.5)
    when "left" then view[0] += 5
    when "right" then view[0] -= 5
    when "up" then view[1]+= 5
    when "down" then view[1]-= 5

    else
      false

  if result
    draw()
  else
    notify JSON.stringify key

process.stdout.on 'resize', ->
  init()
  draw()

moving = null
mousePosition = null

mouse.on 'click', (event) ->
  if moving and event.button is "left"
    view[0] -= (moving.x-mousePosition.x)*2
    view[1] -= (moving.y-mousePosition.y)*4
    draw()

    moving = null

mouse.on 'scroll', (event) ->
  # TODO: handle .x/y for directed zoom
  zoomBy .5 * if event.button is "up" then 1 else -1
  draw()

mouse.on 'move', (event) ->
  return unless event.x <= process.stdout.columns and event.y <= process.stdout.rows
  if not moving and event.button is "left"
    moving = x: event.x, y: event.y

  mousePosition = x: event.x, y: event.y
