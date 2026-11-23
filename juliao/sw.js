// Guarda o app para abrir sem internet; os pedaços do mapa vão ficando guardados conforme você navega.
// o nome do cache leva a pasta, para o mapa do Biel e o do pai não apagarem o cache um do outro
const BASE = new URL('./', self.location).pathname;
const VERSAO = 'leonida-v5' + BASE;
const APP = ['./', 'index.html', 'estilo.css', 'app.js', 'dados.json', 'manifest.webmanifest',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'icones/icone-192.png', 'icones/icone-512.png', 'icones/icone-180.png', 'icones/lista.png', 'icones/mapa.png'];
const TILES = 'leonida-tiles';
const FOTOS = 'leonida-fotos'; // fotos vistas ficam guardadas (servem aos dois mapas)
const LIMITE_TILES = 4000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO && k !== TILES && k !== FOTOS && (k.endsWith(BASE) || !k.includes('/'))).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function guardarTile(req, resp) {
  const c = await caches.open(TILES);
  await c.put(req, resp);
  const ks = await c.keys();
  if (ks.length > LIMITE_TILES) for (const k of ks.slice(0, ks.length - LIMITE_TILES)) await c.delete(k);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'tiles.mapgenie.io') {
    e.respondWith(caches.match(req).then((achou) => achou || fetch(req).then((resp) => {
      if (resp.ok || resp.type === 'opaque') e.waitUntil(guardarTile(req, resp.clone()));
      return resp;
    })));
    return;
  }

  if (url.origin === location.origin && url.pathname.includes('/fotos/')) {
    e.respondWith(caches.open(FOTOS).then((c) => c.match(req).then((achou) => achou || fetch(req).then((resp) => {
      if (resp.ok) c.put(req, resp.clone());
      return resp;
    }))));
    return;
  }

  if (url.origin === location.origin) {
    // rede primeiro (pega atualização), cache se estiver sem internet
    e.respondWith(fetch(req).then((resp) => {
      if (resp.ok) { const cp = resp.clone(); caches.open(VERSAO).then((c) => c.put(req, cp)); }
      return resp;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
    return;
  }

  if (url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((resp) => {
      const cp = resp.clone(); caches.open(VERSAO).then((c) => c.put(req, cp)); return resp;
    })));
  }
});
