import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveCatalog, archiveFileUrl } from './public/catalog.js';
import { archiveEdition, archiveIdPattern, searchArchive } from './archive.mjs';
import { accountApi } from './accounts.mjs';
import { catalogFilters, discoverParams, matchesCatalog } from './public/discover.js';
import { cacheMetadata, cachedRatings, imdbRating, refreshMetadataPeriodically } from './metadata.mjs';

const port = Number(process.env.PORT || 4173);
const publicDirectory = fileURLToPath(new URL('./public/', import.meta.url));
const catalog = new Map(archiveCatalog.map(item => [item.key, item]));
const localHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.vtt': 'text/vtt; charset=utf-8', '.woff2': 'font/woff2',
};
const contentPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://image.tmdb.org https://archive.org https://*.archive.org; media-src 'self' blob: https://archive.org https://*.archive.org https://upload.wikimedia.org; frame-src https://cinesrc.st; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
let tmdbToken = process.env.TMDB_READ_TOKEN?.trim() || '';
const tmdbKey = process.env.TMDB_API_KEY?.trim() || '';

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function tmdb(path, params = {}, token = tmdbToken) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  url.search = new URLSearchParams(params);
  if (!token && tmdbKey) url.searchParams.set('api_key', tmdbKey);
  const response = await fetch(url, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw Object.assign(new Error('TMDB request failed'), { upstreamStatus: response.status });
  }
  return response.json();
}

async function discover(type, page, filters, collection) {
  const params = { language: 'en-US', page, include_adult: 'false', ...discoverParams(type, filters, collection) };
  const data = await cacheMetadata(`discover:${type}:${JSON.stringify(params)}`, 30 * 60000, () => tmdb(`/discover/${type}`, params));
  let results = data.results.filter(item => !item.adult).map(item => ({ ...item, media_type: type }));
  if (filters.imdb) {
    const facts = await catalogFacts(results.map(item => `${type}:${item.id}`));
    results = results.flatMap(item => {
      const info = facts[`${type}-${item.id}`];
      return info?.rating?.score >= filters.imdb ? [{ ...item, catalog_facts: info }] : [];
    });
  }
  return { results, total: filters.imdb ? null : data.total_results, nextPage: page < Math.min(data.total_pages, 500) ? page + 1 : null };
}

function titleMetadata(type, id, season, refresh = false) {
  const path = `/${type}/${id}`;
  return cacheMetadata(`title:${type}:${id}:${season ?? ''}`, 12 * 3600000, () => season && type === 'tv'
    ? tmdb(`${path}/season/${season}`, { language: 'en-US' })
    : tmdb(path, { language: 'en-US', append_to_response: 'watch/providers,external_ids,credits' }), refresh);
}

async function catalogFacts(keys) {
  const cached = await cachedRatings(keys);
  const facts = {};
  for (let index = 0; index < keys.length; index += 5) {
    await Promise.all(keys.slice(index, index + 5).map(async key => {
      const [type, id] = key.split(':');
      const cardKey = `${type}-${id}`;
      try {
        const details = type === 'tv' || !cached[cardKey] ? await titleMetadata(type, id) : null;
        const external = details?.external_ids?.imdb_id || details?.imdb_id;
        facts[cardKey] = {
          rating: cached[cardKey] || await imdbRating(external),
          seasons: details?.number_of_seasons, status: details?.status,
        };
      } catch {
        if (cached[cardKey]) facts[cardKey] = { rating: cached[cardKey] };
      }
    }));
  }
  return facts;
}

