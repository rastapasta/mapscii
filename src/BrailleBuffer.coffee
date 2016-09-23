###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Simple pixel to barille character mapper

  Implementation inspired by node-drawille (https://github.com/madbence/node-drawille)
  * added written text support
  * added color support
  * general optimizations
    -> more bit shifting/operations, less Math.floors

  Will either be merged into node-drawille or become an own module at some point
###

module.exports = class BrailleBuffer
  characterMap: [[0x1, 0x8],[0x2, 0x10],[0x4, 0x20],[0x40, 0x80]]

  pixelBuffer: null
  charBuffer: null
  colorBuffer: null

  termReset: "\x1B[39m"
  termColor: (color) -> "\x1B[38;5;#{color}m"

  constructor: (@width, @height) ->
    @pixelBuffer = new Buffer @width*@height/8
    @clear()

  clear: ->
    @pixelBuffer.fill 0
    @charBuffer = []
    @colorBuffer = []

  setPixel: (x, y, color) ->
    @_locate x, y, (idx, mask) =>
      @pixelBuffer[idx] |= mask
      @colorBuffer[idx] = @termColor color

  unsetPixel: (x, y) ->
    @_locate x, y, (idx, mask) =>
      @pixelBuffer[idx] &= ~mask

  _project: (x, y) ->
    (x>>1) + (@width>>1)*(y>>2)

  _locate: (x, y, cb) ->
    return unless 0 <= x < @width and 0 <= y < @height
    idx = @_project x, y
    mask = @characterMap[y&3][x&1]
    cb idx, mask

  frame: ->
    output = []
    currentColor = null
    delimeter = "\n"

    for idx in [0...@pixelBuffer.length]
      output.push delimeter unless idx % (@width/2)

      if currentColor isnt colorCode = @colorBuffer[idx] or @termReset
        output.push currentColor = colorCode

      output.push if @charBuffer[idx]
        @charBuffer[idx]
      else if @pixelBuffer[idx] is 0
        ' '
      else
        String.fromCharCode 0x2800+@pixelBuffer[idx]

    output.push @termReset+delimeter
    output.join ''

  setChar: (char, x, y, color) ->
    return unless 0 <= x < @width/2 and 0 <= y < @height/4
    idx = @_project x, y
    @charBuffer[idx] = char
    @colorBuffer[idx] = @termColor color

  writeText: (text, x, y, color, center = true) ->
    x -= text.length/2 if center
    @setChar text.charAt(i), x+i*2, y, color for i in [0...text.length]

# buffer = new BrailleBuffer 100, 16
# for i in [0...255]
#   buffer.setPixel i, 8+8*Math.cos(i/10*Math.PI/2), i
#
# buffer.writeText "ruth", 10, 0, 111
# console.log buffer.frame()
