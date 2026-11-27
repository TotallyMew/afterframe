import assert from 'node:assert/strict';
import { test } from 'node:test';
import { weeklyAiringSchedule, weeklyAnimeEntries } from '../catalog/airing.mjs';
import { fallbackAnimeCatalog, stripAnimeSeasonTitle } from '../catalog/discovery.mjs';

const from = Date.parse('2026-11-22T00:00:00Z') / 1000;
const to = from + 7 * 86400;
const now = from * 1000;
const params = (type, offset = 0) => new URLSearchParams({ type, from: String(from + offset), to: String(to + offset) });
const json = data => new Response(JSON.stringify(data), { status: 200 });

test('rejects invalid or unbounded schedule requests before fetching', async context => {
  const fetchMock = context.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected fetch'); });
  for (const input of [new URLSearchParams(), params('movie'), new URLSearchParams({ type: 'tv', from: String(from), to: String(from + 100) }), params('anime', 40 * 86400)]) {
    await assert.rejects(weeklyAiringSchedule(input, now), error => error.statusCode === 400);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('paginates anime, maps catalog seasons, filters adult entries and excludes the next week', async context => {
  const pages = [];
  const episode = (id, number, airingAt, isAdult = false) => ({ id, episode: number, airingAt, media: { id: 123, isAdult, countryOfOrigin: 'JP', format: 'TV', title: { english: 'Example anime' } } });
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).includes('anibridge')) return json({
      'tmdb_show:456:s2': { 'anilist:123': { '1-12': '1-12' } },
      'tmdb_show:789:s1': { 'tvdb_show:100:s1': { '1-24': '1-24' }, 'tvdb_show:100:s2': { '25-48': '1-24' } },
    });
    const { variables } = JSON.parse(options.body);
    pages.push(variables.page);
    assert.equal(variables.from, from - 8 * 86400);
    return json({ data: { Page: { pageInfo: { hasNextPage: variables.page === 1 }, airingSchedules: variables.page === 1
      ? [episode(0, 2, from - 7 * 86400), episode(1, 3, from), episode(2, 4, from + 20, true)]
      : [episode(1, 3, from), episode(4, 4, to)] } } });
  });
  const result = await weeklyAiringSchedule(params('anime'), now);
  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(result.results.map(entry => entry.id), ['anilist-1']);
  assert.equal(result.results[0].catalog, 'tv/456');
  assert.equal(result.results[0].catalogSeason, 2);
});

test('only Japanese weekly series are eligible; batch drops, movies, daily series and companion minis are excluded', () => {
  const series = (id, changes = {}) => ({ id, countryOfOrigin: 'JP', format: 'TV', duration: 24, episodes: 12, ...changes });
  const episodes = (media, dates) => dates.map((offset, index) => ({ id: `${media.id}-${index}`, media, episode: index + 1, airingAt: from + offset * 86400 }));
  const input = [
    ...episodes(series(1), [-7, 0, 7]),
    ...episodes(series(2, { countryOfOrigin: 'CN' }), [-7, 0, 7]),
    ...episodes(series(3, { format: 'ONA', title: { english: 'Fool Night' } }), Array(12).fill(0)),
    ...episodes(series(4, { format: 'MOVIE', episodes: 1 }), [0]),
    ...episodes(series(5), [-1, 0, 1, 2, 7]),
    ...episodes(series(6, { format: 'ONA', duration: 2, relations: { edges: [{ relationType: 'PARENT', node: { type: 'ANIME' } }] } }), [-7, 0, 7]),
    ...episodes(series(7, { format: 'ONA' }), [-7, 0, 7]),
    ...episodes(series(8, { isAdult: true }), [-7, 0, 7]),
    ...episodes(series(9, { episodes: 2 }), [0, 0]),
    ...episodes(series(10), [-28, 0, 28]),
    ...episodes(series(11, { format: 'TV_SHORT', title: { english: 'Example Omake Shorts' } }), [-7, 0, 7]),
  ];
  assert.deepEqual([...new Set(weeklyAnimeEntries(input).map(entry => entry.media.id))], [1, 7]);
});

