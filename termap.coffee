fs = require 'fs'
Termap = require __dirname+'/src/Termap'

termap = new Termap()

# TODO: abstracing this class, create loader class
data = fs.readFileSync __dirname+"/tiles/regensburg.pbf.gz"
termap.renderer.features = termap.renderer._getFeatures termap.renderer._parseTile data
termap._draw()
