// MBTiles files, with the SQLite built into Node.js 22.5+.
'use strict';
const fs = require('fs');

// hide Node's "experimental" warning for SQLite
function loadSqlite() {
  const emitWarning = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    if (String(warning).includes('SQLite')) {
      return;
    }
    return emitWarning.call(process, warning, ...rest);
  };
  try {
    return require('node:sqlite');
  } catch (error) {
    throw new Error(`MBTiles files need Node.js 22.5 or later (this is ${process.version})`);
  } finally {
    process.emitWarning = emitWarning;
  }
}

class MBTilesFile {
  constructor(file, {write = false} = {}) {
    const {DatabaseSync} = loadSqlite();
    this.file = file;
    if (write) {
      fs.rmSync(file, {force: true});
      this.db = new DatabaseSync(file);
      this.db.exec(`
        CREATE TABLE metadata (name TEXT, value TEXT);
        CREATE UNIQUE INDEX metadata_name ON metadata (name);
        CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
        CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
      `);
      this.insertTile = this.db.prepare('INSERT OR REPLACE INTO tiles VALUES (?, ?, ?, ?)');
      this.insertMeta = this.db.prepare('INSERT OR REPLACE INTO metadata VALUES (?, ?)');
    } else {
      if (!fs.existsSync(file)) {
        throw new Error(`no such file: ${file}`);
      }
      this.db = new DatabaseSync(file, {readOnly: true});
      try {
        this.selectTile = this.db.prepare('SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?');
      } catch (error) {
        throw new Error(`${file} is not an MBTiles file`);
      }
    }
  }

  // y counts from the top, as in the rest of MapSCII (MBTiles counts from the bottom)
  getTile(z, x, y) {
    const row = this.selectTile.get(z, x, Math.pow(2, z) - 1 - y);
    return row ? Buffer.from(row.tile_data) : null;
  }

  // The metadata, with vector_layers parsed and numbers as numbers
  getInfo() {
    const info = {};
    for (const {name, value} of this.db.prepare('SELECT name, value FROM metadata').all()) {
      info[name] = value;
    }
    if (info.json) {
      try {
        Object.assign(info, JSON.parse(info.json));
      } catch (error) {
        void 0;
      }
    }
    for (const name of ['minzoom', 'maxzoom']) {
      if (info[name] !== undefined) {
        info[name] = +info[name];
      }
    }
    for (const name of ['bounds', 'center']) {
      if (typeof info[name] === 'string') {
        info[name] = info[name].split(',').map(Number);
      }
    }
    return info;
  }

  // Every tile in the file: [{z, x, y}]
  listTiles() {
    return this.db.prepare('SELECT zoom_level AS z, tile_column AS x, tile_row AS row FROM tiles').all()
      .map(({z, x, row}) => ({z, x, y: Math.pow(2, z) - 1 - row}));
  }

  // Stores a tile's data
  putTile(z, x, y, data) {
    this.insertTile.run(z, x, Math.pow(2, z) - 1 - y, data);
  }

  // Writes the metadata; vector_layers goes into the json field
  putInfo(info) {
    for (const [name, value] of Object.entries(info)) {
      if (value === undefined || value === null) continue;
      if (name === 'vector_layers') {
        this.insertMeta.run('json', JSON.stringify({vector_layers: value}));
      } else {
        this.insertMeta.run(name, Array.isArray(value) ? value.join(',') : String(value));
      }
    }
  }

  // Runs fn in one transaction, much faster for many tiles
  transaction(fn) {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  // Closes the database
  close() {
    this.db.close();
  }
}

MBTilesFile.sqlite = loadSqlite;
module.exports = MBTilesFile;
