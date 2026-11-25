import assert from 'node:assert/strict';
import test from 'node:test';
import { activeSkipSegment, bufferedIntervals, completionReached, movieDurationMismatch, samplePlayback, viewingSession } from '@afterframe/shared/playback';
import { playbackLanguage, samePlaybackLanguage } from '@afterframe/shared/subtitles';

test('a large runtime discrepancy is flagged while ordinary release differences remain playable', () => {
  assert.equal(movieDurationMismatch(173, 86 * 60 + 3), true);
  assert.equal(movieDurationMismatch(100, 113 * 60), false);
  assert.equal(movieDurationMismatch(36, 50 * 60), false);
  assert.equal(movieDurationMismatch(undefined, 86 * 60), false);
  assert.equal(movieDurationMismatch(173, Infinity), false);
});

test('credits follow matched segments and preserve gaps between them', () => {
  const first = { kind: 'credits', start: 80, end: 85 };
  const last = { kind: 'credits', start: 95, end: 100 };
  const segments = [first, last];
  const at = (currentTime, duration = 100) => activeSkipSegment(segments, { currentTime, duration });
  assert.equal(at(79.9), undefined);
  assert.equal(at(80), first);
  assert.equal(at(90), undefined);
  assert.equal(at(95), last);
  assert.equal(at(95, 99), undefined);
  assert.equal(at(100), undefined);
});

test('buffered intervals preserve unbuffered gaps and clamp to the media duration', () => {
  const buffered = { length: 2, start: index => [0, 30][index], end: index => [10, 60][index] };
  assert.deepEqual(bufferedIntervals(buffered, 50), [[0, 20], [60, 100]]);
  assert.deepEqual(bufferedIntervals(buffered, NaN), []);
  assert.deepEqual(bufferedIntervals(undefined, 50), []);
});

test('seeking into credits does not establish watching coverage', () => {
  const tracking = viewingSession();
  const credits = [{ kind: 'credits', start: 90, end: 100 }];
  samplePlayback(tracking, { currentTime: 0 }, 0);
  samplePlayback(tracking, { currentTime: 90, seeking: true }, 1000);
  assert.equal(completionReached(tracking.ranges, { currentTime: 90, duration: 100 }, credits), false);
  assert.equal(completionReached([[0, 89]], { currentTime: 90, duration: 100 }, credits), true);
});

test('remembered subtitle language matches provider names and language codes', () => {
  assert.equal(playbackLanguage('en-US'), 'English');
  assert.equal(samePlaybackLanguage('eng', 'English'), true);
  assert.equal(samePlaybackLanguage('ENGLISH', 'en'), true);
  assert.equal(samePlaybackLanguage('Spanish', 'English'), false);
  assert.equal(samePlaybackLanguage('English', ''), false);
});

test('a new signed-in session receives the account’s playback language settings', async () => {
  const oldDatabase = process.env.AFTERFRAME_DB;
  const oldPostgres = process.env.AFTERFRAME_ACCOUNTS_DATABASE_URL;
  process.env.AFTERFRAME_DB = ':memory:';
  delete process.env.AFTERFRAME_ACCOUNTS_DATABASE_URL;
  let accountApi;
  try {
    ({ accountApi } = await import('../accounts/accounts.mjs'));
  } finally {
    if (oldDatabase === undefined) delete process.env.AFTERFRAME_DB;
    else process.env.AFTERFRAME_DB = oldDatabase;
    if (oldPostgres === undefined) delete process.env.AFTERFRAME_ACCOUNTS_DATABASE_URL;
    else process.env.AFTERFRAME_ACCOUNTS_DATABASE_URL = oldPostgres;
  }
  let session;
  const response = { setHeader: (_, value) => { session = value.split(';')[0]; } };
  const post = (action, body, cookie) => accountApi({ method: 'POST', headers: { cookie } }, response, `/api/account/${action}`, body);
  const credentials = { username: 'language-test', password: 'fixture-only-password' };
  const registration = await post('create', credentials);
  assert.equal(registration.code, 201);
  const entry = { accountId: registration.body.account.id, kind: 'preferences' };
  for (const [key, value] of [['subtitleLanguage', 'English'], ['audioLanguage', 'Japanese']]) {
    assert.equal((await post('library', { ...entry, key, value }, session)).code, 200);
  }
  assert.equal((await post('library', { ...entry, key: 'subtitleLanguage', value: 'a'.repeat(61) }, session)).code, 400);
  const otherDevice = await post('signin', credentials);
  assert.equal(otherDevice.code, 200);
  assert.deepEqual({ ...otherDevice.body.library.preferences }, { subtitleLanguage: 'English', audioLanguage: 'Japanese' });
});
