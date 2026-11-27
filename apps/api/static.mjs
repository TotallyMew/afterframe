import { createReadStream, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { compressBuffer, negotiateEncoding } from './http-settings.mjs';

const compressibleExts = new Set(['.html', '.js', '.css', '.svg', '.webmanifest', '.vtt']);
const compressedCache = new Map();
const MAX_COMPRESSED_CACHE = 64;

const publicDirectory = fileURLToPath(new URL('../../afterframe/public/', import.meta.url));
const webDirectory = resolve(process.env.AFTERFRAME_WEB_DIST || fileURLToPath(new URL('../web/dist/', import.meta.url)));
const hasWebBuild = existsSync(join(webDirectory, 'index.html'));
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8', '.woff2': 'font/woff2',
};
const spaTopSections = new Set([
  'home', 'main', 'movies', 'tv', 'new', 'anime', 'comics', 'manga',
  'recommendations', 'search', 'watchlist', 'watched', 'ratings',
  'reading', 'history', 'notifications',
]);
const spaTitleRoute = /^\/(?:movie|tv)\/[1-9]\d{0,9}(?:\/(?:watch|s\d{1,4}e[1-9]\d{0,3}))?$/i;
const spaComicRoute = /^\/comic\/[\w-]+(?:\/read\/[\w.-]+)?$/i;
const spaEditionRoute = /^\/edition\/[\w.-]+(?:\/watch(?:\/[\w-]+)?)?$/i;
const staticBuildPath = /^\/(?:assets\/[a-z0-9][\w.-]*|icons\/[a-z0-9][\w.-]*\.png|manifest\.webmanifest|sw\.js)$/i;

function isSpaRoute(pathname) {
  if (pathname === '/') return true;
  const trimmed = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (trimmed.startsWith('/') && spaTopSections.has(trimmed.slice(1).toLowerCase())) return true;
  return spaTitleRoute.test(trimmed) || spaComicRoute.test(trimmed) || spaEditionRoute.test(trimmed);
}

function buildTarget(directory, path, builtFile, statusCode) {
  const ext = extname(path);
  if (!mime[ext]) return { notFound: true };
  return { file: join(directory, path.slice(1)), ext, builtFile, statusCode };
}

function resolveStaticTarget(pathname) {
  if (staticBuildPath.test(pathname)) {
    if (!hasWebBuild) return { notFound: true };
    return buildTarget(webDirectory, pathname, true, 200);
  }
  if (/^\/art\/[a-z0-9][\w.-]*$/i.test(pathname)) {
    return buildTarget(publicDirectory, pathname, false, 200);
  }
  const spaMatched = isSpaRoute(pathname);
  if (pathname !== '/' && !spaMatched && extname(pathname)) {
    return { notFound: true };
  }
  if (!hasWebBuild) return { missingBuild: true };
  return buildTarget(webDirectory, '/index.html', true, spaMatched ? 200 : 404);
}

function resolveCacheControl(builtFile, pathname) {
  if (!builtFile) return 'no-cache';
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (pathname.startsWith('/icons/')) return 'public, max-age=86400';
  return 'no-cache';
}

function isNotModified(request, statusCode, etag) {
  if (statusCode !== 200 || !['GET', 'HEAD'].includes(request.method)) return false;
  const validators = request.headers['if-none-match']?.split(',').map(value => value.trim().replace(/^W\//, ''));
  return Boolean(validators?.includes('*') || validators?.includes(etag.slice(2)));
}

function selectCompression(ext, size, acceptEncoding) {
  if (!compressibleExts.has(ext) || size < 1024 || size > 2 * 1024 * 1024) return null;
  return negotiateEncoding(acceptEncoding);
}

async function loadCompressedAsset(file, info, preferredEncoding) {
  const cacheKey = `${file}:${info.size}:${info.mtimeMs}:${preferredEncoding}`;
  const cached = compressedCache.get(cacheKey);
  if (cached) return cached;
  const raw = await readFile(file);
  const payload = await compressBuffer(raw, preferredEncoding);
  if (compressedCache.size >= MAX_COMPRESSED_CACHE) {
    const oldest = compressedCache.keys().next().value;
    if (oldest) compressedCache.delete(oldest);
  }
  compressedCache.set(cacheKey, payload);
  return payload;
}

function sendCompressed(request, response, statusCode, cacheHeaders, ext, payload) {
  const headers = {
    ...cacheHeaders,
    'content-type': mime[ext],
    'content-length': payload.buffer.length,
    vary: 'Accept-Encoding',
    ...(payload.encoding ? { 'content-encoding': payload.encoding } : {}),
  };
  response.writeHead(statusCode, headers);
  return response.end(request.method === 'HEAD' ? undefined : payload.buffer);
}

export async function serveFile(request, response, pathname, sendJson) {
  const target = resolveStaticTarget(pathname);
  if (target.missingBuild) {
    return sendJson(response, 503, { error: 'The web client has not been built. Run npm run build in apps/web or use the web service.' });
  }
  if (target.notFound) return sendJson(response, 404, { error: 'Not found.' });
  const info = await stat(target.file).catch(() => null);
  if (!info?.isFile()) return sendJson(response, 404, { error: 'Not found.' });
  const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
  const cacheHeaders = { etag, 'cache-control': resolveCacheControl(target.builtFile, pathname) };
  if (isNotModified(request, target.statusCode, etag)) {
    response.writeHead(304, cacheHeaders);
    return response.end();
  }
  const preferredEncoding = selectCompression(target.ext, info.size, request.headers['accept-encoding']);
  if (preferredEncoding) {
    const payload = await loadCompressedAsset(target.file, info, preferredEncoding);
    return sendCompressed(request, response, target.statusCode, cacheHeaders, target.ext, payload);
  }
  response.writeHead(target.statusCode, { ...cacheHeaders, 'content-type': mime[target.ext], 'content-length': info.size });
  if (request.method === 'HEAD') return response.end();
  await pipeline(createReadStream(target.file), response);
}
