import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { migrateAccounts } from '../accounts/account-migrations.mjs';
import { recommendations } from '../catalog/discovery.mjs';
import { malRating } from '../catalog/mal.mjs';
import { recommendationProfile, titleProgress } from '../../../afterframe/public/library.js';

const item = { key: 'tv-8001', id: 8001, title: 'Fixture series', type: 'tv', genreIds: [18], totalEpisodes: 10 };

test('MAL scores use the official endpoint and the mapped ID', async t => {
  const previous = process.env.MAL_CLIENT_ID;
  process.env.MAL_CLIENT_ID = 'test-fixture';
  try {
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(url, 'https://api.myanimelist.net/v2/manga/912345?fields=mean');
      assert.equal(options.headers['X-MAL-CLIENT-ID'], 'test-fixture');
      return Response.json({ mean: 8.74 });
    });
    assert.equal(await malRating('manga', 912345), 8.74);
    assert.equal(await malRating('manga', 'not-an-id'), null);
  } finally {
    if (previous === undefined) delete process.env.MAL_CLIENT_ID;
    else process.env.MAL_CLIENT_ID = previous;
  }
});

test('per-episode coverage contributes to series progress without completing the whole series', () => {
  const watched = { 'tv-8001/e1': {} };
  assert.equal(titleProgress(item, { 'tv-8001/e2': { ranges: [[0, 50]], duration: 100 } }, watched), 15);
  assert.equal(titleProgress(item, {}, watched), 10);
});

test('recommendations count distinct watched media and exclude completed or dropped titles', () => {
  const entry = episode => ({ item, mediaKey: `tv-8001/e${episode}`, coverage: 600, duration: 1200, updated: 1 });
  const saved = { 'tv-8001': { ...item, watchStatus: 'completed' }, 'movie-9': { key: 'movie-9', watchStatus: 'dropped' } };
  const cold = recommendationProfile({ saved, history: [entry(1), entry(1), { ...entry(2), coverage: 25 }] });
  assert.equal(cold.personalized, false);
  const personalized = recommendationProfile({ saved, history: [entry(1), entry(2), entry(3)] });
  assert.equal(personalized.personalized, true);
  assert.deepEqual([...personalized.excluded].sort(), ['movie-9', 'tv-8001']);
});

test('discovery explains recommendations and filters dropped titles', async () => {
  const title = { ...item, id: 8002, key: 'tv-8002' };
  const history = [1, 2, 3].map(episode => ({ item: title, mediaKey: `tv-8002/e${episode}`, coverage: 1000, duration: 1200, updated: episode }));
  const saved = { 'tv-8003': { key: 'tv-8003', id: 8003, type: 'tv', watchStatus: 'dropped' } };
  const tmdb = async path => {
    if (path === '/tv/8002/recommendations') return { results: [{ id: 8003 }, { id: 8004 }] };
    if (path === '/discover/tv') return { results: [{ id: 8004 }, { id: 8005 }] };
    assert.equal(path, '/trending/all/week');
    return { results: [{ id: 8006, media_type: 'movie' }] };
  };
  const cold = await recommendations({ saved, history: history.slice(0, 1) }, tmdb, true);
  assert.equal(cold.personalized, false);
  assert.equal(cold.sections[0].items[0].id, 8006);
  const personalized = await recommendations({ saved, history }, tmdb, true);
  assert.equal(personalized.personalized, true);
  assert.deepEqual(personalized.sections.flatMap(section => section.items.map(entry => entry.id)), [8004, 8005]);
});

test('two manually completed series personalize recommendations without playback history', async () => {
  const another = { ...item, key: 'tv-8101', id: 8101, title: 'Another series' };
  const saved = { [item.key]: { ...item, genreIds: [80], watchStatus: 'completed' }, [another.key]: { ...another, genreIds: [80], watchStatus: 'completed' } };
  assert.equal(recommendationProfile({ saved: { [item.key]: saved[item.key] } }).personalized, false);
  const result = await recommendations({ saved }, async path => ({ results: path.startsWith('/tv/') ? [{ id: item.id }, { id: another.id }, { id: 8102 }] : [] }), true);
  assert.equal(result.personalized, true);
  assert.match(result.sections[0].label, /^Because you completed/);
  assert.deepEqual(result.sections.flatMap(section => section.items.map(entry => entry.id)), [8102]);
});

