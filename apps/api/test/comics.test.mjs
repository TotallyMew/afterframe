import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comicsApi } from '../comics/comics.mjs';

test('chapter ranges and reader links follow the same ordered list of chapters', async t => {
  const uuid = number => `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`;
  const titleId = uuid(1000);
  const release = (id, number, title = '') => ({
    id: uuid(id),
    attributes: { chapter: number, title, translatedLanguage: 'en', pages: 1 },
    relationships: [],
  });
  const chapter50 = release(50, '50');
  const extra = release(200, '49.5');
  const alternate = release(201, '050.0');
  const special = release(202, null, 'Afterword');
  const feed = [...Array.from({ length: 105 }, (_, i) => release(i + 1, String(i + 1))), extra, chapter50, alternate, special];

  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url.origin, 'https://api.mangadex.org');
    if (url.pathname.endsWith('/feed')) {
      return Response.json({ result: 'ok', data: feed, total: feed.length });
    }
    assert.equal(url.pathname, `/manga/${titleId}`);
    return Response.json({ result: 'ok', data: {
      id: titleId,
      attributes: { title: { en: 'Fixture Comic' }, originalLanguage: 'en', contentRating: 'safe', availableTranslatedLanguages: ['en'] },
      relationships: [],
    } });
  });
  const load = async params => {
    const { status, body } = await comicsApi(`/api/comics/${titleId}/chapters`, new URLSearchParams(params));
    assert.equal(status, 200);
    return body;
  };

  const first = await load({});
  const second = await load({ page: 3, chapter: alternate.id });
  const last = await load({ page: 200 });

  assert.deepEqual(first.ranges, [
    { start: '1', end: '49.5' },
    { start: '50', end: '99' },
    { start: '100', end: 'Afterword' },
  ]);
  assert.equal(first.totalChapters, 107);
  assert.equal(first.mainChapters, 105);
  const entries = [...first.results, ...second.results, ...last.results];
  assert.equal(new Set(entries.map(entry => entry.id)).size, entries.length);
  assert.deepEqual([...new Set(entries.map(entry => entry.number))], [
    ...Array.from({ length: 49 }, (_, i) => String(i + 1)),
    '49.5',
    ...Array.from({ length: 56 }, (_, i) => String(i + 50)),
    null,
  ]);
  assert.equal(second.page, 2);
  assert.equal(second.neighbors.previous.page, 1);
  assert.equal(second.neighbors.previous.entry.id, extra.id);
  assert.equal(second.neighbors.next.entry.number, '51');
  assert.deepEqual(second.results.slice(0, 2).map(entry => entry.id), [chapter50.id, alternate.id]);
  assert.equal(last.page, 3);
  assert.equal(last.nextPage, null);

  const boundary = await load({ chapter: extra.id });
  assert.equal(boundary.neighbors.next.entry.id, chapter50.id);
  assert.equal(boundary.neighbors.next.page, 2);
  const end = await load({ chapter: special.id });
  assert.equal(end.neighbors.next, null);
});

test('native MangaDex pages are served through the local image route', async t => {
  const titleId = '00000000-0000-0000-0000-000000001001';
  const chapterId = '00000000-0000-0000-0000-000000001002';
  const hash = '0123456789abcdef0123456789abcdef';
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.pathname === `/manga/${titleId}`) {
      return Response.json({ result: 'ok', data: {
        id: titleId,
        attributes: { title: { en: 'Fixture Comic' }, originalLanguage: 'en', contentRating: 'safe' },
        relationships: [],
      } });
    }
    if (url.pathname === `/chapter/${chapterId}`) {
      return Response.json({ result: 'ok', data: {
        id: chapterId,
        attributes: { chapter: '1', translatedLanguage: 'en', pages: 1 },
        relationships: [{ type: 'manga', id: titleId }],
      } });
    }
    assert.equal(url.pathname, `/at-home/server/${chapterId}`);
    return Response.json({ result: 'ok',
      baseUrl: 'https://uploads.mangadex.org',
      chapter: { hash, data: ['page.jpg'], dataSaver: [] },
    });
  });

  const result = await comicsApi(`/api/comics/${titleId}/chapters/${chapterId}`, new URLSearchParams());
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.pages, [`/comic-page/${titleId}/${chapterId}/1`]);
});
