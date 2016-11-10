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

    @_replaceConstants json.constants, json.layers if json.constants

    for style in json.layers
      if style.ref and @styleById[style.ref]
        for ref in ['type', 'source-layer', 'minzoom', 'maxzoom', 'filter']
          if @styleById[style.ref][ref] and not style[ref]
            style[ref] = @styleById[style.ref][ref]

      style.appliesTo = @_compileFilter style.filter

      @styleByLayer[style['source-layer']] ?= []
      @styleByLayer[style['source-layer']].push style
      @styleById[style.id] = style

  getStyleFor: (layer, feature, zoom) ->
    return false unless @styleByLayer[layer]

    for style in @styleByLayer[layer]
      if style.appliesTo feature
          return style

    return false

  _replaceConstants: (constants, tree) ->
    for id, node of tree
      switch typeof node
        when 'object'
          continue if node.constructor.name.match /Stream/
          @_replaceConstants constants, node

        when 'string'
          if node.charAt(0) is '@'
            tree[id] = constants[node]
    null

  _compileFilter: (filter) ->
    switch filter?[0]
      when "all"
        filters = (@_compileFilter subFilter for subFilter in filter[1..])
        (feature) ->
          return false for appliesTo in filters when not appliesTo feature
          true

      when "any"
        filters = (@_compileFilter subFilter for subFilter in filter[1..])
        (feature) ->
          return true for appliesTo in filters when appliesTo feature
          false

      when "none"
        filters = (@_compileFilter subFilter for subFilter in filter[1..])
        (feature) ->
          return false for appliesTo in filters when appliesTo feature
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

      when "has"
        (feature) -> !!feature.properties[filter[1]]

      when "!has"
        (feature) -> !feature.properties[filter[1]]

      when ">"
        (feature) -> feature.properties[filter[1]] > filter[2]

      when ">="
        (feature) -> feature.properties[filter[1]] >= filter[2]

      when "<"
        (feature) -> feature.properties[filter[1]] < filter[2]

      when "<="
        (feature) -> feature.properties[filter[1]] <= filter[2]

      else
        -> true
