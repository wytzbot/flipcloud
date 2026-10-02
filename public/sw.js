const CACHE="flipcloud-static-v3";
const STATIC=["/","/index.html","/styles.css","/app.js","/manifest.json","/icon-192.svg"];
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{
 const u=new URL(event.request.url);
 if(u.origin!==location.origin||event.request.method!=="GET"||u.pathname.startsWith("/api/")||u.pathname.startsWith("/auth/")) return;
 if(event.request.mode==="navigate"){event.respondWith(fetch(event.request).catch(()=>caches.match("/index.html")));return;}
 event.respondWith(fetch(event.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));}return r;}).catch(()=>caches.match(event.request)));
});