async function handleApi(request, response, url) {
  const { pathname, searchParams } = url;
  if (pathname === '/api/status' && request.method === 'GET') return json(response, 200, { connected: Boolean(tmdbToken || tmdbKey) });

  if (pathname === '/api/account' || pathname.startsWith('/api/account/')) {
    let body;
    if (request.method === 'POST') {
      if (request.headers.origin !== `http://${request.headers.host}` || !request.headers['content-type']?.startsWith('application/json')) {
        return json(response, 403, { error: 'Open Afterframe on localhost to use accounts.' });
      }
      let raw = '';
      for await (const chunk of request) {
        raw += chunk;
        if (raw.length > 16384) return json(response, 413, { error: 'This account request is too large.' });
      }
      try { body = JSON.parse(raw); } catch { return json(response, 400, { error: 'Invalid account request.' }); }
    }
    const result = await accountApi(request, response, pathname, body);
    return json(response, result.code, result.body);
  }

  if (pathname === '/api/connection' && request.method === 'POST') {
    if (request.headers.origin !== `http://${request.headers.host}` || !request.headers['content-type']?.startsWith('application/json')) {
      return json(response, 403, { error: 'Open settings from Afterframe on localhost.' });
    }
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 4096) return json(response, 413, { error: 'The supplied token is too long.' });
    }
    let candidate;
    try { candidate = JSON.parse(body)?.token; } catch { return json(response, 400, { error: 'Invalid request.' }); }
    if (typeof candidate !== 'string' || !/^[\w.-]{20,2048}$/.test(candidate.trim())) {
      return json(response, 400, { error: 'Enter your TMDB API Read Access Token.' });
    }
    await tmdb('/authentication', {}, candidate.trim());
    tmdbToken = candidate.trim();
    return json(response, 200, { connected: true });
  }

  if (request.method !== 'GET') return json(response, 405, { error: 'Method unavailable.' });
  if (pathname === '/api/imdb') return json(response, 200, { rating: await imdbRating(searchParams.get('id')) });
  if (pathname === '/api/imdb/cached') {
    const keys = [...new Set((searchParams.get('titles') || '').split(','))].filter(key => /^(movie|tv):[1-9]\d{0,9}$/.test(key)).slice(0, 100);
    return json(response, 200, { ratings: keys.length ? await cachedRatings(keys) : {} });
  }
  if (pathname === '/api/catalog/facts') {
    const keys = [...new Set((searchParams.get('titles') || '').split(','))].filter(key => /^(movie|tv):[1-9]\d{0,9}$/.test(key)).slice(0, 20);
    return json(response, 200, { facts: keys.length && (tmdbToken || tmdbKey) ? await catalogFacts(keys) : {} });
  }
  const related = pathname.match(/^\/api\/(movie|tv)\/([1-9]\d{0,9})\/related$/);
  if (related && (tmdbToken || tmdbKey)) {
    const [, type, id] = related;
    const data = await cacheMetadata(`related:${type}:${id}`, 12 * 3600000, () => tmdb(`/${type}/${id}/recommendations`, { language: 'en-US', page: 1 }));
    return json(response, 200, { results: data.results.filter(item => !item.adult).slice(0, 8).map(item => ({ ...item, media_type: type })) });
  }
  if (pathname === '/api/segments') {
    const id = searchParams.get('id') || '';
    const type = searchParams.get('type');
    const duration = Number(searchParams.get('duration'));
    const season = searchParams.get('season') || '';
    const episode = searchParams.get('episode') || '';
    if (!/^\d{1,10}$/.test(id) || !['movie', 'tv'].includes(type) || !Number.isInteger(duration) || duration < 60000 || duration > 86400000
      || (type === 'tv' && (!/^\d{1,4}$/.test(season) || !/^[1-9]\d{0,3}$/.test(episode)))) return json(response, 400, { error: 'Invalid playback coordinates.' });
    const upstream = new URL('https://api.theintrodb.org/v4/media');
    upstream.search = new URLSearchParams({ tmdb_id: id, type, duration_ms: duration, details: 'true', ...(type === 'tv' ? { season, episode } : {}) });
    const result = await fetch(upstream, { signal: AbortSignal.timeout(6000) });
    if (!result.ok) {
      await result.body?.cancel();
      return json(response, 200, { segments: [] });
    }
    const data = await result.json();
    if (data.type !== type || !Number.isFinite(data.group_duration_ms) || Math.abs(data.group_duration_ms - duration) > 2500) return json(response, 200, { segments: [] });
    const segments = ['intro', 'recap', 'credits'].flatMap(kind => {
      const candidates = (Array.isArray(data[kind]) ? data[kind] : []).filter(entry => Number.isFinite(entry?.confidence) && entry.confidence >= .5)
        .sort((a, b) => b.confidence - a.confidence);
      const matched = candidates.flatMap(entry => {
        if (entry.start_ms != null && !Number.isFinite(entry.start_ms)) return [];
        if (!Number.isFinite(entry.end_ms) && (kind !== 'credits' || entry.end_ms !== null)) return [];
        const start = (entry.start_ms ?? 0) / 1000;
        const end = (entry.end_ms === null ? Number(duration) : Math.min(entry.end_ms, duration)) / 1000;
        return start >= 0 && end > start && (kind !== 'credits' || start >= duration / 2000)
          ? [{ kind, start, end }] : [];
      });
      return kind === 'credits' ? matched.sort((a, b) => a.start - b.start) : matched.slice(0, 1);
    });
    return json(response, 200, { segments });
  }
  if (pathname === '/api/archive') {
    const page = Number(searchParams.get('page') || 1);
    if (!Number.isInteger(page) || page < 1 || page > 278) return json(response, 400, { error: 'That Archive page is unavailable.' });
    try {
      return json(response, 200, await searchArchive({ group: searchParams.get('group'), query: searchParams.get('q')?.trim().slice(0, 180), page, filters: catalogFilters(searchParams) }));
    } catch {
      return json(response, 502, { error: 'The Internet Archive catalog is temporarily unavailable.' });
    }
  }
  if (pathname.startsWith('/api/archive/')) {
    const id = pathname.slice('/api/archive/'.length);
    const item = archiveIdPattern.test(id) ? await archiveEdition(id) : null;
    return item ? json(response, 200, item) : json(response, 404, { error: 'A playable licensed video is unavailable for this Archive item.' });
  }

  const route = pathname.match(/^\/api\/(movie|tv)\/(\d{1,10})(?:\/season\/(\d{1,4}))?$/);
  if (!route && !['/api/search', '/api/trending', '/api/browse', '/api/home'].includes(pathname)) return json(response, 404, { error: 'Not found.' });
  if (!(tmdbToken || tmdbKey)) return json(response, 503, { error: 'Connect TMDB in Settings to use the full catalog.' });

  const page = Number(searchParams.get('page') || 1);
  if (!Number.isInteger(page) || page < 1 || page > 500) return json(response, 400, { error: 'That TMDB page is unavailable.' });

  if (pathname === '/api/search') {
    const query = searchParams.get('q')?.trim().slice(0, 180);
    if (!query) return json(response, 200, { results: [] });
    const type = searchParams.get('type');
    const endpoint = ['movie', 'tv'].includes(type) ? type : 'multi';
    const data = await tmdb(`/search/${endpoint}`, { query, language: 'en-US', include_adult: 'false', page });
    const filters = catalogFilters(searchParams);
    const results = data.results.filter(item => !item.adult && (endpoint !== 'multi' || ['movie', 'tv'].includes(item.media_type)))
      .map(item => ({ ...item, media_type: endpoint === 'multi' ? item.media_type : endpoint }))
      .filter(item => matchesCatalog({ type: item.media_type, year: (item.release_date || item.first_air_date || '').slice(0, 4), genreIds: item.genre_ids, originalLanguage: item.original_language }, filters));
    return json(response, 200, { results, nextPage: page < Math.min(data.total_pages, 500) ? page + 1 : null });
  }
  if (pathname === '/api/browse') {
    const type = searchParams.get('type');
    if (!['movie', 'tv'].includes(type)) return json(response, 400, { error: 'Choose movies or TV shows.' });
    const filters = catalogFilters(searchParams);
    const collection = searchParams.get('collection');
    if (collection === 'new') filters.sort = 'newest';
    return json(response, 200, await discover(type, page, filters, collection));
  }
  if (pathname === '/api/home') {
    const collections = [
      ['newMovies', 'movie', 'newest', 'new', ''],
      ['newTV', 'tv', 'newest', 'new', ''],
      ['top', 'movie', 'top', '', ''],
      ['anime', 'tv', 'popular', '', 'Anime'],
    ];
    const sections = await Promise.allSettled(collections.map(([, type, sort, collection, category]) =>
      discover(type, 1, { sort, category, decade: 0 }, collection)));
    return json(response, 200, Object.fromEntries(sections.flatMap((section, index) =>
      section.status === 'fulfilled' ? [[collections[index][0], section.value.results]] : [])));
  }
  if (pathname === '/api/trending') {
    const type = searchParams.get('type');
    const endpoint = ['movie', 'tv'].includes(type) ? type : 'all';
    const data = await cacheMetadata(`trending:${endpoint}:${page}`, 15 * 60000, () => tmdb(`/trending/${endpoint}/week`, { language: 'en-US', page }));
    const results = data.results.filter(item => !item.adult && (endpoint !== 'all' || ['movie', 'tv'].includes(item.media_type)))
      .map(item => ({ ...item, media_type: endpoint === 'all' ? item.media_type : endpoint }));
    return json(response, 200, { results, nextPage: page < Math.min(data.total_pages, 500) ? page + 1 : null });
  }

  const [, type, id, season] = route;
  return json(response, 200, await titleMetadata(type, id, season));
}

