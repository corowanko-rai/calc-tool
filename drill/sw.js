/* 処方監査ドリル  Service Worker（オフライン起動用）
   - drill フォルダ内のファイルだけをキャッシュする（他アプリのキャッシュには触れない）
   - 共通マスタ drug-master.json はネット優先、つながらないときだけキャッシュを使う */
'use strict';
const VERSION = 'drill-v1.8.0';
const SHELL = [
  './', './index.html', './style.css', './core.js', './app.js', './manifest.json',
  './icon-192.png', './icon-512.png', './icon-192-maskable.png', './icon-512-maskable.png', './apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('drill-') === 0 && k !== VERSION; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 共通マスタ：ネット優先
  if (/\/drug-master\.json$/.test(url.pathname)) {
    const key = new Request(url.origin + url.pathname);
    e.respondWith(
      fetch(req).then(function (res) {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(key, copy); }); }
        return res;
      }).catch(function () {
        return caches.match(key).then(function (r) { return r || new Response('', { status: 504 }); });
      })
    );
    return;
  }

  // drill フォルダ外（他アプリ）は扱わない
  if (!url.href.startsWith(self.registration.scope)) return;

  // 画面本体：ネット優先（更新をすぐ反映）、オフライン時はキャッシュ
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(function (c) { c.put('./index.html', copy); }); }
        return res;
      }).catch(function () { return caches.match('./index.html'); })
    );
    return;
  }

  // それ以外（CSS・JS・アイコン）：キャッシュ優先、裏で更新
  e.respondWith(
    caches.match(req).then(function (hit) {
      const net = fetch(req).then(function (res) {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
