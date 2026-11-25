import { cacheMetadata } from './metadata.mjs';

const mappingUrl = 'https://github.com/anibridge/anibridge-mappings/releases/download/v3/mappings.min.json';
const day = 24 * 60 * 60 * 1000;
const scheduleTtl = 20 * 60_000;
const rangePattern = /^([1-9]\d*)(?:-([1-9]\d*|))?$/;
const airingScheduleQuery = `query($id:Int!, $page:Int!) {
  Media(id:$id, type:ANIME) {
    airingSchedule(page:$page, perPage:50) {
      pageInfo { lastPage }
      nodes { episode airingAt }
    }
  }
}`;
let mapping;
let mappingExpiry = 0;
let mappingRequest;

async function animeMappings() {
  if (mapping && Date.now() < mappingExpiry) return mapping;
  mappingRequest ??= (async () => {
    const response = await fetch(mappingUrl, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Anime episode mappings are temporarily unavailable.');
    }
    const data = await response.json();
    const entries = Object.entries(data).filter(([key]) => /^tmdb_(?:show|movie):/.test(key));
    if (!entries.length) throw new Error('Anime episode mappings are invalid.');
    mapping = new Map(entries);
    mappingExpiry = Date.now() + day;
    return mapping;
  })().catch(error => {
    if (!mapping) throw error;
    mappingExpiry = Date.now() + 5 * 60_000;
    return mapping;
  }).finally(() => { mappingRequest = null; });
  return mappingRequest;
}

function range(value) {
  const match = value.match(rangePattern);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] === undefined ? start : Number(match[2]) || Infinity;
  return end >= start ? { start, end } : null;
}

export function matchAnimeEpisode(targets = {}, episode) {
  const matches = new Map();
  for (const [descriptor, rules] of Object.entries(targets)) {
    const id = descriptor.match(/^anilist:([1-9]\d*)$/)?.[1];
    if (!id) continue;
    for (const [from, to] of Object.entries(rules)) {
      const source = range(from);
      if (!source || episode < source.start || episode > source.end) continue;
      // Split or combined episodes may use a different cut. Only use one-to-one mappings.
      const [intervals, ratio = '1'] = to.split('|');
      const targets = intervals.split(',').map(range);
      if (ratio !== '1' || targets.some(target => !target)) return null;
      const lengths = targets.map(target => target.end - target.start + 1);
      if (lengths.reduce((sum, length) => sum + length, 0) !== source.end - source.start + 1) return null;
      let offset = episode - source.start;
      let index = 0;
      while (offset >= lengths[index]) offset -= lengths[index++];
      const number = targets[index].start + offset;
      matches.set(`${id}/${number}`, { id: Number(id), episode: number });
    }
  }
  return matches.size === 1 ? matches.values().next().value : null;
}

export async function animeSource(type, id, season, episode) {
  const descriptor = type === 'tv' ? `tmdb_show:${id}:s${season}` : `tmdb_movie:${id}`;
  return matchAnimeEpisode((await animeMappings()).get(descriptor), episode);
}

export async function animeCatalogTitles(ids) {
  const matches = new Map();
  const requested = new Set(ids);
  for (const [descriptor, rules] of await animeMappings()) {
    const source = descriptor.match(/^tmdb_(show|movie):([1-9]\d*)(?::s(\d+))?$/);
    if (!source) continue;
    for (const target of Object.keys(rules || {})) {
      const id = Number(target.match(/^anilist:([1-9]\d*)$/)?.[1]);
      if (!requested.has(id)) continue;
      const catalog = `${source[1] === 'show' ? 'tv' : 'movie'}/${source[2]}`;
      const season = source[3] ? Number(source[3]) : null;
      const existing = matches.get(id);
      if (existing === undefined) matches.set(id, { catalog, season });
      else if (existing && existing.catalog !== catalog) matches.set(id, null);
      else if (existing && existing.season !== season && season !== null) {
        matches.set(id, { catalog, season: existing.season == null ? season : Math.min(existing.season, season) });
      }
    }
  }
  return matches;
}

function utcDate(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

async function fetchAnilistSchedulePage(id, page) {
  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query: airingScheduleQuery, variables: { id, page } }),
    signal: AbortSignal.timeout(5500),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('AniList schedule is unavailable.');
  }
  return (await response.json()).data?.Media?.airingSchedule ?? null;
}

async function anilistAiringSchedule(id) {
  return cacheMetadata(`anilist-schedule:${id}`, scheduleTtl, async () => {
    const first = await fetchAnilistSchedulePage(id, 1);
    const episodes = {};
    const collect = page => {
      for (const node of page?.nodes || []) {
        if (Number.isSafeInteger(node?.episode) && node.episode > 0 && Number.isSafeInteger(node?.airingAt) && node.airingAt > 0) {
          episodes[node.episode] = node.airingAt;
        }
      }
    };
    collect(first);
    const lastPage = Number(first?.pageInfo?.lastPage) || 1;
    if (lastPage > 1) {
      const extraPages = lastPage > 2 ? [lastPage - 1, lastPage] : [lastPage];
      const pages = await Promise.all(extraPages.map(page => fetchAnilistSchedulePage(id, page).catch(() => null)));
      for (const page of pages) collect(page);
    }
    return { episodes };
  });
}