test('catalog fallback rejects live-action namesakes and loosely similar anime titles', async () => {
  const result = await fallbackAnimeCatalog({ id: 900003, format: 'TV', title: { english: 'Example' } }, async () => ({ results: [
    { id: 1, name: 'Example', genre_ids: [18], original_language: 'ja' },
    { id: 2, name: 'Example of an Unrelated Show', genre_ids: [16], original_language: 'ja' },
  ] }));
  assert.equal(result, null);
});

test('season matching uses parent titles and aliases while cour/part numbers never replace the season', async () => {
  assert.deepEqual(stripAnimeSeasonTitle('Example Season 3 Part 2'), { baseTitle: 'Example', season: 3 });
  assert.deepEqual(stripAnimeSeasonTitle('Example 2nd Cour'), { baseTitle: 'Example', season: null });
  const queries = [];
  const result = await fallbackAnimeCatalog({ id: 900001, format: 'TV', title: { english: 'Unknown Name Season 3', romaji: 'Other Name 3rd Season' }, synonyms: ['Catalog Name Season 3'] }, async (path, values) => {
    if (path === '/tv/321') return { seasons: [1, 2, 3].map(season_number => ({ season_number, episode_count: 12 })) };
    assert.equal(path, '/search/tv');
    queries.push(values.query);
    return { results: values.query === 'Catalog Name' ? [{ id: 321, name: 'Catalog Name', genre_ids: [16], original_language: 'ja' }] : [] };
  });
  assert.deepEqual(result, { catalog: 'tv/321', season: 3 });
  assert.deepEqual(queries, ['Unknown Name', 'Other Name', 'Catalog Name']);
});

test('weekly schedules resolve unmapped season-qualified anime through the parent catalog', async context => {
  const start = from + 240;
  context.mock.method(globalThis, 'fetch', async () => json({ data: { Page: { pageInfo: { hasNextPage: false }, airingSchedules: [-7, 0, 7].map((offset, index) => ({
    id: 500 + index, episode: index + 1, airingAt: start + offset * 86400,
    media: { id: 900002, countryOfOrigin: 'JP', format: 'TV', title: { english: 'Blue Box Season 2' } },
  })) } } }));
  const result = await weeklyAiringSchedule(params('anime', 240), now, async path => path === '/tv/259140'
    ? { seasons: [{ season_number: 1, episode_count: 37 }] }
    : { results: [{ id: 259140, name: 'Blue Box', genre_ids: [16], original_language: 'ja' }] });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].catalog, 'tv/259140');
  assert.equal(result.results[0].catalogSeason, 1);
});

test('fallback season validation preserves supported virtual anime seasons', async () => {
  const result = await fallbackAnimeCatalog({ id: 900004, format: 'TV', title: { english: 'Virtual Example Season 2' } }, async path => path === '/tv/789'
    ? { seasons: [{ season_number: 1, episode_count: 48 }] }
    : { results: [{ id: 789, name: 'Virtual Example', genre_ids: [16], original_language: 'ja' }] });
  assert.deepEqual(result, { catalog: 'tv/789', season: 2 });
});

test('combines TV broadcasts and streaming, deduplicates episodes and respects timezone boundaries', async context => {
  const urls = [];
  const start = from + 60;
  const episode = (id, airingAt) => ({ id, number: 2, season: 1, airtime: '19:00', airstamp: new Date(airingAt * 1000).toISOString(), show: { name: 'Example TV', webChannel: { name: 'Stream' } } });
  context.mock.method(globalThis, 'fetch', async url => {
    urls.push(String(url));
    return json([episode(1, start - 1), episode(2, start), episode(3, start + 7 * 86400)]);
  });
  const result = await weeklyAiringSchedule(params('tv', 60), now);
  assert.deepEqual(result.results.map(entry => entry.id), ['tvmaze-2']);
  assert.ok(urls.some(url => url.includes('/schedule?country=US')));
  assert.ok(urls.some(url => url.includes('/schedule/web?country=&')));
  assert.ok(urls.some(url => url.endsWith('2026-11-21')));
  assert.equal(result.results[0].network, 'Stream');
});

test('provider failures reject instead of returning a misleading empty week', async context => {
  context.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  await assert.rejects(weeklyAiringSchedule(params('anime', 120), now), /temporarily unavailable/);
});
