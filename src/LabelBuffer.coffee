###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Using 2D spatial indexing to avoid overlapping labels and markers
  Future: to detect collision on mouse interaction
###

rbush = require 'rbush'

module.exports = class LabelBuffer
  tree: null
  margin: 5

  constructor: (@width, @height) ->
    @tree = rbush()

  clear: ->
    @tree.clear()

  project: (x, y) ->
    [Math.floor(x/2), Math.floor(y/4)]

  writeIfPossible: (text, x, y, margin = @margin) ->
    point = @project x, y

    if @_hasSpace text, point[0], point[1]
      @tree.insert @_calculateArea text, point[0], point[1], margin
    else
      false

  _hasSpace: (text, x, y) ->
    not @tree.collides @_calculateArea text, x, y, 0

  _calculateArea: (text, x, y, margin) ->
    minX: x-margin
    minY: y-margin
    maxX: x+margin+text.length
    maxY: y+margin
