/* 剤形変更 換算 — Service Worker */
const CACHE = 'dfconv-v1';
const ASSETS = [
  './', './index.html', './app.js', './manifest.json',
  './icon-192.png', './icon-512.png',
  './icon-192-maskable.png', './icon-512-maskable.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){
    return c.addAll(ASSETS.map(function(u){ return new Request(u, {cache:'reload'}); }));
  }).then(function(){
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    // 自分の古いキャッシュだけ消す（ドリル・水剤MIXなど他のアプリのキャッシュには触れない）
    return Promise.all(keys.filter(function(k){ return k.indexOf('dfconv-') === 0 && k !== CACHE; })
                          .map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

self.addEventListener('fetch', function(e){
  if(e.request.method !== 'GET') return;
  e.respondWith(
    // 画面以外（app.js など）はサーバーに更新を確認してから使う（HTTPキャッシュの古い app.js を使わない）
    fetch(e.request.mode === 'navigate' ? e.request : new Request(e.request, {cache:'no-cache'})).then(function(res){
      if(res.ok){   // エラー（404など）はキャッシュしない
        const copy = res.clone();
        caches.open(CACHE).then(function(c){ c.put(e.request, copy); });
      }
      return res;
    }).catch(function(){
      return caches.match(e.request).then(function(m){
        return m || caches.match('./index.html');
      });
    })
  );
});
