import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { comicPageResponse, comicsApi } from '../comics/comics.mjs';

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
  const preview = await load({ scope: 'native' });
  const second = await load({ page: 3, chapter: alternate.id });
  const last = await load({ page: 200 });

  assert.deepEqual(first.ranges, [
    { start: '1', end: '49.5' },
    { start: '50', end: '99' },
    { start: '100', end: 'Afterword' },
  ]);
  assert.equal(first.totalChapters, 107);
  assert.equal(preview.preview, true);
  assert.deepEqual(preview.results, first.results);
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

  const allChapters = await load({ all: '1' });
  assert.equal(allChapters.totalChapters, 107);
  assert.deepEqual(allChapters.ranges, []);
  assert.equal(allChapters.nextPage, null);
  assert.equal(allChapters.results.length, entries.length);
});

test('native MangaDex pages are served through the local image route', async t => {
  const titleId = '00000000-0000-0000-0000-000000001001';
  const chapterId = '00000000-0000-0000-0000-000000001002';
  const hash = '0123456789abcdef0123456789abcdef';
  let manifests = 0;
  let chapters = 0;
  let rejectImage = false;
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).startsWith('https://uploads.mangadex.org/')) {
      return rejectImage ? new Response(null, { status: 404 }) : new Response('image', { headers: { 'content-type': 'image/jpeg' } });
    }
    if (url.pathname === `/manga/${titleId}`) {
      return Response.json({ result: 'ok', data: {
        id: titleId,
        attributes: { title: { en: 'Fixture Comic' }, originalLanguage: 'en', contentRating: 'safe' },
        relationships: [],
      } });
    }
    if (url.pathname === `/chapter/${chapterId}`) {
      chapters++;
      return Response.json({ result: 'ok', data: {
        id: chapterId,
        attributes: { chapter: '1', translatedLanguage: 'en', pages: 1 },
        relationships: [{ type: 'manga', id: titleId }],
      } });
    }
    assert.equal(url.pathname, `/at-home/server/${chapterId}`);
    manifests++;
    return Response.json({ result: 'ok',
      baseUrl: 'https://uploads.mangadex.org',
      chapter: { hash, data: ['page.jpg'], dataSaver: [] },
    });
  });

  const result = await comicsApi(`/api/comics/${titleId}/chapters/${chapterId}`, new URLSearchParams());
  assert.equal(result.status, 200);
  assert.equal(result.body.transcript, undefined);
  assert.deepEqual(result.body.pages, [`/comic-page/${titleId}/${chapterId}/1`]);
  const folder = await mkdtemp(join(tmpdir(), 'afterframe-transcripts-'));
  const file = join(folder, 'transcripts.json');
  const previousFile = process.env.AFTERFRAME_COMIC_TRANSCRIPTS_FILE;
  try {
    const entry = `${titleId}/${chapterId}`;
    await writeFile(file, JSON.stringify({ [entry]: { pages: ['Page one text', 'Wrong extra page'], source: 'https://example.com/source' } }));
    process.env.AFTERFRAME_COMIC_TRANSCRIPTS_FILE = file;
    const supplied = await comicsApi(`/api/comics/${titleId}/chapters/${chapterId}`, new URLSearchParams());
    assert.deepEqual(supplied.body.transcript, { pages: ['Page one text'], source: 'https://example.com/source' });
    await writeFile(file, '{malformed');
    const noTranscript = await comicsApi(`/api/comics/${titleId}/chapters/${chapterId}`, new URLSearchParams());
    assert.equal(noTranscript.status, 200);
    assert.equal(noTranscript.body.transcript, undefined);
  } finally {
    if (previousFile === undefined) delete process.env.AFTERFRAME_COMIC_TRANSCRIPTS_FILE;
    else process.env.AFTERFRAME_COMIC_TRANSCRIPTS_FILE = previousFile;
    await rm(file, { force: true });
    await rmdir(folder);
  }
  const [first, second] = await Promise.all(result.body.pages.concat(result.body.pages)
    .map(path => comicPageResponse(path, new AbortController().signal)));
  assert.equal(await first.text(), 'image');
  assert.equal(await second.text(), 'image');
  assert.equal(chapters, 1);
  assert.equal(manifests, 1);
  rejectImage = true;
  assert.equal(await comicPageResponse(result.body.pages[0], new AbortController().signal), null);
  const refreshed = await comicsApi(`/api/comics/${titleId}/chapters/${chapterId}`, new URLSearchParams());
  assert.equal(refreshed.status, 200);
  assert.equal(manifests, 2);
});

