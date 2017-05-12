###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  methods used all around
###
config = require './config'

constants =
  RADIUS: 6378137

utils =
  clamp: (num, min, max) ->
    if num <= min then min else if num >= max then max else num

  baseZoom: (zoom) ->
    Math.min config.tileRange, Math.max 0, Math.floor zoom

  tilesizeAtZoom: (zoom) ->
    config.projectSize * Math.pow(2, zoom-utils.baseZoom(zoom))

  deg2rad: (angle) ->
    # (angle / 180) * Math.PI
    angle * 0.017453292519943295

  ll2tile: (lon, lat, zoom) ->
    x: (lon+180)/360*Math.pow(2, zoom)
    y:  (1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*Math.pow(2, zoom)
    z:  zoom

  tile2ll: (x, y, zoom) ->
    n = Math.PI - 2*Math.PI*y/Math.pow(2, zoom)

    lon: x/Math.pow(2, zoom)*360-180
    lat: 180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n)))

  metersPerPixel: (zoom, lat = 0) ->
    (Math.cos(lat * Math.PI/180) * 2 * Math.PI * constants.RADIUS) / (256 * Math.pow(2, zoom))

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

  normalize: (ll) ->
    ll.lon += 360 if ll.lon < -180
    ll.lon -= 360 if ll.lon > 180

    ll.lat = 85.0511 if ll.lat > 85.0511
    ll.lat = -85.0511 if ll.lat < -85.0511

    ll

  population: (val) ->
    bits = 0
    while val>0
      bits += val & 1
      val >>= 1
    bits

module.exports = utils
