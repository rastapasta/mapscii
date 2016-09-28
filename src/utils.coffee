###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  methods used all around
###

utils =
  # Based on W. Randolph Franklin (WRF)'s Point Inclusion in Polygon Test
  # https://www.ecse.rpi.edu/Homepages/wrf/Research/Short_Notes/pnpoly.html
  pointInPolygon: (polygon, point) ->
    inside = false
    j = polygon.length-1
    for i in [0...polygon.length]
      if (polygon[i][1]>point[1]) isnt (polygon[j][1]>point[1]) and
      point[0] < (polygon[j][0]-polygon[i][0]) * (point[1]-polygon[i][1]) / (polygon[j][1]-polygon[i][1]) + polygon[i][0]
          inside = !inside
      j = i
    inside

  deg2rad: (angle) ->
    # (angle / 180) * Math.PI
    angle * 0.017453292519943295
  rad2deg: (angle) ->
    angle / Math.PI * 180

  hex2rgb: (color) ->
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
