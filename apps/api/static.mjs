import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const publicDirectory = fileURLToPath(new URL('../../afterframe/public/', import.meta.url));
const webDirectory = resolve(process.env.AFTERFRAME_WEB_DIST || fileURLToPath(new URL('../web/dist/', import.meta.url)));
const hasWebBuild = existsSync(join(webDirectory, 'index.html'));
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8', '.woff2': 'font/woff2',
};
const spaRoute = /^\/(?:(?:home|main|movies|tv|new|anime|comics|recommendations|search|watchlist|watched|ratings|reading|history|notifications)\/?|(?:movie|tv)\/[1-9]\d{0,9}(?:\/(?:watch|s\d{1,4}e[1-9]\d{0,3}))?\/?|comic\/[\w-]+(?:\/read\/[\w.-]+)?\/?|edition\/[\w.-]+(?:\/watch(?:\/[\w-]+)?)?\/?)?$/i;
const staticBuildPath = /^\/(?:assets\/[a-z0-9][\w.-]*|icons\/[a-z0-9][\w.-]*\.png|manifest\.webmanifest|sw\.js)$/i;

export async function serveFile(request, response, pathname, sendJson) {
  const isBuildAsset = staticBuildPath.test(pathname);
  const isArtAsset = /^\/art\/[a-z0-9][\w.-]*$/i.test(pathname);
  const isSpaFallback = !isBuildAsset && !isArtAsset && !extname(pathname);
  if ((pathname === '/' || isSpaFallback) && !hasWebBuild) {
    return sendJson(response, 503, { error: 'The web client has not been built. Run npm run build in apps/web or use the web service.' });
  }
  const path = pathname === '/' || isSpaFallback ? '/index.html' : pathname;
  const builtFile = hasWebBuild && (pathname === '/' || isSpaFallback || isBuildAsset);
  const allowed = builtFile || isArtAsset;
  if (!allowed || !mime[extname(path)]) return sendJson(response, 404, { error: 'Not found.' });
  const file = join(builtFile ? webDirectory : publicDirectory, path.slice(1));
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return sendJson(response, 404, { error: 'Not found.' });
  const statusCode = path === '/index.html' && !spaRoute.test(pathname) ? 404 : 200;
  const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
  const cacheHeaders = {
    etag,
    'cache-control': builtFile && pathname.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : builtFile && pathname.startsWith('/icons/')
        ? 'public, max-age=86400'
        : 'no-cache',
  };
  const validators = request.headers['if-none-match']?.split(',').map(value => value.trim().replace(/^W\//, ''));
  if (statusCode === 200 && ['GET', 'HEAD'].includes(request.method) && (validators?.includes('*') || validators?.includes(etag.slice(2)))) {
    response.writeHead(304, cacheHeaders);
    return response.end();
  }
  response.writeHead(statusCode, { ...cacheHeaders, 'content-type': mime[extname(path)], 'content-length': info.size });
  if (request.method === 'HEAD') return response.end();
  await pipeline(createReadStream(file), response);
}
