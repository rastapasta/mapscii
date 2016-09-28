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

  polyline: (points, color) ->
    projected = (@_project point[0], point[1] for point in points)
    for i in [1...projected.length]
      bresenham projected[i-1]..., projected[i]...,
        (x, y) => @buffer.setPixel x, y, color

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

  _bresenham: (pointA, pointB) ->
    bresenham pointA[0], pointA[1],
              pointB[0], pointB[1]

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
