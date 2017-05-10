###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Using 2D spatial indexing to avoid overlapping labels and markers
  and to find labels underneath a mouse cursor's position
###
rbush = require 'rbush'
stringWidth = require 'string-width'

module.exports = class LabelBuffer
  tree: null

  margin: 5

  constructor: (@width, @height) ->
    @tree = rbush()

  clear: ->
    @tree.clear()

  project: (x, y) ->
    [Math.floor(x/2), Math.floor(y/4)]

  writeIfPossible: (text, x, y, feature, margin = @margin) ->
    point = @project x, y

    if @_hasSpace text, point[0], point[1]
      data = @_calculateArea text, point[0], point[1], margin
      data.feature = feature
      @tree.insert data
    else
      false

  featuresAt: (x, y) ->
    @tree.search minX: x, maxX: x, minY: y, maxY: y

  _hasSpace: (text, x, y) ->
    not @tree.collides @_calculateArea text, x, y

  _calculateArea: (text, x, y, margin = 0) ->
    minX: x-margin
    minY: y-margin/2
    maxX: x+margin+stringWidth(text)
    maxY: y+margin/2
