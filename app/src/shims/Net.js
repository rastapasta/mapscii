/* Net with the browser's fetch, counting the bytes downloaded */
'use strict';
let bytes = 0;
const meter = {
  sessionBytes: () => bytes,
  watch: () => null,
  save: () => null,
};

// Fetches a URL into a Buffer
async function fetchBuffer(url, headers = {}) {
  let res;
  try {
    res = await fetch(url, {headers});
  } catch (caught) {
    throw Object.assign(new Error(`no connection for ${url}`), {type: 'system'});
  }
  if (!res.ok) {
    throw Object.assign(new Error(`could not load ${url}: HTTP ${res.status}`), {status: res.status, retry: res.status >= 500});
  }
  // a Buffer, as Node's fetch gives: the picture decoders use its methods
  const data = Buffer.from(await res.arrayBuffer());
  bytes += data.length;
  return data;
}

// Fetches JSON
async function fetchJson(url, headers = {}) {
  return JSON.parse(new TextDecoder().decode(await fetchBuffer(url, headers)));
}

// Fetches text
async function fetchText(url, headers = {}) {
  return new TextDecoder().decode(await fetchBuffer(url, headers));
}

module.exports = {fetchBuffer, fetchJson, fetchText, meter, agents: {}};
