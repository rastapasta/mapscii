/*
  Translates features of the OpenMapTiles schema (https://openmaptiles.org/schema/),
  as served e.g. by OpenFreeMap, into the osm2vectortiles layers and properties
  the bundled styles and the renderer are written for.

  translate(layer, properties, type) returns {layer, properties} for the
  osm2vectortiles layer the feature belongs to, or null to skip the feature.
  Only the properties the styles and labels use are kept, to save memory.
*/
'use strict';
const config = require('./config');

// transportation classes -> osm2vectortiles road classes
const roadClasses = {
  motorway: 'motorway',
  trunk: 'trunk',
  primary: 'primary',
  secondary: 'secondary',
  tertiary: 'tertiary',
  minor: 'street',
  busway: 'street',
  service: 'service',
  track: 'track',
  path: 'path',
  ferry: 'ferry',
};

const railClasses = {
  rail: 'major_rail',
  transit: 'minor_rail',
};

const placeTypes = {
  city: 'city',
  town: 'town',
  village: 'village',
  hamlet: 'hamlet',
  isolated_dwelling: 'hamlet',
  suburb: 'suburb',
  quarter: 'neighbourhood',
  neighbourhood: 'neighbourhood',
  island: 'island',
};

const marineRanks = {
  ocean: 1,
  sea: 2,
  gulf: 3,
  bay: 3,
  strait: 4,
};

const landuseClasses = {
  cemetery: 'cemetery',
  grave_yard: 'cemetery',
  hospital: 'hospital',
  school: 'school',
  college: 'school',
  university: 'school',
  kindergarten: 'school',
};

// OpenMapTiles ranks POIs per area from 1 (most important) upwards;
// the styles group them into scaleranks 1-4
function scalerank(rank) {
  if (!rank) return 4;
  if (rank <= 2) return 1;
  if (rank <= 6) return 2;
  if (rank <= 15) return 3;
  return 4;
}

function names(properties) {
  const result = {name: properties.name, name_en: properties.name_en || properties['name:en']};
  const own = properties['name_' + config.language] || properties['name:' + config.language];
  if (own) {
    result['name_' + config.language] = own;
  }
  return result;
}

function roadClass(properties) {
  if (railClasses[properties.class]) {
    return railClasses[properties.class];
  }
  const base = roadClasses[properties.class];
  if (!base) {
    return null;
  }
  if (base === 'path' && properties.subclass === 'pedestrian') {
    return 'pedestrian';
  }
  if (properties.ramp) {
    return base === 'motorway' ? 'motorway_link' : 'link';
  }
  return base;
}

const translators = {
  transportation(properties, type) {
    const cls = roadClass(properties);
    if (!cls || type !== 'LineString') return null;
    const structure = properties.brunnel === 'bridge' || properties.brunnel === 'tunnel' ? properties.brunnel : 'none';
    return {layer: 'road', properties: {class: cls, structure}};
  },

  transportation_name(properties) {
    const cls = roadClass(properties) || 'street';
    if (!properties.name) return null;
    return {layer: 'road_label', properties: Object.assign(names(properties), {class: cls})};
  },

  housenumber(properties) {
    return {layer: 'housenum_label', properties: {house_num: properties.housenumber}};
  },

  poi(properties) {
    if (!properties.name) return null;
    const rank = properties.rank;
    if (properties.class === 'railway') {
      return {layer: 'rail_station_label', properties: Object.assign(names(properties), {localrank: rank})};
    }
    return {
      layer: 'poi_label',
      properties: Object.assign(names(properties), {scalerank: scalerank(rank), localrank: rank}),
    };
  },

  mountain_peak(properties) {
    if (!properties.name) return null;
    return {layer: 'poi_label', properties: Object.assign(names(properties), {scalerank: 3, localrank: properties.rank})};
  },

  park(properties, type) {
    if (type === 'Point') {
      // park names
      if (!properties.name) return null;
      return {layer: 'poi_label', properties: Object.assign(names(properties), {scalerank: 2, localrank: properties.rank})};
    }
    if (properties.class === 'national_park') {
      return {layer: 'landuse_overlay', properties: {class: 'national_park'}};
    }
    return {layer: 'landuse', properties: {class: 'park'}};
  },

  place(properties) {
    if (!properties.name) return null;
    if (properties.class === 'country') {
      return {layer: 'country_label', properties: Object.assign(names(properties), {scalerank: Math.min(4, properties.rank || 4)})};
    }
    if (properties.class === 'state' || properties.class === 'province') {
      return {layer: 'state_label', properties: Object.assign(names(properties), {localrank: properties.rank})};
    }
    const placeType = placeTypes[properties.class];
    if (!placeType) return null;
    return {
      layer: 'place_label',
      properties: Object.assign(names(properties), {type: placeType, localrank: properties.rank}),
    };
  },

  water_name(properties) {
    if (!properties.name) return null;
    if (marineRanks[properties.class]) {
      return {layer: 'marine_label', properties: Object.assign(names(properties), {labelrank: marineRanks[properties.class]})};
    }
    return {layer: 'water_label', properties: names(properties)};
  },

  aerodrome_label(properties) {
    if (!properties.name) return null;
    const rank = properties.class === 'international' ? 1 : properties.class === 'public' ? 2 : 3;
    return {layer: 'airport_label', properties: Object.assign(names(properties), {scalerank: rank})};
  },

  water() {
    return {layer: 'water', properties: {}};
  },

  waterway(properties) {
    const cls = properties.class === 'drain' || properties.class === 'ditch' ? 'stream' : properties.class;
    return {layer: 'waterway', properties: {class: cls}};
  },

  landuse(properties) {
    return {layer: 'landuse', properties: {class: landuseClasses[properties.class] || properties.class}};
  },

  landcover(properties) {
    if (properties.class === 'wood') {
      return {layer: 'landuse', properties: {class: 'wood'}};
    }
    if (properties.subclass === 'park' || properties.subclass === 'garden') {
      return {layer: 'landuse', properties: {class: 'park'}};
    }
    return null;
  },

  building() {
    return {layer: 'building', properties: {}};
  },

  boundary(properties) {
    return {
      layer: 'admin',
      properties: {
        admin_level: properties.admin_level,
        maritime: properties.maritime || 0,
        disputed: properties.disputed || 0,
      },
    };
  },

  aeroway(properties) {
    return {layer: 'aeroway', properties: {type: properties.class}};
  },
};

module.exports = {
  translate(layer, properties, type) {
    const translator = translators[layer];
    return translator ? translator(properties, type) : null;
  },

  // true if a TileJSON's vector layers look like the OpenMapTiles schema
  matches(vectorLayers) {
    const ids = (vectorLayers || []).map((layer) => layer.id);
    return ids.includes('transportation') && ids.includes('poi');
  },
};
