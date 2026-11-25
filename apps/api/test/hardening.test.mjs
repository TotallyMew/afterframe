import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheMetadata, peekMetadata } from '../catalog/metadata.mjs';
import { comicsApi } from '../comics/comics.mjs';
import { fetchWithRetry, resetCircuits } from '../http-client.mjs';
import { checkRateLimit, resetRateLimits } from '../rate-limit.mjs';

const prevDb = process.env.AFTERFRAME_DB;
const prevPg = process.env.AFTERFRAME_ACCOUNTS_DATABASE_URL;
process.env.AFTERFRAME_DB = ':memory:';
delete process.env.AFTERFRAME_ACCOUNTS_DATABASE_URL;
const { accountApi, clientAddress } = await import('../accounts/accounts.mjs');
const { setTmdbCredential } = await import('../catalog/tmdb.mjs');
const { handleApi } = await import('../server.mjs');
if (prevDb === undefined) delete process.env.AFTERFRAME_DB; else process.env.AFTERFRAME_DB = prevDb;
if (prevPg === undefined) delete process.env.AFTERFRAME_ACCOUNTS_DATABASE_URL; else process.env.AFTERFRAME_ACCOUNTS_DATABASE_URL = prevPg;

test('clientAddress respects rightmost X-Forwarded-For only when behind trusted proxy', () => {
  const prevTrust = process.env.AFTERFRAME_TRUST_PROXY;
  const prevOrigin = process.env.AFTERFRAME_ORIGIN;
  const prevWebPort = process.env.AFTERFRAME_WEB_PORT;
  try {
    delete process.env.AFTERFRAME_TRUST_PROXY;
    delete process.env.AFTERFRAME_ORIGIN;
    delete process.env.AFTERFRAME_WEB_PORT;
    const req = { socket: { remoteAddress: '10.0.0.5' }, headers: { 'x-forwarded-for': '203.0.113.1, 198.51.100.9' } };
    assert.equal(clientAddress(req), '10.0.0.5');

    process.env.AFTERFRAME_TRUST_PROXY = '1';
    assert.equal(clientAddress(req), '198.51.100.9');
  } finally {
    if (prevTrust === undefined) delete process.env.AFTERFRAME_TRUST_PROXY; else process.env.AFTERFRAME_TRUST_PROXY = prevTrust;
    if (prevOrigin === undefined) delete process.env.AFTERFRAME_ORIGIN; else process.env.AFTERFRAME_ORIGIN = prevOrigin;
    if (prevWebPort === undefined) delete process.env.AFTERFRAME_WEB_PORT; else process.env.AFTERFRAME_WEB_PORT = prevWebPort;
  }
});

test('concurrent sign-in attempts queue instead of failing with 429', async () => {
  const noopRes = { setHeader() {} };
  const created = await accountApi({ method: 'POST', headers: {} }, noopRes, '/api/account/create', { username: 'queue-user', password: 'strong-test-password' });
  assert.equal(created.code, 201);
  const results = await Promise.all([1, 2, 3].map(n => accountApi(
    { method: 'POST', headers: {}, socket: { remoteAddress: `127.0.0.${n}` } },
    noopRes,
    '/api/account/signin',
    { username: 'queue-user', password: 'strong-test-password' },
  )));
  assert.deepEqual(results.map(r => r.code), [200, 200, 200]);
});

test('unconfigured TMDb returns 503 for /related instead of 404', async () => {
  setTmdbCredential('');
  let statusCode = 0;
  let body = '';
  const response = {
    writeHead(code) { statusCode = code; },
    end(chunk) { body = chunk; },
  };
  await handleApi({ method: 'GET', headers: {} }, response, new URL('http://localhost/api/movie/550/related'));
  assert.equal(statusCode, 503);
  assert.match(body, /Connect the catalog/);
});

test('metadata cache uses LRU eviction order', async () => {
  await cacheMetadata('lru-hot', 60_000, async () => 'hot-value');
  await cacheMetadata('lru-cold', 60_000, async () => 'cold-value');
  for (let i = 0; i < 605; i++) {
    if (i === 300) assert.equal(peekMetadata('lru-hot'), 'hot-value');
    await cacheMetadata(`lru-fill-${i}`, 60_000, async () => i);
  }
  assert.equal(peekMetadata('lru-hot'), 'hot-value');
  assert.equal(peekMetadata('lru-cold'), undefined);
});

