/*#
  mapscii - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>
  Discover the planet in your console!

  This scripts boots up the application.

  TODO: params parsing and so on
#*/
'use strict';
require('coffee-script/register');

const Mapscii = require('./src/Mapscii');

const mapscii = new Mapscii();
mapscii.init();
