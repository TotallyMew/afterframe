import { cacheMetadata } from './metadata.mjs';
import { animeCatalogTitles, animeDubInfo } from './anime.mjs';
import { recommendationProfile } from '@afterframe/shared/library';
import { malRating } from './mal.mjs';

export async function recommendations(library, tmdb, tmdbEnabled) {
  const { personalized, seeds, excluded, completedSeries } = recommendationProfile(library);
  if (!tmdbEnabled) return { personalized: false, mode: 'unavailable', sections: [] };
  const sections = [];
  const shown = new Set(excluded);
  for (const item of [...Object.values(library?.saved || {}), ...Object.values(library?.watched || {}).map(entry => entry?.item)]) {
    if (excluded.has(item?.key) && Number.isSafeInteger(item.id)) shown.add(`${item.type}-${item.id}`);
  }
  const filter = (items, seen, limit) => {
    const results = [];
    for (const item of items) {
      const key = `${item.media_type}-${item.id}`;
      if (item.adult || !['movie', 'tv'].includes(item.media_type) || seen.has(key)) continue;
      results.push(item);
      seen.add(key);
      if (results.length === limit) break;
    }
    return results;
  };
  if (personalized) {
    const sectionLimit = 18;
    const selected = seeds.filter(({ item }) => Number.isSafeInteger(item.id) && Number(item.id) > 0).slice(0, 5);
    await Promise.allSettled(selected.map(async ({ item }) => {
      const page1 = await cacheMetadata(`related:${item.type}:${item.id}`, 12 * 3600000, () => tmdb(`/${item.type}/${item.id}/recommendations`, { language: 'en-US', page: 1 }));
      let candidates = (page1.results || []).map(result => ({ ...result, media_type: item.type }));
      if (page1.total_pages > 1 && candidates.length < sectionLimit) {
        const page2 = await cacheMetadata(`related:${item.type}:${item.id}:2`, 12 * 3600000, () => tmdb(`/${item.type}/${item.id}/recommendations`, { language: 'en-US', page: 2 })).catch(() => null);
        if (page2?.results?.length) candidates = [...candidates, ...page2.results.map(result => ({ ...result, media_type: item.type }))];
      }
      return { label: completedSeries.has(String(item.key)) ? `Because you completed ${item.title}` : `Based on ${item.title}`, candidates };
    })).then(results => {
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const items = filter(result.value.candidates, shown, sectionLimit);
        if (items.length) sections.push({ label: result.value.label, items });
      }
    });
    const genres = new Map();
    for (const { item, weight } of seeds) {
      for (const genre of Array.isArray(item.genreIds) ? item.genreIds : []) {
        if (!Number.isSafeInteger(genre) || genre < 1) continue;
        const key = `${item.type}:${genre}`;
        genres.set(key, (genres.get(key) || 0) + weight);
      }
    }
    const favoriteGenres = [...genres].sort((a, b) => b[1] - a[1]).slice(0, 2);
    const genreResults = await Promise.all(favoriteGenres.map(async ([favorite], idx) => {
      const [type, genre] = favorite.split(':');
      const page1 = await cacheMetadata(`recommend-genre:${favorite}`, 3600000, () => tmdb(`/discover/${type}`, { with_genres: genre, sort_by: 'popularity.desc', include_adult: 'false', page: 1 })).catch(() => null);
      let candidates = (page1?.results || []).map(item => ({ ...item, media_type: type }));
      if (page1?.total_pages > 1) {
        const page2 = await cacheMetadata(`recommend-genre:${favorite}:2`, 3600000, () => tmdb(`/discover/${type}`, { with_genres: genre, sort_by: 'popularity.desc', include_adult: 'false', page: 2 })).catch(() => null);
        if (page2?.results?.length) candidates = [...candidates, ...page2.results.map(item => ({ ...item, media_type: type }))];
      }
      return { idx, candidates };
    }));
    for (const { idx, candidates } of genreResults) {
      const items = filter(candidates, shown, sectionLimit);
      if (items.length) sections.push({ label: idx === 0 ? 'Based on genres you watch' : 'More from your favorite genres', items });
    }
  }
  if (!sections.length) {
    const items = [];
    for (let page = 1; page <= 3 && items.length < 20; page++) {
      const trending = await cacheMetadata(`trending:all:${page}`, 15 * 60000, () => tmdb('/trending/all/week', { language: 'en-US', page }));
      items.push(...filter(trending.results, shown, 20 - items.length));
      if (!trending.total_pages || page >= trending.total_pages) break;
    }
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
const animeSort = ['POPULARITY_DESC', 'SCORE_DESC', 'START_DATE_DESC', 'START_DATE'];
const seasonalQuery = `query(${Object.entries(animeVariables).map(([name, type]) => `$${name}:${type}`).join(',')}) {
  Page(page:$page, perPage:20) { pageInfo { currentPage hasNextPage } media(type:ANIME, isAdult:false, seasonYear:$year, startDate_like:$yearPattern, season:$season, format:$format,
    status:$status, genre:$genre, tag:$theme, episodes_greater:$min, episodes_lesser:$max, sort:$sort) {
    id idMal title { romaji english } coverImage { large } startDate { year month day } season seasonYear format status episodes popularity
    nextAiringEpisode { episode airingAt }
  } } }`;

const seasonSuffixPattern = /\s*(?:[:-]\s*)?(?:(?:season|part|cour)\s*(\d+)|(\d+)(?:st|nd|rd|th)\s+(?:season|stage|cour)|final\s+season(?:\s+part\s*(\d+))?)\s*$/i;

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
    const match = clean.match(seasonSuffixPattern);
    if (!match) break;
    const extracted = Number(match[1] || match[2] || match[3]);
    if (Number.isInteger(extracted) && extracted >= 1 && extracted <= 50 && season === null) {
      season = extracted;
    }
    clean = clean.slice(0, match.index).replace(/[:\-–—\s]+$/, '').trim();
  }
  return { baseTitle: clean, season };
}

