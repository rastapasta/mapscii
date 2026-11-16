// A small GPX reader: tracks, routes and waypoints.
'use strict';

const entities = {amp: '&', lt: '<', gt: '>', quot: '"', apos: '\''};

// An element's text: tags removed, entities decoded, CDATA kept as it is
function text(xml) {
  return xml.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/).map((part) => {
    if (part.startsWith('<![CDATA[')) {
      return part.slice(9, -3);
    }
    return part
      .replace(/<[^>]+>/g, '')
      // one pass: "&amp;#65;" is "&#65;", not "A"
      .replace(/&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9a-f]+));/gi, (m, name, dec, hex) => {
        if (name) return entities[name] || m;
        const code = dec ? parseInt(dec, 10) : parseInt(hex, 16);
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\ufffd';
      });
  }).join('').trim();
}

// The value of an attribute in a tag, or undefined
function attribute(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(["'])([^"']*)\\1`));
  return m ? m[2] : undefined;
}

// The element's own <name>, not one of its points'
function nameOf(content) {
  const own = content.replace(/<(trkseg|trkpt|rtept|wpt)[\s>][\s\S]*?<\/\1>/g, '');
  const m = own.match(/<name>([\s\S]*?)<\/name>/);
  return m ? text(m[1]) : undefined;
}

// The points of the elements with this tag: [{lat, lon, ele, time, name}]
function points(xml, tag) {
  const result = [];
  const re = new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g');
  let m;
  while ((m = re.exec(xml))) {
    const lat = parseFloat(attribute(m[1], 'lat'));
    const lon = parseFloat(attribute(m[1], 'lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const point = {lat, lon};
    const body = m[2] || '';
    const ele = body.match(/<ele>([\s\S]*?)<\/ele>/);
    if (ele && Number.isFinite(parseFloat(text(ele[1])))) point.ele = parseFloat(text(ele[1]));
    const time = body.match(/<time>([\s\S]*?)<\/time>/);
    if (time) point.time = text(time[1]);
    const name = body.match(/<name>([\s\S]*?)<\/name>/);
    if (name) point.name = text(name[1]);
    result.push(point);
  }
  return result;
}

// every track segment and route becomes a track
function parse(xml) {
  if (!/<gpx[\s>]/.test(xml)) {
    throw new Error('not a GPX file');
  }
  const tracks = [];
  for (const [, content] of xml.matchAll(/<trk\b[^>]*>([\s\S]*?)<\/trk>/g)) {
    const name = nameOf(content);
    for (const [, segment] of content.matchAll(/<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/g)) {
      tracks.push({name, points: points(segment, 'trkpt')});
    }
  }
  for (const [, content] of xml.matchAll(/<rte\b[^>]*>([\s\S]*?)<\/rte>/g)) {
    tracks.push({name: nameOf(content), points: points(content, 'rtept')});
  }
  const metadata = xml.match(/<metadata\b[^>]*>([\s\S]*?)<\/metadata>/);
  return {
    name: metadata ? nameOf(metadata[1]) : undefined,
    tracks: tracks.filter((track) => track.points.length),
    waypoints: points(xml, 'wpt'),
  };
}

// The length of a line of points, in km
function length(line) {
  let km = 0;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const rad = Math.PI / 180;
    const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
    km += 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  return km;
}

// [west, south, east, north] or null; across the date line west > 180 (Fiji: [178.5, -18.2, 181.4, -17.7])
function bounds(all) {
  if (!all.length) {
    return null;
  }
  // loops: too many points to spread into Math.min
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const shifted = [Infinity, -Infinity];
  for (const p of all) {
    box[0] = Math.min(box[0], p.lon);
    box[1] = Math.min(box[1], p.lat);
    box[2] = Math.max(box[2], p.lon);
    box[3] = Math.max(box[3], p.lat);
    const lon = p.lon < 0 ? p.lon + 360 : p.lon;
    shifted[0] = Math.min(shifted[0], lon);
    shifted[1] = Math.max(shifted[1], lon);
  }
  if (shifted[1] - shifted[0] < box[2] - box[0]) {
    box[0] = shifted[0];
    box[2] = shifted[1];
  }
  return box;
}

module.exports = {parse, length, bounds};
