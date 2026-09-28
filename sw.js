// Service worker — changer VERSION à chaque déploiement pour forcer la mise à jour.
const VERSION = 'salati-v2.6.4';
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;

const APP_SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/style.css',
  'js/adhan.js',
  'js/api.js',
  'js/app.js',
  'js/calendar.js',
  'js/clock.js',
  'js/compass.js',
  'js/countdown.js',
  'js/hijri.js',
  'js/i18n.js',
  'js/location.js',
  'js/prayer-calc.js',
  'js/prayer-times.js',
  'js/qibla.js',
  'js/storage.js',
  'js/sun.js',
  'js/wmm.js',
  'icons/apple-touch-icon.png',
  'icons/icon-144.png',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-96.png',
  'icons/icon-maskable-512.png',
  'icons/icon.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(c => c.addAll(APP_SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // la synchro d'horloge (HEAD) passe au réseau
  const url = new URL(req.url);

  // Horaires : réseau d'abord (les données sont aussi gardées dans localStorage)
  if (url.hostname === 'api.aladhan.com') {
    event.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(RUNTIME).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req)));
    return;
  }
  // API GitHub (liste des Adhans du dépôt) : réseau uniquement
  if (url.hostname === 'api.github.com') return;
  // Recherche de ville : réseau uniquement
  if (url.hostname.endsWith('openstreetmap.org')) return;

  // Polices Google : cache puis mise à jour en arrière-plan
  if (url.hostname.endsWith('googleapis.com') || url.hostname.endsWith('gstatic.com')) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Audio : mis en cache au premier usage
  if (url.pathname.includes('/audio/')) {
    event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok && res.status === 200) { const copy = res.clone(); caches.open(RUNTIME).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  // Page et fichiers de l'appli : CACHE D'ABORD (ouverture instantanée, même hors ligne).
  // Tous les fichiers d'une version sont pré-téléchargés ensemble à l'installation du service
  // worker : pas de mélange entre versions. Une nouvelle version (VERSION changée) s'installe
  // en arrière-plan puis l'appli se recharge une fois (voir registerSW dans app.js).
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('index.html', { cacheName: SHELL })
      .then(hit => hit || fetch(req).then(res => { const copy = res.clone(); caches.open(SHELL).then(c => c.put('index.html', copy)); return res; }))
      .catch(() => caches.match('index.html')));
    return;
  }
  event.respondWith(caches.match(req, { cacheName: SHELL, ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
    if (res.ok && res.status === 200) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
    return res;
  })).catch(() => caches.match(req, { ignoreSearch: true })));
});

function staleWhileRevalidate(req) {
  return caches.open(RUNTIME).then(async cache => {
    const hit = await caches.match(req, { ignoreSearch: false });
    const network = fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    }).catch(() => hit);
    return hit || network;
  });
}

// Clic sur une notification : ramène l'appli au premier plan
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const win = list.find(c => 'focus' in c);
    return win ? win.focus() : self.clients.openWindow('./');
  }));
});