async function relayArchive(request, response, pathname) {
  const [, , key, episodeKey] = pathname.split('/');
  const item = catalog.get(key);
  const archiveId = key.startsWith('archive-') ? key.slice('archive-'.length) : '';
  const edition = !item && !episodeKey && archiveIdPattern.test(archiveId) ? await archiveEdition(archiveId) : null;
  const media = episodeKey ? item?.episodes?.find(episode => episode.key === episodeKey)?.media : item?.media || edition?.media;
  if (!media) return json(response, 404, { error: 'Archive stream unavailable.' });
  const url = archiveFileUrl(media);
  const range = request.headers.range;
  if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return json(response, 416, { error: 'Invalid byte range.' });

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
    return json(response, 502, { error: 'The video source could not serve this stream.' });
  }
  const headers = { 'cache-control': 'no-store' };
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }
  response.writeHead(upstream.status, headers);
  if (!upstream.body) return response.end();
  await pipeline(Readable.fromWeb(upstream.body), response);
}

async function serveFile(request, response, pathname) {
  const path = pathname === '/' ? '/index.html' : pathname;
  if (!/^\/(?:art\/)?[a-z0-9][\w.-]*$/i.test(path) || !mime[extname(path)]) return json(response, 404, { error: 'Not found.' });
  const file = join(publicDirectory, path.slice(1));
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return json(response, 404, { error: 'Not found.' });
  response.writeHead(200, { 'content-type': mime[extname(path)], 'content-length': info.size, 'cache-control': 'no-cache' });
  if (request.method === 'HEAD') return response.end();
  await pipeline(createReadStream(file), response);
}

