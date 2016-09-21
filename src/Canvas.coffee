###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Extends drawille-canvas to add additional drawing functions.
  To be PRed up the tree at some point.
###

BlessedCanvas = require 'drawille-canvas-blessed-contrib'
vec2 = require('gl-matrix').vec2

module.exports = class Canvas extends BlessedCanvas

  # bresenham: (from, to) ->
  #   points = []
  #   adx = Math.abs dx = to.x - from.x
  #   ady = Math.abs dy = to.y - from.y
  #   eps = 0
  #   sx = if dx > 0 then 1 else -1
  #   sy = if dy > 0 then 1 else -1
  #
  #   [x, y] = from
  #   if adx > ady
  #     while if sx < 0 then x >= x1 else x <= x1
  #       points.add x:, y: y
  #       eps += ady
  #       if eps<<1 >= adx
  #         y += sy
  #         eps -= adx
  #
  #       x += sx
  #   else
  #     while if sy < 0 then y >= y1 else y <= y1
  #       fn(x, y);
  #       eps += adx;
  #       if eps<<1 >= ady
  #         x += sx;
  #         eps -= ady;
  #
  #       y += sy
  #   arr
