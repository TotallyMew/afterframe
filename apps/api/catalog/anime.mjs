import { cacheMetadata } from './metadata.mjs';

const mappingUrl = 'https://github.com/anibridge/anibridge-mappings/releases/download/v3/mappings.min.json';
const dubsUrl = 'https://raw.githubusercontent.com/MAL-Dubs/MAL-Dubs/main/data/dubInfo.json';
const dubFeedUrl = 'https://raw.githubusercontent.com/RockinChaos/AniSchedule/master/raw/dub-episode-feed.json';
const dubScheduleUrl = 'https://raw.githubusercontent.com/RockinChaos/AniSchedule/master/raw/dub-schedule.json';
const day = 24 * 60 * 60 * 1000;
const scheduleTtl = 20 * 60_000;
const rangePattern = /^([1-9]\d*)(?:-([1-9]\d*|))?$/;
const tvdbSeasonPattern = /^tvdb_show:([1-9]\d*):s([1-9]\d*)$/;
const airingScheduleQuery = `query($id:Int!, $page:Int!) {
  Media(id:$id, type:ANIME) {
    airingSchedule(page:$page, perPage:50) {
      pageInfo { lastPage }
      nodes { episode airingAt }
    }
  }
}`;
let mapping;
let mappingByAnilist;
let mappingByTmdbShow;
let mappingEtag = '';
let mappingExpiry = 0;
let mappingRequest;
let dubsCache;
let dubsEtag = '';
let dubsExpiry = 0;
let dubsRequest;
let dubSchedulesCache;
let dubFeedEtag = '';
let dubSchedEtag = '';
let dubSchedulesExpiry = 0;
let dubSchedulesRequest;

function buildMappingIndexes(entries) {
  const byAnilist = new Map();
  const byTmdbShow = new Map();
  for (const [descriptor, rules] of entries) {
    const source = descriptor.match(/^tmdb_(show|movie):([1-9]\d*)(?::s(\d+))?$/);
    if (!source) continue;
    if (source[1] === 'show' && source[3]) {
      const showId = source[2];
      const sNum = Number(source[3]);
      if (Number.isSafeInteger(sNum) && sNum >= 1) {
        let list = byTmdbShow.get(showId);
        if (!list) { list = []; byTmdbShow.set(showId, list); }
        list.push([sNum, rules]);
      }
    }
    const vSeasons = source[1] === 'show' && source[3] === '1' ? virtualSeasonsFromTargets(rules) : null;
    for (const [target, epRules] of Object.entries(rules || {})) {
      const id = Number(target.match(/^anilist:([1-9]\d*)$/)?.[1]);
      if (!Number.isSafeInteger(id) || id < 1) continue;
      const catalog = `${source[1] === 'show' ? 'tv' : 'movie'}/${source[2]}`;
      let season = source[3] ? Number(source[3]) : null;
      if (vSeasons && epRules && typeof epRules === 'object') {
        const starts = Object.keys(epRules).map(range).filter(Boolean).map(entry => entry.start);
        const minStart = starts.length ? Math.min(...starts) : null;
        const owner = minStart != null ? vSeasons.find(entry => minStart >= entry.start && minStart <= entry.end) : null;
        if (owner) season = owner.season;
      }
      const existing = byAnilist.get(id);
      if (existing === undefined) byAnilist.set(id, { catalog, season });
      else if (existing && existing.catalog !== catalog) byAnilist.set(id, null);
      else if (existing && existing.season !== season && season !== null) {
        byAnilist.set(id, { catalog, season: existing.season == null ? season : Math.min(existing.season, season) });
      }
    }
  }
  return { byAnilist, byTmdbShow };
}

