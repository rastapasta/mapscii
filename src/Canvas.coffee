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
earcut = require 'earcut'

BrailleBuffer = require './BrailleBuffer'
utils = require './utils'

module.exports = class Canvas
  stack: []

  constructor: (@width, @height) ->
    @buffer = new BrailleBuffer @width, @height

  frame: ->
    @buffer.frame()

  clear: ->
    @buffer.clear()

  text: (text, x, y, color, center = false) ->
    @buffer.writeText text, x, y, color, center

  line: (from, to, color, width = 1) ->
    @_line from, to, color, width

  polyline: (points, color, width = 1) ->
    for i in [1...points.length]
      @_line points[i-1], points[i], width, color

  setBackground: (color) ->
    @buffer.setGlobalBackground color

  background: (x, y, color) ->
    @buffer.setBackground x, y, color

  polygon: (polylines, color) ->
    vertices = []
    holes = []

    xs = {}
    ys = {}

    for points in polylines
      if vertices.length
        continue
        holes.push vertices.length/2

      lastPoint = [-1, -1]
      for point in points
        vertices = vertices.concat point[0], point[1]
        xs[point[0]] = ys[point[1]] = true

      # Check if we actually got a valid polygon after projection and clamping
      if Object.keys(xs).length is 1 or Object.keys(ys).length is 1
        if vertices.length
          # TODO: a line-hole - skip it for now
          continue
        else
          # TODO: a line instead of a polygon - skip it for now
          return false

    try
      triangles = earcut vertices, holes
    catch e
      return false

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

  _filledRectangle: (x, y, width, height, color) ->
    pointA = [x, y]
    pointB = [x+width, y]
    pointC = [x, y+height]
    pointD = [x+width, y+height]

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
