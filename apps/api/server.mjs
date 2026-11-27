import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { catalogFilters, isAnime, matchesCatalog } from '@afterframe/shared/discover';
import { archiveEdition, archiveIdPattern } from './catalog/archive.mjs';
import { accountApi, accountStorageHealth, clientAddress, closeAccountStorage, currentAccount, readLibrary, saveProviderCredential } from './accounts/accounts.mjs';
import { recommendations, seasonalAnime } from './catalog/discovery.mjs';
import { monitorReleases } from './catalog/releases.mjs';
import { catalogAnimeRating, malRating } from './catalog/mal.mjs';
import { comicCoverResponse, comicPageResponse, comicsApi } from './comics/comics.mjs';
import { animeStreamSource, emnexEpisode, emnexServers, enrichAnimeDetails, hasEmnexKey } from './catalog/anime.mjs';
import { cacheMetadata, cachedRatings, closeMetadataPool, imdbRating, refreshMetadataPeriodically, setOmdbKey, validateOmdbKey } from './catalog/metadata.mjs';
import { basicTitle, catalogFacts, connectionStatus, discover, hasTmdbCredential, loadInitialCredentials, rawTitleMetadata, setTmdbCredential, titleMetadata, tmdb, tvRatingsMap } from './catalog/tmdb.mjs';
import { loadSegments } from './catalog/segments.mjs';
import { relayArchive } from './archive-stream.mjs';
import { checkRateLimit } from './rate-limit.mjs';
import { serveFile } from './static.mjs';
import { applySecurityHeaders, compressBuffer, negotiateEncoding, publicOrigin } from './http-settings.mjs';

const port = Number(process.env.PORT || 4173);
const localPort = Number(process.env.AFTERFRAME_WEB_PORT || port);
const localHosts = new Set([`localhost:${localPort}`, `127.0.0.1:${localPort}`]);
const allowedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const publicCatalogCache = { 'cache-control': 'public, max-age=60, stale-while-revalidate=300' };
const longCatalogCache = { 'cache-control': 'public, max-age=3600, stale-while-revalidate=3600' };
let activeArchiveStreams = 0;
const maxConcurrentArchiveStreams = 12;

function siteJsonRequest(request) {
  return request.headers.origin === (publicOrigin?.origin || `http://${request.headers.host}`)
    && request.headers['content-type']?.split(';')[0].trim().toLowerCase() === 'application/json';
}

async function readJsonBody(request, maxBytes) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) return { tooLarge: true };
    chunks.push(buffer);
  }
  try {
    return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { invalid: true };
  }
}

async function json(response, status, body, extraHeaders = {}, request = null) {
  if (status === 304) {
    response.writeHead(304, extraHeaders);
    return response.end();
  }
  const serialized = JSON.stringify(body);
  const encoding = request ? negotiateEncoding(request.headers?.['accept-encoding']) : null;
  if (encoding && serialized.length >= 1024) {
    const compressed = await compressBuffer(Buffer.from(serialized, 'utf8'), encoding);
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': compressed.buffer.length,
      vary: 'Accept-Encoding',
      ...(compressed.encoding ? { 'content-encoding': compressed.encoding } : {}),
      ...extraHeaders,
    });
    return response.end(compressed.buffer);
  }
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders });
  response.end(serialized);
}

function enforceRateLimit(request, response, scope, policy) {
  const verdict = checkRateLimit(scope, clientAddress(request), policy);
  if (verdict.allowed) return false;
  void json(response, 429, { error: 'Too many requests. Try again shortly.' }, { 'retry-after': String(verdict.retryAfterSeconds) }, request);
  return true;
}

