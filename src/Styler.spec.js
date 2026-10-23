'use strict';
const Styler = require('./Styler');

const style = {
  layers: [
    {id: 'all', 'source-layer': 'test', filter: ['all', ['==', 'a', 1], ['==', 'b', 2]]},
    {id: 'any', 'source-layer': 'test', filter: ['any', ['==', 'a', 1], ['==', 'b', 2]]},
    {id: 'none', 'source-layer': 'test', filter: ['none', ['==', 'a', 1], ['==', 'b', 2]]},
  ],
};

describe('Styler', () => {
  const styler = new Styler(style);
  const filter = (id) => styler.styleById[id].appliesTo;
  const feature = (properties) => ({properties});

  test('"all" matches only if every filter matches', () => {
    expect(filter('all')(feature({a: 1, b: 2}))).toBe(true);
    expect(filter('all')(feature({a: 1, b: 3}))).toBe(false);
    expect(filter('all')(feature({a: 0, b: 0}))).toBe(false);
  });

  test('"any" matches if one filter matches', () => {
    expect(filter('any')(feature({a: 1, b: 3}))).toBe(true);
    expect(filter('any')(feature({a: 0, b: 0}))).toBe(false);
  });

  test('"none" matches only if no filter matches', () => {
    expect(filter('none')(feature({a: 0, b: 0}))).toBe(true);
    expect(filter('none')(feature({a: 1, b: 3}))).toBe(false);
  });

  test('picks the style matching a POI\'s rank', () => {
    const dark = new Styler(require('../styles/dark.json'));
    for (const rank of [1, 2, 3, 4]) {
      const poi = feature({$type: 'Point', scalerank: rank});
      expect(dark.getStyleFor('poi_label', poi).id).toBe(`poi_label_${rank}`);
    }
  });
});
