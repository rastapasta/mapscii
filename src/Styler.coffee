###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Minimalistic parser and compiler for Mapbox (Studio) Map Style files
  See: https://www.mapbox.com/mapbox-gl-style-spec/

  Verrrrry MVP implementation
  TODO: should be optimized by compiling the json to method&cb based filters
###

fs = require 'fs'

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
    switch filter[0]
      when "all"
        for subFilter in filter[1..]
          return false unless @_passesFilter feature, subFilter
        true

      when "=="
        feature.properties[filter[1]] is filter[2]

      when "!="
        feature.properties[filter[2]] isnt filter[2]

      when "in"
        field = filter[1]
        for value in filter[2..]
          return true if feature.properties[field] is value
        false

      when "!in"
        field = filter[1]
        for value in filter[2..]
          return false if feature.properties[field] is value
        true
