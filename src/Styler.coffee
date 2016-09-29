###
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Minimalistic parser and compiler for Mapbox (Studio) Map Style files
  See: https://www.mapbox.com/mapbox-gl-style-spec/

  Compiles layer filter instructions into a chain of true/false returning
  anonymous functions to improve rendering speed compared to realtime parsing.
###

fs = require 'fs'

module.exports = class Styler
  styleById: {}
  styleByLayer: {}

  constructor: (file) ->
    json = JSON.parse fs.readFileSync(file).toString()
    @styleName = json.name

    for style in json.layers
      continue if style.ref

      style.appliesTo = @_compileFilter style.filter

      @styleByLayer[style['source-layer']] ?= []
      @styleByLayer[style['source-layer']].push style

      @styleById[style.id] = style

  getStyleFor: (layer, feature, zoom) ->
    # Skip all layers that don't have any styles set
    return false unless @styleByLayer[layer]

    for style in @styleByLayer[layer]
      if style.appliesTo(feature) and ((layer is "road") or (not style.minzoom) or style.minzoom <= zoom)
          return style

    false

  _compileFilter: (filter) ->
    switch filter?[0]
      when "all"
        filters = (@_compileFilter subFilter for subFilter in filter[1..])
        (feature) ->
          return false for appliesTo in filters when not appliesTo feature
          true

      when "=="
        (feature) -> feature.properties[filter[1]] is filter[2]

      when "!="
        (feature) -> feature.properties[filter[1]] isnt filter[2]

      when "in"
        (feature) ->
          return true for value in filter[2..] when feature.properties[filter[1]] is value
          false

      when "!in"
        (feature) ->
          return false for value in filter[2..] when feature.properties[filter[1]] is value
          true

      else
        -> true
