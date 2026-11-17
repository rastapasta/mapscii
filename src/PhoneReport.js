// Positions sent by phone apps over HTTP: GPSLogger, OwnTracks, or any lat/lon query, form or JSON.
'use strict';

// Resolves with {position (or null), device, token}; never rejects.
function readReport(req, url) {
  return new Promise((resolve) => {
    let body = '';
    let done = false;
    const finish = (text) => {
      if (done) return;
      done = true;
      try {
        resolve(parse(req, url, text));
      } catch (error) {
        resolve({position: null, device: 'unknown', token: null});
      }
    };
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 100000) {
        body = '';
        req.destroy();
        finish('');
      }
    });
    req.on('end', () => finish(body));
    req.on('error', () => finish(''));
    req.on('close', () => finish(body));
  });
}

// A time as ISO text, or undefined
function isoTime(value) {
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
  const ms = date.getTime();
  return Number.isFinite(ms) && Math.abs(ms) < 8.64e15 ? date.toISOString() : undefined;
}

// The position and device of a GPSLogger, OwnTracks or plain JSON report
function parse(req, url, body) {
  const params = Object.fromEntries(url.searchParams);
  if (/application\/x-www-form-urlencoded/.test(req.headers['content-type'] || '')) {
    Object.assign(params, Object.fromEntries(new URLSearchParams(body)));
  }
  let json = null;
  if ((body && /json/.test(req.headers['content-type'] || '')) || /^\s*\{/.test(body)) {
    try {
      json = JSON.parse(body);
    } catch (error) {
      void 0;
    }
  }
  const token = params.token || (json && json.token) || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  let p = null;
  let device = params.id || params.device || params.name || params.ser || null;
  if (json && json._type === 'location') {
    // OwnTracks
    p = {lat: +json.lat, lon: +json.lon, time: json.tst ? isoTime(+json.tst * 1000) : undefined};
    if (json.acc !== undefined) p.accuracy = +json.acc;
    if (json.vel !== undefined) p.speed = +json.vel;
    if (json.cog !== undefined) p.course = +json.cog;
    if (json.alt !== undefined) p.altitude = +json.alt;
    device = device || (req.headers['x-limit-u'] && req.headers['x-limit-d'] ? `${req.headers['x-limit-u']}/${req.headers['x-limit-d']}` : null) ||
      (json.topic ? String(json.topic).split('/').slice(-2).join('/') : null) || json.tid || null;
  } else if (json && json.lat !== undefined && json.lon !== undefined) {
    p = {lat: +json.lat, lon: +json.lon, time: json.time ? isoTime(json.time) : undefined};
    for (const key of ['accuracy', 'speed', 'course', 'altitude']) {
      if (json[key] !== undefined) p[key] = +json[key];
    }
    device = device || json.device || json.name || null;
  } else if (params.lat !== undefined && params.lon !== undefined) {
    // GPSLogger and the like: ?lat=..&lon=..&time=..&spd=..&acc=..&alt=..
    p = {lat: +params.lat, lon: +params.lon};
    const time = params.time || params.timestamp;
    if (time) {
      const iso = /^\d+$/.test(time) ? isoTime(+time * (time.length > 11 ? 1 : 1000)) : isoTime(time);
      if (iso) p.time = iso;
    }
    const speed = params.spd !== undefined ? params.spd : params.speed;
    if (speed !== undefined && speed !== '') p.speed = +speed * 3.6;
    if (params.acc !== undefined && params.acc !== '') p.accuracy = +params.acc;
    if (params.alt !== undefined && params.alt !== '') p.altitude = +params.alt;
    if (params.dir !== undefined && params.dir !== '') p.course = +params.dir;
  }
  if (p) {
    for (const key of Object.keys(p)) {
      if (p[key] === undefined || (typeof p[key] === 'number' && !Number.isFinite(p[key]))) delete p[key];
    }
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) p = null;
  }
  return {position: p, device: device ? String(device).slice(0, 60) : (req.socket && req.socket.remoteAddress) || 'unknown', token};
}

module.exports = {readReport, parse, isoTime};
