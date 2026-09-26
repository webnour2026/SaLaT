// Service worker — changer VERSION à chaque déploiement pour forcer la mise à jour.
const VERSION = 'priere-v1.8.1';
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;

const APP_SHELL = [
  './', 'index.html', 'manifest.json', 'css/style.css',
  'js/app.js', 'js/i18n.js', 'js/storage.js', 'js/clock.js', 'js/api.js',
  'js/prayer-calc.js', 'js/prayer-times.js', 'js/countdown.js',
  'js/qibla.js', 'js/compass.js', 'js/wmm.js', 'js/sun.js', 'js/hijri.js', 'js/calendar.js', 'js/adhan.js', 'js/location.js',
  'icons/icon.svg', 'icons/icon-96.png', 'icons/icon-192.png', 'icons/apple-touch-icon.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
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

  // Pages : réseau d'abord pour avoir la dernière version, cache si hors ligne
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then(res => {
      const copy = res.clone(); caches.open(SHELL).then(c => c.put('index.html', copy));
      return res;
    }).catch(() => caches.match('index.html')));
    return;
  }

  // Fichiers de l'appli (JS, CSS, icônes) : RÉSEAU D'ABORD, cache seulement hors ligne.
  // Évite de mélanger une nouvelle page avec d'anciens scripts après une mise à jour.
  event.respondWith(fetch(req, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true })));
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
