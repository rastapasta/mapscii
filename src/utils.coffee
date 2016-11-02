###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  methods used all around
###

constants =
  RADIUS: 6378137

utils =
  clamp: (num, min, max) ->
    if num <= min then min else if num >= max then max else num

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

  ll2xy: (lon, lat) ->
    [
      utils.deg2rad(lon)*constants.RADIUS,
      Math.log(Math.tan(Math.PI/4 + utils.deg2rad(lat)/2)) * constants.RADIUS
    ]

  ll2tile: (lon, lat, zoom) ->
    [
      Math.floor (lon+180)/360*Math.pow(2, zoom)
      Math.floor (1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*Math.pow(2, zoom)
    ]

  tile2ll: (x, y, zoom) ->
    n = Math.PI - 2*Math.PI*y/Math.pow(2, zoom)

    lon: x/Math.pow(2, zoom)*360-180
    lat: 180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n)))

  metersPerPixel: (zoom, lat = 0) ->
    (Math.cos(lat * Math.PI/180) * 2 * Math.PI * constants.RADIUS) / (256 * Math.pow(2, zoom))

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

module.exports = utils
