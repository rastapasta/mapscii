/* Node's path, for the few names MapSCII builds */
'use strict';
// Joins path parts with /
const join = (...parts) => parts.filter(Boolean).join('/').replace(/\/+/g, '/');
module.exports = {
  join,
  resolve: join,
  dirname: (p) => String(p).replace(/\/[^/]*$/, '') || '/',
  // The last part of a path, without ext
  basename: (p, ext) => {
    const base = String(p).replace(/^.*\//, '');
    return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
  },
  extname: (p) => (String(p).match(/\.[^./]*$/) || [''])[0],
  sep: '/',
};