export async function fallbackAnimeCatalog(item, tmdb) {
  if (!tmdb || !item?.id) return null;
  const mediaType = item.format === 'MOVIE' ? 'movie' : 'tv';
  const rawNames = [item.title?.english, item.title?.romaji].filter(Boolean);
  if (!rawNames.length) return null;
  return cacheMetadata(`anime-tmdb-fallback:v1:${item.id}`, 7 * 86400000, async () => {
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
    const targetNorms = new Set(queries.map(q => q.norm));
    for (const { query } of queries.slice(0, 2)) {
      const data = await tmdb(`/search/${mediaType}`, { query, language: 'en-US', include_adult: 'false', page: 1 }).catch(() => null);
      const list = Array.isArray(data?.results) ? data.results : [];
      const scored = list
        .filter(res => !res.adult && Number.isSafeInteger(res.id))
        .map(res => {
          const names = [res.name, res.original_name, res.title, res.original_title].map(normalizeAnimeName).filter(Boolean);
          const exact = names.some(n => targetNorms.has(n));
          const starts = names.some(n => [...targetNorms].some(t => n.startsWith(t) || t.startsWith(n)));
          const isAnim = Array.isArray(res.genre_ids) && res.genre_ids.includes(16);
          const isJp = res.original_language === 'ja';
          const score = (exact ? 10 : starts ? 4 : 0) + (isAnim ? 5 : 0) + (isJp ? 3 : 0);
          return { res, score, exact, isAnim };
        })
        .filter(entry => entry.score >= 12 || (entry.exact && entry.isAnim))
        .sort((a, b) => b.score - a.score || (b.res.popularity || 0) - (a.res.popularity || 0));
      if (scored.length) {
        return {
          catalog: `${mediaType}/${scored[0].res.id}`,
          season: mediaType === 'tv' ? detectedSeason : null,
        };
      }
    }
    return null;
  }).catch(() => null);
}

