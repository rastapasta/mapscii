// MapSCII's live layers with their state in local storage. Aircraft servers block browsers.
'use strict';
const {LayerManager} = require('../../src/layers/LayerManager');

const PREFIX = 'layer-cache:';

class AppLayerManager extends LayerManager {
  constructor(options) {
    super(Object.assign({cacheDir: null, stateFile: null}, options));
  }

  // Switches on the layers that were on last time
  restoreSaved() {
    let ids = [];
    try {
      ids = JSON.parse(localStorage.getItem('layers-on') || '[]');
    } catch (error) {
      ids = [];
    }
    for (const id of ids) {
      const layer = this.get(id);
      if (layer) layer.start();
    }
  }

  // Saves which layers are on
  _save() {
    try {
      localStorage.setItem('layers-on', JSON.stringify(this.layers.filter((l) => l.on).map((l) => l.id)));
    } catch (error) {
      void 0;
    }
  }

  // A layer's cached data: [text, age in seconds], or [null, null]
  readCache(name) {
    try {
      const saved = JSON.parse(localStorage.getItem(PREFIX + name) || 'null');
      if (!saved) return [null, null];
      return [saved.text, (Date.now() - saved.at) / 1000];
    } catch (error) {
      return [null, null];
    }
  }

  // Saves a layer's data for offline use
  writeCache(name, text) {
    try {
      localStorage.setItem(PREFIX + name, JSON.stringify({text, at: Date.now()}));
    } catch (error) {
      // storage full: the layer works without its offline copy
      void 0;
    }
  }
}

// The layers the app offers
function makeLayers(onChange) {
  const manager = new AppLayerManager({onChange});
  for (const Layer of [require('../../src/layers/Satellites'), require('../../src/layers/Earthquakes'), require('../../src/layers/Aircraft'), require('../../src/layers/Weather')]) {
    manager.add(new Layer());
  }
  const aircraft = manager.get('aircraft');
  if (aircraft) {
    aircraft.browserBlocked = true;
    aircraft.refresh = async () => {
      throw new Error('only in the APK version');
    };
  }
  return manager;
}

module.exports = {makeLayers, AppLayerManager};
