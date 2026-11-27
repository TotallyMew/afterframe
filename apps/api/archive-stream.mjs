import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { archiveCatalog, archiveFileUrl } from '@afterframe/shared/catalog';
import { archiveEdition, archiveIdPattern } from './catalog/archive.mjs';
import { assertPublicHost } from './http-client.mjs';

const catalog = new Map(archiveCatalog.map(item => [item.key, item]));
const maxArchiveRedirects = 5;

function isAllowedArchiveHost(hostname) {
  const host = hostname.toLowerCase();
  return host === 'archive.org' || host.endsWith('.archive.org') || host === 'upload.wikimedia.org';
}

async function fetchArchiveWithRedirects(startUrl, method, headers, signal) {
  let current = new URL(startUrl);
  for (let hop = 0; hop <= maxArchiveRedirects; hop++) {
    if (current.protocol !== 'https:' || current.username || current.password || !isAllowedArchiveHost(current.hostname)) {
      throw new Error('Archive redirect target is not allowed.');
    }
    await assertPublicHost(current.hostname);
    const upstream = await fetch(current, { method, signal, headers, redirect: 'manual' });
    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('location');
      await upstream.body?.cancel();
      if (!location || hop === maxArchiveRedirects) throw new Error('Archive redirect limit exceeded.');
      current = new URL(location, current);
      continue;
    }
    return upstream;
  }
  throw new Error('Archive redirect limit exceeded.');
}

async function resolveArchiveStream(pathname) {
  const [, , key, episodeKey] = pathname.split('/');
  const item = catalog.get(key);
  const archiveId = key.startsWith('archive-') ? key.slice('archive-'.length) : '';
  const edition = !item && !episodeKey && archiveIdPattern.test(archiveId) ? await archiveEdition(archiveId) : null;
  const media = episodeKey
    ? item?.episodes?.find(episode => episode.key === episodeKey)?.media
    : item?.media || edition?.media;
  return { item, media };
}

async function handleRangeNotSatisfiable(upstream, response, sendJson) {
  const contentRange = upstream.headers.get('content-range');
  await upstream.body?.cancel();
  const extra = contentRange && /^bytes \*\/\d+$/.test(contentRange) ? { 'content-range': contentRange } : {};
  return sendJson(response, 416, { error: 'Requested range not satisfiable.' }, extra);
}

function buildStreamHeaders(upstream, item, type) {
  const headers = { 'cache-control': item ? 'private, max-age=3600' : 'no-store', 'content-type': type };
  for (const name of ['content-length', 'content-range', 'accept-ranges', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }
  return headers;
}

export async function relayArchive(request, response, pathname, sendJson) {
  const { item, media } = await resolveArchiveStream(pathname);
  if (!media) return sendJson(response, 404, { error: 'Archive stream unavailable.' });
  const url = archiveFileUrl(media);
  const range = request.headers.range;
  if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return sendJson(response, 416, { error: 'Invalid byte range.' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  response.once('close', () => {
    if (!response.writableEnded) controller.abort();
  });
  let upstream;
  try {
    upstream = await fetchArchiveWithRedirects(url, request.method, range ? { Range: range } : {}, controller.signal);
  } catch {
    return sendJson(response, 502, { error: 'The video source could not serve this stream.' });
  } finally {
    clearTimeout(timer);
  }
  if (upstream.status === 416) {
    return handleRangeNotSatisfiable(upstream, response, sendJson);
  }
  const type = upstream.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (![200, 206].includes(upstream.status) || !type?.startsWith('video/')) {
    await upstream.body?.cancel();
    return sendJson(response, 502, { error: 'The video source could not serve this stream.' });
  }
  response.writeHead(upstream.status, buildStreamHeaders(upstream, item, type));
  if (!upstream.body) return response.end();
  await pipeline(Readable.fromWeb(upstream.body), response);
}
