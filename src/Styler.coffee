fs = require 'fs'
# 'text-field'

# Verrrrry MVP implementation
# TODO: should be optimized by compiling the json to method&cb based filters

module.exports = class Styler
  styleById: {}
  styleByLayer: {}

  constructor: (file) ->
    json = JSON.parse fs.readFileSync(file).toString()
    @styleName = json.name

    for layer in json.layers
      continue if layer.ref
      style = layer

      @styleByLayer[layer['source-layer']] ?= []
      @styleByLayer[layer['source-layer']].push style

      @styleById[layer.id] = style

  getStyleFor: (layer, feature, zoom) ->
    return false unless @styleByLayer[layer]

    for style in @styleByLayer[layer]
      return style unless style.filter

      if @_passesFilter feature, style.filter
        return style

    false

  _passesFilter: (feature, filter) ->
    switch filter.shift()
      when "all"
        for subFilter in filter
          return false unless @_passesFilter feature, subFilter
        true

      when "=="
        feature.properties[filter[0]] is filter[1]

      when "!="
        feature.properties[filter[0]] isnt filter[1]

      when "in"
        field = filter.shift()
        for value in filter
          return true if feature.properties[field] is value
        false

      when "!in"
        field = filter.shift()
        for value in filter
          return false if feature.properties[field] is value
        true

  ###
  cleanStyle: (file) ->
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

      # TODO: opacity
      for key in ['fill-color', 'line-color', 'text-color', 'background-color']
        cleanLayer.paint[key] = layer.paint[key] if layer.paint?[key]

      if Object.keys(cleanLayer.paint).length
        cleanedStyle.layers.push cleanLayer

    console.log JSON.stringify cleanedStyle, null, '  '
  ###
