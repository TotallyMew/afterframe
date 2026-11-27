import assert from 'node:assert/strict';
import { test } from 'node:test';
import { weeklyAiringSchedule } from '../catalog/airing.mjs';

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
  const episode = (id, airingAt, isAdult = false) => ({ id, episode: 3, airingAt, media: { id: 123, isAdult, title: { english: 'Example anime' } } });
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).includes('anibridge')) return json({ 'tmdb_show:456:s2': { 'anilist:123': { '1-12': '1-12' } } });
    const { variables } = JSON.parse(options.body);
    pages.push(variables.page);
    assert.equal(variables.from, from - 1);
    return json({ data: { Page: { pageInfo: { hasNextPage: variables.page === 1 }, airingSchedules: variables.page === 1
      ? [episode(1, from), episode(2, from + 20, true)]
      : [episode(1, from), episode(3, from + 30), episode(4, to)] } } });
  });
  const result = await weeklyAiringSchedule(params('anime'), now);
  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(result.results.map(entry => entry.id), ['anilist-1', 'anilist-3']);
  assert.equal(result.results[0].catalog, 'tv/456');
  assert.equal(result.results[0].catalogSeason, 2);
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
