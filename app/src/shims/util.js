'use strict';
module.exports = {
  format: (...args) => args.map(String).join(' '),
  inspect: (value) => String(value),
  promisify: (fn) => (...args) => new Promise((resolve, reject) => fn(...args, (error, value) => (error ? reject(error) : resolve(value)))),
};
