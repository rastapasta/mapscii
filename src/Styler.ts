/*
  MapSCII - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Minimalistic parser and compiler for Mapbox (Studio) Map Style files
  See: https://www.mapbox.com/mapbox-gl-style-spec/

  Compiles layer filter instructions into a chain of true/false returning
  anonymous functions to improve rendering speed compared to realtime parsing.
*/

export interface StylePaint {
  'line-color'?: string;
  'fill-color'?: string;
  'text-color'?: string;
  'background-color'?: string;
  'line-width'?: number | { stops: [number, number][] };
}

export interface StyleLayer {
  id: string;
  type?: string;
  ref?: string;
  'source-layer'?: string;
  minzoom?: number;
  maxzoom?: number;
  filter?: FilterExpression;
  paint?: StylePaint;
  appliesTo?: (feature: FeatureForStyle) => boolean;
}

export interface MapStyle {
  name: string;
  constants?: Record<string, string | number>;
  layers: StyleLayer[];
}

// Filter expression types - filter values can be strings, numbers, or booleans
type FilterValue = string | number | boolean;
// Filter expressions can be nested (for 'all', 'any', 'none')
type FilterExpressionValue = FilterValue | FilterExpression;
type FilterExpression = [string, ...FilterExpressionValue[]];

// Feature interface for styling - properties are typically primitives
interface FeatureForStyle {
  properties: Record<string, FilterValue | undefined>;
}

type FilterFunction = (feature: FeatureForStyle) => boolean;

// Tolerant equality: vector-tile properties are sometimes numeric where style
// filters use strings (and vice versa). Strict match first, then compare
// string representations when the types differ.
function filterValueEquals(a: FilterValue | undefined, b: FilterExpressionValue | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (typeof a !== typeof b && (typeof a !== 'object' && typeof b !== 'object')) {
    return String(a) === String(b);
  }
  return false;
}

export default class Styler {
  public styleById: Record<string, StyleLayer> = {};
  public styleByLayer: Record<string, StyleLayer[]> = {};
  public styleName: string;

  constructor(style: MapStyle) {
    this.styleName = style.name;

    if (style.constants) {
      this._replaceConstants(style.constants, style.layers);
    }

    for (const layer of style.layers) {
      if (layer.ref && this.styleById[layer.ref]) {
        const refLayer = this.styleById[layer.ref];
        for (const ref of ['type', 'source-layer', 'minzoom', 'maxzoom', 'filter'] as const) {
          if (refLayer[ref] !== undefined && layer[ref] === undefined) {
            // Use Object.assign pattern to copy referenced properties
            Object.assign(layer, { [ref]: refLayer[ref] });
          }
        }
      }

      layer.appliesTo = this._compileFilter(layer.filter);

      const sourceLayer = layer['source-layer'];
      if (sourceLayer !== undefined) {
        if (!this.styleByLayer[sourceLayer]) {
          this.styleByLayer[sourceLayer] = [];
        }
        this.styleByLayer[sourceLayer].push(layer);
      }
      this.styleById[layer.id] = layer;
    }
  }

  getStyleFor(layer: string, feature: FeatureForStyle): StyleLayer | false {
    if (!this.styleByLayer[layer]) {
      return false;
    }

    for (const style of this.styleByLayer[layer]) {
      if (style.appliesTo && style.appliesTo(feature)) {
        return style;
      }
    }

    return false;
  }

  // Tree type for constant replacement - can be style layers, paint objects, filter arrays, etc.
  // Using generic object type as style files can have deeply nested arbitrary structures
  private _replaceConstants(constants: Record<string, string | number>, tree: object | FilterExpressionValue[]): void {
    if (tree === null || tree === undefined) return;

    if (Array.isArray(tree)) {
      for (let i = 0; i < tree.length; i++) {
        const node = tree[i];
        if (typeof node === 'object' && node !== null) {
          this._replaceConstants(constants, node);
        } else if (typeof node === 'string' && node.charAt(0) === '@') {
          (tree as (string | number)[])[i] = constants[node];
        }
      }
    } else if (typeof tree === 'object') {
      for (const id in tree) {
        const node = (tree as Record<string, FilterValue | object | null>)[id];
        if (typeof node === 'object' && node !== null) {
          // Skip streams
          const constructor = (node as { constructor?: { name?: string } }).constructor;
          if (constructor?.name?.match(/Stream/)) {
            continue;
          }
          this._replaceConstants(constants, node);
        } else if (typeof node === 'string' && node.charAt(0) === '@') {
          (tree as Record<string, string | number>)[id] = constants[node];
        }
      }
    }
  }

  private _compileFilter(filter: FilterExpression | undefined): FilterFunction {
    if (!filter || filter[0] === undefined) {
      return () => true;
    }

    let filters: FilterFunction[];

    switch (filter[0]) {
      case 'all':
        filters = (filter.slice(1) as FilterExpression[]).map((sub) => this._compileFilter(sub));
        return (feature) => !filters.find((appliesTo) => !appliesTo(feature));

      case 'any':
        filters = (filter.slice(1) as FilterExpression[]).map((sub) => this._compileFilter(sub));
        return (feature) => !!filters.find((appliesTo) => appliesTo(feature));

      case 'none':
        filters = (filter.slice(1) as FilterExpression[]).map((sub) => this._compileFilter(sub));
        return (feature) => !filters.find((appliesTo) => appliesTo(feature));

      case '==':
        return (feature) => filterValueEquals(feature.properties[filter[1] as string], filter[2]);

      case '!=':
        return (feature) => !filterValueEquals(feature.properties[filter[1] as string], filter[2]);

      case 'in':
        return (feature) => !!filter.slice(2).find((value) => filterValueEquals(feature.properties[filter[1] as string], value));

      case '!in':
        return (feature) => !filter.slice(2).find((value) => filterValueEquals(feature.properties[filter[1] as string], value));

      case 'has':
        return (feature) => !!feature.properties[filter[1] as string];

      case '!has':
        return (feature) => !feature.properties[filter[1] as string];

      case '>':
        return (feature) => (feature.properties[filter[1] as string] as number) > (filter[2] as number);

      case '>=':
        return (feature) => (feature.properties[filter[1] as string] as number) >= (filter[2] as number);

      case '<':
        return (feature) => (feature.properties[filter[1] as string] as number) < (filter[2] as number);

      case '<=':
        return (feature) => (feature.properties[filter[1] as string] as number) <= (filter[2] as number);

      default:
        return () => true;
    }
  }
}
