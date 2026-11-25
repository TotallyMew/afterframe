import { discoverParams, isAnime } from '@afterframe/shared/discover';
import { enrichAnimeDetails, enrichAnimeSeason } from './anime.mjs';
import { catalogAnimeRating } from './mal.mjs';
import { cacheMetadata, cachedRatings, hasOmdbKey, imdbRating, peekMetadata, setOmdbKey } from './metadata.mjs';
import { providerCredential } from '../accounts/accounts.mjs';
import { fetchWithRetry } from '../http-client.mjs';
import { publicOrigin } from '../http-settings.mjs';

const tmdbKeyPattern = /^[a-f0-9]{32}$/i;
let tmdbCredential = '';

export async function loadInitialCredentials() {
  tmdbCredential = (!publicOrigin && await providerCredential('tmdb'))
    || process.env.TMDB_READ_TOKEN?.trim()
    || process.env.TMDB_API_KEY?.trim()
    || '';
  const savedOmdbKey = !publicOrigin && await providerCredential('omdb');
  if (savedOmdbKey) setOmdbKey(savedOmdbKey);
}

export function hasTmdbCredential() {
  return Boolean(tmdbCredential);
}

export function setTmdbCredential(value) {
  tmdbCredential = value;
}

export function connectionStatus() {
  return { connected: Boolean(tmdbCredential), omdbConnected: hasOmdbKey(), managedIntegrations: Boolean(publicOrigin) };
}

export async function tmdb(path, params = {}, credential = tmdbCredential) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  url.search = new URLSearchParams(params).toString();
  const apiKey = tmdbKeyPattern.test(credential);
  if (apiKey) url.searchParams.set('api_key', credential);
  const response = await fetchWithRetry(url, {
    headers: { ...(credential && !apiKey ? { Authorization: `Bearer ${credential}` } : {}), Accept: 'application/json' },
  }, { timeoutMs: 12000, retries: 1 });
  if (!response.ok) {
    await response.body?.cancel();
    throw Object.assign(new Error('TMDB request failed'), { upstreamStatus: response.status });
  }
  return response.json();
}

export function rawTitleMetadata(type, id, season, refresh = false) {
  const path = `/${type}/${id}`;
  const hasSeason = season !== undefined && season !== null && season !== '';
  return cacheMetadata(`title:${type}:${id}:${season ?? ''}`, 12 * 3600000, () => hasSeason && type === 'tv'
    ? tmdb(`${path}/season/${season}`, { language: 'en-US' })
    : tmdb(path, { language: 'en-US', append_to_response: 'watch/providers,external_ids,credits' }), refresh);
}

export async function titleMetadata(type, id, season, refresh = false) {
  const data = await rawTitleMetadata(type, id, season, refresh);
  if (type !== 'tv') return data;
  const hasSeason = season !== undefined && season !== null && season !== '';
  if (hasSeason) {
    const seasonNumber = Number(season);
    if (!Number.isSafeInteger(seasonNumber) || seasonNumber < 1) return data;
    const parent = peekMetadata(`title:tv:${id}:`) ?? peekMetadata(`basic:tv:${id}:`)
      ?? await basicTitle('tv', id).catch(() => null);
    if (!isAnime(parent?.original_language, parent?.genres?.map(genre => genre.id))) return data;
    return enrichAnimeSeason(id, seasonNumber, data).catch(() => data);
  }
  if (!isAnime(data?.original_language, data?.genres?.map(genre => genre.id))) return data;
  return enrichAnimeDetails(id, data, seasonNumber => rawTitleMetadata('tv', id, String(seasonNumber))).catch(() => data);
}

export function basicTitle(type, id) {
  return peekMetadata(`title:${type}:${id}:`) ?? cacheMetadata(`basic:${type}:${id}:`, 12 * 3600000,
    () => tmdb(`/${type}/${id}`, { language: 'en-US', ...(type === 'tv' ? { append_to_response: 'external_ids' } : {}) }));
}

export async function catalogFacts(keys) {
  const cached = await cachedRatings(keys);
  const facts = {};
  const hasMal = Boolean(process.env.MAL_CLIENT_ID?.trim());
  let index = 0;
  async function loadFacts() {
    while (index < keys.length) {
      const key = keys[index++];
      const [type, id] = key.split(':');
      const cardKey = `${type}-${id}`;
      try {
        const needDetails = type === 'tv' || (!cached[cardKey] && hasOmdbKey()) || hasMal;
        const details = needDetails ? await basicTitle(type, id) : null;
        const external = details?.external_ids?.imdb_id || details?.imdb_id;
        const anime = details && isAnime(details.original_language, details.genres?.map(genre => genre.id));
        const [rating, mal] = await Promise.all([
          cached[cardKey] ? Promise.resolve(cached[cardKey]) : imdbRating(external),
          anime && hasMal ? catalogAnimeRating(type, id, 1).catch(() => null) : Promise.resolve(null),
        ]);
        facts[cardKey] = {
          rating,
          ...(mal ? { mal } : {}),
          seasons: details?.number_of_seasons, status: details?.status,
        };
      } catch {
        if (cached[cardKey]) facts[cardKey] = { rating: cached[cardKey] };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, keys.length) }, loadFacts));
  return facts;
}

export async function discover(type, page, filters, collection) {
  const params = { language: 'en-US', page, include_adult: 'false', ...discoverParams(type, filters, collection) };
  const data = await cacheMetadata(`discover:${type}:${JSON.stringify(params)}`, 30 * 60000, () => tmdb(`/discover/${type}`, params));
  let results = data.results.filter(item => !item.adult).map(item => ({ ...item, media_type: type }));
  let ratingCoverage;
  if (filters.imdb) {
    const facts = await catalogFacts(results.map(item => `${type}:${item.id}`));
    ratingCoverage = { total: results.length, rated: results.filter(item => facts[`${type}-${item.id}`]?.rating?.score > 0).length };
    results = results.flatMap(item => {
      const info = facts[`${type}-${item.id}`];
      return info?.rating?.score >= filters.imdb ? [{ ...item, catalog_facts: info }] : [];
    });
  }
  return { results, total: filters.imdb ? null : data.total_results, ...(ratingCoverage ? { ratingCoverage } : {}), nextPage: page < Math.min(data.total_pages, 500) ? page + 1 : null };
}
