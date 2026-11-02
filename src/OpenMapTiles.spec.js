'use strict';
const OpenMapTiles = require('./OpenMapTiles');
const Styler = require('./Styler');

const translate = OpenMapTiles.translate;

describe('OpenMapTiles', () => {
  describe('translate', () => {
    test('maps roads to osm2vectortiles classes and structures', () => {
      expect(translate('transportation', {class: 'minor'}, 'LineString'))
        .toEqual({layer: 'road', properties: {class: 'street', structure: 'none'}});
      expect(translate('transportation', {class: 'motorway', ramp: 1, brunnel: 'bridge'}, 'LineString'))
        .toEqual({layer: 'road', properties: {class: 'motorway_link', structure: 'bridge'}});
      expect(translate('transportation', {class: 'primary', ramp: 1}, 'LineString').properties.class).toBe('link');
      expect(translate('transportation', {class: 'path', subclass: 'pedestrian'}, 'LineString').properties.class).toBe('pedestrian');
      expect(translate('transportation', {class: 'rail'}, 'LineString').properties.class).toBe('major_rail');
      expect(translate('transportation', {class: 'transit'}, 'LineString').properties.class).toBe('minor_rail');
    });

    test('skips road areas and roads under construction', () => {
      expect(translate('transportation', {class: 'pier'}, 'Polygon')).toBeNull();
      expect(translate('transportation', {class: 'minor'}, 'Polygon')).toBeNull();
      expect(translate('transportation', {class: 'minor_construction'}, 'LineString')).toBeNull();
    });

    test('keeps names, also in the configured language', () => {
      const poi = translate('poi', {name: 'Mairie', 'name:en': 'Town Hall', class: 'town_hall', rank: 1});
      expect(poi.layer).toBe('poi_label');
      expect(poi.properties).toMatchObject({name: 'Mairie', name_en: 'Town Hall', scalerank: 1, localrank: 1});
    });

    test('drops unnamed POIs and turns railway POIs into stations', () => {
      expect(translate('poi', {class: 'parking', rank: 3})).toBeNull();
      expect(translate('poi', {name: 'Kendall/MIT', class: 'railway', rank: 2}).layer).toBe('rail_station_label');
    });

    test('groups POI ranks into the scaleranks 1-4 the styles use', () => {
      const rankOf = (rank) => translate('poi', {name: 'x', class: 'shop', rank}).properties.scalerank;
      expect([1, 2, 5, 10, 40].map(rankOf)).toEqual([1, 1, 2, 3, 4]);
    });

    test('sorts places into country, state and place labels', () => {
      expect(translate('place', {name: 'Cameroon', class: 'country', rank: 2}))
        .toMatchObject({layer: 'country_label', properties: {scalerank: 2}});
      expect(translate('place', {name: 'Centre', class: 'state'}).layer).toBe('state_label');
      expect(translate('place', {name: 'Yaoundé', class: 'city', rank: 1}))
        .toMatchObject({layer: 'place_label', properties: {type: 'city'}});
      expect(translate('place', {name: 'Bastos', class: 'quarter'}).properties.type).toBe('neighbourhood');
      expect(translate('place', {name: 'Africa', class: 'continent'})).toBeNull();
    });

    test('maps house numbers, water names and areas', () => {
      expect(translate('housenumber', {housenumber: '77'})).toEqual({layer: 'housenum_label', properties: {house_num: '77'}});
      expect(translate('water_name', {name: 'Atlantic', class: 'ocean'}))
        .toMatchObject({layer: 'marine_label', properties: {labelrank: 1}});
      expect(translate('water_name', {name: 'Charles River', class: 'river'}).layer).toBe('water_label');
      expect(translate('landuse', {class: 'university'}).properties.class).toBe('school');
      expect(translate('landcover', {class: 'wood'}).properties.class).toBe('wood');
      expect(translate('landcover', {class: 'sand'})).toBeNull();
      expect(translate('park', {class: 'national_park'}, 'Polygon').layer).toBe('landuse_overlay');
      expect(translate('park', {name: 'Danehy Park', class: 'park'}, 'Point').layer).toBe('poi_label');
      expect(translate('boundary', {admin_level: 2})).toEqual({layer: 'admin', properties: {admin_level: 2, maritime: 0, disputed: 0}});
    });

    test('skips layers it does not know', () => {
      expect(translate('something_new', {name: 'x'})).toBeNull();
    });

    test('translated features find their style', () => {
      const styler = new Styler(require('../styles/dark.json'));
      const styleOf = (layer, properties, type) => {
        const translated = translate(layer, properties, type);
        translated.properties.$type = type;
        const style = styler.getStyleFor(translated.layer, {properties: translated.properties});
        return style && style.id;
      };
      expect(styleOf('transportation', {class: 'motorway'}, 'LineString')).toBe('road_motorway');
      expect(styleOf('transportation', {class: 'secondary', brunnel: 'tunnel'}, 'LineString')).toBe('tunnel_secondary_tertiary');
      expect(styleOf('transportation', {class: 'minor'}, 'LineString')).toBe('road_street');
      expect(styleOf('poi', {name: 'x', class: 'shop', rank: 1}, 'Point')).toBe('poi_label_1');
      expect(styleOf('place', {name: 'x', class: 'town'}, 'Point')).toBe('place_label_town');
      expect(styleOf('water', {class: 'lake'}, 'Polygon')).toBe('water');
    });
  });

  describe('matches', () => {
    test('recognises an OpenMapTiles TileJSON by its layers', () => {
      expect(OpenMapTiles.matches([{id: 'transportation'}, {id: 'poi'}, {id: 'water'}])).toBe(true);
      expect(OpenMapTiles.matches([{id: 'road'}, {id: 'poi_label'}])).toBe(false);
      expect(OpenMapTiles.matches(undefined)).toBe(false);
    });
  });
});
