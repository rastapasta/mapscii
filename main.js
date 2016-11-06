/*#
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>
  Discover the planet in your console!

  This scripts boots up the application.

  TODO: params parsing and so on
#*/
require('coffee-script/register');

const Termap = require('./src/Termap');

termap = new Termap();
termap.init();
