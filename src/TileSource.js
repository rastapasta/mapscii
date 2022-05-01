/*
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Source for VectorTiles - supports
  * remote TileServer
  * local MBTiles and VectorTiles
*/
import fsPromises from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import envPaths from 'env-paths';
const paths = envPaths('mapscii');

import Tile from './Tile.js';
import config from './config.js';

// https://github.com/mapbox/node-mbtiles has native build dependencies (sqlite3)
// To maximize MapSCII’s compatibility, MBTiles support must be manually added via
// $> npm install -g @mapbox/mbtiles
let MBTiles = null;
try {
  MBTiles = require('@mapbox/mbtiles');
} catch (err) {void 0;}

const modes = {
  MBTiles: 1,
  VectorTile: 2,
  HTTP: 3,
};

export default class TileSource {
  async init(source) {
    this.source = source;
    
    this.cache = {};
    this.cacheSize = 16;
    this.cached = [];
    
    this.mode = null;
    this.mbtiles = null;
    this.styler = null;
    
    if (this.source.startsWith('http')) {
      if (config.persistDownloadedTiles) {
        await this._initPersistence();
      }

      this.mode = modes.HTTP;

    } else if (this.source.endsWith('.mbtiles')) {
      if (!MBTiles) {
        throw new Error('MBTiles support must be installed with following command: \'npm install -g @mapbox/mbtiles\'');
      }

      this.mode = modes.MBTiles;
      this.loadMBTiles(source);
    } else {
      throw new Error('source type isn\'t supported yet');
    }
  }

  loadMBTiles(source) {
    return new Promise((resolve, reject) => {
      new MBTiles(source, (err, mbtiles) => {
        if (err) {
          reject(err);
        }
        this.mbtiles = mbtiles;
        resolve();
      });
    });
  }

  useStyler(styler) {
    this.styler = styler;
  }

  getTile(z, x, y) {
    if (!this.mode) {
      throw new Error('no TileSource defined');
    }
    
    const cached = this.cache[[z, x, y].join('-')];
    if (cached) {
      return Promise.resolve(cached);
    }
    
    if (this.cached.length > this.cacheSize) {
      const overflow = Math.abs(this.cacheSize - this.cache.length);
      for (const tile in this.cached.splice(0, overflow)) {
        delete this.cache[tile];
      }
    }
  
    switch (this.mode) {
      case modes.MBTiles:
        return this._getMBTile(z, x, y);
      case modes.HTTP:
        return this._getHTTP(z, x, y);
    }
  }

  async _getHTTP(z, x, y) {
    let promise;
    const persistedTile = await this._getPersited(z, x, y);
    if (config.persistDownloadedTiles && persistedTile) {
      promise = Promise.resolve(persistedTile);
    } else {
      promise = fetch(this.source + [z,x,y].join('/') + '.pbf')
        .then((res) => res.arrayBuffer())
        .then((arrayBuffer) => {
          const buffer = Buffer.from(arrayBuffer);
          if (config.persistDownloadedTiles) {
            this._persistTile(z, x, y, buffer);
            return buffer;
          }
        });
    }
    return promise.then((buffer) => {
      return this._createTile(z, x, y, buffer);
    });
  }

  async _getMBTile(z, x, y) {
    return new Promise((resolve, reject) => {
      this.mbtiles.getTile(z, x, y, (err, buffer) => {
        if (err) {
          reject(err);
        }
        resolve(this._createTile(z, x, y, buffer));
      });
    });
  }

  async _createTile(z, x, y, buffer) {
    const name = [z, x, y].join('-');
    this.cached.push(name);
    
    const tile = this.cache[name] = new Tile(this.styler);
    await tile.load(buffer);
    return tile;
  }

  async _initPersistence() {
    try {
      await this._createFolder(paths.cache);
    } catch (error) {
      config.persistDownloadedTiles = false;
    }
  }

  async _persistTile(z, x, y, buffer) {
    const zoom = z.toString();
    await this._createFolder(path.join(paths.cache, zoom));
    const filePath = path.join(paths.cache, zoom, `${x}-${y}.pbf`);
    return fsPromises.writeFile(filePath, buffer);
  }

  async _getPersited(z, x, y) {
    try {
      return await fsPromises.readFile(path.join(paths.cache, z.toString(), `${x}-${y}.pbf`));
    } catch (error) {
      return false;
    }
  }

  async _createFolder(path) {
    try {
      await fsPromises.mkdir(path);
      return true;
    } catch (error) {
      if (error.code === 'EEXIST') return true;
      throw error;
    }
  }
}
