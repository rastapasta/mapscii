/*
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Minimalistic parser and compiler for Mapbox (Studio) Map Style files
  See: https://www.mapbox.com/mapbox-gl-style-spec/

  Compiles layer filter instructions into a chain of true/false returning
  anonymous functions to improve rendering speed compared to realtime parsing.
*/
'use strict';

const fs = require('fs');

class Styler {
  constructor(file) {
    this.styleById = {};
    this.styleByLayer = {};
    var base, name;
    const json = JSON.parse(fs.readFileSync(file).toString());
    this.styleName = json.name;
    if (json.constants) {
      this._replaceConstants(json.constants, json.layers);
    }

    for (const style of json.layers) {
      if (style.ref && this.styleById[style.ref]) {
        for (const ref of ['type', 'source-layer', 'minzoom', 'maxzoom', 'filter']) {
          if (this.styleById[style.ref][ref] && !style[ref]) {
            style[ref] = this.styleById[style.ref][ref];
          }
        }
      }

      style.appliesTo = this._compileFilter(style.filter);

      //TODO Better translation of: @styleByLayer[style['source-layer']] ?= []
      if ((base = this.styleByLayer)[name = style['source-layer']] == null) {
        base[name] = [];
      }
      this.styleByLayer[style['source-layer']].push(style);
      this.styleById[style.id] = style;
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