test('comic transcript file is cached by mtime and reloads when updated', async t => {
  const titleId = '00000000-0000-0000-0000-000000002001';
  const chapterId = '00000000-0000-0000-0000-000000002002';
  const hash = '0123456789abcdef0123456789abcdef';
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.pathname === `/manga/${titleId}`) {
      return Response.json({ result: 'ok', data: { id: titleId, attributes: { title: { en: 'Cached Transcript Comic' }, originalLanguage: 'en', contentRating: 'safe' }, relationships: [] } });
    }
    if (url.pathname === `/chapter/${chapterId}`) {
      return Response.json({ result: 'ok', data: { id: chapterId, attributes: { chapter: '1', translatedLanguage: 'en', pages: 1 }, relationships: [{ type: 'manga', id: titleId }] } });
    }
    return Response.json({ result: 'ok', baseUrl: 'https://uploads.mangadex.org', chapter: { hash, data: ['p1.jpg'], dataSaver: [] } });
  });
  const folder = await mkdtemp(join(tmpdir(), 'afterframe-tr-cache-'));
  const file = join(folder, 'transcripts.json');
  const prev = process.env.AFTERFRAME_COMIC_TRANSCRIPTS_FILE;
  try {
    process.env.AFTERFRAME_COMIC_TRANSCRIPTS_FILE = file;
    await writeFile(file, JSON.stringify({ [`${titleId}/${chapterId}`]: { pages: ['v1'] } }));
    const r1 = await comicsApi(`/api/comics/${titleId}/chapters/${chapterId}`, new URLSearchParams());
    assert.deepEqual(r1.body.transcript, { pages: ['v1'] });
    await writeFile(file, JSON.stringify({ [`${titleId}/${chapterId}`]: { pages: ['v2-updated'] } }));
    const r2 = await comicsApi(`/api/comics/${titleId}/chapters/${chapterId}`, new URLSearchParams());
    assert.deepEqual(r2.body.transcript, { pages: ['v2-updated'] });
  } finally {
    if (prev === undefined) delete process.env.AFTERFRAME_COMIC_TRANSCRIPTS_FILE; else process.env.AFTERFRAME_COMIC_TRANSCRIPTS_FILE = prev;
    await rm(file, { force: true });
    await rmdir(folder);
  }
});

test('account library accepts comic ratings and reading status updates', async () => {
  let cookie = '';
  const captureRes = {
    setHeader(name, value) {
      if (String(name).toLowerCase() === 'set-cookie') {
        const raw = Array.isArray(value) ? value[0] : value;
        cookie = String(raw).split(';')[0];
      }
    },
  };
  const created = await accountApi(
    { method: 'POST', headers: {} },
    captureRes,
    '/api/account/create',
    { username: 'comic-rater', password: 'strong-test-password' },
  );
  assert.equal(created.code, 201);
  assert.ok(cookie);

  const comicItem = { id: 'c-100', key: 'comic-c-100', type: 'comic', title: 'Berserk', format: 'manga' };
  const accountId = created.body.account.id;
  const saved = await accountApi(
    { method: 'POST', headers: { cookie } },
    captureRes,
    '/api/account/library',
    { accountId, kind: 'saved', key: 'comic-c-100', value: { ...comicItem, watchStatus: 'watching', added: Date.now() } },
  );
  assert.equal(saved.code, 200);

  const rated = await accountApi(
    { method: 'POST', headers: { cookie } },
    captureRes,
    '/api/account/library',
    { accountId, kind: 'ratings', key: 'comic-c-100', value: { score: 10, scale: 10, item: comicItem, updated: Date.now() } },
  );
  assert.equal(rated.code, 200);

  const account = await accountApi({ method: 'GET', headers: { cookie } }, captureRes, '/api/account');
  assert.equal(account.code, 200);
  assert.equal(account.body.library.saved['comic-c-100'].watchStatus, 'watching');
  assert.equal(account.body.library.ratings['comic-c-100'].score, 10);
});

test('GET /api/comics/:id/related returns related comics excluding self', async t => {
  const titleId = '00000000-0000-0000-0000-000000003001';
  const siblingId = '00000000-0000-0000-0000-000000003002';
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.pathname === `/manga/${titleId}`) {
      return Response.json({
        result: 'ok',
        data: {
          id: titleId,
          attributes: {
            title: { en: 'Primary Manga' },
            originalLanguage: 'ja',
            contentRating: 'safe',
            tags: [{ id: 'tag-action', attributes: { group: 'genre', name: { en: 'Action' } } }],
          },
          relationships: [],
        },
      });
    }
    if (url.pathname === '/manga') {
      return Response.json({
        result: 'ok',
        data: [
          { id: titleId, attributes: { title: { en: 'Primary Manga' }, originalLanguage: 'ja', contentRating: 'safe' }, relationships: [] },
          { id: siblingId, attributes: { title: { en: 'Sibling Manga' }, originalLanguage: 'ja', contentRating: 'safe' }, relationships: [] },
        ],
      });
    }
    return Response.json({ result: 'ok', data: [] });
  });

  const res = await comicsApi(`/api/comics/${titleId}/related`, new URLSearchParams());
  assert.equal(res.status, 200);
  assert.equal(res.body.results.length, 1);
  assert.equal(res.body.results[0].id, siblingId);
});

