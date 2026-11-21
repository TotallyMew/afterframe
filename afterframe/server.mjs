import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveCatalog, archiveFileUrl } from './public/catalog.js';
import { archiveEdition, archiveIdPattern } from './archive.mjs';
import { accountApi, currentAccount, readLibrary, providerCredential, saveProviderCredential } from './accounts.mjs';
import { recommendations, seasonalAnime } from './discovery.mjs';
import { monitorReleases } from './releases.mjs';
import { catalogAnimeRating, malRating } from './mal.mjs';
import { comicCoverResponse, comicPageResponse, comicsApi, reportComicPage } from './comics.mjs';
import { animeSource } from './anime.mjs';
import { catalogFilters, discoverParams, isAnime, matchesCatalog } from './public/discover.js';
import { cacheMetadata, cachedRatings, hasOmdbKey, imdbRating, refreshMetadataPeriodically, setOmdbKey, validateOmdbKey } from './metadata.mjs';

const port = Number(process.env.PORT || 4173);
const publicDirectory = fileURLToPath(new URL('./public/', import.meta.url));
const catalog = new Map(archiveCatalog.map(item => [item.key, item]));
const localHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
const publicOrigin = process.env.AFTERFRAME_ORIGIN ? new URL(process.env.AFTERFRAME_ORIGIN) : null;
if (publicOrigin && (publicOrigin.protocol !== 'https:' || publicOrigin.href !== `${publicOrigin.origin}/`)) throw new Error('AFTERFRAME_ORIGIN must be an HTTPS origin.');
const verifiedCuts = {
  // Slow Horses S5E2, checked against the 47:55 CineSrc cut.
  'cinesrc/tv/95480/5/2': {
    durationMs: 2875957,
    segments: [
      { kind: 'intro', start: 490, end: 533.5 },
      { kind: 'credits', start: 2799.678, end: null },
    ],
  },
};
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.vtt': 'text/vtt; charset=utf-8', '.woff2': 'font/woff2',
};
const contentPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: https://image.tmdb.org https://s4.anilist.co https://archive.org https://*.archive.org https://uploads.mangadex.org; media-src 'self' blob: https://archive.org https://*.archive.org https://upload.wikimedia.org; connect-src 'self' https://opensubtitles-v3.strem.io https://subs5.strem.io https://subs.bright67.online https://uploads.mangadex.org https://*.mangadex.network; frame-src https://cinesrc.st https://ani.pm https://animeembed.com; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const tmdbKeyPattern = /^[a-f0-9]{32}$/i;
let tmdbCredential = (!publicOrigin && providerCredential('tmdb')) || process.env.TMDB_READ_TOKEN?.trim() || process.env.TMDB_API_KEY?.trim();
const savedOmdbKey = !publicOrigin && providerCredential('omdb');
if (savedOmdbKey) setOmdbKey(savedOmdbKey);

function connectionStatus() {
  return { connected: Boolean(tmdbCredential), omdbConnected: hasOmdbKey(), managedIntegrations: Boolean(publicOrigin) };
}

