import { cacheMetadata } from './metadata.mjs';
import { animeCatalogTitles, animeDubInfo } from './anime.mjs';
import { recommendationProfile } from '@afterframe/shared/library';
import { malRating } from './mal.mjs';

function buildShownSet(library, excluded) {
  const shown = new Set(excluded);
  const allItems = [
    ...Object.values(library?.saved || {}),
    ...Object.values(library?.watched || {}).map(entry => entry?.item),
  ];
  for (const item of allItems) {
    if (excluded.has(item?.key) && Number.isSafeInteger(item.id)) shown.add(`${item.type}-${item.id}`);
  }
  return shown;
}

function filterDiscoveryItems(items, seen, limit) {
  const results = [];
  for (const item of items) {
    const key = `${item.media_type}-${item.id}`;
    if (item.adult || (item.media_type !== 'movie' && item.media_type !== 'tv') || seen.has(key)) continue;
    results.push(item);
    seen.add(key);
    if (results.length === limit) break;
  }
  return results;
}

async function fetchSeedCandidates(item, sectionLimit, completedSeries, tmdb) {
  const page1 = await cacheMetadata(`related:${item.type}:${item.id}`, 12 * 3600000, () => tmdb(`/${item.type}/${item.id}/recommendations`, { language: 'en-US', page: 1 }));
  let candidates = (page1.results || []).map(result => ({ ...result, media_type: item.type }));
  if (page1.total_pages > 1 && candidates.length < sectionLimit) {
    const page2 = await cacheMetadata(`related:${item.type}:${item.id}:2`, 12 * 3600000, () => tmdb(`/${item.type}/${item.id}/recommendations`, { language: 'en-US', page: 2 })).catch(() => null);
    if (page2?.results?.length) candidates = [...candidates, ...page2.results.map(result => ({ ...result, media_type: item.type }))];
  }
  const label = completedSeries.has(String(item.key)) ? `Because you completed ${item.title}` : `Based on ${item.title}`;
  return { label, candidates };
}

function topFavoriteGenres(seeds) {
  const genres = new Map();
  for (const { item, weight } of seeds) {
    for (const genre of Array.isArray(item.genreIds) ? item.genreIds : []) {
      if (!Number.isSafeInteger(genre) || genre < 1) continue;
      const key = `${item.type}:${genre}`;
      genres.set(key, (genres.get(key) || 0) + weight);
    }
  }
  return [...genres].sort((a, b) => b[1] - a[1]).slice(0, 2);
}

async function fetchGenreCandidates(favorite, idx, tmdb) {
  const [type, genre] = favorite.split(':');
  const page1 = await cacheMetadata(`recommend-genre:${favorite}`, 3600000, () => tmdb(`/discover/${type}`, { with_genres: genre, sort_by: 'popularity.desc', include_adult: 'false', page: 1 })).catch(() => null);
  let candidates = (page1?.results || []).map(item => ({ ...item, media_type: type }));
  if (page1?.total_pages > 1) {
    const page2 = await cacheMetadata(`recommend-genre:${favorite}:2`, 3600000, () => tmdb(`/discover/${type}`, { with_genres: genre, sort_by: 'popularity.desc', include_adult: 'false', page: 2 })).catch(() => null);
    if (page2?.results?.length) candidates = [...candidates, ...page2.results.map(item => ({ ...item, media_type: type }))];
  }
  return { idx, candidates };
}

