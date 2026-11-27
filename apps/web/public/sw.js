const SHELL_CACHE = 'afterframe-shell-v2';
const MAX_ASSET_ENTRIES = 80;
const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · Afterframe</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:#121416;color:#f3ece0;font:16px/1.5 system-ui,sans-serif}.card{max-width:28rem;padding:24px;border:1px solid #363b3f;border-radius:12px;background:#1b1e21}h1{margin:0 0 8px;font-size:1.5rem}p{margin:0 0 16px;color:#b5b0a7}a.btn{display:inline-block;padding:10px 16px;border-radius:6px;background:#a74736;color:#fff7ef;font:600 14px/1 system-ui,sans-serif;text-decoration:none}</style></head><body><div class="card"><h1>You appear to be offline</h1><p>Afterframe cannot reach the server right now. Check your connection and try again.</p><a class="btn" href="">Try again</a></div></body></html>`;

async function trimAssetCache(cache) {
  const keys = await cache.keys();
  const assetKeys = keys.filter(req => new URL(req.url).pathname.startsWith('/assets/'));
  if (assetKeys.length > MAX_ASSET_ENTRIES) {
    await Promise.all(assetKeys.slice(0, assetKeys.length - MAX_ASSET_ENTRIES).map(req => cache.delete(req)));
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(['/manifest.webmanifest', '/art/favicon.svg', '/icons/icon-192.png']).catch(() => {})),
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await Promise.all([
      caches.keys().then(keys => Promise.all(keys.filter(key => key !== SHELL_CACHE).map(key => caches.delete(key)))),
      self.registration.navigationPreload?.enable().catch(() => {}),
    ]);
    await self.clients.claim();
  })());
});

async function cacheAssetResponse(request, copy) {
  const cache = await caches.open(SHELL_CACHE);
  await cache.put(request, copy);
  await trimAssetCache(cache);
}

async function handleAssetRequest(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    cacheAssetResponse(request, response.clone()).catch(() => {});
  }
  return response;
}

async function fetchAndCacheShellAsset(cache, request, fallback) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    return fallback;
  }
}

async function handleShellAssetRequest(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  const network = fetchAndCacheShellAsset(cache, request, cached);
  return cached || network;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (/^\/(?:api|stream|comic-page|comic-cover)\//.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preloaded = await event.preloadResponse;
        if (preloaded) return preloaded;
        return await fetch(request);
      } catch {
        return new Response(OFFLINE_HTML, {
          status: 503,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
            'x-content-type-options': 'nosniff',
          },
        });
      }
    })());
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(handleAssetRequest(request));
    return;
  }

  if (url.pathname.startsWith('/icons/') || url.pathname === '/art/favicon.svg' || url.pathname === '/manifest.webmanifest') {
    event.respondWith(handleShellAssetRequest(request));
  }
});
