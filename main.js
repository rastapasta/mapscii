/*#
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>
  Discover the planet in your console!

  This scripts boots up the application.

  TODO: params parsing and so on
#*/

require('coffee-script/register');

const fs = require('fs');
const Termap = require(__dirname+'/src/Termap');
const Tile = require(__dirname+'/src/Tile')

termap = new Termap();

// TODO: abstracing this class, create loader class
data = fs.readFileSync(__dirname+"/tiles/germany.pbf.gz");
tile = new Tile(data);
termap.renderer.features = tile.layers
termap._draw();
