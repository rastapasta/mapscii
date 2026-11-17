/* Caches the app shell and the pictures seen; map tiles are cached by the app. */
'use strict';
const SHELL = 'map-shell-v1';
const PICTURES = 'map-pictures-v1';
const FILES = ['./', 'index.html', 'dist/app.js', 'dist/LICENSES.txt', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const MAX_PICTURES = 4000;
let stored = 0;
const PICTURE_HOSTS = ['server.arcgisonline.com', 's3.amazonaws.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (PICTURE_HOSTS.includes(url.host)) {
    event.respondWith(caches.open(PICTURES).then(async (cache) => {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res.ok) {
        await cache.put(event.request, res.clone());
        if (++stored % 100 === 0) {
          const keys = await cache.keys();
          for (const request of keys.slice(0, Math.max(0, keys.length - MAX_PICTURES))) await cache.delete(request);
        }
      }
      return res;
    }));
  } else if (url.origin === location.origin) {
    // network first, the cached copy offline
    event.respondWith(fetch(event.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(SHELL).then((cache) => cache.put(event.request, copy));
      }
      return res;
    }).catch(() => caches.match(event.request).then((hit) => hit || caches.match('index.html'))));
  }
});
