// 水剤MIX調製計算 Service Worker
//
// 方針:
// - HTML本体と defaults.json は「ネットワーク優先」。更新をすぐ反映させるため。
//   オフライン時のみキャッシュにフォールバックする。
// - アイコンなど変化しないファイルは「キャッシュ優先」で高速起動。
//
// アプリを更新したらCACHE_NAMEの数字を上げること（古いキャッシュが自動で破棄される）。

const CACHE_NAME = 'mix-calc-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-192-maskable.png',
  './icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ネットワーク優先（取れたらキャッシュも更新／失敗したらキャッシュを返す）
function networkFirst(req) {
  return fetch(req)
    .then(res => {
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    })
    .catch(() => caches.match(req).then(cached => cached || caches.match('./index.html')));
}

// キャッシュ優先（無ければ取得してキャッシュ）
function cacheFirst(req) {
  return caches.match(req).then(cached => {
    if (cached) return cached;
    return fetch(req).then(res => {
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 外部リソースは介入しない

  const path = url.pathname;
  const isHtml = req.mode === 'navigate'
    || path.endsWith('/')
    || path.endsWith('.html');
  const isJson = path.endsWith('.json');

  if (isHtml || isJson) {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(cacheFirst(req));
  }
});