test('the SQLite migration doubles legacy ratings exactly once', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE accounts (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, salt TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE library (account_id INTEGER NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (account_id, kind, key));
    INSERT INTO accounts VALUES (1, 'legacy-fixture', 'unused', 'unused');`);
  db.prepare("INSERT INTO library VALUES (1, 'ratings', ?, ?)").run(item.key, JSON.stringify({ item, score: 4 }));
  migrateAccounts(db);
  migrateAccounts(db);
  assert.deepEqual(JSON.parse(db.prepare('SELECT value FROM library').get().value), { item, score: 8, scale: 10 });
  db.close();
});

test('playback conflicts, release deduplication and one-time recovery', async () => {
  const oldDatabase = process.env.AFTERFRAME_DB;
  const oldPostgres = process.env.AFTERFRAME_ACCOUNTS_DATABASE_URL;
  process.env.AFTERFRAME_DB = ':memory:';
  if (process.env.AFTERFRAME_TEST_POSTGRES_URL) process.env.AFTERFRAME_ACCOUNTS_DATABASE_URL = process.env.AFTERFRAME_TEST_POSTGRES_URL;
  else delete process.env.AFTERFRAME_ACCOUNTS_DATABASE_URL;
  let accountApi, readLibrary, storeReleaseEvents, releaseEvents;
  try {
    ({ accountApi, readLibrary, storeReleaseEvents } = await import('../accounts/accounts.mjs'));
    ({ releaseEvents } = await import('../catalog/releases.mjs'));
  } finally {
    if (oldDatabase === undefined) delete process.env.AFTERFRAME_DB;
    else process.env.AFTERFRAME_DB = oldDatabase;
    if (oldPostgres === undefined) delete process.env.AFTERFRAME_ACCOUNTS_DATABASE_URL;
    else process.env.AFTERFRAME_ACCOUNTS_DATABASE_URL = oldPostgres;
  }
  let cookie;
  const response = { setHeader: (_, value) => { cookie = value.split(';')[0]; } };
  const call = (action, body, session, method = 'POST') => accountApi({ method, headers: { cookie: session } }, response, `/api/account${action ? `/${action}` : ''}`, body);
  const credentials = { username: 'new-fixture', password: 'test-password-only' };
  const registration = await call('create', credentials);
  assert.equal(registration.code, 201);
  const accountId = registration.body.account.id;
  const firstSession = cookie;
  assert.equal((await call('signin', credentials)).code, 200);
  const secondSession = cookie;
  const write = (kind, key, value, at, session = firstSession) => call('library', { accountId, kind, key, value, at }, session);
  await write('saved', item.key, { ...item, watchStatus: 'watching' });
  await write('ratings', item.key, { item, score: 9, scale: 10 });
  const now = Date.now();
  const position = { time: 45, duration: 100, updated: now, item, ranges: [[1, 45]] };
  const mediaKey = `${item.key}/s1e1`;
  assert.equal((await write('progress', mediaKey, position, now)).code, 200);
  await write('progress', mediaKey, null, now + 10, secondSession);
  assert.equal((await write('progress', mediaKey, position, now, firstSession)).body.stale, true);
  await write('history', '00000000-0000-4000-8000-000000000001', { ...position, started: now - 45000, completed: false, mediaKey, coverage: 44 });
  const library = (await call('', null, secondSession, 'GET')).body.library;
  assert.equal(library.saved[item.key].watchStatus, 'watching');
  assert.equal(library.ratings[item.key].score, 9);
  assert.equal(library.progress[mediaKey], undefined);
  assert.equal(Object.values(library.history)[0].coverage, 44);
  const completion = await call('complete-series', { accountId, item, episodes: ['s1e1', 's1e2'] }, firstSession);
  assert.equal(completion.code, 200);
  const completed = await readLibrary(accountId);
  assert.equal(completed.saved[item.key].watchStatus, 'completed');
  assert.equal(Object.hasOwn(completed.watched, `${item.key}/s1e1`), true);
  assert.equal(Object.hasOwn(completed.watched, `${item.key}/s1e2`), true);
  assert.equal(Object.hasOwn(completed.watched, `${item.key}/s1e3`), false);
  assert.equal((await write('progress', mediaKey, position, now, secondSession)).body.stale, true);

  const date = new Date('2025-11-10T10:00:00Z');
  const old = { season_number: 1, episode_number: 3, air_date: '2025-10-01' };
  const fresh = { season_number: 2, episode_number: 2, air_date: '2025-11-06' };
  const season = [{ ...fresh, episode_number: 1, air_date: '2025-11-04' }, { ...fresh, episode_number: 3, air_date: '2025-12-01' }];
  const followers = [{ accountId, title: item.title }];
  await storeReleaseEvents(item.id, followers, previous => releaseEvents(item.id, old, previous, date));
  await write('preferences', 'notifySeasonStarts', false);
  for (let i = 0; i < 2; i++) await storeReleaseEvents(item.id, followers, previous => releaseEvents(item.id, fresh, previous, date, season));
  assert.deepEqual(Object.keys((await readLibrary(accountId)).notifications), ['tmdb-8001-s2e1', 'tmdb-8001-s2e2']);
  assert.equal(releaseEvents(item.id, { ...fresh, air_date: '2025-12-01' }, null, date).events.length, 0);

  const recovery = await call('recovery-code', {}, firstSession);
  assert.match(recovery.body.code, /^[a-f0-9]{48}$/);
  const reset = { ...credentials, code: recovery.body.code, password: 'updated-test-password' };
  assert.equal((await call('reset', reset)).code, 200);
  assert.equal((await call('', null, secondSession, 'GET')).body.account, null);
  assert.equal((await call('reset', reset)).code, 400);
  assert.equal((await call('signin', { username: credentials.username, password: reset.password })).code, 200);
});
