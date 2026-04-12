module.exports = {
  language: 'en',

  source: 'https://tiles.openfreemap.org/planet/map/',

  //source: __dirname+"/../mbtiles/regensburg.mbtiles",

  styleFile: __dirname+'/../styles/dark.json',

  initialZoom: null,
  maxZoom: 18,
  zoomStep: 0.2,

  // sf lat: 37.787946, lon: -122.407522
  // iceland lat: 64.124229, lon: -21.811552
  // rgbg
  // lat: 49.019493, lon: 12.098341
  initialLat: 52.51298,
  initialLon: 13.42012,

  simplifyPolylines: false,

  useBraille: true,

  // Downloaded files get persisted in ~/.mapscii
  persistDownloadedTiles: true,

  tileRange: 14,
  projectSize: 256,

  labelMargin: 5,

  layers: {
    housenumber: {
      margin: 4
    },
    poi: {
      cluster: true,
      margin: 5,
    },
    place: {
      cluster: true,
    }
  },

  input: process.stdin,
  output: process.stdout,

  headless: false,

  delimeter: '\n\r',

  poiMarker: '◉',
};
