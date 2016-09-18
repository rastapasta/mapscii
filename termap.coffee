Canvas = require 'drawille-canvas-blessed-contrib'
VectorTile = require('vector-tile').VectorTile
Protobuf = require 'pbf'
keypress = require 'keypress'
fs = require 'fs'
zlib = require 'zlib'
mouse = require('term-mouse')()

keypress process.stdin

width = Math.floor((process.stdout.columns-1)/2)*2*2;
height = Math.ceil(process.stdout.rows/4)*4*4;

drawOrder = ["admin", "water", "landuse", "building", "road"]
layers =
  road: "white"
  landuse: "green"
  water: "blue"
  admin: "red"
  building: 8

canvas = new Canvas width, height

features = {}
data = fs.readFileSync __dirname+"/tiles/regensburg.pbf.gz"
zlib.gunzip data, (err, buffer) ->
  throw new Error err if err

  tile = new VectorTile new Protobuf buffer
  for name,layer of tile.layers
    if layers[name]
      features[name] = []
      for i in [0...layer.length]
        features[name].push layer.feature(i).loadGeometry()

  draw()

zoom = 0
view = [-400, -80]
size = 4

flush = ->
  process.stdout.write canvas._canvas.frame()

draw = ->
  canvas.clearRect(0, 0, width, height)

  canvas.save()

  canvas.translate view[0], view[1]
  for layer in drawOrder
    continue unless features[layer]

    canvas.strokeStyle = layers[layer]
    for feature in features[layer]
      for line in feature
        found = false
        points = for point in line
          p = [point.x/size, point.y/size]
          if not found and p[0]+view[0]>=0 and p[0]+view[0]<width and p[1]+view[1]>=0 and p[1]+view[1]<height
            found = true
          p
        continue unless found

        canvas.beginPath()
        canvas.moveTo points.shift()...
        canvas.lineTo point... for point in points
        canvas.stroke()

  canvas.restore()
  flush()


moving = null
process.stdin.on 'mousepress', (info) ->
  # TODO: file bug @keypress, fails after x>95 / sequence: '\u001b[M#B'
  if info.x > 2048
    info.x = 100

  switch info.scroll
    when -1
      size -= .2
    when 1
      size += .2

  if info.button is 0
    moving = info

  else if moving and info.release
    view[0] -= (moving.x-info.x)*2
    view[1] -= (moving.y-info.y)*4
    moving = null

 draw()

process.stdin.on 'keypress', (ch, key) ->
  result = switch key?.name
    when "q"
      process.exit 0

    when "a" then size += 1
    when "z" then size -= 1
    when "left" then view[0] += 5
    when "right" then view[0] -= 5
    when "up" then view[1]+= 5
    when "down" then view[1]-= 5

    else
      false

  draw() if result

process.stdin.setRawMode(true)
process.stdin.resume()