export async function handleApi(request, response, url) {
  const send = (statusCode, body, extraHeaders = {}) => json(response, statusCode, body, extraHeaders, request);
  const { pathname, searchParams } = url;
  if (pathname === '/api/health' && request.method === 'GET') {
    try { await accountStorageHealth(); }
    catch { return send(503, { status: 'unavailable' }); }
    return send(200, { status: 'ok' });
  }
  if (pathname === '/api/account/import' && request.method === 'POST') {
    if (enforceRateLimit(request, response, 'account-import', { limit: 5, windowMs: 15 * 60_000 })) return;
  } else if (enforceRateLimit(request, response, 'api', { limit: 120, windowMs: 60_000 })) {
    return;
  }
  if (pathname === '/api/status' && request.method === 'GET') return send(200, connectionStatus());

  if (pathname === '/api/account' || pathname.startsWith('/api/account/')) {
    let body;
    if (request.method === 'POST') {
      if (!siteJsonRequest(request)) {
        return send(403, { error: 'Open Afterframe on its configured address to use accounts.' });
      }
      const maxAccountBytes = pathname === '/api/account/import' ? 2_097_152 : pathname === '/api/account/complete-series' ? 500000 : 16384;
      const parsed = await readJsonBody(request, maxAccountBytes);
      if (parsed.tooLarge) return send(413, { error: 'This account request is too large.' });
      if (parsed.invalid) return send(400, { error: 'Invalid account request.' });
      body = parsed.value;
    }
    const result = await accountApi(request, response, pathname, body);
    return send(result.code, result.body, result.headers || {});
  }

  if (pathname === '/api/connection' && request.method === 'POST') {
    if (publicOrigin || !siteJsonRequest(request)) {
      return json(response, 403, { error: 'This installation manages integration keys on the server.' });
    }
    const parsed = await readJsonBody(request, 4096);
    if (parsed.tooLarge) return json(response, 413, { error: 'The supplied credential is too long.' });
    if (parsed.invalid) return json(response, 400, { error: 'Invalid request.' });
    const submitted = parsed.value;
    const provider = submitted?.provider ?? 'tmdb';
    const value = submitted?.credential ?? submitted?.token;
    const candidate = typeof value === 'string' ? value.trim() : '';
    if (provider === 'tmdb') {
      if (!/^[\w.-]{20,2048}$/.test(candidate)) {
        return json(response, 400, { error: 'Enter your catalog API token or key.' });
      }
      await tmdb('/authentication', {}, candidate);
      await saveProviderCredential(provider, candidate);
      setTmdbCredential(candidate);
    } else if (provider === 'omdb') {
      if (!/^[\w-]{1,128}$/.test(candidate)) {
        return json(response, 400, { error: 'Enter your OMDb API key.' });
      }
      const failure = await validateOmdbKey(candidate).catch(() => ({ status: 502, error: 'OMDb is temporarily unavailable. Try again later.' }));
      if (failure) return json(response, failure.status, { error: failure.error });
      await saveProviderCredential(provider, candidate);
      setOmdbKey(candidate);
    } else {
      return json(response, 400, { error: 'Choose a supported integration.' });
    }
    return json(response, 200, connectionStatus());
  }

  if (pathname === '/api/anime-discovery' && request.method === 'GET') return send(200, await seasonalAnime(searchParams, tmdb, hasTmdbCredential()), publicCatalogCache);
  const mal = pathname.match(/^\/api\/mal\/(anime|manga)\/([1-9]\d{0,9})$/);
  if (mal && request.method === 'GET') return send(200, { rating: await malRating(mal[1], mal[2], searchParams.get('status') === '1') }, publicCatalogCache);
  if (pathname === '/api/mal/manga/batch' && request.method === 'GET') {
    const ids = [...new Set((searchParams.get('ids') || '').split(','))].filter(id => /^[1-9]\d{0,9}$/.test(id)).slice(0, 24);
    const ratings = {};
    for (let offset = 0; offset < ids.length; offset += 4) {
      await Promise.all(ids.slice(offset, offset + 4).map(async id => {
        const score = await malRating('manga', id);
        if (score) ratings[id] = score;
      }));
    }
    return send(200, { ratings }, publicCatalogCache);
  }
  const catalogMal = pathname.match(/^\/api\/mal\/catalog\/(movie|tv)\/([1-9]\d{0,9})$/);
  if (catalogMal && request.method === 'GET') {
    const season = searchParams.get('season') || '1';
    if (!/^\d{1,4}$/.test(season)) return send(400, { error: 'Invalid season.' });
    return send(200, { rating: await catalogAnimeRating(catalogMal[1], catalogMal[2], season, searchParams.get('status') === '1') }, publicCatalogCache);
  }
  if (pathname === '/api/recommendations' && ['GET', 'POST'].includes(request.method)) {
    const account = await currentAccount(request);
    let library = account ? await readLibrary(account.id) : undefined;
    if (!account && request.method === 'POST') {
      if (!siteJsonRequest(request)) return send(403, { error: 'Open recommendations from Afterframe.' });
      const parsed = await readJsonBody(request, 64000);
      if (parsed.tooLarge) return send(413, { error: 'Recommendation request is too large.' });
      if (parsed.invalid) return send(400, { error: 'Invalid recommendation request.' });
      library = parsed.value;
    }
    return send(200, await recommendations(library || undefined, tmdb, hasTmdbCredential()));
  }
  if (request.method !== 'GET') return send(405, { error: 'Method unavailable.' });
  if (pathname === '/api/comics' || pathname.startsWith('/api/comics/')) {
    const result = await comicsApi(pathname, searchParams);
    const cacheHeaders = result.status === 200
      ? (pathname === '/api/comics/genres' ? longCatalogCache : publicCatalogCache)
      : {};
    return send(result.status, result.body, cacheHeaders);
  }
  const emnexStreamRoute = pathname.match(/^\/api\/anime\/stream\/([1-9]\d{0,9})\/([1-9]\d{0,4})$/);
  if (emnexStreamRoute) {
    if (!hasEmnexKey()) return send(503, { error: 'EmnexAnime is not configured on this server.' });
    const [, animeId, episode] = emnexStreamRoute;
    const rawType = searchParams.get('type') || 'sub';
    if (rawType !== 'sub' && rawType !== 'dub') return send(400, { error: 'Invalid anime audio type.' });
    const idType = searchParams.get('idType') || 'anilist';
    if (idType !== 'anilist' && idType !== 'mal') return send(400, { error: 'Invalid anime identifier type.' });
    const provider = searchParams.get('provider')?.trim() || '';
    if (provider && !/^[A-Za-z0-9._-]{1,32}$/.test(provider)) return send(400, { error: 'Invalid anime server.' });
    const refresh = searchParams.get('refresh') === '1';
    if (refresh && enforceRateLimit(request, response, 'anime-refresh', { limit: 6, windowMs: 60_000 })) return;
    try {
      const stream = await emnexEpisode(Number(animeId), Number(episode), {
        type: rawType,
        provider,
        refresh,
        idType,
      });
      return send(200, stream);
    } catch (error) {
      const status = error?.upstreamStatus;
      if (status === 404) return send(404, { error: 'No EmnexAnime stream is available for this episode.' });
      if (status === 429) return send(429, { error: 'EmnexAnime is temporarily limiting requests. Try again shortly.' });
      if (status === 503) return send(503, { error: 'EmnexAnime is busy. Try again shortly.' });
      return send(502, { error: 'EmnexAnime stream is temporarily unavailable.' });
    }
  }
  const emnexServersRoute = pathname.match(/^\/api\/anime\/servers\/([1-9]\d{0,9})\/([1-9]\d{0,4})$/);
  if (emnexServersRoute) {
    if (!hasEmnexKey()) return send(503, { error: 'EmnexAnime is not configured on this server.' });
    const [, animeId, episode] = emnexServersRoute;
    const idType = searchParams.get('idType') || 'anilist';
    if (idType !== 'anilist' && idType !== 'mal') return send(400, { error: 'Invalid anime identifier type.' });
    try {
      return send(200, await emnexServers(Number(animeId), Number(episode), idType));
    } catch (error) {
      const status = error?.upstreamStatus;
      if (status === 404) return send(404, { error: 'No EmnexAnime servers were found for this episode.' });
      if (status === 429) return send(429, { error: 'EmnexAnime is temporarily limiting requests. Try again shortly.' });
      return send(502, { error: 'EmnexAnime servers are temporarily unavailable.' });
    }
  }
  const anime = pathname.match(/^\/api\/anime\/(movie|tv)\/([1-9]\d{0,9})$/);
  if (anime) {
    const [, type, id] = anime;
    const season = searchParams.get('s') || '';
    const episode = searchParams.get('e') || '';
    if (type === 'tv' && (!/^\d{1,4}$/.test(season) || !/^[1-9]\d{0,3}$/.test(episode))) return send(400, { error: 'Invalid episode coordinates.' });
    if (!hasTmdbCredential()) return send(503, { error: 'Connect the catalog in Settings.' });
    const title = await titleMetadata(type, id);
    if (!isAnime(title.original_language, title.genres?.map(genre => genre.id))) return send(200, { source: null, emnex: hasEmnexKey() });
    try {
      return send(200, { source: await animeStreamSource(type, id, Number(season), type === 'tv' ? Number(episode) : 1), emnex: hasEmnexKey() });
    } catch {
      return send(502, { error: 'The anime player is temporarily unavailable.' });
    }
  }
  if (pathname === '/api/imdb') {
    if (enforceRateLimit(request, response, 'imdb-lookup', { limit: 30, windowMs: 60_000 })) return;
    return send(200, { rating: await imdbRating(searchParams.get('id'), searchParams.get('status') === '1') }, publicCatalogCache);
  }
  if (pathname === '/api/imdb/cached') {
    const keys = [...new Set((searchParams.get('titles') || '').split(','))].filter(key => /^(movie|tv):[1-9]\d{0,9}$/.test(key)).slice(0, 100);
    return send(200, { ratings: keys.length ? await cachedRatings(keys) : {} }, publicCatalogCache);
  }
  if (pathname === '/api/catalog/facts') {
    const keys = [...new Set((searchParams.get('titles') || '').split(','))].filter(key => /^(movie|tv):[1-9]\d{0,9}$/.test(key)).slice(0, 20);
    return send(200, { facts: keys.length && hasTmdbCredential() ? await catalogFacts(keys) : {} }, publicCatalogCache);
  }
  const related = pathname.match(/^\/api\/(movie|tv)\/([1-9]\d{0,9})\/related$/);
  if (related) {
    if (!hasTmdbCredential()) return send(503, { error: 'Connect the catalog in Settings to use the full catalog.' });
    const [, type, id] = related;
    const data = await cacheMetadata(`related:${type}:${id}`, 12 * 3600000, () => tmdb(`/${type}/${id}/recommendations`, { language: 'en-US', page: 1 }));
    return send(200, { results: data.results.filter(item => !item.adult).slice(0, 8).map(item => ({ ...item, media_type: type })) }, publicCatalogCache);
  }
  const ratingsMapRoute = pathname.match(/^\/api\/tv\/([1-9]\d{0,9})\/ratings-map$/);
  if (ratingsMapRoute) {
    if (!hasTmdbCredential()) return send(503, { error: 'Connect the catalog in Settings to use the full catalog.' });
    return send(200, await tvRatingsMap(ratingsMapRoute[1]), publicCatalogCache);
  }
  if (pathname === '/api/segments') {
    const result = await loadSegments(searchParams);
    return send(result.status, result.body, result.status === 200 ? longCatalogCache : {});
  }
  if (pathname.startsWith('/api/archive/')) {
    const id = pathname.slice('/api/archive/'.length);
    const item = archiveIdPattern.test(id) ? await archiveEdition(id) : null;
    return item ? send(200, item, publicCatalogCache) : send(404, { error: 'A playable licensed video is unavailable for this Archive item.' });
  }

  const route = pathname.match(/^\/api\/(movie|tv)\/([1-9]\d{0,9})(?:(?:\/season\/(\d{1,4}))|(\/playback))?$/);
  if (!route && !['/api/search', '/api/trending', '/api/browse', '/api/home'].includes(pathname)) return send(404, { error: 'Not found.' });
  if (!hasTmdbCredential()) return send(503, { error: 'Connect the catalog in Settings to use the full catalog.' });

  const page = Number(searchParams.get('page') || 1);
  if (!Number.isInteger(page) || page < 1 || page > 500) return send(400, { error: 'That catalog page is unavailable.' });

  if (pathname === '/api/search') {
    const query = searchParams.get('q')?.trim().slice(0, 180);
    if (!query) return send(200, { results: [] });
    const type = searchParams.get('type');
    const endpoint = ['movie', 'tv'].includes(type) ? type : 'multi';
    const data = await tmdb(`/search/${endpoint}`, { query, language: 'en-US', include_adult: 'false', page });
    const filters = catalogFilters(searchParams);
    const results = data.results.filter(item => !item.adult && (endpoint !== 'multi' || ['movie', 'tv'].includes(item.media_type)))
      .map(item => ({ ...item, media_type: endpoint === 'multi' ? item.media_type : endpoint }))
      .filter(item => matchesCatalog({ year: (item.release_date || item.first_air_date || '').slice(0, 4), genreIds: item.genre_ids, originalLanguage: item.original_language }, filters));
    return send(200, { results, nextPage: page < Math.min(data.total_pages, 500) ? page + 1 : null }, publicCatalogCache);
  }
  if (pathname === '/api/browse') {
    const type = searchParams.get('type');
    if (!['movie', 'tv'].includes(type)) return send(400, { error: 'Choose movies or TV shows.' });
    const filters = catalogFilters(searchParams);
    const collection = searchParams.get('collection');
    if (collection === 'new' && !searchParams.has('sort')) filters.sort = 'newest';
    return send(200, await discover(type, page, filters, collection), publicCatalogCache);
  }
  if (pathname === '/api/home') {
    /** @type {readonly [string, string, string, string, string][]} */
    const collections = [
      ['newMovies', 'movie', 'newest', 'new', ''],
      ['newTV', 'tv', 'newest', 'new', ''],
      ['anime', 'tv', 'popular', '', 'Anime'],
    ];
    const load = ([, type, sort, collection, category]) => discover(type, 1, { sort, category, decade: 0 }, collection);
    const section = searchParams.get('section');
    if (section !== null) {
      const selected = collections.find(([key]) => key === section);
      return selected ? send(200, await load(selected), publicCatalogCache) : send(400, { error: 'Choose a home section.' });
    }
    const sections = await Promise.allSettled(collections.map(load));
    return send(200, Object.fromEntries(sections.flatMap((entry, index) =>
      entry.status === 'fulfilled' ? [[collections[index][0], entry.value.results]] : [])), publicCatalogCache);
  }
  if (pathname === '/api/trending') {
    const type = searchParams.get('type');
    const endpoint = ['movie', 'tv'].includes(type) ? type : 'all';
    const data = await cacheMetadata(`trending:${endpoint}:${page}`, 15 * 60000, () => tmdb(`/trending/${endpoint}/week`, { language: 'en-US', page }));
    const results = data.results.filter(item => !item.adult && (endpoint !== 'all' || ['movie', 'tv'].includes(item.media_type)))
      .map(item => ({ ...item, media_type: endpoint === 'all' ? item.media_type : endpoint }));
    return send(200, { results, nextPage: page < Math.min(data.total_pages, 500) ? page + 1 : null }, publicCatalogCache);
  }

  const [, type, id, season, playback] = route;
  return send(200, await (playback ? basicTitle(type, id) : titleMetadata(type, id, season)), publicCatalogCache);
}