test('POST /api/account/import merges newer entries non-destructively and validates payloads', async () => {
  let cookie = '';
  const captureRes = {
    setHeader(name, value) {
      if (String(name).toLowerCase() === 'set-cookie') {
        const raw = Array.isArray(value) ? value[0] : value;
        cookie = String(raw).split(';')[0];
      }
    },
  };
  const created = await accountApi(
    { method: 'POST', headers: {} },
    captureRes,
    '/api/account/create',
    { username: 'importer-user', password: 'strong-test-password' },
  );
  assert.equal(created.code, 201);
  const accountId = created.body.account.id;
  const now = Date.now();

  await accountApi(
    { method: 'POST', headers: { cookie } },
    captureRes,
    '/api/account/library',
    {
      accountId,
      kind: 'saved',
      key: 'movie-550',
      value: { key: 'movie-550', id: 550, type: 'movie', title: 'Fight Club', watchStatus: 'watching', added: now },
      at: now,
    },
  );

  const imported = await accountApi(
    { method: 'POST', headers: { cookie } },
    captureRes,
    '/api/account/import',
    {
      accountId,
      library: {
        saved: {
          // Older than existing -> should be skipped
          'movie-550': { key: 'movie-550', id: 550, type: 'movie', title: 'Fight Club', watchStatus: 'planned', added: now - 5000 },
          // New title -> should be imported
          'movie-603': { key: 'movie-603', id: 603, type: 'movie', title: 'The Matrix', watchStatus: 'planned', added: now },
          // Invalid -> skipped
          'bad key!': { key: 'bad key!', type: 'invalid' },
        },
        ratings: {
          'movie-603': { score: 9, scale: 10, updated: now, item: { key: 'movie-603', id: 603, type: 'movie', title: 'The Matrix' } },
        },
      },
    },
  );
  assert.equal(imported.code, 200);
  assert.equal(imported.body.totalImported, 2);
  assert.equal(imported.body.skipped, 2);
  assert.equal(imported.body.library.saved['movie-550'].watchStatus, 'watching');
  assert.equal(imported.body.library.saved['movie-603'].title, 'The Matrix');
  assert.equal(imported.body.library.ratings['movie-603'].score, 9);
});

test('checkRateLimit enforces bucket limit and returns retryAfterSeconds', () => {
  resetRateLimits();
  const base = 1_700_000_000_000;
  const policy = { limit: 2, windowMs: 60_000 };
  assert.equal(checkRateLimit('test-scope', '10.0.0.1', policy, base).allowed, true);
  assert.equal(checkRateLimit('test-scope', '10.0.0.1', policy, base + 1000).allowed, true);
  const blocked = checkRateLimit('test-scope', '10.0.0.1', policy, base + 2000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 58);
  // Different IP is unaffected
  assert.equal(checkRateLimit('test-scope', '10.0.0.2', policy, base + 2000).allowed, true);
  // Window expiry resets quota
  assert.equal(checkRateLimit('test-scope', '10.0.0.1', policy, base + 61_000).allowed, true);
  resetRateLimits();
});

test('fetchWithRetry retries transient 503 and trips circuit breaker after repeated failures', async t => {
  resetCircuits();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) return new Response('busy', { status: 503 });
    return new Response('ok', { status: 200 });
  });
  const okRes = await fetchWithRetry('https://example.test/retry', {}, { retries: 1, baseDelayMs: 5, hostKey: 'retry-host' });
  assert.equal(okRes.status, 200);
  assert.equal(calls, 2);

  t.mock.method(globalThis, 'fetch', async () => { throw new Error('network down'); });
  for (let i = 0; i < 2; i++) {
    await assert.rejects(() => fetchWithRetry('https://example.test/fail', {}, { retries: 0, hostKey: 'broken-host', circuitThreshold: 2, circuitCooldownMs: 60_000 }));
  }
  await assert.rejects(
    () => fetchWithRetry('https://example.test/fail', {}, { retries: 0, hostKey: 'broken-host', circuitThreshold: 2, circuitCooldownMs: 60_000 }),
    error => Boolean(error.circuitOpen),
  );
  resetCircuits();
});
