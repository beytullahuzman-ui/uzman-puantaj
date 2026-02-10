// UZMAN Puantaj — simple cache-first SW
const CACHE = 'uzman-puantaj-v6';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async ()=>{
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k===CACHE)?null:caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if(req.method !== 'GET') return;
  event.respondWith((async ()=>{
    const cached = await caches.match(req, { ignoreSearch:true });
    if(cached) return cached;
    try{
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE);
      cache.put(req, fresh.clone());
      return fresh;
    }catch(err){
      // fallback to app shell for navigations
      if(req.mode === 'navigate'){
        const shell = await caches.match('./index.html');
        if(shell) return shell;
      }
      throw err;
    }
  })());
});
