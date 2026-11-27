import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comicsApi } from '../comics/comics.mjs';

const uuid = number => `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`;

test('browse sorts map to MangaDex orders and titles carry their latest chapter release', async t => {
  const requests = [];
  const latestId = uuid(900);
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(url);
    if (url.pathname === '/chapter') {
      assert.deepEqual(url.searchParams.getAll('ids[]'), [latestId]);
      return Response.json({ result: 'ok', total: 1, data: [{
        id: latestId, attributes: { chapter: '0120.50', readableAt: '2026-11-26T10:00:00+00:00' }, relationships: [],
      }] });
    }
    assert.equal(url.pathname, '/manga');
    return Response.json({ result: 'ok', total: 1, data: [{
      id: uuid(1),
      attributes: { title: { en: 'Trending Fixture' }, originalLanguage: 'ja', latestUploadedChapter: latestId, tags: [] },
      relationships: [],
    }] });
  });

  const trending = await comicsApi('/api/comics', new URLSearchParams({ sort: 'trending', type: 'manhua' }));
  assert.equal(trending.status, 200);
  const [browse] = requests;
  assert.equal(browse.searchParams.get('order[followedCount]'), 'desc');
  assert.match(browse.searchParams.get('createdAtSince'), /^\d{4}-\d{2}-\d{2}T00:00:00$/);
  assert.equal(browse.searchParams.get('hasAvailableChapters'), 'true');
  assert.equal(trending.body.results[0].latestChapter, '120.5');
  assert.equal(trending.body.results[0].latestAt, '2026-11-26T10:00:00.000Z');

  requests.length = 0;
  await comicsApi('/api/comics', new URLSearchParams({ sort: 'newest', type: 'manhwa' }));
  assert.equal(requests[0].searchParams.get('order[createdAt]'), 'desc');
  assert.equal(requests[0].searchParams.get('createdAtSince'), null);

  requests.length = 0;
  await comicsApi('/api/comics', new URLSearchParams({ sort: 'rating', type: 'manga' }));
  assert.equal(requests[0].searchParams.get('order[rating]'), 'desc');
  assert.equal(requests[0].searchParams.get('hasAvailableChapters'), null);
});
