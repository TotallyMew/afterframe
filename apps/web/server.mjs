import { createReadStream } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { createServer, request as proxyRequest } from 'node:http';
import { extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { applySecurityHeaders, compressBuffer, isPrivateIp, negotiateEncoding, publicOrigin } from '../api/http-settings.mjs';

const compressibleExts = new Set(['.html', '.js', '.css', '.svg', '.webmanifest']);
const compressedCache = new Map();
const MAX_COMPRESSED_CACHE = 64;

const port = Number(process.env.PORT || 4173);
const localHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
const upstream = new URL(process.env.AFTERFRAME_API_URL || 'http://127.0.0.1:8080');
if (upstream.protocol !== 'http:' || upstream.href !== `${upstream.origin}/`) {
  throw new Error('AFTERFRAME_API_URL must be the private HTTP origin of the Afterframe API.');
}
const build = new URL('./dist/', import.meta.url);
await access(new URL('index.html', build)).catch(() => {
  throw new Error('Build the Afterframe web client before starting the web service.');
});
const assets = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
const spaRoute = /^\/(?:(?:home|main|movies|tv|new|anime|comics|manga|recommendations|search|watchlist|watched|ratings|reading|history|notifications)\/?|(?:movie|tv)\/[1-9]\d{0,9}(?:\/(?:watch|s\d{1,4}e[1-9]\d{0,3}))?\/?|comic\/[\w-]+(?:\/read\/[\w.-]+)?\/?|edition\/[\w.-]+(?:\/watch(?:\/[\w-]+)?)?\/?)?$/i;
const staticBuildPath = /^\/(?:assets\/[a-z0-9][\w.-]*|icons\/[a-z0-9][\w.-]*\.png|manifest\.webmanifest|sw\.js)$/i;
const hopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

function withoutHopHeaders(headers) {
  const next = { ...headers };
  for (const name of [...hopHeaders, ...(headers.connection || '').toLowerCase().split(/\s*,\s*/)]) delete next[name];
  return next;
}

function reply(response, code, error) {
  response.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify({ error }));
}

function forwardedClientIp(request) {
  const remote = request.socket?.remoteAddress || '127.0.0.1';
  if (publicOrigin && isPrivateIp(remote)) {
    const incoming = request.headers['x-forwarded-for'];
    if (typeof incoming === 'string' && incoming.trim()) {
      const parts = incoming.split(',').map(part => part.trim()).filter(Boolean);
      const hops = Math.max(1, Number(process.env.AFTERFRAME_TRUST_PROXY_HOPS) || 1);
      if (parts.length) return parts[Math.max(0, parts.length - hops)];
    }
  }
  return remote;
}

function forward(request, response, host, isStream = false) {
  const headers = withoutHopHeaders(request.headers);
  headers.host = host;
  headers['x-forwarded-for'] = forwardedClientIp(request);
  const proxy = proxyRequest(upstream, {
    method: request.method,
    path: request.url,
    headers,
    ...(isStream ? {} : { timeout: 30_000 }),
  }, incoming => {
    response.writeHead(incoming.statusCode, withoutHopHeaders(incoming.headers));
    pipeline(incoming, response).catch(() => response.destroy());
  });
  proxy.once('timeout', () => proxy.destroy(new Error('Upstream timeout')));
  response.once('close', () => proxy.destroy());
  proxy.once('error', () => {
    if (response.destroyed) return;
    if (response.headersSent) response.destroy();
    else reply(response, 502, 'The Afterframe API is unavailable.');
  });
  request.pipe(proxy);
}

const server = createServer(async (request, response) => {
  applySecurityHeaders(response);
  const railwayHealth = request.headers.host === 'healthcheck.railway.app' && request.method === 'GET' && request.url === '/api/health';
  if (!railwayHealth && (publicOrigin ? request.headers.host !== publicOrigin.host : !localHosts.has(request.headers.host))) {
    return reply(response, 403, 'Use the configured address to open Afterframe.');
  }
  if (!request.url.startsWith('/')) return reply(response, 400, 'Invalid request path.');
  const path = request.url.split('?')[0];
  if (/^\/(?:legacy|player)\/?$/.test(path) && ['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(302, { location: `/${request.url.slice(path.length)}`, 'cache-control': 'no-store' });
    return response.end();
  }
  const isAsset = staticBuildPath.test(path);
  const isProxy = /^\/(?:api|art|stream|comic-cover|comic-page)\//.test(path);
  if (isProxy) {
    return forward(request, response, railwayHealth ? publicOrigin?.host || `localhost:${port}` : request.headers.host, path.startsWith('/stream/'));
  }
  if (!['GET', 'HEAD'].includes(request.method)) return reply(response, 405, 'Method unavailable.');
  const staticFile = path === '/' ? 'index.html' : isAsset ? path.slice(1) : (spaRoute.test(path) || !extname(path)) ? 'index.html' : null;
  if (!staticFile) return reply(response, 404, 'Not found.');
  const file = new URL(staticFile, build);
  const ext = extname(staticFile);
  const type = assets[ext];
  const info = type && await stat(file).catch(() => null);
  if (!info?.isFile()) return reply(response, 404, 'Not found.');
  const statusCode = staticFile === 'index.html' && !spaRoute.test(path) ? 404 : 200;
  const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
  const cacheControl = path.startsWith('/assets/')
    ? 'public, max-age=31536000, immutable'
    : path.startsWith('/icons/')
      ? 'public, max-age=86400'
      : 'no-cache';
  const cacheHeaders = { etag, 'cache-control': cacheControl };
  const validators = request.headers['if-none-match']?.split(',').map(value => value.trim().replace(/^W\//, ''));
  if (statusCode === 200 && (validators?.includes('*') || validators?.includes(etag.slice(2)))) {
    response.writeHead(304, cacheHeaders);
    return response.end();
  }
  const preferredEncoding = compressibleExts.has(ext) && info.size >= 1024 && info.size <= 2 * 1024 * 1024
    ? negotiateEncoding(request.headers['accept-encoding'])
    : null;
  if (preferredEncoding) {
    const cacheKey = `${staticFile}:${info.size}:${info.mtimeMs}:${preferredEncoding}`;
    let payload = compressedCache.get(cacheKey);
    if (!payload) {
      const raw = await readFile(file);
      payload = await compressBuffer(raw, preferredEncoding);
      if (compressedCache.size >= MAX_COMPRESSED_CACHE) {
        const oldest = compressedCache.keys().next().value;
        if (oldest) compressedCache.delete(oldest);
      }
      compressedCache.set(cacheKey, payload);
    }
    response.writeHead(statusCode, {
      ...cacheHeaders,
      'content-type': type,
      'content-length': payload.buffer.length,
      vary: 'Accept-Encoding',
      ...(payload.encoding ? { 'content-encoding': payload.encoding } : {}),
    });
    return response.end(request.method === 'HEAD' ? undefined : payload.buffer);
  }
  response.writeHead(statusCode, {
    ...cacheHeaders,
    'content-type': type,
    'content-length': info.size,
  });
  if (request.method === 'HEAD') return response.end();
  await pipeline(createReadStream(file), response).catch(() => response.destroy());
});

server.listen(port, process.env.AFTERFRAME_HOST || '127.0.0.1', () => console.log(`Afterframe web is listening on port ${port}`));

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
