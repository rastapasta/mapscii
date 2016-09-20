rbush = require 'rbush'

module.exports = class LabelBuffer
  tree: null
  margin: 1

  constructor: (@width, @height) ->
    @tree = rbush()

  project: (x, y) ->
    [Math.floor(x/2), Math.floor(y/4)]

  writeIfPossible: (text, x, y) ->
    point = @project x, y

    return false unless @_hasSpace text, point[0], point[1]
    @tree.insert @_calculateArea text, point[0], point[1]
    true

  _hasSpace: (text, x, y) ->
    not @tree.collides @_calculateArea text, x, y

  _calculateArea: (text, x, y) ->
    minX: x-@margin
    minY: y-@margin
    maxX: x+@margin+text.length
    maxY: y+@margin
