import { cacheMetadata } from './metadata.mjs';
import { animeCatalogTitles } from './anime.mjs';

const day = 86400;
const animeQuery = `query($page:Int!, $from:Int!, $to:Int!) {
  Page(page:$page, perPage:50) {
    pageInfo { hasNextPage }
    airingSchedules(airingAt_greater:$from, airingAt_lesser:$to, sort:TIME) {
      id episode airingAt
      media { id isAdult title { english romaji } coverImage { large } }
    }
  }
}`;

function invalid(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

async function providerJson(url, options = {}) {
  const response = await fetch(url, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(12000),
    headers: { accept: 'application/json', ...options.headers },
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('The airing schedule is temporarily unavailable. Please try again.');
  }
  return response.json();
}

async function animeSchedule(from, to) {
  const episodes = [];
  // Paginate the schedule itself so multiple episodes and less popular titles are included.
  for (let page = 1; page <= 40; page++) {
    const data = await cacheMetadata(`weekly-anime:v1:${from}:${to}:${page}`, 15 * 60000, () =>
      providerJson('https://graphql.anilist.co', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: animeQuery, variables: { page, from: from - 1, to } }),
      }));
    const result = data?.data?.Page;
    if (data.errors?.length || !Array.isArray(result?.airingSchedules)) {
      throw new Error('The anime airing schedule is temporarily unavailable. Please try again.');
    }
    episodes.push(...result.airingSchedules);
    if (!result.pageInfo?.hasNextPage) break;
    if (page === 40) throw new Error('The anime schedule is too large. Please try again later.');
  }
  const eligible = episodes.filter(entry => entry?.media && !entry.media.isAdult);
  const mappings = eligible.length
    ? await animeCatalogTitles([...new Set(eligible.map(entry => entry.media.id))]).catch(() => new Map())
    : new Map();
  return eligible.map(entry => {
    const match = mappings.get(entry.media.id);
    return {
      id: `anilist-${entry.id}`, title: entry.media.title?.english || entry.media.title?.romaji || 'Anime',
      poster: entry.media.coverImage?.large, episode: entry.episode, airingAt: entry.airingAt,
      timeKnown: true, catalog: match?.catalog, catalogSeason: match?.season,
    };
  });
}

async function tvSchedule(from, to) {
  // Include neighboring provider dates: broadcast and viewer timezones can differ by a day.
  const dates = [];
  for (let at = Math.floor(from / day) * day - day; at < to + day; at += day) {
    dates.push(new Date(at * 1000).toISOString().slice(0, 10));
  }
  const jobs = dates.flatMap(date => [
    `https://api.tvmaze.com/schedule?country=US&date=${date}`,
    `https://api.tvmaze.com/schedule/web?country=&date=${date}`,
  ]);
  const episodes = [];
  // Keep concurrent provider requests below TVmaze's rate limit.
  for (let index = 0; index < jobs.length; index += 4) {
    const batch = await Promise.all(jobs.slice(index, index + 4).map(url =>
      cacheMetadata(`weekly-tv:v1:${url}`, 30 * 60000, async () => {
        const result = await providerJson(url);
        if (!Array.isArray(result)) throw new Error('The TV airing schedule is temporarily unavailable. Please try again.');
        return result;
      })));
    episodes.push(...batch.flat());
  }
  return episodes.flatMap(entry => {
    const show = entry?.show || entry?._embedded?.show;
    const airingAt = Date.parse(entry?.airstamp) / 1000;
    if (!show || !Number.isFinite(airingAt)) return [];
    return [{
      id: `tvmaze-${entry.id}`, title: show.name || 'TV show', poster: show.image?.medium,
      season: entry.season, episode: entry.number, airingAt, timeKnown: Boolean(entry.airtime),
      network: show.network?.name || show.webChannel?.name,
    }];
  });
}

export async function weeklyAiringSchedule(params, now = Date.now()) {
  const type = params.get('type');
  const from = Number(params.get('from'));
  const to = Number(params.get('to'));
  if (type !== 'anime' && type !== 'tv') throw invalid('Choose an anime or TV schedule.');
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to)
    || to - from < 6 * day || to - from > 8 * day
    || Math.abs(from - now / 1000) > 36 * day) {
    throw invalid('Choose a week within the previous or next four weeks.');
  }
  const entries = type === 'anime' ? await animeSchedule(from, to) : await tvSchedule(from, to);
  const seen = new Set();
  const results = entries.filter(entry => {
    if (!entry.id || !Number.isFinite(entry.airingAt) || entry.airingAt < from || entry.airingAt >= to || seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  }).sort((a, b) => a.airingAt - b.airingAt || a.title.localeCompare(b.title));
  return { results };
}
