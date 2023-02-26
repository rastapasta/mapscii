/*
  MapSCII - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  UI and central command center
*/
import fsPromises from 'fs/promises';
import keypress from 'keypress';
import TermMouse from 'term-mouse';

import Renderer from './Renderer.js';
import TileSource from './TileSource.js';
import * as utils from './utils.js';
import MapsciiConfig from './config.js';

export default class Mapscii {
  constructor(options) {
    this.width = null;
    this.height = null;
    this.canvas = null;
    this.mouse = null;

    this.mouseDragging = false;
    this.mousePosition = {
      x: 0,
      y: 0,
    };

    this.tileSource = null;
    this.renderer = null;

    this.zoom = 0;
    this.minZoom = null;
    this.config = {
      ...MapsciiConfig,
      ...options,
    };

    this.center = {
      lat: this.config.initialLat,
      lon: this.config.initialLon,
    };
  }

  async init() {
    if (!this.config.headless) {
      this._initKeyboard();
      this._initMouse();
    }
    await this._initTileSource();
    await this._initRenderer();
    await this._draw();
    this.notify('Welcome to MapSCII! Use your cursors to navigate, a/z to zoom, q to quit.');
  }


  async _initTileSource() {
    this.tileSource = new TileSource();
    await this.tileSource.init(this.config.source);
  }

  _initKeyboard() {
    keypress(this.config.input);
    if (this.config.input.setRawMode) {
      this.config.input.setRawMode(true);
    }
    this.config.input.resume();

    this.config.input.on('keypress', (ch, key) => this._onKey(key));
  }

  _initMouse() {
    this.mouse = TermMouse({
      input: this.config.input,
      output: this.config.output,
    });
    this.mouse.start();

    this.mouse.on('click', (event) => this._onClick(event));
    this.mouse.on('scroll', (event) => this._onMouseScroll(event));
    this.mouse.on('move', (event) => this._onMouseMove(event));
  }

  async _initRenderer() {
    const style = JSON.parse(await fsPromises.readFile(this.config.styleFile, 'utf8'));
    this.renderer = new Renderer(this.tileSource, style);

    this.config.output.on('resize', () => {
      this._resizeRenderer();
      this._draw();
    });

    this._resizeRenderer();
    this.zoom = (this.config.initialZoom !== null) ? this.config.initialZoom : this.minZoom;
  }

  _resizeRenderer() {
    this.width = this.config.size && this.config.size.width ? this.config.size.width * 2 : this.config.output.columns >> 1 << 2;
    this.height = this.config.size && this.config.size.height ? this.config.size.height * 4 : this.config.output.rows * 4 - 4;

    this.minZoom = 4-Math.log(4096/this.width)/Math.LN2;

    this.renderer.setSize(this.width, this.height);
  }

  _colrow2ll(x, y) {
    const projected = {
      x: (x-0.5)*2,
      y: (y-0.5)*4,
    };

    const size = utils.tilesizeAtZoom(this.zoom);
    const [dx, dy] = [projected.x-this.width/2, projected.y-this.height/2];

    const z = utils.baseZoom(this.zoom);
    const center = utils.ll2tile(this.center.lon, this.center.lat, z);

    return utils.normalize(utils.tile2ll(center.x+(dx/size), center.y+(dy/size), z));
  }

  _updateMousePosition(event) {
    this.mousePosition = this._colrow2ll(event.x, event.y);
  }

  _onClick(event) {
    if (event.x < 0 || event.x > this.width/2 || event.y < 0 || event.y > this.height/4) {
      return;
    }
    this._updateMousePosition(event);

    if (this.mouseDragging && event.button === 'left') {
      this.mouseDragging = false;
    } else {
      this.setCenter(this.mousePosition.lat, this.mousePosition.lon);
    }

    this._draw();
  }

  _onMouseScroll(event) {
    this._updateMousePosition(event);

    // the location of the pointer, where we want to zoom toward
    const targetMouseLonLat = this._colrow2ll(event.x, event.y);

    // zoom toward the center
    this.zoomBy(this.config.zoomStep * (event.button === 'up' ? 1 : -1));

    // the location the pointer ended up after zooming
    const offsetMouseLonLat = this._colrow2ll(event.x, event.y);

    const z = utils.baseZoom(this.zoom);
    // the projected locations
    const targetMouseTile = utils.ll2tile(targetMouseLonLat.lon, targetMouseLonLat.lat, z);
    const offsetMouseTile = utils.ll2tile(offsetMouseLonLat.lon, offsetMouseLonLat.lat, z);

    // the projected center
    const centerTile = utils.ll2tile(this.center.lon, this.center.lat, z);

    // calculate a new center that puts the pointer back in the target location
    const offsetCenterLonLat = utils.tile2ll(
      centerTile.x - (offsetMouseTile.x - targetMouseTile.x),
      centerTile.y - (offsetMouseTile.y - targetMouseTile.y),
      z
    );
    // move to the new center
    this.setCenter(offsetCenterLonLat.lat, offsetCenterLonLat.lon);

    this._draw();
  }

