/* 入口ページ用 Service Worker
   サブフォルダの各アプリ（/mix/ /ontmix/ /dfconv/ など）は
   それぞれ自前の sw.js を持っているため、ここでは一切触らない。 */
const CACHE = 'portal-v1';
const OWN = [
  '/', '/index.html', '/manifest.json',
  '/icon-192.png', '/icon-512.png',
  '/icon-192-maskable.png', '/icon-512-maskable.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(OWN); })
    .then(function(){ return self.skipWaiting(); }));
});

self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k !== CACHE; })
                          .map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

self.addEventListener('fetch', function(e){
  if(e.request.method !== 'GET') return;
  var url;
  try{ url = new URL(e.request.url); }catch(err){ return; }
  if(url.origin !== self.location.origin) return;
  // 入口ページ自身のファイル以外（＝各アプリのフォルダ）は横取りしない
  if(OWN.indexOf(url.pathname) < 0) return;

  e.respondWith(
    fetch(e.request).then(function(res){
      const copy = res.clone();
      caches.open(CACHE).then(function(c){ c.put(e.request, copy); });
      return res;
    }).catch(function(){
      return caches.match(e.request).then(function(m){ return m || caches.match('/index.html'); });
    })
  );
});