const server = createServer(async (request, response) => {
  response.setHeader('content-security-policy', contentPolicy);
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  if (!localHosts.has(request.headers.host)) return json(response, 403, { error: 'Use localhost to open Afterframe.' });
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(request, response, url);
    if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { error: 'Method unavailable.' });
    if (/^\/stream\/[\w.-]+(?:\/[\w-]+)?$/.test(url.pathname)) return await relayArchive(request, response, url.pathname);
    await serveFile(request, response, url.pathname);
  } catch (error) {
    if (response.destroyed) return;
    if (response.headersSent) return response.destroy();
    const status = error.upstreamStatus;
    if (status === 401 || status === 403) return json(response, 401, { error: 'TMDB rejected the Read Access Token.' });
    if (status === 404) return json(response, 404, { error: 'TMDB could not find this title.' });
    if (status === 429) return json(response, 429, { error: 'TMDB is rate limiting requests. Try again shortly.' });
    return json(response, 502, { error: 'The source is temporarily unavailable.' });
  }
});

refreshMetadataPeriodically(async key => {
  const match = key.match(/^title:(movie|tv):(\d{1,10}):(\d{0,4})$/);
  if (match && (tmdbToken || tmdbKey)) await titleMetadata(match[1], match[2], match[3], true);
});
server.listen(port, '127.0.0.1', () => console.log(`Afterframe is ready at http://localhost:${port}`));
