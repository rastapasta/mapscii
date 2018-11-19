/*
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Minimalistic parser and compiler for Mapbox (Studio) Map Style files
  See: https://www.mapbox.com/mapbox-gl-style-spec/

  Compiles layer filter instructions into a chain of true/false returning
  anonymous functions to improve rendering speed compared to realtime parsing.
*/
'use strict';

class Styler {
  constructor(style) {
    this.styleById = {};
    this.styleByLayer = {};
    var base, name;
    this.styleName = style.name;
    if (style.constants) {
      this._replaceConstants(style.constants, style.layers);
    }

    for (const layer of style.layers) {
      if (layer.ref && this.styleById[layer.ref]) {
        for (const ref of ['type', 'source-layer', 'minzoom', 'maxzoom', 'filter']) {
          if (this.styleById[layer.ref][ref] && !layer[ref]) {
            layer[ref] = this.styleById[layer.ref][ref];
          }
        }
      }

      layer.appliesTo = this._compileFilter(layer.filter);

      //TODO Better translation of: @styleByLayer[style['source-layer']] ?= []
      if ((base = this.styleByLayer)[name = layer['source-layer']] == null) {
        base[name] = [];
      }
      this.styleByLayer[layer['source-layer']].push(layer);
      this.styleById[layer.id] = layer;
    }
  }

  getStyleFor(layer, feature) {
    if (!this.styleByLayer[layer]) {
      return false;
    }

    for (const style of this.styleByLayer[layer]) {
      if (style.appliesTo(feature)) {
        return style;
      }
    }

    return false;
  }

  _replaceConstants(constants, tree) {
    for (const id in tree) {
      const node = tree[id];
      switch (typeof node) {
        case 'object':
          if (node.constructor.name.match(/Stream/)) {
            continue;
          }
          this._replaceConstants(constants, node);
          break;
        case 'string':
          if (node.charAt(0) === '@') {
            tree[id] = constants[node];
          }
      }
    }
  }

  //TODO Better translation of the long cases.
  _compileFilter(filter) {
    let filters;
    switch (filter != null ? filter[0] : void 0) {
      case 'all':
        filter = filter.slice(1);
        filters = (() => {
          return filter.map((sub) => this._compileFilter(sub));
        }).call(this);
        return (feature) => !!filters.find((appliesTo) => {
          return !appliesTo(feature);
        });
      case 'any':
        filter = filter.slice(1);
        filters = (() => {
          return filter.map((sub) => this._compileFilter(sub));
        }).call(this);
        return (feature) => !!filters.find((appliesTo) => {
          return appliesTo(feature);
        });
      case 'none':
        filter = filter.slice(1);
        filters = (() => {
          return filter.map((sub) => this._compileFilter(sub));
        }).call(this);
        return (feature) => !filters.find((appliesTo) => {
          return !appliesTo(feature);
        });
      case '==':
        return (feature) => feature.properties[filter[1]] === filter[2];
      case '!=':
        return (feature) => feature.properties[filter[1]] !== filter[2];
      case 'in':
        return (feature) => !!filter.slice(2).find((value) => {
          return feature.properties[filter[1]] === value;
        });
      case '!in':
        return (feature) => !filter.slice(2).find((value) => {
          return feature.properties[filter[1]] === value;
        });
      case 'has':
        return (feature) => !!feature.properties[filter[1]];
      case '!has':
        return (feature) => !feature.properties[filter[1]];
      case '>':
        return (feature) => feature.properties[filter[1]] > filter[2];
      case '>=':
        return (feature) => feature.properties[filter[1]] >= filter[2];
      case '<':
        return (feature) => feature.properties[filter[1]] < filter[2];
      case '<=':
        return (feature) => feature.properties[filter[1]] <= filter[2];
      default:
        return () => true;
    }
  }
}

module.exports = Styler;
