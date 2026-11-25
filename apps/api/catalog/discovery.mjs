import { cacheMetadata } from './metadata.mjs';
import { animeCatalogTitles } from './anime.mjs';
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
    for (let idx = 0; idx < favoriteGenres.length; idx++) {
      const favorite = favoriteGenres[idx][0];
      const [type, genre] = favorite.split(':');
      const page1 = await cacheMetadata(`recommend-genre:${favorite}`, 3600000, () => tmdb(`/discover/${type}`, { with_genres: genre, sort_by: 'popularity.desc', include_adult: 'false', page: 1 })).catch(() => null);
      let candidates = (page1?.results || []).map(item => ({ ...item, media_type: type }));
      if (page1?.total_pages > 1) {
        const page2 = await cacheMetadata(`recommend-genre:${favorite}:2`, 3600000, () => tmdb(`/discover/${type}`, { with_genres: genre, sort_by: 'popularity.desc', include_adult: 'false', page: 2 })).catch(() => null);
        if (page2?.results?.length) candidates = [...candidates, ...page2.results.map(item => ({ ...item, media_type: type }))];
      }
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
  Page(page:$page, perPage:18) { pageInfo { currentPage hasNextPage } media(type:ANIME, isAdult:false, seasonYear:$year, startDate_like:$yearPattern, season:$season, format:$format,
    status:$status, genre:$genre, tag:$theme, episodes_greater:$min, episodes_lesser:$max, sort:$sort) {
    id idMal title { romaji english } coverImage { large } startDate { year month day } season seasonYear format status episodes popularity
    nextAiringEpisode { episode airingAt }
  } } }`;

export async function seasonalAnime(params) {
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
    if (value?.length > 60) throw invalid(`Invalid anime ${key}.`);
    if (value) variables[key] = value;
  }
  const data = await cacheMetadata(`anime-season:${JSON.stringify(variables)}`, 20 * 60000, async () => {
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query: seasonalQuery, variables }), signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) throw new Error('Anime schedules are temporarily unavailable.');
    const result = (await response.json()).data?.Page;
    if (!Array.isArray(result?.media)) throw new Error('Anime schedules are temporarily unavailable.');
    return result;
  });
  const mapped = await animeCatalogTitles(data.media.map(item => item.id)).catch(() => new Map());
  const results = data.media.map(item => {
    const match = mapped.get(item.id);
    return { ...item, catalog: match?.catalog ?? undefined, catalogSeason: match?.season ?? undefined, mal: null };
  });
  for (let start = 0; start < results.length; start += 6) {
    await Promise.all(results.slice(start, start + 6).map(async item => { item.mal = await malRating('anime', item.idMal); }));
  }
  return { results, nextPage: data.pageInfo.hasNextPage && variables.page < 100 ? variables.page + 1 : null };
}
