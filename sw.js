/* UZMAN Puantaj - simple cache for PWA */
const CACHE = "uzman-puantaj-cache-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./sw.js",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event)=>{
  event.waitUntil(
    caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate", (event)=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE?caches.delete(k):null)))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch", (event)=>{
  const req = event.request;
  if(req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then((cached)=>{
      if(cached) return cached;
      return fetch(req).then((resp)=>{
        const copy = resp.clone();
        caches.open(CACHE).then(c=>c.put(req, copy)).catch(()=>{});
        return resp;
      }).catch(()=> cached || new Response("Offline", {status:503, statusText:"Offline"}));
    })
  );
});
