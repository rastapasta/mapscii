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

termap = new Termap();

// TODO: abstracing this class, create loader class
data = fs.readFileSync(__dirname+"/tiles/regensburg.pbf.gz");
termap.renderer.features = termap.renderer._getFeatures(termap.renderer._parseTile(data));
termap._draw();
