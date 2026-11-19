/* Офлайн-режим: приложение сохраняется на телефоне и открывается без интернета */
const VER = '2.0.45';
const CACHE = 'hero-' + VER;
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png', ].concat([1, 2, 3, 4, 5, 6].flatMap(n => [`hero_${n}.webp`, `hero_${n}_f.webp`, `body_${n}_front.webp`, `body_${n}_back.webp`]));

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('hero-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // запросы к таблице — только по сети
  const url = new URL(req.url);
  if (url.hostname.endsWith('script.google.com') || url.hostname.endsWith('googleusercontent.com')) return;
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (url.origin !== location.origin && !isFont) return;
  // сама страница: сначала из сети (чтобы сразу приходили обновления), без интернета — из памяти
  if (req.mode === 'navigate') {
    e.respondWith(caches.open(CACHE).then(async c => {
      try {
        const res = await Promise.race([fetch(req, { cache: 'no-store' }), new Promise((_, rej) => setTimeout(() => rej('timeout'), 3500))]);
        if (res && res.ok) { c.put('index.html', res.clone()); return res; }
      } catch (err) {}
      return (await c.match('index.html')) || (await c.match('./')) || new Response('Нет сети', { status: 503 });
    }));
    return;
  }
  // остальное: сначала из памяти телефона, в фоне — обновление
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: url.origin === location.origin });
    const net = fetch(req, url.origin === location.origin ? { cache: 'no-cache' } : {}).then(res => { if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const res = await net;
    if (res) return res;
    if (req.mode === 'navigate') return c.match('index.html');
    return new Response('', { status: 504 });
  }));
});
