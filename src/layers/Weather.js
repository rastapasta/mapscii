// The weather at the map's centre from Open-Meteo (CC BY 4.0, which asks for the credit shown in the footer).
'use strict';
const {Layer} = require('./LayerManager');
const Gpx = require('../Gpx');

const CODES = [
  [[0], '☀', 'clear'], [[1, 2], '⛅', 'partly cloudy'], [[3], '☁', 'cloudy'], [[45, 48], '≋', 'fog'],
  [[51, 53, 55, 56, 57], '☂', 'drizzle'], [[61, 63, 65, 66, 67, 80, 81, 82], '☔', 'rain'],
  [[71, 73, 75, 77, 85, 86], '❄', 'snow'], [[95, 96, 99], '⚡', 'thunderstorm'],
];
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

class Weather extends Layer {
  constructor() {
    super('weather', 'weather', {every: 1200});
    this.now = null;
  }

  // Asks again when the view moved 25 km
  viewChanged() {
    const view = this.manager.view;
    if (!view || (this.lastAsk && Date.now() - this.lastAsk < 10000)) return;
    // the layer may start before the first view
    if (!this.at || Gpx.length([this.at, view.center]) > 25) this._refreshSoon(1);
  }

  // Fetches the current weather at the map's centre
  async refresh() {
    const view = this.manager.view;
    if (!view) return;
    const {lat, lon} = view.center;
    this.lastAsk = Date.now();
    const data = await this.manager.fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,precipitation`);
    this.now = Weather.read(data);
    this.at = {lat, lon};
    this.updated = Date.now();
    this.status = 'live';
  }

  // Open-Meteo's answer to {temp, code, symbol, words, wind, from, rain}
  static read(data) {
    const c = (data && data.current) || {};
    const kind = CODES.find(([codes]) => codes.includes(c.weather_code)) || [[], '·', 'unknown'];
    return {
      temp: c.temperature_2m, code: c.weather_code, symbol: kind[1], words: kind[2],
      wind: c.wind_speed_10m, from: Number.isFinite(c.wind_direction_10m) ? COMPASS[Math.round(c.wind_direction_10m / 45) % 8] : '',
      rain: c.precipitation,
    };
  }

  // The footer text: the weather now
  footer() {
    if (!this.now) return `weather: ${this.status}`;
    const w = this.now;
    const old = this.age();
    const temp = Number.isFinite(w.temp) ? ` ${Math.round(w.temp)}°C` : '';
    const wind = Number.isFinite(w.wind) ? `, wind ${Math.round(w.wind)} km/h ${w.from}` : '';
    return `${w.symbol}${temp} ${w.words}${wind}${old ? ` (${old})` : ''} - Weather data by Open-Meteo.com`;
  }
}

module.exports = Weather;
