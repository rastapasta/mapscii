/* eslint jest/expect-expect: ["warn", {"assertFunctionNames": ["expect", "expectPlace"]}] */
'use strict';
const {parse} = require('./coordinates');

const near = (actual, expected) => expect(actual).toBeCloseTo(expected, 4);

function expectPlace(text, lat, lon, zoom) {
  const result = parse(text);
  near(result.lat, lat);
  near(result.lon, lon);
  expect(result.zoom).toBe(zoom);
}

describe('coordinates.parse', () => {
  test('reads decimal degrees, latitude first', () => {
    expectPlace('42.3601, -71.0942', 42.3601, -71.0942, undefined);
    expectPlace('42.3601 -71.0942', 42.3601, -71.0942, undefined);
    expectPlace('  3.848;11.5021 ', 3.848, 11.5021, undefined);
    expectPlace('-33.8568, 151.2153', -33.8568, 151.2153, undefined);
  });

  test('reads a zoom level after the coordinates', () => {
    expectPlace('42.3601, -71.0942, 16', 42.3601, -71.0942, 16);
    expectPlace('42.3601 -71.0942 16', 42.3601, -71.0942, 16);
    expectPlace('42.3601, -71.0942 z16', 42.3601, -71.0942, 16);
    expectPlace('42.3601 -71.0942 zoom 12.5', 42.3601, -71.0942, 12.5);
  });

  test('reads hemisphere letters before or after the number', () => {
    expectPlace('42.3601N 71.0942W', 42.3601, -71.0942, undefined);
    expectPlace('42.3601 N, 71.0942 W', 42.3601, -71.0942, undefined);
    expectPlace('N42.3601 W71.0942', 42.3601, -71.0942, undefined);
    expectPlace('33.8568S 151.2153E', -33.8568, 151.2153, undefined);
    expectPlace('n3.848 e11.5021', 3.848, 11.5021, undefined);
  });

  test('takes the order from hemisphere letters', () => {
    expectPlace('71.0942W 42.3601N', 42.3601, -71.0942, undefined);
  });

  test('reads degrees, minutes and seconds', () => {
    expectPlace('42°21\'36.4"N 71°05\'39.1"W', 42 + 21 / 60 + 36.4 / 3600, -(71 + 5 / 60 + 39.1 / 3600), undefined);
    expectPlace('42° 21′ 36″ N, 71° 5′ 39″ W', 42.36, -(71 + 5 / 60 + 39 / 3600), undefined);
    expectPlace('3 50 53 N 11 30 7 E', 3 + 50 / 60 + 53 / 3600, 11 + 30 / 60 + 7 / 3600, undefined);
    expectPlace('48°51.4\'N 2°21.1\'E', 48 + 51.4 / 60, 2 + 21.1 / 60, undefined);
    expectPlace('-33 51 24, 151 12 55', -(33 + 51 / 60 + 24 / 3600), 151 + 12 / 60 + 55 / 3600, undefined);
  });

  test('reads links from map websites', () => {
    expectPlace('https://www.google.com/maps/@42.3601,-71.0942,15z', 42.3601, -71.0942, 15);
    expectPlace('https://www.google.com/maps/place/MIT/@42.3601,-71.0942,17.5z/data=x', 42.3601, -71.0942, 17.5);
    expectPlace('https://www.openstreetmap.org/#map=16/42.3601/-71.0942', 42.3601, -71.0942, 16);
    expectPlace('geo:42.3601,-71.0942', 42.3601, -71.0942, undefined);
    expectPlace('geo:42.3601,-71.0942?z=13', 42.3601, -71.0942, 13);
  });

  test('reads degrees with decimal minutes, letters in front', () => {
    expectPlace('N 48° 51.504 E 002° 17.670', 48.8584, 2.2945, undefined);
    expectPlace('S 33 51 24 E 151 12 55', -(33 + 51 / 60 + 24 / 3600), 151 + 12 / 60 + 55 / 3600, undefined);
  });

  test('reads typeset minus signs, decimal commas and short numbers', () => {
    expectPlace('\u221233.8568, 151.2153', -33.8568, 151.2153, undefined);
    expectPlace('33.8568, \u2013151.2153', 33.8568, -151.2153, undefined);
    expectPlace('48,8584 2,2945', 48.8584, 2.2945, undefined);
    expectPlace('.5, -.5', 0.5, -0.5, undefined);
    expectPlace('48.8584N2.2945E', 48.8584, 2.2945, undefined);
    expectPlace('48.8584, 2.2945, 17z', 48.8584, 2.2945, 17);
  });

  test('reads labelled coordinates in either order', () => {
    expectPlace('lat 48.8584 lon 2.2945', 48.8584, 2.2945, undefined);
    expectPlace('lng: 2.2945, lat: 48.8584', 48.8584, 2.2945, undefined);
  });

  test('reads coordinates from link parameters', () => {
    expectPlace('https://www.google.com/maps?q=48.8584,2.2945&z=15', 48.8584, 2.2945, 15);
    expectPlace('https://www.google.com/maps/search/?api=1&query=48.8584%2C2.2945', 48.8584, 2.2945, undefined);
    expectPlace('https://maps.apple.com/?ll=48.8584,2.2945&z=15', 48.8584, 2.2945, 15);
    expectPlace('https://www.openstreetmap.org/?mlat=48.8584&mlon=2.2945', 48.8584, 2.2945, undefined);
    expectPlace('https://www.bing.com/maps?cp=48.8584~2.2945&lvl=16', 48.8584, 2.2945, 16);
    expect(() => parse('https://www.google.com/maps?q=Eiffel+Tower')).toThrow('no coordinates');
  });

  test('wraps longitudes beyond 180 in links, as after panning across the date line', () => {
    expectPlace('https://www.google.com/maps/@21.3069,-202.1417,12z', 21.3069, 157.8583, 12);
    expectPlace('https://www.openstreetmap.org/#map=10/-17.7/538.3', -17.7, 178.3, 10);
    expect(() => parse('21.3069, -202.1417')).toThrow('longitude');
  });

  test('rejects what it cannot read, with a reason', () => {
    expect(() => parse('')).toThrow('no coordinates');
    expect(() => parse('Cambridge')).toThrow('place names');
    expect(() => parse('42.3601')).toThrow('latitude and a longitude');
    expect(() => parse('42.36N 71.09N')).toThrow('N or S');
    expect(() => parse('42 75 00 N 71 0 0 W')).toThrow('between 0 and 60');
  });

  test('rejects coordinates outside the earth', () => {
    expect(() => parse('91, 10')).toThrow('latitude');
    expect(() => parse('10, 181')).toThrow('longitude');
    expect(() => parse('10, 10, 30')).toThrow('zoom');
  });
});
