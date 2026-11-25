const SHELL_CACHE = 'afterframe-shell-v1';
const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · Afterframe</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:#121416;color:#f3ece0;font:16px/1.5 system-ui,sans-serif}.card{max-width:28rem;padding:24px;border:1px solid #363b3f;border-radius:12px;background:#1b1e21}h1{margin:0 0 8px;font-size:1.5rem}p{margin:0 0 16px;color:#b5b0a7}button{padding:10px 16px;border:0;border-radius:6px;background:#a74736;color:#fff7ef;font:600 14px/1 system-ui,sans-serif;cursor:pointer}</style></head><body><div class="card"><h1>You appear to be offline</h1><p>Afterframe cannot reach the server right now. Check your connection and try again.</p><button type="button" onclick="location.reload()">Try again</button></div></body></html>`;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(['/manifest.webmanifest', '/art/favicon.svg', '/icons/icon-192.png']).catch(() => {})),
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== SHELL_CACHE).map(key => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (/^\/(?:api|stream|comic-page|comic-cover)\//.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match('/');
        return cached || new Response(OFFLINE_HTML, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
      }),
    );
    return;
  }

  if (/^\/(?:assets|icons)\//.test(url.pathname) || url.pathname === '/art/favicon.svg' || url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(SHELL_CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })),
    );
  }
});
