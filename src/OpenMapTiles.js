// Translates OpenMapTiles features (e.g. OpenFreeMap) into the osm2vectortiles layers the styles use.
// translate() returns {layer, properties}, or null to skip; only properties the styles use are kept.
'use strict';
const config = require('./config');

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

// OpenMapTiles ranks POIs from 1 upwards; the styles use scaleranks 1-4
function scalerank(rank) {
  if (!rank) return 4;
  if (rank <= 2) return 1;
  if (rank <= 6) return 2;
  if (rank <= 15) return 3;
  return 4;
}

// The name properties the labels use
function names(properties) {
  const result = {name: properties.name, name_en: properties.name_en || properties['name:en']};
  const own = properties['name_' + config.language] || properties['name:' + config.language];
  if (own) {
    result['name_' + config.language] = own;
  }
  return result;
}

// The osm2vectortiles class of a road or railway
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
  // Roads and railways
  transportation(properties, type) {
    const cls = roadClass(properties);
    if (!cls || type !== 'LineString') return null;
    const structure = properties.brunnel === 'bridge' || properties.brunnel === 'tunnel' ? properties.brunnel : 'none';
    // 1: along the line, -1: against it
    return {layer: 'road', properties: {class: cls, structure, oneway: properties.oneway}};
  },

  // Road names
  transportation_name(properties) {
    const cls = roadClass(properties) || 'street';
    if (!properties.name) return null;
    return {layer: 'road_label', properties: Object.assign(names(properties), {class: cls})};
  },

  // House numbers
  housenumber(properties) {
    return {layer: 'housenum_label', properties: {house_num: properties.housenumber}};
  },

  // Points of interest, with a scalerank from their rank
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

  // Mountain peaks, as points of interest
  mountain_peak(properties) {
    if (!properties.name) return null;
    return {layer: 'poi_label', properties: Object.assign(names(properties), {scalerank: 3, localrank: properties.rank})};
  },

  // Parks: areas as landuse, names as points of interest
  park(properties, type) {
    if (type === 'Point') {
      if (!properties.name) return null;
      return {layer: 'poi_label', properties: Object.assign(names(properties), {scalerank: 2, localrank: properties.rank})};
    }
    if (properties.class === 'national_park') {
      return {layer: 'landuse_overlay', properties: {class: 'national_park'}};
    }
    return {layer: 'landuse', properties: {class: 'park'}};
  },

  // Countries, states and settlements
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

  // Names of seas, lakes and rivers
  water_name(properties) {
    if (!properties.name) return null;
    if (marineRanks[properties.class]) {
      return {layer: 'marine_label', properties: Object.assign(names(properties), {labelrank: marineRanks[properties.class]})};
    }
    return {layer: 'water_label', properties: names(properties)};
  },

  // Airports, ranked by class
  aerodrome_label(properties) {
    if (!properties.name) return null;
    const rank = properties.class === 'international' ? 1 : properties.class === 'public' ? 2 : 3;
    return {layer: 'airport_label', properties: Object.assign(names(properties), {scalerank: rank})};
  },

  // Water areas
  water() {
    return {layer: 'water', properties: {}};
  },

  // Rivers and streams
  waterway(properties) {
    const cls = properties.class === 'drain' || properties.class === 'ditch' ? 'stream' : properties.class;
    return {layer: 'waterway', properties: {class: cls}};
  },

  // Land use areas
  landuse(properties) {
    return {layer: 'landuse', properties: {class: landuseClasses[properties.class] || properties.class}};
  },

  // Woods, grass and the like, as landuse
  landcover(properties) {
    if (properties.class === 'wood') {
      return {layer: 'landuse', properties: {class: 'wood'}};
    }
    if (properties.subclass === 'park' || properties.subclass === 'garden') {
      return {layer: 'landuse', properties: {class: 'park'}};
    }
    return null;
  },

  // Buildings
  building() {
    return {layer: 'building', properties: {}};
  },

  // Borders
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

  // Runways and taxiways
  aeroway(properties) {
    return {layer: 'aeroway', properties: {type: properties.class}};
  },
};

module.exports = {
  // The osm2vectortiles {layer, properties} of a feature, or null to skip it
  translate(layer, properties, type) {
    const translator = translators[layer];
    return translator ? translator(properties, type) : null;
  },

  // Whether a TileJSON's vector layers look like the OpenMapTiles schema
  matches(vectorLayers) {
    const ids = (vectorLayers || []).map((layer) => layer.id);
    return ids.includes('transportation') && ids.includes('poi');
  },
};
