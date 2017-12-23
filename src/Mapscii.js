/*
  mapscii - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  UI and central command center
*/
'use strict';
const keypress = require('keypress');
const TermMouse = require('term-mouse');

const Renderer = require('./Renderer');
const TileSource = require('./TileSource');
const utils = require('./utils');
let config = require('./config');

class Mapscii {
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
    // sf lat: 37.787946, lon: -122.407522
    // iceland lat: 64.124229, lon: -21.811552
    // rgbg
    // lat: 49.019493, lon: 12.098341
    this.center = {
      lat: 52.51298,
      lon: 13.42012,
    };

    this.minZoom = null;
    config = Object.assign(config, options);
  }

  init() {
    return new Promise((resolve) => {
      if (!config.headless) {
        this._initKeyboard();
        this._initMouse();
      }
      this._initTileSource();
      this._initRenderer();
      this._draw();
      this.notify('Welcome to MapSCII! Use your cursors to navigate, a/z to zoom, q to quit.');
      resolve();
    });
  }


  _initTileSource() {
    this.tileSource = new TileSource();
    this.tileSource.init(config.source);
  }

  _initKeyboard() {
    keypress(config.input);
    if (config.input.setRawMode) {
      config.input.setRawMode(true);
    }
    config.input.resume();

    config.input.on('keypress', (ch, key) => this._onKey(key));
  }

  _initMouse() {
    this.mouse = TermMouse({
      input: config.input,
      output: config.output,
    });
    this.mouse.start();

    this.mouse.on('click', (event) => this._onClick(event));
    this.mouse.on('scroll', (event) => this._onMouseScroll(event));
    this.mouse.on('move', (event) => this._onMouseMove(event));
  }

  _initRenderer() {
    this.renderer = new Renderer(config.output, this.tileSource);
    this.renderer.loadStyleFile(config.styleFile);

    config.output.on('resize', () => {
      this._resizeRenderer();
      this._draw();
    });

    this._resizeRenderer();
    this.zoom = (config.initialZoom !== null) ? config.initialZoom : this.minZoom;
  }

  _resizeRenderer() {
    if (config.size) {
      this.width = config.size.width;
      this.height = config.size.height;
    } else {
      this.width = config.output.columns >> 1 << 2;
      this.height = config.output.rows * 4 - 4;
    }

    this.minZoom = 4-Math.log(4096/this.width)/Math.LN2;

    this.renderer.setSize(this.width, this.height);
  }

  _updateMousePosition(event) {
    const projected = {
      x: (event.x-0.5)*2,
      y: (event.y-0.5)*4,
    };

    const size = utils.tilesizeAtZoom(this.zoom);
    const [dx, dy] = [projected.x-this.width/2, projected.y-this.height/2];

    const z = utils.baseZoom(this.zoom);
    const center = utils.ll2tile(this.center.lon, this.center.lat, z);

    this.mousePosition = utils.normalize(utils.tile2ll(center.x+(dx/size), center.y+(dy/size), z));
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
    // TODO: handle .x/y for directed zoom
    this.zoomBy(config.zoomStep * (event.button === 'up' ? 1 : -1));
    this._draw();
  }

  _onMouseMove(event) {
    if (event.x < 0 || event.x > this.width/2 || event.y < 0 || event.y > this.height/4) {
      return;
    }
    if (config.mouseCallback && !config.mouseCallback(event)) {
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
    if (config.keyCallback && !config.keyCallback(key)) return;
    if (!key || !key.name) return;

    // check if the pressed key is configured
    let draw = true;
    switch (key.name) {
      case 'q':
        if (config.quitCallback) {
          config.quitCallback();
        } else {
          process.exit(0);
        }
        break;
      case 'a':
        this.zoomBy(config.zoomStep);
        break;
      case 'y':
      case 'z':
        this.zoomBy(-config.zoomStep);
        break;
      case 'left':
        this.moveBy(0, -8/Math.pow(2, this.zoom));
        break;
      case 'right':
        this.moveBy(0, 8/Math.pow(2, this.zoom));
        break;
      case 'up':
        this.moveBy(6/Math.pow(2, this.zoom), 0);
        break;
      case 'down':
        this.moveBy(-6/Math.pow(2, this.zoom), 0);
        break;
      case 'c':
        config.useBraille = !config.useBraille;
        break;
      default:
        draw = false;
    }

    if (draw !== null) {
      this._draw();
    }
  }

  _draw() {
    this.renderer.draw(this.center, this.zoom).then((frame) => {
      this._write(frame);
      this.notify(this._getFooter());
    }).catch(() => {
      this.notify('renderer is busy');
    });
  }

  _getFooter() {
    // tile = utils.ll2tile(this.center.lon, this.center.lat, this.zoom);
    // `tile: ${utils.digits(tile.x, 3)}, ${utils.digits(tile.x, 3)}   `+

    return `center: ${utils.digits(this.center.lat, 3)}, ${utils.digits(this.center.lon, 3)}   `+
      `zoom: ${utils.digits(this.zoom, 2)}   `+
      `mouse: ${utils.digits(this.mousePosition.lat, 3)}, ${utils.digits(this.mousePosition.lon, 3)} `;
  }

  notify(text) {
    config.onUpdate && config.onUpdate();
    if (!config.headless) {
      this._write('\r\x1B[K' + text);
    }
  }

  _write(output) {
    config.output.write(output);
  }

  zoomBy(step) {
    if (this.zoom+step < this.minZoom) {
      return this.zoom = this.minZoom;
    }
    if (this.zoom+step > config.maxZoom) {
      return this.zoom = config.maxZoom;
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

module.exports = Mapscii;
