/* 入口ページ用 Service Worker
   置き場所（/calc-tool/ など）を自動判定して、その直下の自分のファイルだけを扱う。
   サブフォルダの各アプリ（mix / ontmix / dfconv）はそれぞれ自前の sw.js を
   持っているため、ここでは一切横取りしない。 */
const CACHE = 'portal-v2';
const BASE = new URL('./', self.location).pathname;   // 例 /calc-tool/
const FILES = [
  '', 'index.html', 'manifest.json',
  'icon-192.png', 'icon-512.png',
  'icon-192-maskable.png', 'icon-512-maskable.png',
  'apple-touch-icon.png'
];
const OWN = FILES.map(function(f){ return BASE + f; });

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      return Promise.all(FILES.map(function(f){
        return c.add(new Request(f, {cache:'reload'})).catch(function(){});
      }));
    }).then(function(){ return self.skipWaiting(); })
  );
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
  if(OWN.indexOf(url.pathname) < 0) return;   // 各アプリのフォルダには触らない

  e.respondWith(
    fetch(e.request).then(function(res){
      const copy = res.clone();
      caches.open(CACHE).then(function(c){ c.put(e.request, copy); });
      return res;
    }).catch(function(){
      return caches.match(e.request).then(function(m){
        return m || caches.match(BASE + 'index.html');
      });
    })
  );
});
