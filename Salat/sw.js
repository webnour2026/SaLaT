// ════════════════════════════════════════
// SERVICE WORKER — صلاة PWA v3
// Audio + Push Notifications + Offline
// ════════════════════════════════════════
const CACHE_NAME = 'salah-v3-cache-v1';
const RUNTIME_CACHE = 'salah-runtime-v1';
const PRECACHE_URLS = [
  './index.html','./manifest.json',
  'https://fonts.googleapis.com/css2?family=Amiri+Quran&family=Amiri:wght@400;700&family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700&display=swap',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(PRECACHE_URLS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME&&k!==RUNTIME_CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url=new URL(e.request.url);
  if(url.hostname==='api.aladhan.com'){
    e.respondWith(fetch(e.request).then(r=>{caches.open(RUNTIME_CACHE).then(c=>c.put(e.request,r.clone()));return r;}).catch(()=>caches.match(e.request)));return;
  }
  if(url.pathname.endsWith('.mp3')){
    e.respondWith(caches.match(e.request).then(c=>{if(c)return c;return fetch(e.request).then(r=>{caches.open(RUNTIME_CACHE).then(cache=>cache.put(e.request,r.clone()));return r;});}));return;
  }
  if(url.hostname==='nominatim.openstreetmap.org'){
    e.respondWith(fetch(e.request).catch(()=>new Response('{}',{headers:{'Content-Type':'application/json'}})));return;
  }
  if(url.hostname.includes('googleapis.com')||url.hostname.includes('gstatic.com')){
    e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{caches.open(RUNTIME_CACHE).then(cache=>cache.put(e.request,r.clone()));return r;})));return;
  }
  e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).catch(()=>caches.match('./index.html'))));
});
self.addEventListener('push', e => {
  const d=e.data?e.data.json():{};
  e.waitUntil(self.registration.showNotification(d.title||'🕌 حان وقت الصلاة',{
    body:d.body||'الله أكبر — حي على الصلاة',icon:'icon-192.png',badge:'icon-192.png',
    vibrate:[300,150,300,150,600],requireInteraction:true,silent:false,
    data:{url:'./index.html'},
    actions:[{action:'open',title:'🕌 فتح التطبيق'},{action:'dismiss',title:'تجاهل'}],
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if(e.action!=='dismiss'){
    e.waitUntil(clients.matchAll({type:'window'}).then(list=>{
      for(const c of list){if(c.url.includes('index')&&'focus' in c)return c.focus();}
      if(clients.openWindow)return clients.openWindow('./index.html');
    }));
  }
});
self.addEventListener('sync', e => {
  if(e.tag==='sync-prayer-times'){
    e.waitUntil(caches.open(RUNTIME_CACHE).then(c=>c.keys().then(keys=>Promise.all(keys.filter(r=>r.url.includes('aladhan.com')).map(r=>c.delete(r))))));
  }
});
