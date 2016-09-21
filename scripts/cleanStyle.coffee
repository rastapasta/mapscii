###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  just a tool to make development easier

  Input: Mapbox Studio map style file
  Output: Reduced map style file (only supported attributes are kept)
###
fs = require 'fs'

cleanStyle = (file) ->
  json = JSON.parse fs.readFileSync(file).toString()

  cleanedStyle =
    name: json.name
    layers: []

  for layer in json.layers
    continue if layer.ref

    cleanLayer =
      type: layer.type
      id: layer.id
      paint: {}
      'source-layer': layer['source-layer']


    for key in ['filter', 'minzoom']
      cleanLayer[key] = layer[key] if layer[key]

    if layer.layout?['text-size']
      cleanLayer.layout = 'text-size': layer.layout?['text-size']

    for key in ['fill-color', 'line-color', 'text-color', 'background-color']
      cleanLayer.paint[key] = layer.paint[key] if layer.paint?[key]

    if Object.keys(cleanLayer.paint).length
      cleanedStyle.layers.push cleanLayer

  JSON.stringify cleanedStyle, null, '  '

console.log unless process.argv[2]
  "usage: coffee cleanStyle.coffee <inputJSON>"
else
  cleanStyle process.argv[2]
