###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Simple pixel to barille character mapper

  Implementation inspired by node-drawille (https://github.com/madbence/node-drawille)
  * added color support
  * added text label support
  * general optimizations

  Will either be merged into node-drawille or become an own module at some point
###
stringWidth = require 'string-width'
config = require './config'
utils = require './utils'

module.exports = class BrailleBuffer
  brailleMap: [[0x1, 0x8],[0x2, 0x10],[0x4, 0x20],[0x40, 0x80]]
  asciiMap:
    # "▬": [2+32, 4+64]
    # "¯": [1+16]
    "▀": [1+2+16+32]
    "▄": [4+8+64+128]
    "■": [2+4+32+64]
    "▌": [1+2+4+8]
    "▐": [16+32+64+128]
    # "▓": [1+4+32+128, 2+8+16+64]
    "█": [255]

  pixelBuffer: null
  charBuffer: null
  foregroundBuffer: null
  backgroundBuffer: null

  asciiToBraille: []

  globalBackground: null

  termReset: "\x1B[39;49m"

  constructor: (@width, @height) ->
    size = @width*@height/8
    @pixelBuffer = new Buffer size
    @foregroundBuffer = new Buffer size
    @backgroundBuffer = new Buffer size

    @_mapBraille()
    @clear()

  clear: ->
    @pixelBuffer.fill 0
    @charBuffer = []
    @foregroundBuffer.fill 0
    @backgroundBuffer.fill 0

  setGlobalBackground: (@globalBackground) ->

  setBackground: (x, y, color) ->
    return unless 0 <= x < @width and 0 <= y < @height
    idx = @_project x, y
    @backgroundBuffer[idx] = color

  setPixel: (x, y, color) ->
    @_locate x, y, (idx, mask) =>
      @pixelBuffer[idx] |= mask
      @foregroundBuffer[idx] = color

  unsetPixel: (x, y) ->
    @_locate x, y, (idx, mask) =>
      @pixelBuffer[idx] &= ~mask

  _project: (x, y) ->
    (x>>1) + (@width>>1)*(y>>2)

  _locate: (x, y, cb) ->
    return unless 0 <= x < @width and 0 <= y < @height
    idx = @_project x, y
    mask = @brailleMap[y&3][x&1]
    cb idx, mask

  _mapBraille: ->
    @asciiToBraille = [" "]

    masks = []
    for char, bits of @asciiMap
      continue unless bits instanceof Array
      masks.push mask: mask, char: char for mask in bits

    for i in [1..255]
      braille = (i&7) + ((i&56)<<1) + ((i&64)>>3) + (i&128)

      @asciiToBraille[i] = masks.reduce(((best, mask) ->
        covered = utils.population(mask.mask&braille)
        if not best or best.covered < covered
          char: mask.char, covered: covered
        else
          best
      ), undefined).char

  _termColor: (foreground, background) ->
    background = background or @globalBackground
    if foreground and background
      "\x1B[38;5;#{foreground};48;5;#{background}m"
    else if foreground
      "\x1B[49;38;5;#{foreground}m"
    else if background
      "\x1B[39;48;5;#{background}m"
    else
      @termReset

  frame: ->
    output = []
    currentColor = null
    skip = 0

    for y in [0...@height/4]
      skip = 0

      for x in [0...@width/2]
        idx = y*@width/2 + x

        if idx and not x
          output.push config.delimeter

        if currentColor isnt colorCode = @_termColor @foregroundBuffer[idx], @backgroundBuffer[idx]
          output.push currentColor = colorCode

        output.push if char = @charBuffer[idx]
          skip += stringWidth(char)-1
          if skip+x >= @width/2
            ''
          else
            char
        else
          if not skip
            if config.useBraille
              String.fromCharCode 0x2800+@pixelBuffer[idx]
            else
              @asciiToBraille[@pixelBuffer[idx]]
          else
            skip--
            ''

    output.push @termReset+config.delimeter
    output.join ''

  setChar: (char, x, y, color) ->
    return unless 0 <= x < @width and 0 <= y < @height
    idx = @_project x, y
    @charBuffer[idx] = char
    @foregroundBuffer[idx] = color

  writeText: (text, x, y, color, center = true) ->
    x -= text.length/2+1 if center
    @setChar text.charAt(i), x+i*2, y, color for i in [0...text.length]