test('comics chapter counts endpoint extracts aggregate chapter counts and ignores invalid IDs', async t => {
  const ongoingId = '00000000-0000-0000-0000-000000002001';
  const emptyId = '00000000-0000-0000-0000-000000002002';
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    calls++;
    assert.equal(url.origin, 'https://api.mangadex.org');
    if (url.pathname === `/manga/${ongoingId}/aggregate`) {
      return Response.json({
        result: 'ok',
        volumes: {
          1: { volume: '1', count: 2, chapters: { 1: { chapter: '1' }, '12.5': { chapter: '12.5' } } },
          none: { volume: 'none', count: 2, chapters: { 145: { chapter: '145' }, '145.5': { chapter: '145.5' } } },
        },
      });
    }
    if (url.pathname === `/manga/${emptyId}/aggregate`) {
      return Response.json({ result: 'ok', volumes: [] });
    }
    throw new Error(`Unexpected fetch ${url}`);
  });

  const first = await comicsApi('/api/comics/counts', new URLSearchParams({
    ids: `${ongoingId},not-a-uuid,${emptyId},${ongoingId}`,
  }));
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { counts: { [ongoingId]: '145' } });
  assert.equal(calls, 2);

  // Cached on second request.
  const cached = await comicsApi('/api/comics/counts', new URLSearchParams({ ids: ongoingId }));
  assert.equal(cached.status, 200);
  assert.deepEqual(cached.body, { counts: { [ongoingId]: '145' } });
  assert.equal(calls, 2);
});

test('comicPageResponse enforces contentRating for native MangaDex chapters and normalizes fractional chapter numbers', async t => {
  const blockedTitle = '00000000-0000-0000-0000-000000009001';
  const blockedChapter = '00000000-0000-0000-0000-000000009002';
  const safeTitle = '00000000-0000-0000-0000-000000009003';
  const chA = '00000000-0000-0000-0000-000000009004';
  const chB = '00000000-0000-0000-0000-000000009005';
  const chUnnumbered = '00000000-0000-0000-0000-000000009006';

  t.mock.method(globalThis, 'fetch', async url => {
    if (url.pathname === `/manga/${blockedTitle}`) {
      return Response.json({
        result: 'ok',
        data: { id: blockedTitle, attributes: { title: { en: 'Blocked' }, originalLanguage: 'ja', contentRating: 'pornographic' }, relationships: [] },
      });
    }
    if (url.pathname === `/manga/${safeTitle}`) {
      return Response.json({
        result: 'ok',
        data: { id: safeTitle, attributes: { title: { en: 'Decimal Test' }, originalLanguage: 'ja', contentRating: 'safe', availableTranslatedLanguages: ['en'] }, relationships: [] },
      });
    }
    if (url.pathname === `/manga/${safeTitle}/feed`) {
      return Response.json({
        result: 'ok',
        data: [
          { id: chUnnumbered, attributes: { chapter: null, title: 'Omake', translatedLanguage: 'en', pages: 1 }, relationships: [] },
          { id: chA, attributes: { chapter: '10.50', title: '', translatedLanguage: 'en', pages: 1 }, relationships: [] },
          { id: chB, attributes: { chapter: '10.5', title: '', translatedLanguage: 'en', pages: 1 }, relationships: [] },
        ],
        total: 3,
      });
    }
    throw new Error(`Unexpected fetch ${url}`);
  });

  const blocked = await comicPageResponse(`/comic-page/${blockedTitle}/${blockedChapter}/1`, new AbortController().signal);
  assert.equal(blocked, null);

  const list = await comicsApi(`/api/comics/${safeTitle}/chapters`, new URLSearchParams({ all: '1' }));
  assert.equal(list.status, 200);
  // Both 10.50 and 10.5 normalize to '10.5', and unnumbered Omake sorts last (after 10.5)
  assert.deepEqual(list.body.results.map(r => r.number), ['10.5', '10.5', null]);
});