export function applyAnimeSeasonSchedule(seasonData, targets, schedules = {}) {
  if (!Array.isArray(seasonData?.episodes) || !targets) {
    return { season: seasonData, changed: false, airingAt: new Map() };
  }
  let changed = false;
  const airingAt = new Map();
  const episodes = seasonData.episodes.map(episode => {
    if (!Number.isSafeInteger(episode?.episode_number) || episode.episode_number < 1) return episode;
    const match = matchAnimeEpisode(targets, episode.episode_number);
    const at = match ? schedules[match.id]?.[match.episode] : undefined;
    if (!Number.isSafeInteger(at) || at <= 0) return episode;
    airingAt.set(episode.episode_number, at);
    const aniDate = utcDate(at);
    if (!episode.air_date || aniDate < episode.air_date) {
      changed = true;
      return { ...episode, air_date: aniDate };
    }
    return episode;
  });
  return { season: changed ? { ...seasonData, episodes } : seasonData, changed, airingAt };
}

export function applyAnimeDetailsSchedule(details, seasonNumber, seasonResult, now = new Date()) {
  if (!details || !seasonResult?.airingAt?.size || !Array.isArray(seasonResult.season?.episodes)) return details;
  const today = now.toISOString().slice(0, 10);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const episodes = [...seasonResult.season.episodes]
    .filter(episode => Number.isSafeInteger(episode?.episode_number) && episode.episode_number > 0)
    .sort((a, b) => a.episode_number - b.episode_number);
  if (!episodes.length) return details;

  const hasAired = episode => {
    const at = seasonResult.airingAt?.get(episode.episode_number);
    if (Number.isSafeInteger(at) && at > 0 && at <= nowSeconds) return true;
    return Boolean(episode.air_date && episode.air_date < today)
      || (Boolean(episode.air_date && episode.air_date === today) && !(Number.isSafeInteger(at) && at > nowSeconds));
  };
  const aired = episodes.filter(hasAired);
  const upcoming = episodes.filter(episode => !hasAired(episode));
  const latestAired = aired.at(-1) ?? null;
  const nextUpcoming = upcoming[0] ?? null;
  const updated = { ...details };

  const prevLast = details.last_episode_to_air;
  const newerLast = latestAired && (!prevLast
    || seasonNumber > prevLast.season_number
    || (seasonNumber === prevLast.season_number && latestAired.episode_number > prevLast.episode_number)
    || (seasonNumber === prevLast.season_number && latestAired.episode_number === prevLast.episode_number
      && (!prevLast.air_date || (latestAired.air_date && latestAired.air_date < prevLast.air_date))));
  if (newerLast) {
    updated.last_episode_to_air = latestAired;
    if (latestAired.air_date && (!updated.last_air_date || latestAired.air_date > updated.last_air_date
      || (prevLast?.season_number === seasonNumber && prevLast?.episode_number === latestAired.episode_number))) {
      updated.last_air_date = latestAired.air_date;
    }
  }

  if (!details.next_episode_to_air || details.next_episode_to_air.season_number === seasonNumber) {
    updated.next_episode_to_air = nextUpcoming;
  }

  const firstDate = episodes[0]?.air_date;
  if (firstDate && Array.isArray(details.seasons)) {
    updated.seasons = details.seasons.map(entry => (
      entry.season_number === seasonNumber && (!entry.air_date || firstDate < entry.air_date)
        ? { ...entry, air_date: firstDate }
        : entry
    ));
  }
  if (seasonNumber === 1 && firstDate && (!updated.first_air_date || firstDate < updated.first_air_date)) {
    updated.first_air_date = firstDate;
  }
  return updated;
}

async function resolveAnimeSeasonSchedule(id, season, seasonData, now = new Date()) {
  if (!Number.isSafeInteger(season) || season < 1 || !Array.isArray(seasonData?.episodes) || !seasonData.episodes.length) {
    return { season: seasonData, changed: false, airingAt: new Map() };
  }
  const today = now.toISOString().slice(0, 10);
  if (!seasonData.episodes.some(episode => !episode.air_date || episode.air_date >= today)) {
    return { season: seasonData, changed: false, airingAt: new Map() };
  }
  const targets = (await animeMappings()).get(`tmdb_show:${id}:s${season}`);
  if (!targets) return { season: seasonData, changed: false, airingAt: new Map() };
  const anilistIds = new Set();
  for (const episode of seasonData.episodes) {
    const match = matchAnimeEpisode(targets, episode.episode_number);
    if (match) anilistIds.add(match.id);
  }
  if (!anilistIds.size) return { season: seasonData, changed: false, airingAt: new Map() };
  const entries = await Promise.all([...anilistIds].map(async anilistId => {
    const data = await anilistAiringSchedule(anilistId).catch(() => null);
    return [anilistId, data?.episodes ?? null];
  }));
  const schedules = Object.fromEntries(entries.filter(([, value]) => value));
  if (!Object.keys(schedules).length) return { season: seasonData, changed: false, airingAt: new Map() };
  return applyAnimeSeasonSchedule(seasonData, targets, schedules);
}

export async function enrichAnimeSeason(id, season, seasonData, now = new Date()) {
  return (await resolveAnimeSeasonSchedule(id, season, seasonData, now)).season;
}

export async function enrichAnimeDetails(id, details, loadSeason, now = new Date()) {
  if (!details) return details;
  const today = now.toISOString().slice(0, 10);
  const next = details.next_episode_to_air;
  const seasonNumber = next?.season_number > 0 && (!next.air_date || next.air_date >= today)
    ? next.season_number
    : (details.seasons ?? [])
      .filter(entry => entry.season_number > 0 && entry.air_date && entry.air_date >= today)
      .sort((a, b) => a.air_date.localeCompare(b.air_date))[0]?.season_number;
  if (!seasonNumber) return details;
  const targets = (await animeMappings()).get(`tmdb_show:${id}:s${seasonNumber}`);
  if (!targets) return details;
  const seasonData = await loadSeason(seasonNumber);
  const seasonResult = await resolveAnimeSeasonSchedule(id, seasonNumber, seasonData, now);
  return applyAnimeDetailsSchedule(details, seasonNumber, seasonResult, now);
}
