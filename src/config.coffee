module.exports =
    language: "en"

    source: "http://nachbar.io/data/osm2vectortiles/"
    #source: __dirname+"/../mbtiles/regensburg.mbtiles"
    styleFile: __dirname+"/../styles/dark.json"

    initialZoom: false
    maxZoom: 18
    zoomStep: 0.2

    tileSize: 4096
    tileRange: 14
    projectSize: 256

    labelMargin: 5

    layers:
      housenum_label: margin: 4
      poi_label: cluster: true, margin: 5
      place_label: cluster: true
      state_label: cluster: true

    input: process.stdin
    output: process.stdout

    headless: false
