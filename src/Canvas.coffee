###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Extends drawille-canvas to add additional drawing functions.
  To be PRed up the tree at some point.
###

BlessedCanvas = require 'drawille-canvas-blessed-contrib'

module.exports = class Canvas extends BlessedCanvas
  fillText: (text, x, y, size=1) ->
    super text, x-text.length, y
