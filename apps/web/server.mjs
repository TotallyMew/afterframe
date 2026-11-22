import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createServer, request as proxyRequest } from 'node:http';
import { extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { applySecurityHeaders, publicOrigin } from '../api/http-settings.mjs';

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
};
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

function forward(request, response, host) {
  const headers = withoutHopHeaders(request.headers);
  headers.host = host;
  const proxy = proxyRequest(upstream, { method: request.method, path: request.url, headers }, incoming => {
    response.writeHead(incoming.statusCode, withoutHopHeaders(incoming.headers));
    pipeline(incoming, response).catch(() => response.destroy());
  });
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
  if (/^\/legacy\/?$/.test(path) && ['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(302, { location: `/${request.url.slice(path.length)}`, 'cache-control': 'no-store' });
    return response.end();
  }
  const staticFile = path === '/' ? 'index.html' : /^\/assets\/[a-z0-9][\w.-]*$/i.test(path) ? path.slice(1) : null;
  if (!staticFile) {
    if (/^\/(?:api|art|player|stream|comic-cover|comic-page)\//.test(path) || /^\/[a-z0-9][\w.-]*\.(?:css|js|vtt)$/i.test(path)) {
      return forward(request, response, railwayHealth ? publicOrigin?.host || `localhost:${port}` : request.headers.host);
    }
    return reply(response, 404, 'Not found.');
  }
  if (!['GET', 'HEAD'].includes(request.method)) return reply(response, 405, 'Method unavailable.');
  const file = new URL(staticFile, build);
  const type = assets[extname(staticFile)];
  const info = type && await stat(file).catch(() => null);
  if (!info?.isFile()) return reply(response, 404, 'Not found.');
  response.writeHead(200, {
    'content-type': type,
    'content-length': info.size,
    'cache-control': path === '/' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  if (request.method === 'HEAD') return response.end();
  await pipeline(createReadStream(file), response).catch(() => response.destroy());
});

server.listen(port, process.env.AFTERFRAME_HOST || '127.0.0.1', () => console.log(`Afterframe web is listening on port ${port}`));
