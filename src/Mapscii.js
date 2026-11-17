/*
  MapSCII - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  UI and central command center
*/
'use strict';
const fs = require('fs');
const keypress = require('keypress');
const TermMouse = require('term-mouse');

const Renderer = require('./Renderer');
const TileSource = require('./TileSource');
const DataMeter = require('./DataMeter');
const PlaceIndex = require('./PlaceIndex');
const SavedPlaces = require('./SavedPlaces');
const FieldNotes = require('./FieldNotes');
const GpsFeed = require('./GpsFeed');
const Gpx = require('./Gpx');
const PlusCode = require('./PlusCode');
const resolvePlace = require('./resolvePlace');
const {LayerManager} = require('./layers/LayerManager');
const Navigator = require('./Navigator');
const Guidance = require('./Guidance');
const Voice = require('./Voice');
const utils = require('./utils');
let config = require('./config');

const VIEWS = ['map', 'satellite', 'hybrid', 'relief', '3d'];
const VIEW_NOTES = {
  map: 'the map',
  satellite: 'satellite imagery (Esri): ~25 KB a picture tile, ~0.2-0.6 MB a screen the first time',
  hybrid: 'hybrid: satellite imagery with roads, borders and rivers (as satellite: ~0.2-0.6 MB a screen the first time)',
  relief: 'relief: the landscape under the map (~150 KB an elevation tile, a few a screen)',
  '3d': '3D: the landscape ahead - , and . turn, a and z go lower and higher, i for satellite colours (elevation tiles, ~150 KB each)',
};

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
    this.minZoom = null;
    this.sourceError = null;

    this.drawTimer = null;
    this.lastDrawAt = 0;
    config = Object.assign(config, options);

    this.center = utils.normalize({
      lat: config.initialLat,
      lon: config.initialLon
    });

    this.marker = config.marker || null;
    this.expandedLabel = null;
    this.nameCycle = null;
    this.prompt = null;
    this.promptError = null;
    // shown in the footer until messageUntil or the next key
    this.message = null;
    this.messageUntil = 0;
  }

  // Starts the map: tile source, renderer, input, layers, views and the first draw
  async init() {
    // the map works while the tile source is still being looked up
    const ready = this._initTileSource();
    this._initLayers();
    if (!config.headless) {
      this._initKeyboard();
      this._initMouse();
      process.on('exit', () => config.output.write('\x1B[0m\n'));
    }
    this._initRenderer();
    let welcome = 'Welcome to MapSCII! Use your cursors to navigate, a/z to zoom, g to go to coordinates, q to quit.';
    if (config.overlaySummary) {
      welcome = config.overlaySummary;
    }
    this._showMessage(welcome, 6000);
    this._draw();
    try {
      await ready;
    } catch (error) {
      // the source is tried again with the next tile request
      this.sourceError = error.message;
      this.message = null;
      this.notify(this._getFooter());
      return;
    }
    if (this.tileSource.attribution && this.message) {
      this.message = `${welcome}  Map: ${this.tileSource.attribution}`;
      this.notify(this._getFooter());
    }
  }

  // Shows a message in the footer for a while
  _showMessage(text, duration) {
    this.message = text;
    this.messageUntil = Date.now() + duration;
    this.notify(this._getFooter());
    const timer = setTimeout(() => this.notify(this._getFooter()), duration + 10);
    if (timer.unref) {
      timer.unref();
    }
  }


  // Sets up the tile source, the search index and the GPS and fleet feeds
  _initTileSource() {
    this.tileSource = new TileSource();
    const ready = this.tileSource.init(config.source);
    this.placeIndex = null;
    this.savedPlaces = config.savedPlacesFile ? new SavedPlaces(config.savedPlacesFile) : null;
    this.fieldNotes = config.notesFile ? new FieldNotes(config.notesFile) : null;
    this.notesSeen = null;
    this.fleet = null;
    if (config.fleetUrl) {
      this.fleet = {devices: new Map(), status: 'connecting'};
      this.fleetFeed = new GpsFeed(config.fleetUrl, (device) => {
        if (!device.id) return;
        this.fleet.devices.set(device.id, Object.assign({heard: Date.now() - (device.age || 0) * 1000}, device));
        this._draw();
      }, (status) => {
        this.fleet.status = status;
        this.notify(this._getFooter());
      }, {name: 'fleet server', tool: 'tools/fleet'});
    }
    this.gps = null;
    if (config.gpsUrl) {
      this.gps = {position: null, track: [], follow: true, status: 'connecting', at: 0};
      this.gpsFeed = new GpsFeed(config.gpsUrl, (position) => this._onGps(position), (status) => {
        this.gps.status = status;
        this.notify(this._getFooter());
      });
    }
    if (config.placeIndexFile) {
      try {
        this.placeIndex = new PlaceIndex(config.placeIndexFile);
        this.tileSource.useIndex(this.placeIndex);
      } catch (error) {
        this.placeIndex = null;
      }
    }
    this.tileSource.onTileLoaded = () => {
      if (this.sourceError && this.tileSource.tileUrl) {
        this.sourceError = null;
      }
      this._draw();
    };
    return ready;
  }

  // Sets up the live layers
  _initLayers() {
    this.layers = new LayerManager({
      cacheDir: config.liveCacheDir || null,
      stateFile: config.layersFile || null,
      onChange: () => this._draw(),
      // traffic, fires and ships need keys (see --keys)
      keys: config.keysFile ? new (require('./Keys'))(config.keysFile) : null,
    });
    for (const Layer of LayerManager.ALL()) {
      this.layers.add(new Layer());
    }
    try {
      this.layers.restore(config.liveLayers || null);
    } catch (error) {
      this._showMessage(error.message, 5000);
    }
  }

  // Sets up the picture sources of the views
  _initViews() {
    const RasterSource = require('./RasterSource');
    const onLoad = () => this._draw();
    this.rasters = {
      imagery: new RasterSource('imagery', {cacheDir: config.pictureCacheDir || null, onLoad}),
      terrain: new RasterSource('terrain', {cacheDir: config.pictureCacheDir || null, onLoad}),
    };
    this.heading = 0;
    this.viewName = 'map';
    if (config.view && config.view !== 'map') this._setView(config.view);
  }

  // Switches to a view: map, satellite, hybrid, relief or 3d
  _setView(name) {
    if (!VIEWS.includes(name)) throw new Error(`no view "${name}" (there are: ${VIEWS.join(', ')})`);
    this.viewName = name;
    this.renderer.setView(name, this.rasters);
    this.renderer.heading = this.heading;
  }

  // The view for the layers: centre, zoom, size and bounds
  _view() {
    const columns = this.width / 2;
    const rows = this.height / 4;
    const nw = this._colrow2ll(0, 0);
    const se = this._colrow2ll(columns, rows);
    return {center: this.center, zoom: this.zoom, width: this.width, height: this.height,
      bounds: {north: nw.lat, west: nw.lon, south: se.lat, east: se.lon}};
  }

  // Reads keys from the terminal
  _initKeyboard() {
    if (!config.input.isTTY) {
      throw new Error('it needs an interactive terminal to read keys from (or use --headless)');
    }
    keypress(config.input);
    if (config.input.setRawMode) {
      config.input.setRawMode(true);
    }
    config.input.resume();

    config.input.on('keypress', (ch, key) => this._onKey(key, ch));
  }

  // Reads mouse clicks, drags and scrolling
  _initMouse() {
    this.mouse = TermMouse({
      input: config.input,
      output: config.output,
    });
    // term-mouse throws on input ending mid escape sequence (Alt+[ sends "ESC [")
    const parse = this.mouse._onData;
    this.mouse._onData = (data) => {
      try {
        parse(data);
      } catch (error) {
        // not a complete mouse event
      }
    };
    this.mouse.on('event', () => {
      this.message = null;
    });
    // term-mouse stops reading on Ctrl+C, so exit then
    this.mouse.on('ctrl-c', () => this._quit());
    this.mouse.start();

    this.mouse.on('click', (event) => this._onClick(event));
    this.mouse.on('scroll', (event) => this._onMouseScroll(event));
    this.mouse.on('move', (event) => this._onMouseMove(event));
  }

  // Ends the program after a second at most for writing new tiles to the disk
  _quit() {
    if (config.quitCallback) {
      config.quitCallback();
      return;
    }
    // flush new tiles to the disk cache (at most a second) so they aren't downloaded again
    const writes = this.tileSource ? this.tileSource.flushWrites() : Promise.resolve();
    const timeout = new Promise((resolve) => setTimeout(resolve, 1000));
    Promise.race([writes, timeout]).then(() => process.exit(0));
  }

  // Sets up the renderer with the style
  _initRenderer() {
    const style = JSON.parse(fs.readFileSync(config.styleFile, 'utf8'));
    this.renderer = new Renderer(config.output, this.tileSource, style);
    this.renderer.setOverlays(config.overlays);
    this._initViews();

    config.output.on('resize', () => {
      this._resizeRenderer();
      this._draw();
    });

    this._resizeRenderer();
    this.zoom = (config.initialZoom !== null) ? utils.clamp(config.initialZoom, this.minZoom, config.maxZoom) : this.minZoom;
  }

  // Fits the map to the terminal's size
  _resizeRenderer() {
    const columns = config.output.columns || 80;
    const rows = config.output.rows || 24;
    this.width = config.size && config.size.width ? config.size.width * 2 : columns >> 1 << 2;
    this.height = config.size && config.size.height ? config.size.height * 4 : rows * 4 - 4;

    this.minZoom = 4-Math.log(4096/this.width)/Math.LN2;

    this.renderer.setSize(this.width, this.height);
  }

  // The place at a terminal column and row
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

  // Remembers the place under the mouse
  _updateMousePosition(event) {
    this.mousePosition = this._colrow2ll(event.x, event.y);
  }

  // A click: shows a shortened name in full, or centres the map there
  _onClick(event) {
    if (event.x < 0 || event.x > this.width/2 || event.y < 0 || event.y > this.height/4) {
      return;
    }
    this._updateMousePosition(event);

    if (this.mouseDragging && event.button === 'left') {
      this.mouseDragging = false;
    } else {
      // a click on a shortened name shows it in full, a second shortens it; elsewhere it centres the map
      const name = this.renderer.labelAt(event.x - 1, event.y - 1);
      if (name && (name === this.expandedLabel || utils.shortenName(name, config.labelMaxWidth) !== name)) {
        this.expandedLabel = name === this.expandedLabel ? null : name;
      } else {
        this.expandedLabel = null;
        this.setCenter(this.mousePosition.lat, this.mousePosition.lon);
      }
      this.renderer.expandLabel(this.expandedLabel);
    }

    this._draw();
  }

  // Zooms around the mouse position
  _onMouseScroll(event) {
    this._updateMousePosition(event);

    // the location of the pointer, where we want to zoom toward
    const targetMouseLonLat = this._colrow2ll(event.x, event.y);

    // zoom toward the center
    this.zoomBy(config.zoomStep * (event.button === 'up' ? 1 : -1));

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

  // Drags the map
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

  // Handles a key on the map
  _onKey(key, ch) {
    if (config.keyCallback && !config.keyCallback(key)) return;
    if (this.message) {
      this.message = null;
      this.notify(this._getFooter());
    }
    if (this.prompt !== null) {
      return this._onPromptKey(key, ch);
    }
    if (ch === '/') {
      this.prompt = '';
      this.promptMode = 'search';
      this.promptError = null;
      this.searchResults = [];
      this.searchChoice = 0;
      this.notify(this._getFooter());
      return;
    }
    if ((ch === ',' || ch === '.') && this.viewName === '3d') {
      this.heading = (this.heading + (ch === '.' ? 20 : -20) + 360) % 360;
      this.renderer.heading = this.heading;
      this._draw();
      return;
    }
    if (ch === 'i' && this.viewName === '3d') {
      this.renderer.photo3d = !this.renderer.photo3d;
      this._showMessage(this.renderer.photo3d ? '3D in satellite colours (imagery tiles, ~25 KB each, a few a screen) - i again for height colours' : '3D in height colours', 3500);
      this._draw();
      return;
    }
    if (!key || !key.name) return;

    // check if the pressed key is configured
    let draw = true;
    switch (key.name) {
      case 'q':
        this._quit();
        break;
      case 'a':
        this.zoomBy(config.zoomStep);
        break;
      case 'y':
      case 'z':
        this.zoomBy(-config.zoomStep);
        break;
      case 'left':
      case 'h':
        this._stopFollowing();
        this.moveBy(0, -8/Math.pow(2, this.zoom));
        break;
      case 'right':
      case 'l':
        this._stopFollowing();
        this.moveBy(0, 8/Math.pow(2, this.zoom));
        break;
      case 'up':
      case 'k':
        this._stopFollowing();
        this.moveBy(6/Math.pow(2, this.zoom), 0);
        break;
      case 'down':
      case 'j':
        this._stopFollowing();
        this.moveBy(-6/Math.pow(2, this.zoom), 0);
        break;
      case 'c':
        config.useBraille = !config.useBraille;
        break;
      case 'f':
        if (!this.gps) {
          draw = false;
          break;
        }
        this.gps.follow = !this.gps.follow;
        if (this.gps.follow && this.gps.position) {
          this.setCenter(this.gps.position.lat, this.gps.position.lon);
        }
        this._showMessage(this.gps.follow ? 'following the GPS position' : 'not following the GPS position', 1500);
        break;
      case 'r':
        if (!this.marker) {
          this._showMessage('first mark where to go (g or /), then r', 3000);
          draw = false;
          break;
        }
        this._navigate({lat: this.marker.lat, lon: this.marker.lon, name: null});
        break;
      case 't': {
        if (!this.voice) this.voice = new Voice();
        if (!this.voice.available) {
          this._showMessage(process.platform === 'linux' ? 'No speech program found: install one with sudo apt install espeak-ng' : 'No speech program found on this computer', 5000);
          break;
        }
        this.voice.on = !this.voice.on;
        config.voice = this.voice.on;
        this._showMessage(this.voice.on ? `Voice on (${this.voice.name}): the turns are spoken when navigating` : 'Voice off', 3000);
        if (this.voice.on && this.navigator) {
          this.guidance.said.clear();
          this._guide();
        }
        break;
      }
      case 'v': {
        const next = VIEWS[(VIEWS.indexOf(this.viewName) + 1) % VIEWS.length];
        this._setView(next);
        this._showMessage(VIEW_NOTES[next], 3500);
        break;
      }
      case 'o':
        if (!this.layers) {
          draw = false;
          break;
        }
        this.prompt = '';
        this.promptMode = 'layers';
        this.promptError = null;
        this.notify(this._getFooter());
        draw = false;
        break;
      case 'm':
        if (!this.fieldNotes) {
          draw = false;
          break;
        }
        this.prompt = '';
        this.promptMode = 'note';
        this.promptError = null;
        this.notify(this._getFooter());
        draw = false;
        break;
      case 's':
        if (!this.savedPlaces) {
          draw = false;
          break;
        }
        this.prompt = '';
        this.promptMode = 'save';
        this.promptError = null;
        this.notify(this._getFooter());
        draw = false;
        break;
      case 'g':
        this.prompt = '';
        this.promptMode = 'goto';
        this.promptError = null;
        this.notify(this._getFooter());
        draw = false;
        break;
      case 'n':
      case 'p': {
        // the order is kept while the view stays, as showing a name in full moves others
        const view = `${this.center.lat},${this.center.lon},${this.zoom}`;
        if (!this.nameCycle || this.nameCycle.view !== view) {
          this.nameCycle = {view, names: this.renderer.shortenedNames()};
        }
        const names = this.nameCycle.names;
        const index = names.indexOf(this.expandedLabel);
        const step = key.name === 'p' ? -1 : 1;
        const name = !names.length ? null :
          index === -1 ? names[step > 0 ? 0 : names.length - 1] :
            names[(index + step + names.length) % names.length];
        if (!name) {
          this.expandedLabel = null;
          this.renderer.expandLabel(null);
          this._showMessage('no shortened names on the screen', 2000);
          draw = false;
          break;
        }
        this.expandedLabel = name;
        this.renderer.expandLabel(name);
        break;
      }
      case 'escape':
        if (this.expandedLabel) {
          this.expandedLabel = null;
          this.renderer.expandLabel(null);
        } else if (this.navigator) {
          this.navigator.stopped = true;
          this.navigator = null;
        } else if (this.marker) {
          this.marker = null;
        } else {
          draw = false;
        }
        break;
      default:
        draw = false;
    }

    if (draw) {
      this._draw();
    }
  }

  // Handles a key while a prompt (search, go to, note, save) or the layer menu is open
  _onPromptKey(key, ch) {
    const name = key && key.name;
    const search = this.promptMode === 'search';
    if (this.promptMode === 'layers') {
      // a number toggles a layer; other keys close the menu and act on the map, except Esc, Enter and o
      const n = ch && /^[1-9]$/.test(ch) ? +ch : null;
      if (n && this.layers.layers[n - 1]) {
        this.layers.toggle(this.layers.layers[n - 1].id);
        this.notify(this._getFooter());
        return;
      }
      this.prompt = null;
      this.notify(this._getFooter());
      if (name === 'escape' || name === 'return' || name === 'enter' || ch === 'o') return;
      return this._onKey(key, ch);
    }
    if (name === 'escape' || (key && key.ctrl && name === 'c')) {
      this.prompt = null;
      this.promptError = null;
    } else if (name === 'return' || name === 'enter') {
      if (search) {
        this._goToResult();
      } else if (this.promptMode === 'save') {
        this._saveInput();
      } else if (this.promptMode === 'note') {
        this._noteInput();
      } else {
        this._goToInput(this.prompt);
      }
    } else if (search && name === 'tab') {
      const count = this.searchResults.length;
      if (count) {
        this.searchChoice = (this.searchChoice + (key.shift ? count - 1 : 1)) % count;
      }
    } else if (name === 'backspace') {
      this.prompt = this.prompt.slice(0, -1);
      this.promptError = null;
      if (search) this._search();
    } else if (ch && ch.length === 1 && ch >= ' ' && !(key && (key.ctrl || key.meta)) && this.prompt.length < 2000) {
      this.prompt += ch;
      this.promptError = null;
      if (search) this._search();
    }
    this.notify(this._getFooter());
  }

  // Updates the search results for the prompt's text
  _search() {
    this.searchChoice = 0;
    const saved = this.savedPlaces ? this.savedPlaces.search(this.prompt) : [];
    let notes = [];
    try {
      notes = this.fieldNotes ? this.fieldNotes.search(this.prompt).map((note) => ({name: note.title, kind: 'note', lat: note.lat, lon: note.lon, zoom: 16})) : [];
    } catch (error) {
      void 0;
    }
    let found = [];
    try {
      found = this.placeIndex ? this.placeIndex.search(this.prompt, {near: this.center}) : [];
    } catch (error) {
      void 0;
    }
    const devices = this.fleet ? [...this.fleet.devices.values()]
      .filter((d) => PlaceIndex.normalize(d.name).includes(PlaceIndex.normalize(this.prompt)))
      .map((d) => ({name: d.name, kind: 'device', lat: d.lat, lon: d.lon, zoom: 16})) : [];
    const live = this.layers ? this.layers.search(this.prompt) : [];
    this.searchResults = devices.concat(saved, notes, live, found).slice(0, 20);
  }

  // A new GPS position: the map follows it unless the user panned away
  _onGps(position) {
    const gps = this.gps;
    gps.position = position;
    gps.at = Date.now();
    if (config.navigateTo && !this.navigator && !this.navigationStarted) {
      this.navigationStarted = true;
      this._navigate(config.navigateTo);
    }
    if (this.navigator) {
      this.navigator.update(position);
      this._guide();
    }
    const last = gps.track[gps.track.length - 1];
    if (!last || Gpx.length([last, position]) * 1000 >= 3) {
      gps.track.push({lat: position.lat, lon: position.lon});
      // a very long session keeps its latest points
      if (gps.track.length > config.gpsTrackPoints) {
        gps.track = gps.track.slice(-Math.floor(config.gpsTrackPoints * 0.9));
      }
    }
    if (gps.follow) {
      this.setCenter(position.lat, position.lon);
      if (!gps.shownFirst && config.gpsZoomIn) {
        this.zoom = Math.max(this.zoom, config.goToZoom);
      }
      gps.shownFirst = true;
    }
    this._draw();
  }

  // Routes to a destination: live navigation from the GPS position, else from the map's centre
  _navigate(destination) {
    if (this.navigator) this.navigator.stopped = true;
    const Router = require('./Router');
    const from = (this.gps && this.gps.position) || this.center;
    const navigator = new Navigator(new Router(this.tileSource), destination, {
      mode: config.navigateBy || 'car',
      onChange: () => {
        if (navigator.stopped) return;
        this._guide();
        this._draw();
      },
    });
    this.navigator = navigator;
    this.guidance = new Guidance(config.navigateBy || 'car', destination.name || null);
    if (!this.voice) {
      this.voice = new Voice();
      this.voice.on = config.voice !== false;
    }
    this.marker = {lat: destination.lat, lon: destination.lon};
    navigator.plan(from);
  }

  // Says what the voice should say now, if anything
  _guide() {
    if (!this.navigator || !this.guidance) return;
    const text = this.guidance.update(this.navigator.state, this.navigator.route);
    if (text && this.voice) this.voice.say(text);
  }

  // Stops following the GPS position
  _stopFollowing() {
    if (this.gps && this.gps.follow) {
      this.gps.follow = false;
    }
  }

  // Where a new note or saved place goes: the marker, else the GPS position, else the centre
  _herePlace() {
    return this.marker || (this.gps && this.gps.position) || this.center;
  }

  // _herePlace in words
  _herePlaceName() {
    return this.marker ? `the ${config.locationMarker}` : this.gps && this.gps.position ? 'your GPS position' : 'the centre';
  }

  // Adds a field note at _herePlace, titled with the prompt's text
  _noteInput() {
    const place = this._herePlace();
    try {
      const note = this.fieldNotes.add({lat: place.lat, lon: place.lon, title: this.prompt});
      this.prompt = null;
      this.promptError = null;
      this._showMessage(`Noted "${note.title}" - add details with: notes edit ${note.id.slice(0, 10)} --text "..."`, 4000);
      this._draw();
    } catch (error) {
      this.promptError = error.message;
    }
  }

  // the notes file is re-read when it changes (e.g. by the notes tool), at most once a second
  _overlays() {
    const result = (config.overlays || []).slice();
    if (this.fieldNotes) {
      if (!this.notesSeen || Date.now() - this.notesSeen.at > 1000) {
        let mtime = 0;
        try {
          mtime = fs.statSync(config.notesFile).mtimeMs;
        } catch (error) {
          void 0;
        }
        if (!this.notesSeen || mtime !== this.notesSeen.mtime) {
          let notes = [];
          try {
            notes = this.fieldNotes.list();
          } catch (error) {
            void 0;
          }
          this.notesOverlay = {
            points: notes.map((note) => ({lat: note.lat, lon: note.lon, name: note.title})),
            color: config.notesColor,
            marker: config.noteMarker,
          };
        }
        this.notesSeen = {at: Date.now(), mtime};
      }
      result.push(this.notesOverlay);
    }
    if (this.fleet && this.fleet.devices.size) {
      const points = [...this.fleet.devices.values()].map((d) => {
        const age = (Date.now() - d.heard) / 1000;
        return {lat: d.lat, lon: d.lon, name: age > config.fleetStale ? `${d.name} (${age < 5400 ? `${Math.round(age / 60)} min` : `${Math.round(age / 3600)} h`})` : d.name};
      });
      result.push({points, color: config.fleetColor, marker: config.fleetMarker});
    }
    if (this.layers) {
      result.push(...this.layers.overlays());
    }
    if (this.navigator && this.navigator.route) {
      result.push({lines: [this.navigator.remaining()], color: config.routeColor});
    }
    if (this.gps && this.gps.position) {
      const {lat, lon} = this.gps.position;
      result.push({lines: [this.gps.track], points: [{lat, lon}], color: config.gpsColor, marker: config.gpsMarker});
    }
    return result;
  }

  // Saves _herePlace under the prompt's name
  _saveInput() {
    const place = this._herePlace();
    try {
      const saved = this.savedPlaces.save(this.prompt, place.lat, place.lon, this.zoom);
      this.prompt = null;
      this.promptError = null;
      this._showMessage(`Saved "${saved.name}" - find it with /`, 3000);
    } catch (error) {
      this.promptError = error.message;
    }
  }

  // Goes to the chosen search result
  _goToResult() {
    const place = this.searchResults[this.searchChoice];
    if (!place) {
      return;
    }
    this.prompt = null;
    this.promptError = null;
    if (place.onSelect) place.onSelect();
    this.goTo(place.lat, place.lon, place.zoom);
    this._showMessage(`${place.name} (${place.kind})`, 3000);
  }

  // Goes to what was typed into the go-to prompt
  _goToInput(text) {
    let place;
    try {
      place = resolvePlace(text, {savedPlaces: this.savedPlaces, placeIndex: this.placeIndex, near: this.center});
    } catch (error) {
      // keep the prompt open so the input can be corrected
      this.promptError = error.message;
      return;
    }
    this.prompt = null;
    this.promptError = null;
    this.goTo(place.lat, place.lon, place.zoom);
  }

  // without a zoom, zooms in to config.goToZoom unless already further in
  goTo(lat, lon, zoom) {
    this.marker = utils.normalize({lat, lon});
    this.setCenter(lat, lon);
    const target = zoom !== undefined ? zoom : Math.max(this.zoom, config.goToZoom);
    this.zoom = utils.clamp(target, this.minZoom, config.maxZoom);
    this._draw();
  }

  // Combines many requests (key repeat, drags, arriving tiles) into one frame, at most config.maxFps a second.
  _draw() {
    if (this.drawTimer) {
      return;
    }
    const wait = Math.max(0, this.lastDrawAt + 1000 / config.maxFps - Date.now());
    this.drawTimer = setTimeout(() => {
      this.drawTimer = null;
      this.lastDrawAt = Date.now();
      if (this.layers) this.layers.setView(this._view());
      this.renderer.setOverlays(this._overlays());
      this.renderer.draw(this.center, this.zoom, this.marker ? [this.marker] : []).then((frame) => {
        this._write(frame);
        this.notify(this._getFooter());
      }).catch(() => {
        this.notify('renderer is busy');
      });
    }, wait);
  }

  // The marker's plus code with the nearest town, worked out once per marker
  _markerAddress() {
    const {lat, lon} = this.marker;
    if (!this.markerAddress || this.markerAddress.lat !== lat || this.markerAddress.lon !== lon) {
      let town = null;
      try {
        town = this.placeIndex ? this.placeIndex.nearest(lat, lon, {limit: 1})[0] : null;
      } catch (error) {
        void 0;
      }
      this.markerAddress = {lat, lon, text: PlusCode.address(lat, lon, town || null)};
    }
    return this.markerAddress.text;
  }

  // "GPS ±8 m 12 km/h following", or why there is no position
  _gpsFooter() {
    const gps = this.gps;
    if (!gps.position) {
      return `GPS: ${gps.status}`;
    }
    const age = (Date.now() - gps.at) / 1000;
    const parts = ['GPS'];
    if (gps.status !== 'live') {
      parts.push(`(${gps.status})`);
    } else if (age > 30) {
      parts.push(`(no position for ${age < 120 ? `${Math.round(age)} s` : `${Math.round(age / 60)} min`})`);
    }
    if (gps.position.accuracy !== undefined) parts.push(`±${Math.round(gps.position.accuracy)} m`);
    if (gps.position.speed !== undefined && gps.position.speed >= 1) parts.push(`${Math.round(gps.position.speed)} km/h`);
    if (gps.follow) parts.push('following');
    return parts.join(' ');
  }

  // The search prompt with its current result
  _searchFooter() {
    const results = this.searchResults;
    let status;
    if (!this.placeIndex) {
      status = 'search is not available (it needs Node.js 22.5 or later)';
    } else if (!this.prompt) {
      status = 'type a place name - your saved places and all maps seen so far, offline';
    } else if (!results.length) {
      status = 'no such name in the maps seen so far';
    } else {
      const place = results[this.searchChoice];
      status = `${this.searchChoice + 1}/${results.length} ${place.name} (${place.kind})${results.length > 1 ? ' - Tab: next' : ''} - Enter: go`;
    }
    const line = `Search: ${this.prompt}█   ${status}`;
    const columns = config.output.columns || 0;
    return columns ? utils.fitWidth(line, columns - 1) : line;
  }

  // The footer line: a prompt, a message, navigation or the status
  _getFooter() {
    // tile = utils.ll2tile(this.center.lon, this.center.lat, this.zoom);
    // `tile: ${utils.digits(tile.x, 3)}, ${utils.digits(tile.x, 3)}   `+

    if (this.message && Date.now() < this.messageUntil) {
      return this.message;
    }
    if (this.prompt !== null && this.promptMode === 'search') {
      return this._searchFooter();
    }
    if (this.prompt !== null && this.promptMode === 'layers') {
      // compact so all seven fit in 80 columns; the legend if there is room
      const list = this.layers.layers.map((l, i) => `${i + 1}${l.on ? '+' : '-'}${l.name}`).join(' ');
      const width = config.output.columns ? config.output.columns - 1 : 200;
      const legend = ['   (+ on, - off: a number switches, Esc when done)', '   (a number switches)', ''].find((tail) => list.length + tail.length <= width);
      return utils.fitWidth(list + legend, width);
    }
    if (this.prompt !== null && this.promptMode === 'note') {
      const what = this._herePlaceName();
      const line = `Note: ${this.prompt}█   ${this.promptError || `a title for a note at ${what} - Enter: save, Esc: cancel`}`;
      return config.output.columns ? utils.fitWidth(line, config.output.columns - 1) : line;
    }
    if (this.prompt !== null && this.promptMode === 'save') {
      const what = this._herePlaceName();
      const line = `Save as: ${this.prompt}█   ${this.promptError || `name for ${what} - Enter: save, Esc: cancel`}`;
      return config.output.columns ? utils.fitWidth(line, config.output.columns - 1) : line;
    }
    if (this.prompt !== null) {
      const help = this.promptError || 'e.g. 42.3601, -71.0942, 48°51\'24"N 2°21\'8"E, a plus code or a place - Enter to go, Esc to cancel';
      const columns = config.output.columns || 0;
      // long input scrolls so the cursor stays visible
      let input = this.prompt;
      const room = Math.max(10, columns - 12 - Math.min(help.length, 40));
      if (columns && input.length > room) {
        input = '…' + input.slice(-(room - 1));
      }
      const line = `Go to: ${input}█   ${help}`;
      return columns ? line.slice(0, columns - 1) : line;
    }

    let footer = this.navigator ? `${this.navigator.summary()}${this.voice && !this.voice.on ? ' (voice off: t)' : ''}   ` : '';
    footer += `center: ${utils.digits(this.center.lat, 3)}, ${utils.digits(this.center.lon, 3)} `;
    footer += `  zoom: ${utils.digits(this.zoom, 2)} `;
    if (this.mousePosition.lat !== undefined) {
      footer += `  mouse: ${utils.digits(this.mousePosition.lat, 3)}, ${utils.digits(this.mousePosition.lon, 3)} `;
    }
    if (this.marker) {
      footer += `  ${config.locationMarker} ${utils.digits(this.marker.lat, 5)}, ${utils.digits(this.marker.lon, 5)} ${this._markerAddress()} `;
    }
    if (this.gps) {
      footer += `  ${this._gpsFooter()} `;
    }
    const live = this.layers ? this.layers.footer() : '';
    if (live) {
      footer += `  ${live} `;
    }
    if (this.fleet) {
      const devices = [...this.fleet.devices.values()];
      const stale = devices.filter((d) => (Date.now() - d.heard) / 1000 > config.fleetStale).length;
      footer += this.fleet.status === 'live' || devices.length ?
        `  fleet: ${devices.length} device${devices.length === 1 ? '' : 's'}${stale ? `, ${stale} not heard of for ${Math.round(config.fleetStale / 60)} min` : ''} ` :
        `  fleet: ${this.fleet.status} `;
    }
    const used = TileSource.meter.sessionBytes();
    if (used > 0) {
      footer += `  ↓ ${DataMeter.format(used)} `;
    }
    if (this.expandedLabel && this.renderer.shortenedNames().includes(this.expandedLabel)) {
      footer += `  ${this.expandedLabel} `;
    }
    if (this.sourceError) {
      footer += `  ${this.sourceError} `;
    }
    const pending = this.renderer.pendingTiles();
    if (pending) {
      footer += `  loading ${pending} tile${pending > 1 ? 's' : ''}… `;
    }
    if (this.viewName !== 'map') {
      const pending = this.renderer.pendingPictures();
      const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(this.heading / 45) % 8];
      const failed = this.renderer.failedPictures();
      footer += `  [${this.viewName}${this.viewName === '3d' ? ` looking ${compass}` : ''}${this.viewName === '3d' && this.renderer.photo3d ? ' in satellite colours' : ''}]` +
        `${pending ? ` loading ${pending} picture${pending === 1 ? '' : 's'}…` : ''}` +
        `${failed && !pending ? ` ${failed} picture${failed === 1 ? '' : 's'} missing, retrying` : ''} `;
    }
    if (this.renderer.sparse() && this.viewName === 'map') {
      const other = /mapscii\.me/.test(this.tileSource.source) ? ', or try --tile_source openfreemap' : '';
      // closer zoom shows no more: the land there isn't mapped
      footer += this.zoom >= 12 ?
        `  little is mapped here: zoom out with z to find roads and towns${other} ` :
        `  few map details here at this zoom: zoom in with a${other} `;
    }
    const failed = this.renderer.failedTiles();
    if (failed.count && !this.sourceError) {
      footer += `  ${failed.count} tile${failed.count > 1 ? 's' : ''} missing (${failed.reason}), retrying `;
    }
    // the attribution, right-aligned if there is room
    const view = this.viewName;
    const credits = [];
    if (view === 'satellite' || view === 'hybrid' || (view === '3d' && this.renderer.photo3d)) credits.push(this.rasters.imagery.attribution);
    if (view === 'relief' || view === '3d') credits.push(this.rasters.terrain.attribution);
    if (view !== '3d' && view !== 'satellite' && this.tileSource.attribution) credits.push(this.tileSource.attribution);
    const attribution = credits.join('; ');
    if (attribution) {
      // it would wrap the line; it is shown in full at startup
      const space = (config.output.columns || 0) - 1 - footer.length - attribution.length;
      if (space > 0) {
        footer += ' '.repeat(space) + attribution;
      }
    }
    return footer;
  }

  // Writes a line of text under the map
  notify(text) {
    config.onUpdate && config.onUpdate();
    if (!config.headless) {
      this._write('\r\x1B[K' + utils.fitWidth(text, (config.output.columns || Infinity) - 1));
    }
  }

  // Writes to the terminal
  _write(output) {
    config.output.write(output);
  }

  // Zooms by a step within the zoom limits
  zoomBy(step) {
    if (this.zoom+step < this.minZoom) {
      return this.zoom = this.minZoom;
    }
    if (this.zoom+step > config.maxZoom) {
      return this.zoom = config.maxZoom;
    }

    this.zoom += step;
  }

  // Moves the map by degrees
  moveBy(lat, lon) {
    this.setCenter(this.center.lat+lat, this.center.lon+lon);
  }

  // Centres the map on a place
  setCenter(lat, lon) {
    this.center = utils.normalize({
      lon: lon,
      lat: lat,
    });
  }
}

module.exports = Mapscii;
