// Earthquakes of the last day, magnitude 2.5+, from the USGS.
'use strict';
const {Layer} = require('./LayerManager');

const URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';

class Earthquakes extends Layer {
  constructor() {
    super('quakes', 'earthquakes', {aliases: ['earthquakes'], every: 600});
    this.quakes = [];
  }

  // Fetches the USGS feed, falling back to the cached copy offline
  async refresh() {
    let data;
    try {
      data = await this.manager.fetchJson(URL);
      // a damaged answer mustn't replace the good copy
      if (!data || !Array.isArray(data.features)) throw new Error('the USGS sent no list of quakes');
      this.manager.writeCache('usgs-2.5_day.geojson', JSON.stringify(data));
      this.updated = Date.now();
      this.status = 'live';
    } catch (error) {
      const [text, age] = this.manager.readCache('usgs-2.5_day.geojson');
      if (!text) throw error;
      data = JSON.parse(text);
      this.updated = Date.now() - age * 1000;
      this.status = 'offline';
    }
    this.quakes = Earthquakes.read(data);
  }

  // A USGS GeoJSON feed to [{lat, lon, depth, mag, place, time}]
  static read(data) {
    return (Array.isArray(data && data.features) ? data.features : []).filter((f) => f && typeof f === 'object').map((f) => {
      const [lon, lat, depth] = (f.geometry && f.geometry.coordinates) || [];
      const p = f.properties || {};
      return {lat, lon, depth, mag: p.mag, place: p.place || '', time: p.time};
    }).filter((q) => Number.isFinite(q.lat) && Number.isFinite(q.lon) && Number.isFinite(q.mag));
  }

  // Quakes labelled with magnitude and age; magnitude 5+ stand out
  overlays() {
    const label = (q) => `M${q.mag.toFixed(1)} ${ago(q.time)}`.trim();
    const strong = this.quakes.filter((q) => q.mag >= 5);
    const other = this.quakes.filter((q) => q.mag < 5);
    return [
      {points: other.map((q) => ({lat: q.lat, lon: q.lon, name: label(q)})), color: '#ffaf00', marker: '◎'},
      {points: strong.map((q) => ({lat: q.lat, lon: q.lon, name: label(q)})), color: '#ff5f5f', marker: '◉'},
    ];
  }

  // The footer text: count and the strongest quake
  footer() {
    if (!this.quakes.length) return `${this.name}: ${this.status}`;
    const top = this.quakes.reduce((a, b) => (b.mag > a.mag ? b : a));
    const old = this.age();
    return `◎ ${this.quakes.length} quakes in 24 h, strongest M${top.mag.toFixed(1)} ${top.place}${old ? ` (${old})` : ''}`;
  }

  // Quakes whose place matches the text, strongest first
  search(text) {
    const q = String(text).toLowerCase();
    return this.quakes.filter((x) => q && (x.place.toLowerCase().includes(q) || (q === 'quake' || q === 'earthquake')))
      .sort((a, b) => b.mag - a.mag).slice(0, 5)
      .map((x) => ({name: `M${x.mag.toFixed(1)} ${x.place}`, kind: 'earthquake', lat: x.lat, lon: x.lon, zoom: 7}));
  }
}

// "12 min", "3 h": how long ago a time was
function ago(ms) {
  if (!Number.isFinite(ms)) return '';
  const s = (Date.now() - ms) / 1000;
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : `${Math.round(s / 3600)} h`;
}

module.exports = Earthquakes;
