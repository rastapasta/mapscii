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
simplify = require 'simplify-js'

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
    @_line from.x, from.y, to.x, to.y, color, width

  polyline: (points, color, width = 1) ->
    for i in [1...points.length]
      @_line points[i-1].x, points[i-1].y, points[i].x, points[i].y, width, color

  setBackground: (color) ->
    @buffer.setGlobalBackground color

  background: (x, y, color) ->
    @buffer.setBackground x, y, color

  polygon: (rings, color) ->
    vertices = []
    holes = []

    for ring in rings
      if vertices.length
        continue if ring.length < 3
        holes.push vertices.length/2
      else
        return false if ring.length < 3

      for point in ring
        vertices.push point.x
        vertices.push point.y

    try
      triangles = earcut vertices, holes
    catch e
      return false

    for i in [0...triangles.length] by 3
      pa = @_polygonExtract vertices, triangles[i]
      pb = @_polygonExtract vertices, triangles[i+1]
      pc = @_polygonExtract vertices, triangles[i+2]

      @_filledTriangle pa, pb, pc, color

    true

  _polygonExtract: (vertices, pointId) ->
    [vertices[pointId*2], vertices[pointId*2+1]]

  # Inspired by Alois Zingl's "The Beauty of Bresenham's Algorithm"
  # -> http://members.chello.at/~easyfilter/bresenham.html
  _line: (x0, y0, x1, y1, width, color) ->

    # Fall back to width-less bresenham algorithm if we dont have a width
    unless width = Math.max 0, width-1
      return bresenham x0, y0, x1, y1,
        (x, y) => @buffer.setPixel x, y, color

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

    points = a.concat(b).concat(c)
    .filter (point) => 0 <= point.y < @height
    .sort (a, b) -> if a.y is b.y then a.x - b.x else a.y-b.y

    for i in [0...points.length]
      point = points[i]
      next = points[i*1+1]

      if point.y is next?.y
        left = Math.max 0, point.x
        right = Math.min @width-1, next.x
        if left >= 0 and right <= @width
          @buffer.setPixel x, point.y, color for x in [left..right]

      else
        @buffer.setPixel point.x, point.y, color

      break unless next