async function loadPersonalizedSections(seeds, completedSeries, shown, tmdb) {
  const sectionLimit = 18;
  const sections = [];
  const selected = seeds.filter(({ item }) => Number.isSafeInteger(item.id) && Number(item.id) > 0).slice(0, 5);
  const seedResults = await Promise.allSettled(selected.map(({ item }) => fetchSeedCandidates(item, sectionLimit, completedSeries, tmdb)));
  for (const result of seedResults) {
    if (result.status !== 'fulfilled') continue;
    const items = filterDiscoveryItems(result.value.candidates, shown, sectionLimit);
    if (items.length) sections.push({ label: result.value.label, items });
  }
  const favoriteGenres = topFavoriteGenres(seeds);
  const genreResults = await Promise.all(favoriteGenres.map(([favorite], idx) => fetchGenreCandidates(favorite, idx, tmdb)));
  for (const { idx, candidates } of genreResults) {
    const items = filterDiscoveryItems(candidates, shown, sectionLimit);
    if (items.length) sections.push({ label: idx === 0 ? 'Based on genres you watch' : 'More from your favorite genres', items });
  }
  return sections;
}

async function collectTrendingItems(shown, tmdb, page = 1, acc = []) {
  if (page > 3 || acc.length >= 20) return acc;
  const trending = await cacheMetadata(`trending:all:${page}`, 15 * 60000, () => tmdb('/trending/all/week', { language: 'en-US', page }));
  acc.push(...filterDiscoveryItems(trending.results, shown, 20 - acc.length));
  if (!trending.total_pages || page >= trending.total_pages) return acc;
  return collectTrendingItems(shown, tmdb, page + 1, acc);
}

export async function recommendations(library, tmdb, tmdbEnabled) {
  const { personalized, seeds, excluded, completedSeries } = recommendationProfile(library);
  if (!tmdbEnabled) return { personalized: false, mode: 'unavailable', sections: [] };
  const shown = buildShownSet(library, excluded);
  const sections = personalized ? await loadPersonalizedSections(seeds, completedSeries, shown, tmdb) : [];
  if (!sections.length) {
    const items = await collectTrendingItems(shown, tmdb);
    if (items.length) sections.push({ label: 'Trending discovery picks', items });
  }
  return { personalized: personalized && sections.some(section => section.label !== 'Trending discovery picks'), sections };
}

const animeVariables = {
  year: 'Int', yearPattern: 'String', season: 'MediaSeason', format: 'MediaFormat', status: 'MediaStatus', genre: 'String', theme: 'String',
  min: 'Int', max: 'Int', sort: '[MediaSort]', page: 'Int',
};
const animeFormats = ['TV', 'TV_SHORT', 'MOVIE', 'OVA', 'ONA', 'SPECIAL'];
const animeStatus = ['RELEASING', 'NOT_YET_RELEASED', 'FINISHED', 'CANCELLED', 'HIATUS'];
const animeSort = new Set(['POPULARITY_DESC', 'SCORE_DESC', 'START_DATE_DESC', 'START_DATE']);
const seasonalVariableDefs = Object.entries(animeVariables).map(([name, type]) => `$${name}:${type}`).join(',');
const seasonalQuery = `query(${seasonalVariableDefs}) {
  Page(page:$page, perPage:20) { pageInfo { currentPage hasNextPage } media(type:ANIME, isAdult:false, seasonYear:$year, startDate_like:$yearPattern, season:$season, format:$format,
    status:$status, genre:$genre, tag:$theme, episodes_greater:$min, episodes_lesser:$max, sort:$sort) {
    id idMal title { romaji english } coverImage { large } startDate { year month day } season seasonYear format status episodes popularity
    nextAiringEpisode { episode airingAt }
  } } }`;

const seasonSuffixPatterns = [
  /(?:season|part|cour)\s+(\d+)$/i,
  /(\d+)(?:st|nd|rd|th)\s+(?:season|stage|cour)$/i,
  /final\s+season(?:\s+part\s+(\d+))?$/i,
  /(?:season|part|cour)(\d+)$/i,
];
const trailingSeparatorChars = new Set([':', '-', '–', '—', ' ', '\t', '\r', '\n']);

function trimTrailingSeparators(value) {
  let end = value.length;
  while (end > 0 && trailingSeparatorChars.has(value[end - 1])) end--;
  return value.slice(0, end);
}

