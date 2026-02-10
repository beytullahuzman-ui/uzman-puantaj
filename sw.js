/* UZMAN Puantaj SW - simple cache */
const CACHE = "uzman-puantaj-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./sw.js",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil((async ()=>{
    const c = await caches.open(CACHE);
    await c.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k===CACHE)?null:caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Only same-origin
  if(url.origin !== self.location.origin) return;

  e.respondWith((async ()=>{
    const cached = await caches.match(req, {ignoreSearch:true});
    if(cached) return cached;
    const res = await fetch(req);
    // cache successful GET
    if(req.method==="GET" && res.ok){
      const c = await caches.open(CACHE);
      c.put(req, res.clone());
    }
    return res;
  })());
});
