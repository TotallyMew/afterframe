import assert from 'node:assert/strict';
import test from 'node:test';
import { activeSkipSegment, bufferedIntervals, completionReached, movieDurationMismatch, samplePlayback, viewingSession } from '@afterframe/shared/playback';
import { playbackLanguage, samePlaybackLanguage } from '@afterframe/shared/subtitles';
import {
  isReasonableSegment,
  mergeSkipCandidates,
  parseAniSkipPayload,
  parseIntroDbPayload,
  parseSkipDbPayload,
  parseTheIntroDbPayload,
} from '../catalog/segments.mjs';
import { stripAnimeSeasonTitle } from '../catalog/discovery.mjs';

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

test('skip segment sanity guards reject oversized or misplaced intros and credits', () => {
  const episodeSec = 57 * 60 + 48; // 3468s (e.g. Black Bird S1E1)
  assert.equal(isReasonableSegment('intro', 120, 210, episodeSec), true);
  assert.equal(isReasonableSegment('intro', 120, 500, episodeSec), false); // > 180s
  assert.equal(isReasonableSegment('intro', 2000, 2060, episodeSec), false); // starts past 35%
  assert.equal(isReasonableSegment('credits', 3300, 3468, episodeSec), true);
  assert.equal(isReasonableSegment('credits', 1000, 1100, episodeSec), false); // starts before 65%
});

test('anime season suffix stripping extracts parent series title and season number', () => {
  assert.deepEqual(stripAnimeSeasonTitle('Blue Box Season 2'), { baseTitle: 'Blue Box', season: 2 });
  assert.deepEqual(stripAnimeSeasonTitle('Frieren: 2nd Season'), { baseTitle: 'Frieren', season: 2 });
  assert.deepEqual(stripAnimeSeasonTitle('Firefly Wedding'), { baseTitle: 'Firefly Wedding', season: null });
});

test('multi-source skip parser & merger combines SkipDB, IntroDB, TheIntroDB, and AniSkip with consensus promotion', () => {
  const durationSec = 3180; // Dexter S1E1 (53:00)
  const durationMs = durationSec * 1000;

  const theIntroDb = parseTheIntroDbPayload({
    type: 'tv',
    group_duration_ms: 3183180, // 3.18s delta -> valid manual intro
    intro: [{ start_ms: null, end_ms: 21586, confidence: 0.8245, submission_count: 2 }],
    recap: [{ start_ms: 114000, end_ms: 284000, confidence: 0.6, submission_count: 1 }],
  }, 'tv', durationMs);
  assert.equal(theIntroDb.length, 1);
  assert.equal(theIntroDb[0].kind, 'intro');
  assert.equal(theIntroDb[0].autoSkip, false);

  const skipDb = parseSkipDbPayload({
    segments: {
      intro: null,
      recap: null,
      outro: { start_ms: 3085100, end_ms: 3180000, adjusted: true, offset_ms: -3200, match: 'shifted', confidence: 0.82 },
    },
  }, durationSec);
  assert.equal(skipDb.length, 1);
  assert.equal(skipDb[0].kind, 'credits');
  assert.equal(skipDb[0].source, 'skipdb');
  assert.equal(skipDb[0].autoSkip, true);

  const introDb = parseIntroDbPayload({
    intro: { start_ms: 1000, end_ms: 28000, confidence: 1, submission_count: 1 },
    recap: null,
    outro: { start_ms: 3088000, end_ms: 3190000, confidence: 1, submission_count: 1 },
  }, durationSec);
  assert.equal(introDb.length, 2);
  assert.equal(introDb[1].end, 3180); // Clamped to durationSec

  // Merging picks TheIntroDB intro (higher multi-vote score) AND SkipDB outro (corroborated by IntroDB within 3s)
  const merged = mergeSkipCandidates([...theIntroDb, ...skipDb, ...introDb], durationSec);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].kind, 'intro');
  assert.equal(merged[0].source, 'theintrodb');
  assert.equal(merged[1].kind, 'credits');
  assert.equal(merged[1].source, 'skipdb');
  assert.equal(merged[1].autoSkip, true);

  // Two manual-only sources agreeing within ±4s promote autoSkip to true
  const consensus = mergeSkipCandidates([
    { kind: 'intro', start: 229, end: 246.5, autoSkip: false, source: 'skipdb', score: 60 },
    { kind: 'intro', start: 228.6, end: 246.5, autoSkip: false, source: 'introdb', score: 64 },
  ], 3500);
  assert.equal(consensus[0].autoSkip, true);

  // AniSkip accepts op/ed and mixed-op/mixed-ed, preferring exact episodeLength and downgrading minor drift to manual
  const aniSkip = parseAniSkipPayload({
    found: true,
    results: [
      { skipType: 'op', interval: { startTime: 54.7, endTime: 145.1 }, episodeLength: 1435.1 },
      { skipType: 'mixed-ed', interval: { startTime: 1338.2, endTime: 1428.2 }, episodeLength: 1441.0 },
    ],
  }, 1435);
  assert.equal(aniSkip.length, 2);
  assert.equal(aniSkip[0].autoSkip, true);
  assert.equal(aniSkip[1].kind, 'credits');
  assert.equal(aniSkip[1].autoSkip, false); // 6s drift -> manual skip only

  // Exact-length AniSkip ED outranks a shorter SkipDB exact outro on anime
  const animeMerged = mergeSkipCandidates([
    ...parseAniSkipPayload({
      found: true,
      results: [{ skipType: 'ed', interval: { startTime: 1338.255, endTime: 1428.255 }, episodeLength: 1435.028 }],
    }, 1435),
    ...parseSkipDbPayload({
      segments: { outro: { start_ms: 1424700, end_ms: 1435000, match: 'exact', confidence: 0.9 } },
    }, 1435),
  ], 1435);
  assert.equal(animeMerged[0].source, 'aniskip');
  assert.equal(animeMerged[0].start, 1338.255);
});
