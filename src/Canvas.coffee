###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Canvas-like painting abstraction for BrailleBuffer

  Implementation inspired by node-drawille-canvas (https://github.com/madbence/node-drawille-canvas)
  * added support for filled polygons
  * improved text rendering

  Will most likely be turned into a stand alone module at some point
###

bresenham = require 'bresenham'
glMatrix = require 'gl-matrix'
earcut = require 'earcut'

BrailleBuffer = require './BrailleBuffer'
utils = require './utils'

vec2 = glMatrix.vec2
mat2d = glMatrix.mat2d

module.exports = class Canvas
  matrix: null

  constructor: (@width, @height) ->
    @buffer = new BrailleBuffer @width, @height
    @reset()

  reset: ->
    @matrix = mat2d.create()

  print: ->
    process.stdout.write @buffer.frame()

  translate: (x, y) ->
    mat2d.translate @matrix, @matrix, vec2.fromValues(x, y)

  clear: ->
    @buffer.clear()

  text: (text, x, y, color, center = true) ->
    position = @_project x, y
    @buffer.writeText text, position[0], position[1], color, center

  line: (from, to, color, width = 1) ->
    from = @_project from[0], from[1]
    to = @_project to[0], to[1]
    @_line from, to, color, width

  polyline: (points, color, width = 1) ->
    projected = (@_project point[0], point[1] for point in points)
    for i in [1...projected.length]
      @_line projected[i-1], projected[i], width, color

  setBackground: (color) ->
    @buffer.setGlobalBackground color

  background: (x, y, color) ->
    point = @_project x, y
    @buffer.setBackground point[0], point[1], color

  # TODO: support for polygon holes
  polygon: (points, color) ->
    vertices = []
    lastPoint = [-1, -1]
    for point in points
      point = @_project point[0], point[1]
      point[0] = utils.clamp point[0], 0, @width
      point[1] = utils.clamp point[1], 0, @height

      if point[0] isnt lastPoint[0] or point[1] isnt lastPoint[1]
        vertices = vertices.concat point[0], point[1]
        lastPoint = point

    triangles = earcut vertices
    extract = (pointId) ->
      [vertices[pointId*2], vertices[pointId*2+1]]

    for i in [0...triangles.length] by 3
      @_filledTriangle extract(triangles[i]), extract(triangles[i+1]), extract(triangles[i+2]), color

  # Inspired by Alois Zingl's "The Beauty of Bresenham's Algorithm"
  # -> http://members.chello.at/~easyfilter/bresenham.html
  _line: (pointA, pointB, width, color) ->

    # Fall back to width-less bresenham algorithm if we dont have a width
    unless width = Math.max 0, width-1
      return bresenham pointA[0], pointA[1], pointB[0], pointB[1],
        (x, y) => @buffer.setPixel x, y, color

    [x0, y0] = pointA
    [x1, y1] = pointB
    dx = Math.abs x1-x0
    sx = if x0 < x1 then 1 else -1
    dy = Math.abs y1-y0
    sy = if y0 < y1 then 1 else -1

    err = dx-dy

    ed = if dx+dy is 0 then 1 else Math.sqrt dx*dx+dy*dy

    width = (width+1)/2
    loop
      @buffer.setPixel x0, y0, color
      e2 = err
      x2 = x0

      if 2*e2 >= -dx
         e2 += dy
         y2 = y0
         while e2 < ed*width && (y1 != y2 || dx > dy)
            @buffer.setPixel x0, y2 += sy, color
            e2 += dx
         break if x0 is x1
         e2 = err
         err -= dy
         x0 += sx

      if 2*e2 <= dy
         e2 = dx-e2
         while e2 < ed*width && (x1 != x2 || dx < dy)
            @buffer.setPixel x2 += sx, y0, color
            e2 += dy
         break if y0 is y1
         err += dx
         y0 += sy

  _project: (x, y) ->
    point = vec2.transformMat2d vec2.create(), vec2.fromValues(x, y), @matrix
    [Math.floor(point[0]), Math.floor(point[1])]

  _filledRectangle: (x, y, width, height, color) ->
    pointA = @_project x, y
    pointB = @_project x+width, y
    pointC = @_project x, y+height
    pointD = @_project x+width, y+height

    @_filledTriangle pointA, pointB, pointC, color
    @_filledTriangle pointC, pointB, pointD, color

  _bresenham: (pointA, pointB) ->
    bresenham pointA[0], pointA[1],
              pointB[0], pointB[1]

  # Draws a filled triangle
  _filledTriangle: (pointA, pointB, pointC, color) ->
    a = @_bresenham pointB, pointC
    b = @_bresenham pointA, pointC
    c = @_bresenham pointA, pointB

    # Filter out any points outside of the visible area
    # TODO: benchmark - is it more effective to filter double points, or does
    # it req more computing time than actually setting points multiple times?
    last = null
    points = a.concat(b).concat(c)
    .filter (point) => 0 <= point.y < @height
    .sort (a, b) -> if a.y is b.y then a.x - b.x else a.y-b.y
    .filter (point) ->
      [lastPoint, last] = [last, point]
      not lastPoint or lastPoint.x isnt point.x or lastPoint.y isnt point.y

    for i, point of points
      next = points[i*1+1]

      if point.y is next?.y
        left = Math.max 0, point.x
        right = Math.min @width, next?.x
        @buffer.setPixel x, point.y, color for x in [left..right]

      else
        @buffer.setPixel point.x, point.y, color