export async function animeDubInfo() {
  if (dubsCache && Date.now() < dubsExpiry) return dubsCache;
  dubsRequest ??= (async () => {
    const headers = dubsEtag && dubsCache ? { 'if-none-match': dubsEtag } : {};
    const response = await fetch(dubsUrl, { headers, redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (response.status === 304 && dubsCache) {
      await response.body?.cancel();
      dubsExpiry = Date.now() + day;
      return dubsCache;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Anime dub metadata is temporarily unavailable.');
    }
    dubsEtag = response.headers.get('etag') || '';
    const data = await response.json();
    const toIdSet = list => new Set((Array.isArray(list) ? list : []).map(Number).filter(id => Number.isSafeInteger(id) && id > 0));
    const dubbed = toIdSet(data?.dubbed);
    const incomplete = toIdSet(data?.incomplete);
    if (!dubbed.size && !incomplete.size) throw new Error('Anime dub metadata is invalid.');
    dubsCache = { dubbed, incomplete };
    dubsExpiry = Date.now() + day;
    return dubsCache;
  })().catch(error => {
    if (!dubsCache) throw error;
    dubsExpiry = Date.now() + 5 * 60_000;
    return dubsCache;
  }).finally(() => { dubsRequest = null; });
  return dubsRequest;
}

export async function animeDubSchedules() {
  if (dubSchedulesCache && Date.now() < dubSchedulesExpiry) return dubSchedulesCache;
  dubSchedulesRequest ??= (async () => {
    const [feedRes, schedRes] = await Promise.allSettled([
      fetch(dubFeedUrl, { headers: dubFeedEtag && dubSchedulesCache ? { 'if-none-match': dubFeedEtag } : {}, redirect: 'error', signal: AbortSignal.timeout(10_000) }),
      fetch(dubScheduleUrl, { headers: dubSchedEtag && dubSchedulesCache ? { 'if-none-match': dubSchedEtag } : {}, redirect: 'error', signal: AbortSignal.timeout(10_000) }),
    ]);
    const feedUnchanged = feedRes.status === 'fulfilled' && feedRes.value.status === 304 && Boolean(dubSchedulesCache);
    const schedUnchanged = schedRes.status === 'fulfilled' && schedRes.value.status === 304 && Boolean(dubSchedulesCache);
    if (feedUnchanged && schedUnchanged) {
      await Promise.all([feedRes.value.body?.cancel(), schedRes.value.body?.cancel()]);
      dubSchedulesExpiry = Date.now() + scheduleTtl;
      return dubSchedulesCache;
    }
    const feedByAnilist = feedUnchanged ? dubSchedulesCache.feedByAnilist : new Map();
    const feedByMal = feedUnchanged ? dubSchedulesCache.feedByMal : new Map();
    const schedByAnilist = schedUnchanged ? dubSchedulesCache.schedByAnilist : new Map();
    const schedByMal = schedUnchanged ? dubSchedulesCache.schedByMal : new Map();

    const recordFeed = (map, id, ep, airedAt) => {
      if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(ep) || ep < 1 || typeof airedAt !== 'string') return;
      let episodes = map.get(id);
      if (!episodes) {
        episodes = new Map();
        map.set(id, episodes);
      }
      if (!episodes.has(ep)) episodes.set(ep, airedAt);
    };

    if (feedUnchanged) {
      await feedRes.value.body?.cancel();
    } else if (feedRes.status === 'fulfilled' && feedRes.value.ok) {
      dubFeedEtag = feedRes.value.headers.get('etag') || '';
      const entries = await feedRes.value.json().catch(() => []);
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          const aired = Number(entry?.episode?.aired);
          const airedAt = typeof entry?.episode?.airedAt === 'string' ? entry.episode.airedAt : '';
          if (!Number.isSafeInteger(aired) || aired < 1 || !airedAt) continue;
          recordFeed(feedByAnilist, Number(entry?.id), aired, airedAt);
          recordFeed(feedByMal, Number(entry?.idMal), aired, airedAt);
        }
      }
    } else if (feedRes.status === 'fulfilled') {
      await feedRes.value.body?.cancel();
    }

    if (schedUnchanged) {
      await schedRes.value.body?.cancel();
    } else if (schedRes.status === 'fulfilled' && schedRes.value.ok) {
      dubSchedEtag = schedRes.value.headers.get('etag') || '';
      const entries = await schedRes.value.json().catch(() => []);
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          const media = entry?.media?.media ?? entry?.media ?? entry;
          const anilistId = Number(media?.id);
          const malId = Number(media?.idMal);
          const episodeNumber = Number(entry?.episodeNumber);
          const episodeDate = typeof entry?.episodeDate === 'string' ? entry.episodeDate : '';
          const episodes = Number.isSafeInteger(Number(entry?.episodes)) && Number(entry.episodes) > 0 ? Number(entry.episodes) : null;
          if (!Number.isSafeInteger(episodeNumber) || episodeNumber < 1 || !episodeDate) continue;
          const record = { episodeNumber, episodeDate, episodes };
          if (Number.isSafeInteger(anilistId) && anilistId > 0) schedByAnilist.set(anilistId, record);
          if (Number.isSafeInteger(malId) && malId > 0) schedByMal.set(malId, record);
        }
      }
    } else if (schedRes.status === 'fulfilled') {
      await schedRes.value.body?.cancel();
    }

    dubSchedulesCache = { feedByAnilist, feedByMal, schedByAnilist, schedByMal };
    dubSchedulesExpiry = Date.now() + scheduleTtl;
    return dubSchedulesCache;
  })().catch(error => {
    if (!dubSchedulesCache) throw error;
    dubSchedulesExpiry = Date.now() + 5 * 60_000;
    return dubSchedulesCache;
  }).finally(() => { dubSchedulesRequest = null; });
  return dubSchedulesRequest;
}

