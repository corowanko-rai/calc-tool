/* リフィル・日数計算  Service Worker（オフライン起動用）
   - refill フォルダ内のファイルだけをキャッシュする（他アプリのキャッシュには触れない） */
'use strict';
const VERSION = 'refill-v1.1.0';
const SHELL = [
  './', './index.html', './style.css', './core.js', './app.js', './manifest.json',
  './icon-192.png', './icon-512.png', './icon-192-maskable.png', './icon-512-maskable.png', './apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  // ブラウザのHTTPキャッシュに残った古いファイルを取り込まないよう、サーバーから取り直す（cache: 'reload'）
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return c.addAll(SHELL.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('refill-') === 0 && k !== VERSION; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  if (!url.href.startsWith(self.registration.scope)) return;   // refill フォルダ外（他アプリ）は扱わない

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

  // それ以外（CSS・JS・アイコン）：ネット優先（サーバーに更新を確認）、つながらないときはキャッシュ
  // 計算ロジック（core.js）の修正が古いまま残らないよう、キャッシュ優先にはしない
  e.respondWith(
    fetch(new Request(req, { cache: 'no-cache' })).then(function (res) {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || new Response('', { status: 504 }); });
    })
  );
});