function siteJsonRequest(request) {
  return request.headers.origin === (publicOrigin?.origin || `http://${request.headers.host}`)
    && request.headers['content-type']?.split(';')[0].trim() === 'application/json';
}

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function tmdb(path, params = {}, credential = tmdbCredential) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  url.search = new URLSearchParams(params);
  const apiKey = tmdbKeyPattern.test(credential);
  if (apiKey) url.searchParams.set('api_key', credential);
  const response = await fetch(url, {
    headers: { ...(credential && !apiKey ? { Authorization: `Bearer ${credential}` } : {}), Accept: 'application/json' },
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
  if (pathname === '/api/health' && request.method === 'GET') return json(response, 200, { status: 'ok' });
  if (pathname === '/api/status' && request.method === 'GET') return json(response, 200, connectionStatus());

  if (pathname === '/api/account' || pathname.startsWith('/api/account/')) {
    let body;
    if (request.method === 'POST') {
      if (!siteJsonRequest(request)) {
        return json(response, 403, { error: 'Open Afterframe on its configured address to use accounts.' });
      }
      let raw = '';
      for await (const chunk of request) {
        raw += chunk;
        if (raw.length > (pathname === '/api/account/complete-series' ? 500000 : 16384)) return json(response, 413, { error: 'This account request is too large.' });
      }
      try { body = JSON.parse(raw); } catch { return json(response, 400, { error: 'Invalid account request.' }); }
    }
    const result = await accountApi(request, response, pathname, body);
    return json(response, result.code, result.body);
  }

  if (pathname === '/api/connection' && request.method === 'POST') {
    if (publicOrigin || !siteJsonRequest(request)) {
      return json(response, 403, { error: 'This installation manages integration keys on the server.' });
    }
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 4096) return json(response, 413, { error: 'The supplied credential is too long.' });
    }
    let submitted;
    try { submitted = JSON.parse(body); } catch { return json(response, 400, { error: 'Invalid request.' }); }
    const provider = submitted?.provider ?? 'tmdb';
    const value = submitted?.credential ?? submitted?.token;
    const candidate = typeof value === 'string' ? value.trim() : '';
    if (provider === 'tmdb') {
      if (!/^[\w.-]{20,2048}$/.test(candidate)) {
        return json(response, 400, { error: 'Enter your catalog API token or key.' });
      }
      await tmdb('/authentication', {}, candidate);
      saveProviderCredential(provider, candidate);
      tmdbCredential = candidate;
    } else if (provider === 'omdb') {
      if (!/^[\w-]{1,128}$/.test(candidate)) {
        return json(response, 400, { error: 'Enter your OMDb API key.' });
      }
      const failure = await validateOmdbKey(candidate).catch(() => ({ status: 502, error: 'OMDb is temporarily unavailable. Try again later.' }));
      if (failure) return json(response, failure.status, { error: failure.error });
      saveProviderCredential(provider, candidate);
      setOmdbKey(candidate);
    } else {
      return json(response, 400, { error: 'Choose a supported integration.' });
    }
    return json(response, 200, connectionStatus());
  }

  if (pathname === '/api/anime-discovery' && request.method === 'GET') return json(response, 200, await seasonalAnime(searchParams));
  const mal = pathname.match(/^\/api\/mal\/(anime|manga)\/([1-9]\d{0,9})$/);
  if (mal && request.method === 'GET') return json(response, 200, { rating: await malRating(mal[1], mal[2]) });
  const catalogMal = pathname.match(/^\/api\/mal\/catalog\/(movie|tv)\/([1-9]\d{0,9})$/);
  if (catalogMal && request.method === 'GET') {
    const season = searchParams.get('season') || '1';
    if (!/^\d{1,4}$/.test(season)) return json(response, 400, { error: 'Invalid season.' });
    return json(response, 200, { rating: await catalogAnimeRating(catalogMal[1], catalogMal[2], season) });
  }
  if (pathname === '/api/recommendations' && ['GET', 'POST'].includes(request.method)) {
    const account = currentAccount(request);
    let library = account ? readLibrary(account.id) : undefined;
    if (!account && request.method === 'POST') {
      if (!siteJsonRequest(request)) return json(response, 403, { error: 'Open recommendations from Afterframe.' });
      let raw = '';
      for await (const chunk of request) {
        raw += chunk;
        if (raw.length > 64000) return json(response, 413, { error: 'Recommendation request is too large.' });
      }
      try { library = JSON.parse(raw); } catch { return json(response, 400, { error: 'Invalid recommendation request.' }); }
    }
    return json(response, 200, await recommendations(library || undefined, tmdb, Boolean(tmdbCredential)));
  }
  if (pathname === '/api/comics/report' && request.method === 'POST') {
    response.writeHead(await reportComicPage(request), { 'cache-control': 'no-store' });
    return response.end();
  }
  if (request.method !== 'GET') return json(response, 405, { error: 'Method unavailable.' });
  if (pathname === '/api/comics' || pathname.startsWith('/api/comics/')) {
    const result = await comicsApi(pathname, searchParams);
    return json(response, result.status, result.body);
  }
  const anime = pathname.match(/^\/api\/anime\/(movie|tv)\/([1-9]\d{0,9})$/);
  if (anime) {
    const [, type, id] = anime;
    const season = searchParams.get('s') || '';
    const episode = searchParams.get('e') || '';
    if (type === 'tv' && (!/^\d{1,4}$/.test(season) || !/^[1-9]\d{0,3}$/.test(episode))) return json(response, 400, { error: 'Invalid episode coordinates.' });
    if (!tmdbCredential) return json(response, 503, { error: 'Connect the catalog in Settings.' });
    const title = await titleMetadata(type, id);
    if (!isAnime(title.original_language, title.genres?.map(genre => genre.id))) return json(response, 200, { source: null });
    try {
      return json(response, 200, { source: await animeSource(type, id, Number(season), type === 'tv' ? Number(episode) : 1) });
    } catch {
      return json(response, 502, { error: 'The anime player is temporarily unavailable.' });
    }
  }
  if (pathname === '/api/imdb') return json(response, 200, { rating: await imdbRating(searchParams.get('id')) });
  if (pathname === '/api/imdb/cached') {
    const keys = [...new Set((searchParams.get('titles') || '').split(','))].filter(key => /^(movie|tv):[1-9]\d{0,9}$/.test(key)).slice(0, 100);
    return json(response, 200, { ratings: keys.length ? await cachedRatings(keys) : {} });
  }
  if (pathname === '/api/catalog/facts') {
    const keys = [...new Set((searchParams.get('titles') || '').split(','))].filter(key => /^(movie|tv):[1-9]\d{0,9}$/.test(key)).slice(0, 20);
    return json(response, 200, { facts: keys.length && tmdbCredential ? await catalogFacts(keys) : {} });
  }
  const related = pathname.match(/^\/api\/(movie|tv)\/([1-9]\d{0,9})\/related$/);
  if (related && tmdbCredential) {
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
    const verified = verifiedCuts[`${searchParams.get('source')}/${type}/${id}/${season}/${episode}`];
    if (verified && Math.abs(verified.durationMs - duration) <= 200) {
      return json(response, 200, { segments: verified.segments.map(segment => ({ ...segment, end: segment.end ?? duration / 1000 })) });
    }
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
      const candidates = (Array.isArray(data[kind]) ? data[kind] : []).filter(entry => Number.isFinite(entry?.confidence) && entry.confidence >= .5);
      // A tightly clustered timestamp can describe a different cut of nearly the same length.
      if (kind !== 'credits') candidates.sort((a, b) => (b.submission_count ?? 0) - (a.submission_count ?? 0) || b.confidence - a.confidence);
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
  if (pathname.startsWith('/api/archive/')) {
    const id = pathname.slice('/api/archive/'.length);
    const item = archiveIdPattern.test(id) ? await archiveEdition(id) : null;
    return item ? json(response, 200, item) : json(response, 404, { error: 'A playable licensed video is unavailable for this Archive item.' });
  }

  const route = pathname.match(/^\/api\/(movie|tv)\/(\d{1,10})(?:\/season\/(\d{1,4}))?$/);
  if (!route && !['/api/search', '/api/trending', '/api/browse', '/api/home'].includes(pathname)) return json(response, 404, { error: 'Not found.' });
  if (!tmdbCredential) return json(response, 503, { error: 'Connect the catalog in Settings to use the full catalog.' });

  const page = Number(searchParams.get('page') || 1);
  if (!Number.isInteger(page) || page < 1 || page > 500) return json(response, 400, { error: 'That catalog page is unavailable.' });

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
    if (collection === 'new' && !searchParams.has('sort')) filters.sort = 'newest';
    return json(response, 200, await discover(type, page, filters, collection));
  }
  if (pathname === '/api/home') {
    const collections = [
      ['newMovies', 'movie', 'newest', 'new', ''],
      ['newTV', 'tv', 'newest', 'new', ''],
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
  if (publicOrigin ? request.headers.host !== publicOrigin.host : !localHosts.has(request.headers.host)) return json(response, 403, { error: 'Use the configured address to open Afterframe.' });
  if (publicOrigin) response.setHeader('strict-transport-security', 'max-age=31536000');
  try {
    const url = new URL(request.url, 'http://localhost');
    if (publicOrigin && url.pathname.startsWith('/api/')) {
      const requestId = randomUUID();
      const started = performance.now();
      response.setHeader('x-request-id', requestId);
      response.once('finish', () => console.log(JSON.stringify({ requestId, method: request.method, path: url.pathname,
        status: response.statusCode, durationMs: Math.round(performance.now() - started) })));
    }
    if (url.pathname.startsWith('/api/')) return await handleApi(request, response, url);
    if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { error: 'Method unavailable.' });
    if (url.pathname.startsWith('/comic-page/')) {
      const controller = new AbortController();
      response.once('close', () => controller.abort());
      const image = await comicPageResponse(url.pathname, controller.signal);
      if (!image?.body) return json(response, 404, { error: 'Comic page unavailable.' });
      response.writeHead(200, {
        'content-type': image.headers.get('content-type'),
        'cache-control': 'private, max-age=1800',
        'cross-origin-resource-policy': 'same-origin',
      });
      if (request.method === 'HEAD') {
        await image.body.cancel();
        return response.end();
      }
      return await pipeline(Readable.fromWeb(image.body), response);
    }
    if (url.pathname.startsWith('/comic-cover/')) {
      const cover = await comicCoverResponse(url.pathname);
      if (!cover?.body) return json(response, 404, { error: 'Comic cover unavailable.' });
      response.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' });
      if (request.method === 'HEAD') {
        await cover.body.cancel();
        return response.end();
      }
      return await pipeline(Readable.fromWeb(cover.body), response);
    }
    if (/^\/stream\/[\w.-]+(?:\/[\w-]+)?$/.test(url.pathname)) return await relayArchive(request, response, url.pathname);
    await serveFile(request, response, url.pathname);
  } catch (error) {
    if (response.destroyed) return;
    if (response.headersSent) return response.destroy();
    if (error.statusCode === 400) return json(response, 400, { error: error.message });
    const status = error.upstreamStatus;
    if (status === 401 || status === 403) return json(response, 401, { error: 'The catalog rejected the API credential.' });
    if (status === 404) return json(response, 404, { error: 'This title was not found.' });
    if (status === 429) return json(response, 429, { error: 'The catalog is temporarily limiting requests. Try again shortly.' });
    return json(response, 502, { error: 'The source is temporarily unavailable.' });
  }
});

refreshMetadataPeriodically(async key => {
  const match = key.match(/^title:(movie|tv):(\d{1,10}):(\d{0,4})$/);
  if (match && tmdbCredential) await titleMetadata(match[1], match[2], match[3], true);
});
server.listen(port, '127.0.0.1', () => console.log(`Afterframe is ready at http://localhost:${port}`));
monitorReleases(id => cacheMetadata(`release:${id}`, 10 * 60000, () => tmdb(`/tv/${id}`, { language: 'en-US' })), () => Boolean(tmdbCredential), (id, season) => titleMetadata('tv', id, season));