function matchSeasonSuffix(value) {
  for (const pattern of seasonSuffixPatterns) {
    const match = pattern.exec(value);
    if (match) return match;
  }
  return null;
}

function normalizeAnimeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/['’`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function stripAnimeSeasonTitle(rawTitle) {
  let clean = String(rawTitle || '').trim();
  let season = null;
  for (let pass = 0; pass < 2; pass++) {
    const match = matchSeasonSuffix(clean);
    if (!match) break;
    const extracted = Number(match[1]);
    if (Number.isInteger(extracted) && extracted >= 1 && extracted <= 50 && season === null) {
      season = extracted;
    }
    clean = trimTrailingSeparators(clean.slice(0, match.index)).trim();
  }
  return { baseTitle: clean, season };
}

function collectFallbackQueries(rawNames) {
  let detectedSeason = null;
  const queries = [];
  const seenQueries = new Set();
  for (const raw of rawNames) {
    const { baseTitle, season } = stripAnimeSeasonTitle(raw);
    if (season && detectedSeason === null) detectedSeason = season;
    for (const candidate of [baseTitle, raw]) {
      const trimmed = candidate.trim();
      const norm = normalizeAnimeName(trimmed);
      if (trimmed && norm && !seenQueries.has(norm)) {
        seenQueries.add(norm);
        queries.push({ query: trimmed, norm });
      }
    }
  }
  return { detectedSeason, queries };
}

function scoreFallbackCandidate(res, targetNorms) {
  const names = [res.name, res.original_name, res.title, res.original_title].map(normalizeAnimeName).filter(Boolean);
  const exact = names.some(n => targetNorms.has(n));
  const starts = names.some(n => [...targetNorms].some(t => n.startsWith(t) || t.startsWith(n)));
  const isAnim = Array.isArray(res.genre_ids) && res.genre_ids.includes(16);
  const isJp = res.original_language === 'ja';
  let nameScore = 0;
  if (exact) nameScore = 10;
  else if (starts) nameScore = 4;
  const score = nameScore + (isAnim ? 5 : 0) + (isJp ? 3 : 0);
  return { res, score, exact, isAnim };
}

async function searchFallbackQueries(queries, targetNorms, mediaType, detectedSeason, tmdb, index = 0) {
  if (index >= queries.length) return null;
  const { query } = queries[index];
  const data = await tmdb(`/search/${mediaType}`, { query, language: 'en-US', include_adult: 'false', page: 1 }).catch(() => null);
  const list = Array.isArray(data?.results) ? data.results : [];
  const scored = list
    .filter(res => !res.adult && Number.isSafeInteger(res.id))
    .map(res => scoreFallbackCandidate(res, targetNorms))
    .filter(entry => entry.score >= 12 || (entry.exact && entry.isAnim))
    .sort((a, b) => b.score - a.score || (b.res.popularity || 0) - (a.res.popularity || 0));
  if (scored.length) {
    return {
      catalog: `${mediaType}/${scored[0].res.id}`,
      season: mediaType === 'tv' ? detectedSeason : null,
    };
  }
  return searchFallbackQueries(queries, targetNorms, mediaType, detectedSeason, tmdb, index + 1);
}

export async function fallbackAnimeCatalog(item, tmdb) {
  if (!tmdb || !item?.id) return null;
  const mediaType = item.format === 'MOVIE' ? 'movie' : 'tv';
  const rawNames = [item.title?.english, item.title?.romaji].filter(Boolean);
  if (!rawNames.length) return null;
  return cacheMetadata(`anime-tmdb-fallback:v1:${item.id}`, 7 * 86400000, () => {
    const { detectedSeason, queries } = collectFallbackQueries(rawNames);
    const targetNorms = new Set(queries.map(q => q.norm));
    return searchFallbackQueries(queries.slice(0, 2), targetNorms, mediaType, detectedSeason, tmdb);
  }).catch(() => null);
}