export async function seasonalAnime(params, tmdb = null, tmdbEnabled = false) {
  const variables = { page: Number(params.get('page') || 1), sort: [params.get('sort') || 'POPULARITY_DESC'] };
  const invalid = message => Object.assign(new Error(message), { statusCode: 400 });
  if (!Number.isSafeInteger(variables.page) || variables.page < 1 || variables.page > 100 || !animeSort.includes(variables.sort[0])) throw invalid('Invalid anime page or sort order.');
  for (const [key, allowed] of Object.entries({ season: ['WINTER', 'SPRING', 'SUMMER', 'FALL'], format: animeFormats, status: animeStatus })) {
    const value = params.get(key);
    if (!value) continue;
    if (!allowed.includes(value)) throw invalid(`Invalid anime ${key}.`);
    variables[key] = value;
  }
  /** @type {readonly [string, number, number][]} */
  const bounds = [['year', 1900, 2100], ['min', 1, 5000], ['max', 1, 5000]];
  for (const [key, lower, upper] of bounds) {
    if (!params.get(key)) continue;
    const value = Number(params.get(key));
    if (!Number.isSafeInteger(value) || value < lower || value > upper) throw invalid(`Invalid anime ${key}.`);
    variables[key] = value;
  }
  if (variables.min > variables.max) throw invalid('Minimum episode count exceeds the maximum.');
  if (variables.year && !variables.season) {
    variables.yearPattern = `${variables.year}%`;
    delete variables.year;
  }
  if (variables.min) variables.min--;
  if (variables.max) variables.max++;
  for (const key of ['genre', 'theme']) {
    const value = params.get(key)?.trim();
    if (value && (value.length > 60 || !/^[A-Za-z0-9 '&:/.,+-]+$/.test(value))) throw invalid(`Invalid anime ${key}.`);
    if (value) variables[key] = value;
  }
  const audio = params.get('audio') || '';
  if (audio && !['dub', 'sub', 'dub-airing', 'sub-airing'].includes(audio)) throw invalid('Invalid anime audio filter.');
  if (audio === 'sub-airing' && !variables.status) variables.status = 'RELEASING';
  if (audio === 'dub-airing' && !variables.status && !variables.season && !variables.year && !variables.yearPattern) {
    variables.status = 'RELEASING';
  }
  const dubInfo = await animeDubInfo().catch(() => ({ dubbed: new Set(), incomplete: new Set() }));
  const currentYear = new Date().getFullYear();
  const fetchAnilistPage = async pageNum => cacheMetadata(`anime-season:v3:${JSON.stringify({ ...variables, page: pageNum })}`, 20 * 60000, async () => {
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
  const pageSize = 20;
  const needsClientFilter = audio === 'dub' || audio === 'sub' || audio === 'dub-airing';
  const collected = [];
  let hasNextPage = false;
  let nextPage = null;

  const tagAndFilter = media => {
    const tagged = media.map(entry => {
      const inDubbed = Boolean(entry.idMal && dubInfo.dubbed.has(entry.idMal));
      const inIncomplete = Boolean(entry.idMal && dubInfo.incomplete.has(entry.idMal));
      const hasDub = inDubbed || inIncomplete;
      const subAiring = entry.status === 'RELEASING';
      const recentYear = Number(entry.seasonYear || entry.startDate?.year || 0);
      const dubAiring = (subAiring && hasDub) || (inIncomplete && (subAiring || recentYear >= currentYear - 1));
      return { ...entry, hasDub, subAiring, dubAiring };
    });
    return audio === 'dub'
      ? tagged.filter(item => item.hasDub)
      : audio === 'sub'
        ? tagged.filter(item => !item.hasDub)
        : audio === 'dub-airing'
          ? tagged.filter(item => item.dubAiring)
          : audio === 'sub-airing'
            ? tagged.filter(item => item.subAiring)
            : tagged;
  };

  if (!needsClientFilter) {
    const pageData = await fetchAnilistPage(variables.page);
    hasNextPage = Boolean(pageData.pageInfo?.hasNextPage);
    collected.push(...tagAndFilter(pageData.media).slice(0, pageSize));
    nextPage = hasNextPage && variables.page < 100 ? variables.page + 1 : null;
  } else {
    // Client-side audio filters scan cached AniList pages to yield exact 20-item pages without skipping entries.
    const targetStart = (variables.page - 1) * pageSize;
    const targetEnd = variables.page * pageSize;
    const maxPage = Math.min(20, variables.page * 3);
    const allFiltered = [];
    let anilistPage = 1;
    while (anilistPage <= maxPage) {
      const pageData = await fetchAnilistPage(anilistPage);
      hasNextPage = Boolean(pageData.pageInfo?.hasNextPage);
      allFiltered.push(...tagAndFilter(pageData.media));
      if (allFiltered.length > targetEnd || !hasNextPage) break;
      anilistPage++;
    }
    collected.push(...allFiltered.slice(targetStart, targetEnd));
    nextPage = allFiltered.length > targetEnd || (hasNextPage && anilistPage < maxPage && collected.length > 0)
      ? variables.page + 1
      : null;
  }
  const mapped = await animeCatalogTitles(collected.map(item => item.id)).catch(() => new Map());
  const results = collected.map(item => {
    const match = mapped.get(item.id);
    return { ...item, catalog: match?.catalog ?? undefined, catalogSeason: match?.season ?? undefined, mal: null };
  });
  await Promise.all([
    (async () => {
      if (!tmdbEnabled || typeof tmdb !== 'function') return;
      const unmapped = results.filter(item => !item.catalog).slice(0, 8);
      for (let start = 0; start < unmapped.length; start += 4) {
        await Promise.all(unmapped.slice(start, start + 4).map(async item => {
          const found = await fallbackAnimeCatalog(item, tmdb);
          if (found?.catalog) {
            item.catalog = found.catalog;
            if (found.season) item.catalogSeason = found.season;
          }
        }));
      }
    })(),
    (async () => {
      for (let start = 0; start < results.length; start += 6) {
        await Promise.all(results.slice(start, start + 6).map(async item => { item.mal = await malRating('anime', item.idMal); }));
      }
    })(),
  ]);
  return { results, nextPage };
}
