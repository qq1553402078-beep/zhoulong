/* 中台拍摄工作台 PWA Service Worker */
const CACHE = 'zhoulong-pwa-v9';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './studio-theme.css?v=v3',
  './studio-editorial.css?v=v5',
  './access.js?v=access-12',
  './team-sync.js?v=shared-settings-4',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './product-straight.webp',
  './studio-ai-triptych.webp',
  './studio-art-backdrop.webp',
  './cover-bg.webm',
  './cover-poster.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' }))))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('zhoulong-pwa-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 导航请求：网络优先，离线回退缓存首页
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // 静态资源：缓存优先 + 后台更新（stale-while-revalidate）
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