function invalidSeasonalParam(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function parseSeasonalNumericBounds(params, variables) {
  /** @type {readonly [string, number, number][]} */
  const bounds = [['year', 1900, 2100], ['min', 1, 5000], ['max', 1, 5000]];
  for (const [key, lower, upper] of bounds) {
    if (!params.get(key)) continue;
    const value = Number(params.get(key));
    if (!Number.isSafeInteger(value) || value < lower || value > upper) throw invalidSeasonalParam(`Invalid anime ${key}.`);
    variables[key] = value;
  }
  if (variables.min > variables.max) throw invalidSeasonalParam('Minimum episode count exceeds the maximum.');
  if (variables.year && !variables.season) {
    variables.yearPattern = `${variables.year}%`;
    delete variables.year;
  }
  if (variables.min) variables.min--;
  if (variables.max) variables.max++;
}

function parseSeasonalParams(params) {
  const variables = { page: Number(params.get('page') || 1), sort: [params.get('sort') || 'POPULARITY_DESC'] };
  if (!Number.isSafeInteger(variables.page) || variables.page < 1 || variables.page > 100 || !animeSort.has(variables.sort[0])) {
    throw invalidSeasonalParam('Invalid anime page or sort order.');
  }
  for (const [key, allowed] of Object.entries({ season: ['WINTER', 'SPRING', 'SUMMER', 'FALL'], format: animeFormats, status: animeStatus })) {
    const value = params.get(key);
    if (!value) continue;
    if (!allowed.includes(value)) throw invalidSeasonalParam(`Invalid anime ${key}.`);
    variables[key] = value;
  }
  parseSeasonalNumericBounds(params, variables);
  for (const key of ['genre', 'theme']) {
    const value = params.get(key)?.trim();
    if (value && (value.length > 60 || !/^[A-Za-z0-9 '&:/.,+-]+$/.test(value))) throw invalidSeasonalParam(`Invalid anime ${key}.`);
    if (value) variables[key] = value;
  }
  const audio = params.get('audio') || '';
  if (audio && !['dub', 'sub', 'dub-airing', 'sub-airing'].includes(audio)) throw invalidSeasonalParam('Invalid anime audio filter.');
  if (audio === 'sub-airing' && !variables.status) variables.status = 'RELEASING';
  if (audio === 'dub-airing' && !variables.status && !variables.season && !variables.year && !variables.yearPattern) {
    variables.status = 'RELEASING';
  }
  return { variables, audio };
}

function fetchSeasonalAnilistPage(variables, pageNum) {
  return cacheMetadata(`anime-season:v3:${JSON.stringify({ ...variables, page: pageNum })}`, 20 * 60000, async () => {
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      redirect: 'error',
      body: JSON.stringify({ query: seasonalQuery, variables: { ...variables, page: pageNum } }), signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Anime schedules are temporarily unavailable.');
    }
    const result = (await response.json()).data?.Page;
    if (!Array.isArray(result?.media)) throw new Error('Anime schedules are temporarily unavailable.');
    return result;
  });
}

function filterTaggedAnime(tagged, audio) {
  switch (audio) {
    case 'dub': return tagged.filter(item => item.hasDub);
    case 'sub': return tagged.filter(item => !item.hasDub);
    case 'dub-airing': return tagged.filter(item => item.dubAiring);
    case 'sub-airing': return tagged.filter(item => item.subAiring);
    default: return tagged;
  }
}

function tagAndFilterMedia(media, dubInfo, currentYear, audio) {
  const tagged = media.map(entry => {
    const inDubbed = Boolean(entry.idMal && dubInfo.dubbed.has(entry.idMal));
    const inIncomplete = Boolean(entry.idMal && dubInfo.incomplete.has(entry.idMal));
    const hasDub = inDubbed || inIncomplete;
    const subAiring = entry.status === 'RELEASING';
    const recentYear = Number(entry.seasonYear || entry.startDate?.year || 0);
    const dubAiring = (subAiring && hasDub) || (inIncomplete && (subAiring || recentYear >= currentYear - 1));
    return { ...entry, hasDub, subAiring, dubAiring };
  });
  return filterTaggedAnime(tagged, audio);
}

async function scanFilteredSeasonalPages(variables, dubInfo, currentYear, audio, pageSize) {
  const targetStart = (variables.page - 1) * pageSize;
  const targetEnd = variables.page * pageSize;
  const maxPage = Math.min(20, variables.page * 3);
  const allFiltered = [];

  async function scanPage(anilistPage) {
    const pageData = await fetchSeasonalAnilistPage(variables, anilistPage);
    const hasNextPage = Boolean(pageData.pageInfo?.hasNextPage);
    allFiltered.push(...tagAndFilterMedia(pageData.media, dubInfo, currentYear, audio));
    if (allFiltered.length > targetEnd || !hasNextPage || anilistPage >= maxPage) {
      return { hasNextPage, lastPage: anilistPage };
    }
    return scanPage(anilistPage + 1);
  }

  const { hasNextPage, lastPage } = await scanPage(1);
  const collected = allFiltered.slice(targetStart, targetEnd);
  const hasMore = allFiltered.length > targetEnd || (hasNextPage && lastPage < maxPage && collected.length > 0);
  return { collected, nextPage: hasMore ? variables.page + 1 : null };
}

async function runInBatches(items, batchSize, worker, start = 0) {
  if (start >= items.length) return;
  await Promise.all(items.slice(start, start + batchSize).map(worker));
  await runInBatches(items, batchSize, worker, start + batchSize);
}

async function enrichSeasonalResults(results, tmdb, tmdbEnabled) {
  const populateFallbacks = async () => {
    if (!tmdbEnabled || typeof tmdb !== 'function') return;
    const unmapped = results.filter(item => !item.catalog).slice(0, 8);
    await runInBatches(unmapped, 4, async item => {
      const found = await fallbackAnimeCatalog(item, tmdb);
      if (found?.catalog) {
        item.catalog = found.catalog;
        if (found.season) item.catalogSeason = found.season;
      }
    });
  };
  const populateMalScores = () => runInBatches(results, 6, async item => {
    item.mal = await malRating('anime', item.idMal);
  });
  await Promise.all([populateFallbacks(), populateMalScores()]);
}

export async function seasonalAnime(params, tmdb = null, tmdbEnabled = false) {
  const { variables, audio } = parseSeasonalParams(params);
  const dubInfo = await animeDubInfo().catch(() => ({ dubbed: new Set(), incomplete: new Set() }));
  const currentYear = new Date().getFullYear();
  const pageSize = 20;
  const needsClientFilter = audio === 'dub' || audio === 'sub' || audio === 'dub-airing';

  let collected;
  let nextPage;
  if (!needsClientFilter) {
    const pageData = await fetchSeasonalAnilistPage(variables, variables.page);
    const hasNextPage = Boolean(pageData.pageInfo?.hasNextPage);
    collected = tagAndFilterMedia(pageData.media, dubInfo, currentYear, audio).slice(0, pageSize);
    nextPage = hasNextPage && variables.page < 100 ? variables.page + 1 : null;
  } else {
    ({ collected, nextPage } = await scanFilteredSeasonalPages(variables, dubInfo, currentYear, audio, pageSize));
  }

  const mapped = await animeCatalogTitles(collected.map(item => item.id)).catch(() => new Map());
  const results = collected.map(item => {
    const match = mapped.get(item.id);
    return { ...item, catalog: match?.catalog ?? undefined, catalogSeason: match?.season ?? undefined, mal: null };
  });
  await enrichSeasonalResults(results, tmdb, tmdbEnabled);
  return { results, nextPage };
}
