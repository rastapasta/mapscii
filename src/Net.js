// Shared connections and downloads, counted by the data meter.
'use strict';
const http = require('http');
const https = require('https');
const fetch = require('node-fetch');
const config = require('./config');
const DataMeter = require('./DataMeter');

// Keep connections alive, and give each address more than Node's default 250 ms to connect: slow links failed otherwise.
const agentOptions = {
  keepAlive: true,
  maxSockets: config.maxConnections,
  autoSelectFamilyAttemptTimeout: config.connectAttemptTimeout,
};
const httpAgent = new http.Agent(agentOptions);
const httpsAgent = new https.Agent(agentOptions);
const meter = new DataMeter();
meter.watch(httpAgent);
meter.watch(httpsAgent);

// Gives up only when no data arrives for tileRequestTimeout, so big tiles on slow links aren't cut off.
const USER_AGENT = `MapSCII/${require('../package.json').version} (https://github.com/rastapasta/mapscii)`;

// Fetches a URL into a Buffer, retrying dropped connections
async function fetchBuffer(url, headers = {}) {
  for (let attempt = 0; ; attempt++) {
    const controller = new global.AbortController();
    let timer;
    const waitForData = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), config.tileRequestTimeout);
    };
    try {
      waitForData();
      const res = await fetch(url, {
        agent: (parsedUrl) => parsedUrl.protocol === 'http:' ? httpAgent : httpsAgent,
        signal: controller.signal,
        headers: Object.assign({'User-Agent': USER_AGENT}, headers),
      });
      if (!res.ok) {
        const error = new Error(`could not load ${url}: HTTP ${res.status}`);
        error.status = res.status;
        error.retry = res.status >= 500;
        throw error;
      }
      const chunks = [];
      for await (const chunk of res.body) {
        chunks.push(chunk);
        waitForData();
      }
      return Buffer.concat(chunks);
    } catch (caught) {
      let error = caught;
      if (error.name === 'AbortError') {
        error = new Error(`no data from ${url} for ${config.tileRequestTimeout / 1000} s`);
        error.type = 'request-timeout';
      }
      // dropped connections and server errors are retried at once; timeouts and 404s aren't
      const retry = error.retry || (error.type === 'system');
      if (!retry || attempt >= config.tileRequestRetries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
}

// Fetches JSON, or throws with a short reason
async function fetchJson(url, headers = {}) {
  const buffer = await fetchBuffer(url, headers);
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    throw new Error(`${new URL(url).host} sent no JSON`);
  }
}

// Fetches text
async function fetchText(url, headers = {}) {
  return (await fetchBuffer(url, headers)).toString('utf8');
}

module.exports = {fetchBuffer, fetchJson, fetchText, meter, agents: {http: httpAgent, https: httpsAgent}};