  _onMouseMove(event) {
    if (event.x < 0 || event.x > this.width/2 || event.y < 0 || event.y > this.height/4) {
      return;
    }
    if (this.config.mouseCallback && !this.config.mouseCallback(event)) {
      return;
    }

    // start dragging
    if (event.button === 'left') {
      if (this.mouseDragging) {
        const dx = (this.mouseDragging.x-event.x)*2;
        const dy = (this.mouseDragging.y-event.y)*4;

        const size = utils.tilesizeAtZoom(this.zoom);

        const newCenter = utils.tile2ll(
          this.mouseDragging.center.x+(dx/size),
          this.mouseDragging.center.y+(dy/size),
          utils.baseZoom(this.zoom)
        );

        this.setCenter(newCenter.lat, newCenter.lon);

        this._draw();

      } else {
        this.mouseDragging = {
          x: event.x,
          y: event.y,
          center: utils.ll2tile(this.center.lon, this.center.lat, utils.baseZoom(this.zoom)),
        };
      }
    }

    this._updateMousePosition(event);
    this.notify(this._getFooter());
  }

  _onKey(key) {
    if (this.config.keyCallback && !this.config.keyCallback(key)) return;
    if (!key || !key.name) return;

    // check if the pressed key is configured
    let draw = true;
    switch (key.name) {
      case 'q':
        if (this.config.quitCallback) {
          this.config.quitCallback();
        } else {
          process.exit(0);
        }
        break;
      case 'a':
        this.zoomBy(this.config.zoomStep);
        break;
      case 'y':
      case 'z':
        this.zoomBy(-this.config.zoomStep);
        break;
      case 'left':
      case 'h':
        this.moveBy(0, -8/Math.pow(2, this.zoom));
        break;
      case 'right':
      case 'l':
        this.moveBy(0, 8/Math.pow(2, this.zoom));
        break;
      case 'up':
      case 'k':
        this.moveBy(6/Math.pow(2, this.zoom), 0);
        break;
      case 'down':
      case 'j':
        this.moveBy(-6/Math.pow(2, this.zoom), 0);
        break;
      case 'c':
        this.config.useBraille = !this.config.useBraille;
        break;
      default:
        draw = false;
    }

    if (draw) {
      this._draw();
    }
  }

  async _draw() {
    try {
      const frame = await this.renderer.draw(this.center, this.zoom);
      this._write(frame);
      this.notify(this._getFooter());
    } catch {
      this.notify('renderer is busy');
    }
  }

  _getFooter() {
    // tile = utils.ll2tile(this.center.lon, this.center.lat, this.zoom);
    // `tile: ${utils.digits(tile.x, 3)}, ${utils.digits(tile.x, 3)}   `+

    let footer = `center: ${utils.digits(this.center.lat, 3)}, ${utils.digits(this.center.lon, 3)} `;
    footer += `  zoom: ${utils.digits(this.zoom, 2)} `;
    if (this.mousePosition.lat !== undefined) {
      footer += `  mouse: ${utils.digits(this.mousePosition.lat, 3)}, ${utils.digits(this.mousePosition.lon, 3)} `;
    }
    return footer;
  }

  notify(text) {
    this.config.onUpdate && this.config.onUpdate();
    if (!this.config.headless) {
      this._write('\r\x1B[K' + text);
    }
  }

  _write(output) {
    this.config.output.write(output);
  }

  zoomBy(step) {
    if (this.zoom+step < this.minZoom) {
      return this.zoom = this.minZoom;
    }
    if (this.zoom+step > this.config.maxZoom) {
      return this.zoom = this.config.maxZoom;
    }

    this.zoom += step;
  }

  moveBy(lat, lon) {
    this.setCenter(this.center.lat+lat, this.center.lon+lon);
  }

  setCenter(lat, lon) {
    this.center = utils.normalize({
      lon: lon,
      lat: lat,
    });
  }
}
