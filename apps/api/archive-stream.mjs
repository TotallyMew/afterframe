import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { archiveCatalog, archiveFileUrl } from '@afterframe/shared/catalog';
import { archiveEdition, archiveIdPattern } from './catalog/archive.mjs';

const catalog = new Map(archiveCatalog.map(item => [item.key, item]));

export async function relayArchive(request, response, pathname, sendJson) {
  const [, , key, episodeKey] = pathname.split('/');
  const item = catalog.get(key);
  const archiveId = key.startsWith('archive-') ? key.slice('archive-'.length) : '';
  const edition = !item && !episodeKey && archiveIdPattern.test(archiveId) ? await archiveEdition(archiveId) : null;
  const media = episodeKey ? item?.episodes?.find(episode => episode.key === episodeKey)?.media : item?.media || edition?.media;
  if (!media) return sendJson(response, 404, { error: 'Archive stream unavailable.' });
  const url = archiveFileUrl(media);
  const range = request.headers.range;
  if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return sendJson(response, 416, { error: 'Invalid byte range.' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  response.on('close', () => controller.abort());
  let upstream;
  try {
    upstream = await fetch(url, {
      method: request.method, signal: controller.signal,
      headers: range ? { Range: range } : {},
    });
  } finally {
    clearTimeout(timer);
  }
  const type = upstream.headers.get('content-type')?.split(';')[0];
  if (![200, 206, 416].includes(upstream.status) || (upstream.ok && !type?.startsWith('video/'))) {
    await upstream.body?.cancel();
    return sendJson(response, 502, { error: 'The video source could not serve this stream.' });
  }
  const headers = { 'cache-control': item && upstream.ok ? 'private, max-age=3600' : 'no-store' };
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }
  response.writeHead(upstream.status, headers);
  if (!upstream.body) return response.end();
  await pipeline(Readable.fromWeb(upstream.body), response);
}