async function animeMappings() {
  if (mapping && Date.now() < mappingExpiry) return mapping;
  mappingRequest ??= (async () => {
    const headers = mappingEtag && mapping ? { 'if-none-match': mappingEtag } : {};
    const response = await fetch(mappingUrl, { headers, signal: AbortSignal.timeout(12000) });
    if (response.status === 304 && mapping) {
      await response.body?.cancel();
      mappingExpiry = Date.now() + day;
      return mapping;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Anime episode mappings are temporarily unavailable.');
    }
    mappingEtag = response.headers.get('etag') || '';
    const data = await response.json();
    const entries = Object.entries(data).filter(([key]) => /^tmdb_(?:show|movie):/.test(key));
    if (!entries.length) throw new Error('Anime episode mappings are invalid.');
    mapping = new Map(entries);
    const indexes = buildMappingIndexes(entries);
    mappingByAnilist = indexes.byAnilist;
    mappingByTmdbShow = indexes.byTmdbShow;
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

export function matchAnimeEpisode(targets = {}, episode, prefix = 'anilist') {
  const matches = new Map();
  const pattern = prefix === 'mal' ? /^mal:([1-9]\d*)$/ : /^anilist:([1-9]\d*)$/;
  for (const [descriptor, rules] of Object.entries(targets)) {
    const id = descriptor.match(pattern)?.[1];
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

export function virtualSeasonsFromTargets(targets = {}) {
  if (!targets || typeof targets !== 'object') return null;
  const byTvdb = new Map();
  for (const [descriptor, rules] of Object.entries(targets)) {
    const match = descriptor.match(tvdbSeasonPattern);
    if (!match || !rules || typeof rules !== 'object') continue;
    const tvdbId = match[1];
    const season = Number(match[2]);
    let minStart = Infinity;
    let maxEnd = 0;
    for (const from of Object.keys(rules)) {
      const parsed = range(from);
      if (!parsed) continue;
      if (parsed.start < minStart) minStart = parsed.start;
      if (parsed.end > maxEnd) maxEnd = parsed.end;
    }
    if (!Number.isFinite(minStart) || maxEnd < minStart) continue;
    let list = byTvdb.get(tvdbId);
    if (!list) {
      list = [];
      byTvdb.set(tvdbId, list);
    }
    list.push({ season, start: minStart, end: maxEnd });
  }
  let best = null;
  for (const list of byTvdb.values()) {
    if (!best || list.length > best.length) best = list;
  }
  if (!best || best.length < 2) return null;
  best.sort((a, b) => a.season - b.season);
  if (best[0].season !== 1 || best[0].start !== 1) return null;
  for (let i = 1; i < best.length; i++) {
    if (best[i].season !== best[i - 1].season + 1) return null;
    if (best[i].start <= best[i - 1].start) return null;
    if (Number.isFinite(best[i - 1].end) && best[i].start <= best[i - 1].end) return null;
  }
  return best.map((entry, index) => ({
    season: entry.season,
    start: entry.start,
    end: index < best.length - 1 ? best[index + 1].start - 1 : Infinity,
  }));
}

export async function animeVirtualSeasonPlan(id) {
  const s1Targets = (await animeMappings()).get(`tmdb_show:${id}:s1`);
  return virtualSeasonsFromTargets(s1Targets);
}

export function sliceVirtualSeason(rawS1Data, vSeason) {
  const episodes = (rawS1Data?.episodes ?? [])
    .filter(ep => Number.isSafeInteger(ep?.episode_number) && ep.episode_number >= vSeason.start && ep.episode_number <= vSeason.end)
    .map(ep => ({
      ...ep,
      season_number: vSeason.season,
      episode_number: ep.episode_number - vSeason.start + 1,
    }));
  return {
    ...rawS1Data,
    season_number: vSeason.season,
    name: `Season ${vSeason.season}`,
    overview: vSeason.season === 1 ? (rawS1Data?.overview ?? '') : '',
    air_date: episodes[0]?.air_date ?? null,
    episodes,
  };
}

export function applyVirtualAnimeSeasons(details, rawS1Data, vSeasons) {
  if (!details || !Array.isArray(rawS1Data?.episodes) || !Array.isArray(vSeasons) || vSeasons.length < 2) {
    return { details, virtualSeasons: null };
  }
  const regular = (details.seasons ?? []).filter(entry => entry.season_number > 0);
  if (regular.length !== 1 || regular[0].season_number !== 1) {
    return { details, virtualSeasons: null };
  }
  const baseS1 = regular[0];
  const populated = [];
  for (const vSeason of vSeasons) {
    const sliced = sliceVirtualSeason(rawS1Data, vSeason);
    if (!sliced.episodes.length) continue;
    populated.push({ vSeason, sliced });
  }
  if (populated.length < 2) return { details, virtualSeasons: null };

  const remapEpisode = ep => {
    if (!ep || ep.season_number !== 1 || !Number.isSafeInteger(ep.episode_number)) return ep;
    const owner = populated.find(({ vSeason }) => ep.episode_number >= vSeason.start && ep.episode_number <= vSeason.end);
    if (!owner) return ep;
    return {
      ...ep,
      season_number: owner.vSeason.season,
      episode_number: ep.episode_number - owner.vSeason.start + 1,
    };
  };

  const specials = (details.seasons ?? []).filter(entry => entry.season_number === 0);
  const virtualSeasonEntries = populated.map(({ vSeason, sliced }) => ({
    ...baseS1,
    id: baseS1.id ? baseS1.id * 100 + vSeason.season : vSeason.season,
    season_number: vSeason.season,
    name: `Season ${vSeason.season}`,
    episode_count: sliced.episodes.length,
    air_date: sliced.air_date,
    overview: vSeason.season === 1 ? (baseS1.overview ?? '') : '',
  }));

  return {
    details: {
      ...details,
      number_of_seasons: virtualSeasonEntries.length,
      seasons: [...specials, ...virtualSeasonEntries],
      last_episode_to_air: remapEpisode(details.last_episode_to_air),
      next_episode_to_air: remapEpisode(details.next_episode_to_air),
    },
    virtualSeasons: populated,
  };
}

function resolveSeasonMapping(mappings, type, id, season, episode) {
  if (type !== 'tv') return { targets: mappings.get(`tmdb_movie:${id}`), episode };
  const direct = mappings.get(`tmdb_show:${id}:s${season}`);
  if (direct) return { targets: direct, episode };
  const s1Targets = mappings.get(`tmdb_show:${id}:s1`);
  const vSeasons = virtualSeasonsFromTargets(s1Targets);
  const vSeason = vSeasons?.find(entry => entry.season === season);
  if (!vSeason) return { targets: undefined, episode };
  const absEpisode = vSeason.start + episode - 1;
  if (absEpisode > vSeason.end) return { targets: undefined, episode };
  return { targets: s1Targets, episode: absEpisode };
}

export async function animeSource(type, id, season, episode) {
  const { targets, episode: resolvedEp } = resolveSeasonMapping(await animeMappings(), type, id, season, episode);
  return matchAnimeEpisode(targets, resolvedEp);
}

export async function animeStreamSource(type, id, season, episode) {
  const { targets, episode: resolvedEp } = resolveSeasonMapping(await animeMappings(), type, id, season, episode);
  const anilist = matchAnimeEpisode(targets, resolvedEp, 'anilist');
  if (anilist) return { ...anilist, idType: 'anilist' };
  const mal = matchAnimeEpisode(targets, resolvedEp, 'mal');
  if (mal) return { ...mal, idType: 'mal' };
  return null;
}

export async function animeMalSource(type, id, season, episode) {
  const { targets, episode: resolvedEp } = resolveSeasonMapping(await animeMappings(), type, id, season, episode);
  const mal = matchAnimeEpisode(targets, resolvedEp, 'mal');
  if (mal) return { malId: mal.id, episode: mal.episode };
  const anilist = matchAnimeEpisode(targets, resolvedEp, 'anilist');
  if (!anilist) return null;
  const malId = await cacheMetadata(`anilist-mal:${anilist.id}`, 7 * 86400000, async () => {
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'query($id:Int!) { Media(id:$id,type:ANIME) { idMal } }', variables: { id: anilist.id } }),
      signal: AbortSignal.timeout(4500),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    return (await response.json()).data?.Media?.idMal || null;
  }).catch(() => null);
  return malId ? { malId, episode: anilist.episode } : null;
}

export async function animeCatalogTitles(ids) {
  await animeMappings();
  const matches = new Map();
  if (!mappingByAnilist) return matches;
  for (const id of ids) {
    if (mappingByAnilist.has(id)) matches.set(id, mappingByAnilist.get(id));
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
    redirect: 'error',
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

export function applyAnimeSeasonSchedule(seasonData, targets, schedules = {}, episodeOffset = 0) {
  if (!Array.isArray(seasonData?.episodes) || !targets) {
    return { season: seasonData, changed: false, airingAt: new Map() };
  }
  let changed = false;
  const airingAt = new Map();
  const episodes = seasonData.episodes.map(episode => {
    if (!Number.isSafeInteger(episode?.episode_number) || episode.episode_number < 1) return episode;
    const match = matchAnimeEpisode(targets, episode.episode_number + episodeOffset);
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

function addUtcDays(isoDate, days) {
  const ms = Date.parse(isoDate);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + days * day).toISOString().slice(0, 10);
}

export function applyAnimeDubSchedule(seasonData, targets, { dubInfo, dubSchedules }, { episodeOffset = 0, now = new Date() } = {}) {
  if (!Array.isArray(seasonData?.episodes) || !targets) {
    return { season: seasonData, dubAvailable: false, nextDubEpisode: null };
  }
  const today = now.toISOString().slice(0, 10);
  const nowMs = now.getTime();
  const dubbedSet = dubInfo?.dubbed ?? new Set();
  const incompleteSet = dubInfo?.incomplete ?? new Set();
  const feedByAnilist = dubSchedules?.feedByAnilist ?? new Map();
  const feedByMal = dubSchedules?.feedByMal ?? new Map();
  const schedByAnilist = dubSchedules?.schedByAnilist ?? new Map();
  const schedByMal = dubSchedules?.schedByMal ?? new Map();

  let dubAvailable = false;
  let nextDubEpisode = null;

  const episodes = seasonData.episodes.map(episode => {
    if (!Number.isSafeInteger(episode?.episode_number) || episode.episode_number < 1) return episode;
    const absEp = episode.episode_number + episodeOffset;
    const anilistMatch = matchAnimeEpisode(targets, absEp, 'anilist');
    const malMatch = matchAnimeEpisode(targets, absEp, 'mal');
    const relEp = anilistMatch?.episode ?? malMatch?.episode;
    if (!relEp) return episode;

    const feedMap = (anilistMatch ? feedByAnilist.get(anilistMatch.id) : null)
      ?? (malMatch ? feedByMal.get(malMatch.id) : null);
    const sched = (anilistMatch ? schedByAnilist.get(anilistMatch.id) : null)
      ?? (malMatch ? schedByMal.get(malMatch.id) : null);
    const inDubbed = Boolean(malMatch && dubbedSet.has(malMatch.id));
    const inIncomplete = Boolean(malMatch && incompleteSet.has(malMatch.id));
    const airedAt = feedMap?.get(relEp);

    if (!airedAt && !sched && !inDubbed && !inIncomplete && !feedMap?.size) {
      return episode;
    }

    dubAvailable = true;
    let dubAirDate;
    let dubAired = false;
    let dubEstimated = false;

    if (airedAt) {
      dubAirDate = airedAt.slice(0, 10);
      const parsedMs = Date.parse(airedAt);
      dubAired = Number.isFinite(parsedMs) ? parsedMs <= nowMs : dubAirDate <= today;
    } else if (sched) {
      if (relEp === sched.episodeNumber) {
        dubAirDate = sched.episodeDate.slice(0, 10);
        const parsedMs = Date.parse(sched.episodeDate);
        dubAired = Number.isFinite(parsedMs) ? parsedMs <= nowMs : dubAirDate <= today;
      } else if (relEp > sched.episodeNumber) {
        dubAirDate = addUtcDays(sched.episodeDate, 7 * (relEp - sched.episodeNumber)) ?? undefined;
        dubAired = Boolean(dubAirDate && dubAirDate <= today);
        dubEstimated = Boolean(dubAirDate);
      } else {
        dubAired = true;
      }
    } else if (inDubbed && !inIncomplete) {
      dubAired = !episode.air_date || episode.air_date <= today;
    } else if (inIncomplete) {
      dubAired = false;
    } else if (feedMap?.size) {
      // Episode belongs to a dubbed title in the feed; if earlier than the highest aired feed ep, treat as aired.
      const maxFed = Math.max(...feedMap.keys());
      dubAired = relEp <= maxFed;
    }

    if (!dubAired && dubAirDate && !nextDubEpisode) {
      nextDubEpisode = {
        season_number: episode.season_number,
        episode_number: episode.episode_number,
        name: episode.name,
        air_date: dubAirDate,
        estimated: dubEstimated,
      };
    }

    return {
      ...episode,
      dub_aired: dubAired,
      ...(dubAirDate ? { dub_air_date: dubAirDate } : {}),
      ...(dubEstimated ? { dub_estimated: true } : {}),
    };
  });

  if (!dubAvailable) return { season: seasonData, dubAvailable: false, nextDubEpisode: null };
  return {
    season: { ...seasonData, dub_available: true, episodes },
    dubAvailable: true,
    nextDubEpisode,
  };
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

async function resolveAnimeSeasonSchedule(id, season, seasonData, now = new Date(), { sourceSeason = season, episodeOffset = 0 } = {}) {
  if (!Number.isSafeInteger(season) || season < 1 || !Array.isArray(seasonData?.episodes) || !seasonData.episodes.length) {
    return { season: seasonData, changed: false, airingAt: new Map() };
  }
  const today = now.toISOString().slice(0, 10);
  if (!seasonData.episodes.some(episode => !episode.air_date || episode.air_date >= today)) {
    return { season: seasonData, changed: false, airingAt: new Map() };
  }
  const targets = (await animeMappings()).get(`tmdb_show:${id}:s${sourceSeason}`);
  if (!targets) return { season: seasonData, changed: false, airingAt: new Map() };
  const anilistIds = new Set();
  for (const episode of seasonData.episodes) {
    const match = matchAnimeEpisode(targets, episode.episode_number + episodeOffset);
    if (match) anilistIds.add(match.id);
  }
  if (!anilistIds.size) return { season: seasonData, changed: false, airingAt: new Map() };
  const entries = await Promise.all([...anilistIds].map(async anilistId => {
    const data = await anilistAiringSchedule(anilistId).catch(() => null);
    return [anilistId, data?.episodes ?? null];
  }));
  const schedules = Object.fromEntries(entries.filter(([, value]) => value));
  if (!Object.keys(schedules).length) return { season: seasonData, changed: false, airingAt: new Map() };
  return applyAnimeSeasonSchedule(seasonData, targets, schedules, episodeOffset);
}

export async function enrichAnimeSeason(id, season, seasonData, now = new Date(), { sourceSeason = season, episodeOffset = 0 } = {}) {
  const [subResult, mappings, dubInfo, dubSchedules] = await Promise.all([
    resolveAnimeSeasonSchedule(id, season, seasonData, now, { sourceSeason, episodeOffset }),
    animeMappings().catch(() => null),
    animeDubInfo().catch(() => ({ dubbed: new Set(), incomplete: new Set() })),
    animeDubSchedules().catch(() => ({ feedByAnilist: new Map(), feedByMal: new Map(), schedByAnilist: new Map(), schedByMal: new Map() })),
  ]);
  const targets = mappings?.get(`tmdb_show:${id}:s${sourceSeason}`);
  if (!targets) return subResult.season;
  return applyAnimeDubSchedule(subResult.season, targets, { dubInfo, dubSchedules }, { episodeOffset, now }).season;
}

const emnexOrigin = 'https://api.emnexanime.site';
const emnexServerPattern = /^[A-Za-z0-9._-]{1,32}$/;
const maxEmnexQueue = 16;
let emnexQueue = Promise.resolve();
let emnexQueueDepth = 0;
let lastEmnexAt = 0;

function emnexApiKey() {
  return process.env.EMNEX_API_KEY?.trim() || '';
}

export function hasEmnexKey() {
  return Boolean(emnexApiKey());
}

function fetchEmnex(url, key, timeoutMs = 12_000) {
  if (emnexQueueDepth >= maxEmnexQueue) {
    return Promise.reject(Object.assign(new Error('EmnexAnime queue is busy.'), { upstreamStatus: 503 }));
  }
  emnexQueueDepth++;
  const run = async () => {
    const wait = Math.max(0, 550 - (Date.now() - lastEmnexAt));
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastEmnexAt = Date.now();
    let response = await fetch(url, {
      headers: { 'x-api-key': key, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 429) {
      await response.body?.cancel();
      await new Promise(resolve => setTimeout(resolve, 1100));
      lastEmnexAt = Date.now();
      response = await fetch(url, {
        headers: { 'x-api-key': key, accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    }
    return response;
  };
  const next = emnexQueue.then(run, run).finally(() => { emnexQueueDepth = Math.max(0, emnexQueueDepth - 1); });
  emnexQueue = next.then(() => undefined, () => undefined);
  return next;
}

function sanitizeEmnexUrl(raw) {
  if (typeof raw !== 'string') return null;
  const parsed = URL.parse(raw);
  if (!parsed || parsed.origin !== emnexOrigin || parsed.username || parsed.password) return null;
  return parsed.href;
}

function sanitizeTimingRange(rangeObj) {
  const start = Number(rangeObj?.start);
  const end = Number(rangeObj?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start + 1) return null;
  return { start, end };
}

export async function emnexServers(animeId, episode, idType = 'anilist', refresh = false) {
  const key = emnexApiKey();
  if (!key) throw Object.assign(new Error('EmnexAnime is not configured.'), { statusCode: 503 });
  const kind = idType === 'mal' ? 'mal' : 'anilist';
  const pathPrefix = kind === 'mal' ? '/api/servers/mal' : '/api/servers';
  return cacheMetadata(`emnex-servers:v1:${kind}:${animeId}:${episode}`, 6 * 3600_000, async () => {
    const response = await fetchEmnex(`${emnexOrigin}${pathPrefix}/${animeId}/${episode}`, key, 10_000);
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(new Error('EmnexAnime servers are unavailable.'), { upstreamStatus: response.status });
    }
    const data = await response.json();
    const list = Array.isArray(data?.servers) ? data.servers : [];
    const seen = new Set();
    const servers = [];
    for (const entry of list) {
      const provider = typeof entry?.provider === 'string' ? entry.provider.trim() : '';
      const type = entry?.type === 'dub' ? 'dub' : entry?.type === 'sub' ? 'sub' : '';
      if (!provider || !emnexServerPattern.test(provider) || !type) continue;
      const dedupeKey = `${provider}:${type}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      servers.push({ provider, type });
    }
    return { servers };
  }, refresh);
}

export async function emnexStream(animeId, episode, { type = 'sub', provider = '', refresh = false, idType = 'anilist' } = {}) {
  const key = emnexApiKey();
  if (!key) throw Object.assign(new Error('EmnexAnime is not configured.'), { statusCode: 503 });
  const kind = idType === 'mal' ? 'mal' : 'anilist';
  const pathPrefix = kind === 'mal' ? '/api/sources/mal' : '/api/sources';
  const normalizedType = type === 'dub' ? 'dub' : 'sub';
  const normalizedProvider = typeof provider === 'string' && emnexServerPattern.test(provider.trim()) ? provider.trim() : '';
  const cacheKey = `emnex-source:v1:${kind}:${animeId}:${episode}:${normalizedType}:${normalizedProvider}`;
  return cacheMetadata(cacheKey, 15 * 60_000, async () => {
    const url = new URL(`${pathPrefix}/${animeId}/${episode}`, emnexOrigin);
    url.searchParams.set('type', normalizedType);
    if (normalizedProvider) url.searchParams.set('provider', normalizedProvider);
    const response = await fetchEmnex(url, key, 12_000);
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(new Error('EmnexAnime stream is unavailable.'), { upstreamStatus: response.status });
    }
    const data = await response.json();
    const hls = sanitizeEmnexUrl(data?.hls);
    if (!hls) {
      throw Object.assign(new Error('EmnexAnime did not return a playable stream.'), { upstreamStatus: 404 });
    }
    const rawSubs = Array.isArray(data?.subtitles) ? data.subtitles : [];
    const seenSubs = new Set();
    const subtitles = [];
    for (const entry of rawSubs) {
      const subUrl = sanitizeEmnexUrl(entry?.url);
      const lang = typeof entry?.lang === 'string' ? entry.lang.trim().slice(0, 80) : '';
      if (!subUrl || !lang || seenSubs.has(subUrl)) continue;
      seenSubs.add(subUrl);
      subtitles.push({ lang, url: subUrl, default: Boolean(entry?.default) });
    }
    return {
      provider: typeof data?.provider === 'string' && data.provider.trim() ? data.provider.trim().slice(0, 32) : (normalizedProvider || 'EmnexAnime'),
      type: data?.type === 'dub' ? 'dub' : normalizedType,
      hls,
      subtitles,
      intro: sanitizeTimingRange(data?.intro),
      outro: sanitizeTimingRange(data?.outro),
    };
  }, refresh);
}

export async function emnexEpisode(animeId, episode, { type = 'sub', provider = '', refresh = false, idType = 'anilist' } = {}) {
  const requestedType = type === 'dub' ? 'dub' : 'sub';
  const serverInfo = await emnexServers(animeId, episode, idType, false).catch(() => null);
  const servers = serverInfo?.servers ?? [];
  const hasSub = servers.length ? servers.some(entry => entry.type === 'sub') : true;
  const hasDub = servers.length ? servers.some(entry => entry.type === 'dub') : true;
  let effectiveType = requestedType;
  let fallbackFrom = null;
  let effectiveProvider = provider;
  if (servers.length) {
    if (requestedType === 'dub' && !hasDub && hasSub) {
      effectiveType = 'sub';
      fallbackFrom = 'dub';
      effectiveProvider = '';
    } else if (requestedType === 'sub' && !hasSub && hasDub) {
      effectiveType = 'dub';
      fallbackFrom = 'sub';
      effectiveProvider = '';
    }
  }
  const stream = await emnexStream(animeId, episode, {
    type: effectiveType,
    provider: effectiveProvider,
    refresh,
    idType,
  });
  return {
    ...stream,
    servers,
    availableTypes: {
      sub: hasSub || stream.type === 'sub',
      dub: hasDub || stream.type === 'dub',
    },
    ...(fallbackFrom ? { fallbackFrom } : {}),
  };
}

export async function enrichAnimeDetails(id, details, loadSeason, now = new Date()) {
  if (!details) return details;
  const dubDataPromise = Promise.all([
    animeDubInfo().catch(() => ({ dubbed: new Set(), incomplete: new Set() })),
    animeDubSchedules().catch(() => ({ feedByAnilist: new Map(), feedByMal: new Map(), schedByAnilist: new Map(), schedByMal: new Map() })),
  ]);
  const mappings = await animeMappings().catch(() => null);
  let working = details;
  let virtualSeasons = null;
  const regularSeasons = (details.seasons ?? []).filter(entry => entry.season_number > 0);
  const s1Targets = mappings?.get(`tmdb_show:${id}:s1`);
  if (regularSeasons.length === 1 && regularSeasons[0].season_number === 1 && s1Targets) {
    const vPlan = virtualSeasonsFromTargets(s1Targets);
    if (vPlan) {
      const rawS1 = await loadSeason(1).catch(() => null);
      if (rawS1) {
        const applied = applyVirtualAnimeSeasons(details, rawS1, vPlan);
        working = applied.details;
        virtualSeasons = applied.virtualSeasons;
      }
    }
  }

  const today = now.toISOString().slice(0, 10);
  const next = working.next_episode_to_air;
  const seasonNumber = next?.season_number > 0 && (!next.air_date || next.air_date >= today)
    ? next.season_number
    : (working.seasons ?? [])
      .filter(entry => entry.season_number > 0 && entry.air_date && entry.air_date >= today)
      .sort((a, b) => a.air_date.localeCompare(b.air_date))[0]?.season_number;

  if (seasonNumber && mappings) {
    const vMatch = virtualSeasons?.find(entry => entry.vSeason.season === seasonNumber);
    const sourceSeason = vMatch ? 1 : seasonNumber;
    const episodeOffset = vMatch ? vMatch.vSeason.start - 1 : 0;
    const targets = mappings.get(`tmdb_show:${id}:s${sourceSeason}`);
    if (targets) {
      const seasonData = vMatch ? vMatch.sliced : await loadSeason(seasonNumber).catch(() => null);
      if (seasonData) {
        const seasonResult = await resolveAnimeSeasonSchedule(id, seasonNumber, seasonData, now, { sourceSeason, episodeOffset });
        working = applyAnimeDetailsSchedule(working, seasonNumber, seasonResult, now);
      }
    }
  }

  // Attach show-level dub availability & upcoming dub episode summary for DetailsPage.
  if (mappings) {
    const [dubInfo, dubSchedules] = await dubDataPromise;
    let showHasDub = false;
    let nextDubEpisode = null;
    const checkTargets = (targets, seasonNum, offset = 0) => {
      if (!targets) return;
      for (const [descriptor, epRules] of Object.entries(targets)) {
        const anilistId = Number(descriptor.match(/^anilist:([1-9]\d*)$/)?.[1]);
        const malId = Number(descriptor.match(/^mal:([1-9]\d*)$/)?.[1]);
        if (malId && (dubInfo.dubbed.has(malId) || dubInfo.incomplete.has(malId))) showHasDub = true;
        if (anilistId && (dubSchedules.feedByAnilist.has(anilistId) || dubSchedules.schedByAnilist.has(anilistId))) showHasDub = true;
        if (malId && (dubSchedules.feedByMal.has(malId) || dubSchedules.schedByMal.has(malId))) showHasDub = true;
        const sched = (anilistId && dubSchedules.schedByAnilist.get(anilistId)) || (malId && dubSchedules.schedByMal.get(malId));
        if (sched && epRules && typeof epRules === 'object') {
          showHasDub = true;
          const airDate = sched.episodeDate.slice(0, 10);
          if (airDate >= today) {
            let targetSeason = seasonNum;
            let targetEp = sched.episodeNumber;
            let mappedTmdbEp = null;
            for (const [from, to] of Object.entries(epRules)) {
              const source = range(from);
              if (!source) continue;
              const [intervals, ratio = '1'] = String(to).split('|');
              const targetRanges = intervals.split(',').map(range);
              if (ratio !== '1' || targetRanges.some(t => !t)) continue;
              let cursor = 0;
              for (const tr of targetRanges) {
                if (sched.episodeNumber >= tr.start && sched.episodeNumber <= tr.end) {
                  mappedTmdbEp = source.start + cursor + (sched.episodeNumber - tr.start);
                  break;
                }
                cursor += tr.end - tr.start + 1;
              }
              if (mappedTmdbEp != null) break;
            }
            if (mappedTmdbEp != null) {
              if (virtualSeasons && offset === 0 && seasonNum === 1) {
                const owner = virtualSeasons.find(v => mappedTmdbEp >= v.vSeason.start && mappedTmdbEp <= v.vSeason.end);
                if (owner) {
                  targetSeason = owner.vSeason.season;
                  targetEp = mappedTmdbEp - owner.vSeason.start + 1;
                } else {
                  targetEp = mappedTmdbEp;
                }
              } else {
                targetEp = mappedTmdbEp;
              }
            }
            if (!nextDubEpisode || airDate < nextDubEpisode.air_date) {
              nextDubEpisode = { season_number: targetSeason, episode_number: targetEp, air_date: airDate };
            }
          }
        }
      }
    };
    const showSeasons = mappingByTmdbShow?.get(String(id)) || [];
    for (const [sNum, targets] of showSeasons) {
      checkTargets(targets, sNum);
    }
    if (showHasDub) {
      working = { ...working, anime_dub: { available: true, next_episode_to_air: nextDubEpisode } };
    }
  }

  return working;
}
