module.exports = {
  language: 'en',

  // TODO: adapt to osm2vectortiles successor openmaptiles v3)
  // mapscii.me hosts the last available version, 2016-06-20
  source: 'http://mapscii.me/',

  //source: __dirname+"/../mbtiles/regensburg.mbtiles",

  styleFile: __dirname+'/../styles/dark.json',

  initialZoom: null,
  maxZoom: 18,
  zoomStep: 0.2,

  simplifyPolylines: false,

  useBraille: true,

  // Downloaded files get persisted in ~/.mapscii
  persistDownloadedTiles: true,

  tileRange: 14,
  projectSize: 256,

  labelMargin: 5,

  layers: {
    housenum_label: {
      margin: 4
    },
    poi_label: {
      cluster: true,
      margin: 5,
    },
    place_label: {
      cluster: true,
    },
    state_label: {
      cluster: true,
    },
  },

  input: process.stdin,
  output: process.stdout,

  headless: false,

  delimeter: '\n\r',

  poiMarker: '◉',
};
