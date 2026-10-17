// Service worker: guarda o app inteiro para uso offline.
// Ao publicar uma nova versão, aumente CACHE_VERSION (deve ser igual a APP_VERSION em js/core.js).
const CACHE_VERSION = '1.2.0';
const CACHE = `trilha-ingles-${CACHE_VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/core.js',
  'js/storage.js',
  'data/topics.json',
  'data/r01.json',
  'data/r02.json',
  'data/r03.json',
  'data/t01.json',
  'data/t02.json',
  'data/t03.json',
  'data/t04.json',
  'data/t05.json',
  'data/t06.json',
  'data/t07.json',
  'data/t08.json',
  'data/t09.json',
  'data/t10.json',
  'data/t11.json',
  'data/t12.json',
  'data/t13.json',
  'data/t14.json',
  'data/t15.json',
  'data/t16.json',
  'data/t17.json',
  'data/t18.json',
  'data/t19.json',
  'data/t20.json',
  'data/t21.json',
  'data/t22.json',
  'data/t23.json',
  'data/t24.json',
  'data/t25.json',
  'data/t26.json',
  'data/t27.json',
  'data/t28.json',
  'fonts/AtkinsonHyperlegible-Regular.woff2',
  'fonts/AtkinsonHyperlegible-Bold.woff2',
  'fonts/BricolageGrotesque.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('trilha-ingles-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// Cache primeiro (ignorando parâmetros de busca); rede como reserva.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (e) {
      if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
      throw e;
    }
  })());
});
