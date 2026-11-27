import { discoverParams, isAnime } from '@afterframe/shared/discover';
import { animeVirtualSeasonPlan, enrichAnimeDetails, enrichAnimeSeason, sliceVirtualSeason } from './anime.mjs';
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
  return cacheMetadata(`title:v2:${type}:${id}:${season ?? ''}`, 12 * 3600000, () => hasSeason && type === 'tv'
    ? tmdb(`${path}/season/${season}`, { language: 'en-US' })
    : tmdb(path, {
      language: 'en-US',
      append_to_response: 'external_ids,credits,images,videos',
      include_image_language: 'en,null',
    }), refresh);
}

async function runWorkerQueue(items, concurrency, task) {
  let cursor = 0;
  async function runNext() {
    if (cursor >= items.length) return;
    const idx = cursor++;
    await task(items[idx], idx);
    await runNext();
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runNext));
}

function isAnimeTitle(meta) {
  return Boolean(meta && isAnime(meta.original_language, meta.genres?.map(genre => genre.id)));
}

async function fetchSeasonRatings(id, entry) {
  try {
    const data = await titleMetadata('tv', id, String(entry.season_number));
    const episodes = (data?.episodes ?? []).map(ep => ({
      episode_number: ep.episode_number,
      name: ep.name || `Episode ${ep.episode_number}`,
      vote_average: typeof ep.vote_average === 'number' && ep.vote_average > 0 ? Math.round(ep.vote_average * 10) / 10 : null,
      vote_count: typeof ep.vote_count === 'number' ? ep.vote_count : 0,
      air_date: ep.air_date || undefined,
    }));
    return { season_number: entry.season_number, name: entry.name || `Season ${entry.season_number}`, episodes };
  } catch {
    return { season_number: entry.season_number, name: entry.name || `Season ${entry.season_number}`, episodes: [] };
  }
}

export async function tvRatingsMap(id) {
  return cacheMetadata(`ratings-map:v2:tv:${id}`, 12 * 3600000, async () => {
    const details = await titleMetadata('tv', id);
    const regular = (details?.seasons ?? [])
      .filter(entry => entry.season_number > 0 && entry.episode_count > 0)
      .sort((a, b) => a.season_number - b.season_number)
      .slice(0, 30);
    const seasons = new Array(regular.length);
    await runWorkerQueue(regular, 4, async (entry, idx) => {
      seasons[idx] = await fetchSeasonRatings(id, entry);
    });
    return { seasons: seasons.filter(Boolean) };
  });
}

async function loadVirtualAnimeSeason(id, seasonNumber, parent, refresh) {
  const rawRegular = (parent?.seasons ?? []).filter(entry => entry.season_number > 0);
  if (rawRegular.length !== 1 || rawRegular[0].season_number !== 1) return null;
  const vPlan = await animeVirtualSeasonPlan(id).catch(() => null);
  const vSeason = vPlan?.find(entry => entry.season === seasonNumber);
  if (!vSeason) return null;
  const rawS1 = await rawTitleMetadata('tv', id, '1', refresh);
  const sliced = sliceVirtualSeason(rawS1, vSeason);
  return enrichAnimeSeason(id, seasonNumber, sliced, new Date(), {
    sourceSeason: 1,
    episodeOffset: vSeason.start - 1,
  }).catch(() => sliced);
}

async function loadTvSeasonMetadata(id, season, refresh) {
  const seasonNumber = Number(season);
  if (!Number.isSafeInteger(seasonNumber) || seasonNumber < 1) {
    return rawTitleMetadata('tv', id, season, refresh);
  }
  const parent = peekMetadata(`title:v2:tv:${id}:`) ?? peekMetadata(`basic:tv:${id}:`)
    ?? await basicTitle('tv', id).catch(() => null);
  if (!isAnimeTitle(parent)) {
    return rawTitleMetadata('tv', id, season, refresh);
  }
  const virtualSeason = await loadVirtualAnimeSeason(id, seasonNumber, parent, refresh);
  if (virtualSeason) return virtualSeason;
  const data = await rawTitleMetadata('tv', id, season, refresh);
  return enrichAnimeSeason(id, seasonNumber, data).catch(() => data);
}

export async function titleMetadata(type, id, season, refresh = false) {
  const hasSeason = season !== undefined && season !== null && season !== '';
  if (type === 'tv' && hasSeason) {
    return loadTvSeasonMetadata(id, season, refresh);
  }
  const data = await rawTitleMetadata(type, id, season, refresh);
  if (type !== 'tv' || !isAnimeTitle(data)) return data;
  return enrichAnimeDetails(id, data, seasonNumber => rawTitleMetadata('tv', id, String(seasonNumber))).catch(() => data);
}

export function basicTitle(type, id) {
  return peekMetadata(`title:v2:${type}:${id}:`) ?? cacheMetadata(`basic:${type}:${id}:`, 12 * 3600000,
    () => tmdb(`/${type}/${id}`, { language: 'en-US', ...(type === 'tv' ? { append_to_response: 'external_ids' } : {}) }));
}

async function resolveFactDetails(key, type, id, hasCachedRating, hasMal) {
  const peeked = peekMetadata(`title:v2:${key}:`) ?? peekMetadata(`basic:${key}:`);
  const peekedIsNonAnimeMovie = type === 'movie' && Boolean(peeked) && !isAnimeTitle(peeked);
  const needOmdb = !hasCachedRating && hasOmdbKey();
  const needMal = hasMal && !peekedIsNonAnimeMovie;
  if (type !== 'tv' && !needOmdb && !needMal) return null;
  return peeked ?? basicTitle(type, id);
}

function fetchFactSignals(type, id, details, cachedRating, hasMal) {
  const external = details?.external_ids?.imdb_id || details?.imdb_id;
  const anime = isAnimeTitle(details);
  const ratingPromise = cachedRating ? Promise.resolve(cachedRating) : imdbRating(external);
  const malPromise = anime && hasMal ? catalogAnimeRating(type, id, 1).catch(() => null) : Promise.resolve(null);
  const vPlanPromise = anime && type === 'tv' && details?.number_of_seasons === 1
    ? animeVirtualSeasonPlan(id).catch(() => null)
    : Promise.resolve(null);
  return Promise.all([ratingPromise, malPromise, vPlanPromise]);
}

function countVirtualSeasons(vPlan, details) {
  if (!vPlan || !details?.number_of_episodes) return 0;
  return vPlan.filter(entry => details.number_of_episodes >= entry.start).length;
}

async function loadFactForKey(key, cached, hasMal) {
  const [type, id] = key.split(':');
  const cardKey = `${type}-${id}`;
  try {
    const details = await resolveFactDetails(key, type, id, Boolean(cached[cardKey]), hasMal);
    const [rating, mal, vPlan] = await fetchFactSignals(type, id, details, cached[cardKey], hasMal);
    const virtualCount = countVirtualSeasons(vPlan, details);
    const seasons = virtualCount >= 2 ? virtualCount : details?.number_of_seasons;
    return [cardKey, { rating, ...(mal ? { mal } : {}), seasons, status: details?.status }];
  } catch {
    if (cached[cardKey]) return [cardKey, { rating: cached[cardKey] }];
    return null;
  }
}

export async function catalogFacts(keys) {
  const cached = await cachedRatings(keys);
  const facts = {};
  const hasMal = Boolean(process.env.MAL_CLIENT_ID?.trim());
  await runWorkerQueue(keys, 5, async key => {
    const entry = await loadFactForKey(key, cached, hasMal);
    if (entry) facts[entry[0]] = entry[1];
  });
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
