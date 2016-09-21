###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  methods used all around
###

utils =
  deg2rad: (angle) ->
    # (angle / 180) * Math.PI
    angle * 0.017453292519943295
  rad2deg: (angle) ->
    angle / Math.PI * 180

  hex2rgb: (color) ->
    if not color?.match
      console.log color

    return [255, 0, 0] unless color?.match

    unless color.match /^#[a-fA-F0-9]{3,6}$/
      throw new Error "#{color} isn\'t a supported hex color"

    color = color.substr 1
    decimal = parseInt color, 16

    if color.length is 3
      rgb = [decimal>>8, (decimal>>4)&15, decimal&15]
      rgb.map (c) => c + (c<<4)
    else
      [(decimal>>16)&255, (decimal>>8)&255, decimal&255]

  digits: (number, digits) ->
    Math.floor(number*Math.pow(10, digits))/Math.pow(10, digits)

  metersPerPixel: (zoom, lat = 0) ->
    utils.rad2deg(40075017*Math.cos(utils.deg2rad(lat))/Math.pow(2, zoom+8))

module.exports = utils