export function createApiServer() {
  return createServer(async (request, response) => {
    applySecurityHeaders(response);
    const railwayHealth = request.headers.host === 'healthcheck.railway.app' && request.method === 'GET' && request.url === '/api/health';
    if (!railwayHealth && (publicOrigin ? request.headers.host !== publicOrigin.host : !localHosts.has(request.headers.host))) {
      return json(response, 403, { error: 'Use the configured address to open Afterframe.' });
    }
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
      if (/^\/(?:legacy|player)\/?$/.test(url.pathname)) {
        response.writeHead(302, { location: `/${url.search}`, 'cache-control': 'no-store' });
        return response.end();
      }
      if (url.pathname.startsWith('/comic-page/')) {
        if (enforceRateLimit(request, response, 'comic-media', { limit: 300, windowMs: 60_000 })) return;
        const controller = new AbortController();
        response.once('close', () => { if (!response.writableEnded) controller.abort(); });
        const image = await comicPageResponse(url.pathname, controller.signal);
        if (!image?.body) return json(response, 404, { error: 'Comic page unavailable.' });
        const normalizedType = image.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
        if (!allowedImageTypes.has(normalizedType)) {
          await image.body.cancel();
          return json(response, 502, { error: 'Comic page unavailable.' });
        }
        const length = image.headers.get('content-length');
        response.writeHead(200, {
          'content-type': normalizedType,
          ...(length && /^\d+$/.test(length) ? { 'content-length': length } : {}),
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
        if (enforceRateLimit(request, response, 'comic-media', { limit: 300, windowMs: 60_000 })) return;
        const controller = new AbortController();
        response.once('close', () => { if (!response.writableEnded) controller.abort(); });
        const cover = await comicCoverResponse(url.pathname, controller.signal);
        if (!cover?.body) return json(response, 404, { error: 'Comic cover unavailable.' });
        const length = cover.headers.get('content-length');
        response.writeHead(200, {
          'content-type': 'image/jpeg',
          ...(length && /^\d+$/.test(length) ? { 'content-length': length } : {}),
          'cache-control': 'public, max-age=86400',
        });
        if (request.method === 'HEAD') {
          await cover.body.cancel();
          return response.end();
        }
        return await pipeline(Readable.fromWeb(cover.body), response);
      }
      if (/^\/stream\/[\w.-]+(?:\/[\w-]+)?$/.test(url.pathname)) {
        if (enforceRateLimit(request, response, 'stream', { limit: 60, windowMs: 60_000 })) return;
        if (activeArchiveStreams >= maxConcurrentArchiveStreams) {
          return json(response, 503, { error: 'Too many active streams. Try again shortly.' });
        }
        activeArchiveStreams++;
        try {
          return await relayArchive(request, response, url.pathname, json);
        } finally {
          activeArchiveStreams = Math.max(0, activeArchiveStreams - 1);
        }
      }
      await serveFile(request, response, url.pathname, json);
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
}

export async function startApiServer() {
  await loadInitialCredentials();
  const server = createApiServer();
  const stopRefresh = refreshMetadataPeriodically(async key => {
    const match = key.match(/^title:v2:(movie|tv):(\d{1,10}):(\d{0,4})$/);
    if (match && hasTmdbCredential()) await titleMetadata(match[1], match[2], match[3], true);
  });
  const stopReleases = monitorReleases(
    async id => {
      const details = await cacheMetadata(`release:${id}`, 10 * 60000, () => tmdb(`/tv/${id}`, { language: 'en-US' }));
      if (!isAnime(details?.original_language, details?.genres?.map(genre => genre.id))) return details;
      return enrichAnimeDetails(id, details, season => rawTitleMetadata('tv', id, String(season))).catch(() => details);
    },
    hasTmdbCredential,
    (id, season) => titleMetadata('tv', id, season),
  );
  server.listen(port, process.env.AFTERFRAME_HOST || '127.0.0.1', () => console.log(`Afterframe API is listening on port ${port}`));

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopRefresh();
    stopReleases();
    server.close(async () => {
      await Promise.allSettled([closeAccountStorage(), closeMetadataPool()]);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}

const isEntrypoint = process.argv[1] && new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href === import.meta.url;
if (isEntrypoint) await startApiServer();
