###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  just a dev tool to make development easier
###
fs = require 'fs'

mergeStyle = (from, to) ->
  from = JSON.parse fs.readFileSync(from).toString()
  to = JSON.parse fs.readFileSync(to).toString()

  fromLayers = {}
  for layer in from.layers
    fromLayers[layer.id] = layer

  for id, layer of to.layers
    continue unless from = fromLayers[layer.id]

    # -> logic for what ever should be merged
    if width = from.paint['line-width']
      to.layers[id].paint['line-width'] = width

  JSON.stringify to, null, '  '

console.log unless process.argv[2] and process.argv[3]
  "usage: coffee mergeStyle.coffee <sourceJSON> <destinationJSON>"
else
  mergeStyle process.argv[2..3]...
