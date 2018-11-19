/*#
  MapSCII - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>
  Discover the planet in your console!

  This scripts boots up the application.

  TODO: params parsing and so on
#*/
'use strict';
const Mapscii = require('./src/Mapscii');

const mapscii = new Mapscii();
mapscii.init().catch((err) => {
  console.error('Failed to start MapSCII.');
  console.error(err);
});
