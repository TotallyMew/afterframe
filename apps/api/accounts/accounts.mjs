import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { comicChapterIdPattern, comicIdPattern } from '@afterframe/shared/comic-ids';
import { preferenceDefaults } from '@afterframe/shared/playback';
import { ratingOnTen, watchStatuses, watchStatus } from '@afterframe/shared/library';
import { isPrivateIp } from '../http-settings.mjs';
import { openAccountStorage } from './account-storage.mjs';

const db = await openAccountStorage();
export const accountStorageHealth = db.health;
export const closeAccountStorage = () => db.close();

/** @type {(password: string, salt: string, keylen: number, options: import('node:crypto').ScryptOptions) => Promise<Buffer>} */
const hashPassword = /** @type {any} */ (promisify(scrypt));
const work = { N: 2 ** 17, r: 8, p: 1, maxmem: 160 * 1024 ** 2 };
const guestSalt = randomBytes(24).toString('hex');
const legacyCookie = 'afterframe_session';
const cookie = process.env.AFTERFRAME_ORIGIN ? '__Host-afterframe_session' : legacyCookie;
const maxAge = 30 * 24 * 60 * 60;
const cookieFlags = `Path=/; HttpOnly; SameSite=Strict${process.env.AFTERFRAME_ORIGIN ? '; Secure' : ''}`;
const maxConcurrentHashes = 2;
const maxQueuedHashes = 16;
const maxSessionsPerAccount = 20;
const maxLibraryRowsPerAccount = 25_000;
const maxFollowedSeriesPerAccount = 150;
let activeHashes = 0;
const hashQueue = [];
const attempts = new Map();
const MAX_ATTEMPT_KEYS = 10_000;

function safeTimestamp(value, fallback, ceiling) {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(Math.max(0, numeric), ceiling);
}

export function clientAddress(request) {
  const remote = request.socket?.remoteAddress || 'local';
  const trustProxy = Boolean(process.env.AFTERFRAME_ORIGIN || process.env.AFTERFRAME_TRUST_PROXY || process.env.AFTERFRAME_WEB_PORT);
  if (trustProxy && (remote === 'local' || isPrivateIp(remote))) {
    const forwarded = request.headers?.['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      const parts = forwarded.split(',').map(part => part.trim()).filter(Boolean);
      const hops = Math.max(1, Number(process.env.AFTERFRAME_TRUST_PROXY_HOPS) || 1);
      if (parts.length) return parts[Math.max(0, parts.length - hops)];
    }
  }
  return remote;
}

async function derivePasswordHash(password, salt) {
  if (activeHashes >= maxConcurrentHashes) {
    if (hashQueue.length >= maxQueuedHashes) return null;
    await new Promise(resolve => hashQueue.push(resolve));
  }
  activeHashes++;
  try {
    return await hashPassword(password, salt, 64, work);
  } finally {
    activeHashes--;
    hashQueue.shift()?.();
  }
}

const accountByName = db.prepare('SELECT * FROM accounts WHERE username = ?', 'SELECT * FROM accounts WHERE lower(username) = lower(?)');
const accountById = db.prepare('SELECT * FROM accounts WHERE id = ?');
const addAccount = db.prepare('INSERT INTO accounts (username, salt, password_hash) VALUES (?, ?, ?) ON CONFLICT DO NOTHING RETURNING id');
const addSession = db.prepare('INSERT INTO sessions (token_hash, account_id, expires) VALUES (?, ?, ?)');
const pruneSessions = db.prepare(
  `DELETE FROM sessions WHERE account_id = ? AND token_hash NOT IN (
    SELECT token_hash FROM sessions WHERE account_id = ? ORDER BY expires DESC LIMIT ?
  )`);
const removeSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
const removeAccountSessions = db.prepare('DELETE FROM sessions WHERE account_id = ?');
const removeOtherSessions = db.prepare('DELETE FROM sessions WHERE account_id = ? AND token_hash <> ?');
const updatePassword = db.prepare('UPDATE accounts SET salt = ?, password_hash = ? WHERE id = ?');
const createRecovery = db.prepare('INSERT INTO recovery_codes VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET code_hash = excluded.code_hash');
const consumeRecovery = db.prepare('DELETE FROM recovery_codes WHERE account_id = ? AND code_hash = ?');
const expireSessions = db.prepare('DELETE FROM sessions WHERE expires <= ?');
const sessionAccount = db.prepare('SELECT accounts.id, accounts.username FROM sessions JOIN accounts ON accounts.id = sessions.account_id WHERE token_hash = ? AND expires > ?');
const listLibrary = db.prepare('SELECT kind, key, value FROM library WHERE account_id = ? ORDER BY rowid',
  'SELECT kind, key, value FROM library WHERE account_id = ? ORDER BY sequence');
const listVersions = db.prepare('SELECT kind, key, updated FROM playback_versions WHERE account_id = ?');
const countLibraryRows = db.prepare('SELECT COUNT(*) AS total FROM library WHERE account_id = ?');
const setEntry = db.prepare('INSERT INTO library (account_id, kind, key, value) VALUES (?, ?, ?, ?) ON CONFLICT (account_id, kind, key) DO UPDATE SET value = excluded.value');
const removeEntry = db.prepare('DELETE FROM library WHERE account_id = ? AND kind = ? AND key = ?');
const getEntry = db.prepare('SELECT value FROM library WHERE account_id = ? AND kind = ? AND key = ?');
const clearKindEntries = db.prepare('DELETE FROM library WHERE account_id = ? AND kind = ?');
const clearKindVersions = db.prepare('DELETE FROM playback_versions WHERE account_id = ? AND kind = ?');
const markAllNotificationsRead = db.prepare(
  `UPDATE library SET value = json_set(value, '$.read', json('true'))
   WHERE account_id = ? AND kind = 'notifications' AND json_extract(value, '$.read') IS NOT 1`,
  `UPDATE library SET value = (value::jsonb || '{"read":true}'::jsonb)::text
   WHERE account_id = ? AND kind = 'notifications' AND COALESCE((value::jsonb->>'read')::boolean, false) = false`);
const getVersion = db.prepare('SELECT updated FROM playback_versions WHERE account_id = ? AND kind = ? AND key = ?');
const versionSql = 'INSERT INTO playback_versions VALUES (?, ?, ?, ?) ON CONFLICT(account_id,kind,key) DO UPDATE SET updated = ';
const setVersion = db.prepare(versionSql + 'max(playback_versions.updated, excluded.updated)',
  versionSql + 'greatest(playback_versions.updated, excluded.updated)');
const setWatchedEpisodes = db.prepare(
  `INSERT INTO library (account_id, kind, key, value)
   SELECT ?, 'watched', value, ? FROM json_each(?) WHERE true ON CONFLICT DO NOTHING`,
  `INSERT INTO library (account_id, kind, key, value)
   SELECT ?, 'watched', key, ? FROM jsonb_array_elements_text(?::jsonb) AS episodes(key) ON CONFLICT DO NOTHING`);
const clearEpisodeProgress = db.prepare(
  `DELETE FROM library WHERE account_id = ? AND kind = 'progress' AND key IN (SELECT value FROM json_each(?))`,
  `DELETE FROM library WHERE account_id = ? AND kind = 'progress' AND key IN (SELECT jsonb_array_elements_text(?::jsonb))`);
const setEpisodeVersions = db.prepare(
  `INSERT INTO playback_versions (account_id, kind, key, updated)
   SELECT ?, kinds.column1, episodes.value, ? FROM json_each(?) AS episodes CROSS JOIN (VALUES ('watched'), ('progress')) AS kinds
   WHERE true ON CONFLICT (account_id, kind, key) DO UPDATE SET updated = max(playback_versions.updated, excluded.updated)`,
  `INSERT INTO playback_versions (account_id, kind, key, updated)
   SELECT ?, kinds.kind, episodes.key, ? FROM jsonb_array_elements_text(?::jsonb) AS episodes(key)
   CROSS JOIN (VALUES ('watched'), ('progress')) AS kinds(kind)
   ON CONFLICT (account_id, kind, key) DO UPDATE SET updated = greatest(playback_versions.updated, excluded.updated)`);
const followedSeries = db.prepare(`SELECT account_id, value FROM library WHERE kind = 'saved' AND json_extract(value, '$.type') = 'tv'`,
  `SELECT account_id, value FROM library WHERE kind = 'saved' AND value::jsonb->>'type' = 'tv'`);
const getReleaseSnapshot = db.prepare('SELECT value FROM release_snapshots WHERE series_id = ?');
const setReleaseSnapshot = db.prepare('INSERT INTO release_snapshots VALUES (?, ?) ON CONFLICT(series_id) DO UPDATE SET value = excluded.value');
const addNotification = db.prepare(`INSERT INTO library (account_id, kind, key, value)
  VALUES (?, 'notifications', ?, ?) ON CONFLICT DO NOTHING`);
const readProviderCredential = db.prepare('SELECT credential FROM provider_credentials WHERE provider = ?');
const writeProviderCredential = db.prepare(`INSERT INTO provider_credentials (provider, credential) VALUES (?, ?)
  ON CONFLICT (provider) DO UPDATE SET credential = excluded.credential`);

export async function providerCredential(provider) {
  return (await readProviderCredential.get(provider))?.credential;
}

export function saveProviderCredential(provider, credential) {
  return writeProviderCredential.run(provider, credential);
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function sessionToken(request) {
  const header = request.headers.cookie;
  if (typeof header !== 'string' || !header) return undefined;
  return /(?:^|;\s*)__Host-afterframe_session=([a-f0-9]{64})(?:;|$)/.exec(header)?.[1]
    ?? /(?:^|;\s*)afterframe_session=([a-f0-9]{64})(?:;|$)/.exec(header)?.[1];
}

export async function currentAccount(request) {
  const token = sessionToken(request);
  return token ? (await sessionAccount.get(hashToken(token), Date.now())) ?? null : null;
}

export async function readLibrary(id) {
  const result = Object.fromEntries(['saved', 'progress', 'reading', 'ratings', 'skips', 'watched', 'preferences', 'history', 'notifications', 'folders'].map(kind => [kind, Object.create(null)]));
  for (const row of await listLibrary.all(id)) {
    if (Object.hasOwn(result, row.kind)) result[row.kind][row.key] = JSON.parse(row.value);
  }
  return result;
}

export async function releaseTargets() {
  const targets = new Map();
  const perAccount = new Map();
  for (const row of await followedSeries.all()) {
    const count = perAccount.get(row.account_id) || 0;
    if (count >= maxFollowedSeriesPerAccount) continue;
    const item = JSON.parse(row.value);
    if (!Number.isSafeInteger(item.id) || item.id <= 0 || watchStatus(item) === 'dropped') continue;
    perAccount.set(row.account_id, count + 1);
    if (!targets.has(item.id)) targets.set(item.id, []);
    targets.get(item.id).push({ accountId: row.account_id, title: item.title, watchKey: item.key });
  }
  return targets;
}

async function storeAccountReleaseEvents(seriesId, follower, events, index = 0) {
  if (index >= events.length) return;
  const { key, message, preference, source } = events[index];
  const pref = await getEntry.get(follower.accountId, 'preferences', preference);
  if (pref?.value !== 'false') {
    const payload = JSON.stringify({
      seriesId, title: follower.title, message, source, created: Date.now(), read: false,
    });
    await addNotification.run(follower.accountId, key, payload);
  }
  return storeAccountReleaseEvents(seriesId, follower, events, index + 1);
}

async function notifyFollowersSequentially(seriesId, sortedFollowers, events, index = 0) {
  if (index >= sortedFollowers.length) return;
  const follower = sortedFollowers[index];
  await db.lockAccount(follower.accountId);
  const followed = await getEntry.get(follower.accountId, 'saved', follower.watchKey ?? `tv-${seriesId}`);
  if (followed && watchStatus(JSON.parse(followed.value)) !== 'dropped') {
    await storeAccountReleaseEvents(seriesId, follower, events);
  }
  return notifyFollowersSequentially(seriesId, sortedFollowers, events, index + 1);
}

export function storeReleaseEvents(seriesId, followers, makeEvents) {
  return db.transaction(async () => {
    await db.lockRelease(seriesId);
    const previous = await releaseSnapshot(seriesId);
    const { snapshot, events } = makeEvents(previous);
    if (events.length) {
      const sortedFollowers = [...followers];
      sortedFollowers.sort((a, b) => a.accountId - b.accountId);
      await notifyFollowersSequentially(seriesId, sortedFollowers, events);
    }
    if (snapshot) await setReleaseSnapshot.run(seriesId, JSON.stringify(snapshot));
  });
}

export async function releaseSnapshot(seriesId) {
  return JSON.parse((await getReleaseSnapshot.get(seriesId))?.value ?? 'null');
}

function status(code, error) {
  return { code, body: { error } };
}

function cleanText(value, maxLen) {
  return typeof value === 'string' ? value.slice(0, maxLen) : undefined;
}

function sanitizeEpisodePos(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const season = Number(raw.season);
  const number = Number(raw.number);
  if (!Number.isInteger(season) || season < 0 || season > 9999 || !Number.isInteger(number) || number < 1 || number > 9999) return undefined;
  const title = cleanText(raw.title, 200);
  return { season, number, ...(title ? { title } : {}) };
}

const COMIC_STRING_FIELDS = [
  ['id', 100], ['format', 32], ['status', 32], ['lastChapter', 32],
  ['chapterCount', 32], ['latestChapter', 32], ['latestAt', 40], ['synopsis', 2000],
];

const VIDEO_STRING_FIELDS = [
  ['year', 16], ['date', 32], ['description', 2000], ['backdrop', 300],
  ['genre', 80], ['originalLanguage', 16], ['archiveId', 120], ['imdb', 24],
];

function assignBoundedStrings(target, source, specs) {
  for (const [field, maxLen] of specs) {
    if (typeof source[field] === 'string') target[field] = source[field].slice(0, maxLen);
  }
}

function sanitizeStringArray(value, maxItems, maxLen) {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, maxItems).filter(entry => typeof entry === 'string').map(entry => entry.slice(0, maxLen));
}

function sanitizeComicGenres(rawGenres) {
  if (!Array.isArray(rawGenres)) return undefined;
  return rawGenres.slice(0, 20)
    .filter(g => g && typeof g.id === 'string' && typeof g.name === 'string')
    .map(g => ({ id: g.id.slice(0, 64), name: g.name.slice(0, 64) }));
}

function sanitizeComicFields(raw, out) {
  assignBoundedStrings(out, raw, COMIC_STRING_FIELDS);
  if (Number.isSafeInteger(raw.year)) out.year = raw.year;
  if (Number.isFinite(raw.updated)) out.updated = raw.updated;
  if (raw.malId === null || Number.isSafeInteger(raw.malId)) out.malId = raw.malId;
  if (typeof raw.longStrip === 'boolean') out.longStrip = raw.longStrip;
  const genres = sanitizeComicGenres(raw.genres);
  if (genres) out.genres = genres;
  const languages = sanitizeStringArray(raw.languages, 30, 12);
  if (languages) out.languages = languages;
  const author = sanitizeStringArray(raw.author, 20, 120);
  if (author) out.author = author;
}

function sanitizeItemRating(rating) {
  if (!rating || typeof rating !== 'object' || !Number.isFinite(rating.score)) return undefined;
  return {
    score: rating.score,
    ...(Number.isFinite(rating.votes) ? { votes: rating.votes } : {}),
  };
}

function sanitizeVideoFields(raw, out) {
  assignBoundedStrings(out, raw, VIDEO_STRING_FIELDS);
  if (Number.isSafeInteger(raw.id)) out.id = raw.id;
  if (Array.isArray(raw.genreIds)) {
    out.genreIds = raw.genreIds.slice(0, 20).filter(id => Number.isSafeInteger(id) && id > 0);
  }
  if (Number.isFinite(raw.duration) && raw.duration >= 0) out.duration = raw.duration;
  const rating = sanitizeItemRating(raw.rating);
  if (rating) out.rating = rating;
  if (Number.isSafeInteger(raw.totalEpisodes) && raw.totalEpisodes >= 0 && raw.totalEpisodes <= 100_000) {
    out.totalEpisodes = raw.totalEpisodes;
  }
}

function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.key !== 'string' || typeof raw.title !== 'string' || !['movie', 'tv', 'comic'].includes(raw.type)) return null;
  const out = {
    key: raw.key.slice(0, 120),
    type: raw.type,
    title: raw.title.slice(0, 300),
  };
  if (raw.type === 'comic') sanitizeComicFields(raw, out);
  else sanitizeVideoFields(raw, out);
  if (typeof raw.poster === 'string') out.poster = raw.poster.slice(0, 300);
  if (Number.isFinite(raw.mal) && raw.mal > 0 && raw.mal <= 10) out.mal = raw.mal;
  return out;
}

function sanitizePreferenceValue(value, key) {
  if (Object.hasOwn(preferenceDefaults, key) && typeof value === 'boolean') return value;
  if (key === 'level' && Number.isFinite(value) && value >= 0 && value <= 1) return value;
  if (['muted', 'captions'].includes(key) && typeof value === 'boolean') return value;
  if (key === 'quality' && ['', '1080', '720', '480'].includes(value)) return value;
  if (['subtitleLanguage', 'audioLanguage'].includes(key) && typeof value === 'string' && value.length <= 60 && !/[\x00-\x1f\x7f]/.test(value)) return value;
  return undefined;
}

function sanitizeSavedValue(value, key) {
  if (value?.key !== key || typeof value.title !== 'string' || !['movie', 'tv', 'comic'].includes(value.type)) return undefined;
  if (value.watchStatus !== undefined && (typeof value.watchStatus !== 'string' || !Object.hasOwn(watchStatuses, value.watchStatus))) return undefined;
  const item = sanitizeItem(value);
  if (!item) return undefined;
  return {
    ...item,
    ...(Number.isFinite(value.added) ? { added: value.added } : {}),
    ...(value.watchStatus ? { watchStatus: value.watchStatus } : {}),
    ...(Number.isFinite(value.completedAt) ? { completedAt: value.completedAt } : {}),
  };
}

function isValidReadingPayload(value, key) {
  const item = value?.item;
  if (item?.type !== 'comic' || item.key !== key || key !== `comic-${item.id}` || !comicIdPattern.test(item.id)) return false;
  if (typeof item.title !== 'string' || typeof value.chapter !== 'string' || !comicChapterIdPattern.test(value.chapter) || typeof value.label !== 'string') return false;
  if (!/^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(value.language)) return false;
  if (value.source !== undefined && value.source !== 'afterframe') return false;
  return Number.isInteger(value.page) && value.page >= 1 && value.page <= 10_000
    && Number.isInteger(value.listPage) && value.listPage >= 1 && value.listPage <= 200
    && Number.isFinite(value.updated);
}

function sanitizeReadingValue(value, key) {
  if (!isValidReadingPayload(value, key)) return undefined;
  const cleanItem = sanitizeItem(value.item);
  if (!cleanItem) return undefined;
  return {
    item: cleanItem,
    chapter: value.chapter,
    label: value.label.slice(0, 120),
    page: value.page,
    language: value.language,
    listPage: value.listPage,
    updated: value.updated,
    ...(value.source ? { source: value.source } : {}),
  };
}

function sanitizeRatingValue(value, key) {
  const maxScore = value?.scale === 10 ? 10 : 5;
  if (!Number.isInteger(value?.score) || value.score < 1 || value.score > maxScore) return undefined;
  if (value.item?.key !== key || typeof value.item.title !== 'string' || !['movie', 'tv', 'comic'].includes(value.item.type)) return undefined;
  const cleanItem = sanitizeItem(value.item);
  if (!cleanItem) return undefined;
  return ratingOnTen({
    item: cleanItem,
    score: value.score,
    ...(value.scale === 10 ? { scale: 10 } : {}),
    ...(Number.isFinite(value.updated) ? { updated: value.updated } : {}),
  });
}

function isValidHistoryPayload(value, key) {
  if (!/^[a-f0-9-]{36}$/.test(key) || typeof value?.item?.key !== 'string' || typeof value.item.title !== 'string' || !['movie', 'tv'].includes(value.item.type)) return false;
  if (typeof value.mediaKey !== 'string' || (value.mediaKey !== value.item.key && !value.mediaKey.startsWith(`${value.item.key}/`))) return false;
  if (!Number.isFinite(value.duration) || value.duration <= 0 || value.duration > 86400) return false;
  if (!Number.isFinite(value.time) || value.time < 0 || value.time > value.duration) return false;
  if (!Number.isFinite(value.coverage) || value.coverage < 0 || value.coverage > value.duration || typeof value.completed !== 'boolean') return false;
  return Number.isSafeInteger(value.started) && value.started > 0
    && Number.isSafeInteger(value.updated) && value.started <= value.updated && value.updated <= Date.now() + 60000;
}

function sanitizeHistoryValue(value, key) {
  if (!isValidHistoryPayload(value, key)) return undefined;
  const cleanItem = sanitizeItem(value.item);
  if (!cleanItem) return undefined;
  const episode = sanitizeEpisodePos(value.episode);
  return {
    item: cleanItem,
    ...(episode ? { episode } : {}),
    mediaKey: value.mediaKey.slice(0, 145),
    started: value.started,
    updated: value.updated,
    duration: value.duration,
    time: value.time,
    coverage: value.coverage,
    completed: value.completed,
  };
}

function sanitizeWatchedValue(value, key) {
  const item = value?.item;
  if (!Number.isFinite(value?.updated) || typeof item?.key !== 'string' || typeof item.title !== 'string') return undefined;
  if (!['movie', 'tv'].includes(item.type) || (item.key !== key && !key.startsWith(`${item.key}/`))) return undefined;
  const cleanItem = sanitizeItem(item);
  if (!cleanItem) return undefined;
  return { item: cleanItem, updated: value.updated };
}

function isValidTimeRange(range) {
  return Array.isArray(range) && range.length === 2
    && Number.isFinite(range[0]) && Number.isFinite(range[1])
    && range[0] >= 0 && range[1] > range[0] && range[1] <= 86400;
}

function isValidTimeRanges(ranges) {
  return ranges === undefined || (Array.isArray(ranges) && ranges.length <= 100 && ranges.every(isValidTimeRange));
}

function sanitizeProgressValue(value) {
  if (!Number.isFinite(value?.time) || value.time < 0 || !Number.isFinite(value.duration) || value.duration <= value.time || value.duration > 86400) return undefined;
  if (!Number.isFinite(value.updated) || !isValidTimeRanges(value.ranges) || !isValidTimeRanges(value.skipped)) return undefined;
  const cleanItem = value.item ? sanitizeItem(value.item) : undefined;
  const episode = sanitizeEpisodePos(value.episode);
  const provider = cleanText(value.provider, 48);
  return {
    ...(cleanItem ? { item: cleanItem } : {}),
    ...(episode ? { episode } : {}),
    time: value.time,
    duration: value.duration,
    updated: value.updated,
    ...(Array.isArray(value.ranges) ? { ranges: value.ranges.map(([a, b]) => [a, b]) } : {}),
    ...(Array.isArray(value.skipped) ? { skipped: value.skipped.map(([a, b]) => [a, b]) } : {}),
    ...(provider ? { provider } : {}),
  };
}

const ALLOWED_FOLDER_COLORS = new Set(['ember', 'gold', 'sage', 'steel', 'slate']);

function sanitizeFolderItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length > 500) return null;
  const seen = new Set();
  const items = [];
  for (const itemKey of rawItems) {
    if (typeof itemKey !== 'string' || !/^[a-z0-9][\w.-]{0,120}$/i.test(itemKey)) return null;
    if (!seen.has(itemKey)) { seen.add(itemKey); items.push(itemKey); }
  }
  return items;
}

function sanitizeFolderValue(value, key) {
  const name = typeof value?.name === 'string' ? value.name.trim() : '';
  const color = value?.color === undefined ? 'ember' : value.color;
  if (value?.id !== key || !name || name.length > 50 || /[\x00-\x1f\x7f]/.test(name)) return undefined;
  if (!ALLOWED_FOLDER_COLORS.has(color) || !Number.isFinite(value?.created) || !Number.isFinite(value?.updated)) return undefined;
  const items = sanitizeFolderItems(value.items);
  if (!items) return undefined;
  return { id: key, name, color, items, created: value.created, updated: value.updated };
}

function isValidSkipSegment(segment, seenKinds) {
  return ['intro', 'recap', 'credits'].includes(segment?.kind) && !seenKinds.has(segment.kind)
    && Number.isFinite(segment.start) && Number.isFinite(segment.end)
    && segment.start >= 0 && segment.end > segment.start && segment.end <= 86400;
}

function sanitizeSkipValue(value) {
  if (!Array.isArray(value) || value.length > 3) return undefined;
  const kinds = new Set();
  const clean = [];
  for (const segment of value) {
    if (!isValidSkipSegment(segment, kinds)) return undefined;
    kinds.add(segment.kind);
    clean.push({ kind: segment.kind, start: segment.start, end: segment.end });
  }
  return clean;
}

const LIBRARY_VALUE_SANITIZERS = {
  preferences: sanitizePreferenceValue,
  saved: sanitizeSavedValue,
  reading: sanitizeReadingValue,
  ratings: sanitizeRatingValue,
  history: sanitizeHistoryValue,
  watched: sanitizeWatchedValue,
  progress: sanitizeProgressValue,
  folders: sanitizeFolderValue,
  skips: sanitizeSkipValue,
};

function libraryValue(kind, value, key) {
  if (value === null) return null;
  return Object.hasOwn(LIBRARY_VALUE_SANITIZERS, kind)
    ? LIBRARY_VALUE_SANITIZERS[kind](value, key)
    : undefined;
}

function pruneExpiredAttempts(now) {
  for (const [key, entry] of attempts) {
    if (now >= entry.expires) attempts.delete(key);
  }
}

function recordAttemptKey(key, now) {
  if (!attempts.has(key) && attempts.size >= MAX_ATTEMPT_KEYS) {
    const oldest = attempts.keys().next().value;
    if (oldest) attempts.delete(oldest);
  }
  const entry = attempts.get(key) || { count: 0, expires: now + 15 * 60000 };
  entry.count++;
  attempts.set(key, entry);
}

async function handleGetAccount(request, account) {
  const payload = { account, library: account ? await readLibrary(account.id) : null };
  if (!account) return { code: 200, body: payload };
  const etag = `W/"${createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16)}"`;
  const validators = request.headers?.['if-none-match']?.split(',').map(v => v.trim().replace(/^W\//, ''));
  const headers = { etag, 'cache-control': 'private, no-cache' };
  if (validators?.includes('*') || validators?.includes(etag.slice(2))) {
    return { code: 304, body: null, headers };
  }
  return { code: 200, body: payload, headers };
}

async function handleSignOut(request, response) {
  const token = sessionToken(request);
  if (token) await removeSession.run(hashToken(token));
  const cleared = cookie === legacyCookie
    ? `${cookie}=; ${cookieFlags}; Max-Age=0`
    : [`${cookie}=; ${cookieFlags}; Max-Age=0`, `${legacyCookie}=; ${cookieFlags}; Max-Age=0`];
  response.setHeader('Set-Cookie', cleared);
  return { code: 200, body: { account: null } };
}

async function handleRecoveryCode(request, account, body) {
  if (!account) return status(401, 'Sign in first.');
  const currentPassword = body?.password;
  if (typeof currentPassword !== 'string' || currentPassword.length < 8 || currentPassword.length > 128) {
    return status(400, 'Enter your current password to generate a recovery code.');
  }
  const now = Date.now();
  pruneExpiredAttempts(now);
  const limitKey = `recovery-code:${clientAddress(request)}:${account.id}`;
  if ((attempts.get(limitKey)?.count || 0) >= 8) {
    return status(429, 'Too many attempts. Try again in 15 minutes.');
  }
  const attemptEntry = attempts.get(limitKey) || { count: 0, expires: now + 15 * 60000 };
  attemptEntry.count++;
  attempts.set(limitKey, attemptEntry);
  const record = await accountById.get(account.id);
  if (!record) return status(401, 'Sign in first.');
  const derived = await derivePasswordHash(currentPassword, record.salt);
  if (!derived) return status(429, 'Too many account requests are in progress. Try again in a moment.');
  if (!timingSafeEqual(derived, Buffer.from(record.password_hash, 'hex'))) {
    return status(401, 'Current password is incorrect.');
  }
  attempts.delete(limitKey);
  const code = randomBytes(24).toString('hex');
  await createRecovery.run(account.id, hashToken(code));
  return { code: 200, body: { code } };
}

async function handleRevokeOther(request, account) {
  if (!account) return status(401, 'Sign in first.');
  await removeOtherSessions.run(account.id, hashToken(sessionToken(request)));
  return { code: 200, body: { ok: true } };
}

async function handleNotificationsReadAll(account, body) {
  if (!account) return status(401, 'Sign in first.');
  if (body?.accountId != null && account.id !== body.accountId) return status(409, 'The signed-in account changed.');
  await db.transaction(async () => {
    await db.lockAccount(account.id);
    await markAllNotificationsRead.run(account.id);
  });
  return { code: 200, body: { ok: true } };
}

async function handleClearHistory(account, body) {
  if (!account) return status(401, 'Sign in first.');
  if (body?.accountId != null && account.id !== body.accountId) return status(409, 'The signed-in account changed.');
  await db.transaction(async () => {
    await db.lockAccount(account.id);
    await clearKindEntries.run(account.id, 'history');
    await clearKindVersions.run(account.id, 'history');
  });
  return { code: 200, body: { ok: true } };
}

async function handleNotificationRead(account, body) {
  if (!account) return status(401, 'Sign in first.');
  if (body?.accountId != null && account.id !== body.accountId) return status(409, 'The signed-in account changed.');
  if (typeof body?.key !== 'string' || !/^[\w-]{1,100}$/.test(body.key)) return status(400, 'Invalid notification.');
  const entry = await getEntry.get(account.id, 'notifications', body.key);
  if (entry) await setEntry.run(account.id, 'notifications', body.key, JSON.stringify({ ...JSON.parse(entry.value), read: true }));
  return { code: 200, body: { ok: true } };
}

function resolvePreviousRevision(version, prior) {
  const rawPrevious = version ? Number(version.updated) : Number(prior?.updated ?? prior?.added ?? 0);
  return Number.isFinite(rawPrevious) ? Math.trunc(rawPrevious) : 0;
}

function applyLibraryEntryChange({ accountId, kind, key, entry, timestamp, expectedAt }) {
  return db.transaction(async () => {
    await db.lockAccount(accountId);
    const entryBefore = await getEntry.get(accountId, kind, key);
    if (!entryBefore && entry !== null) {
      const count = Number((await countLibraryRows.get(accountId))?.total || 0);
      if (count >= maxLibraryRowsPerAccount) return status(400, 'Library storage limit reached.');
    }
    const prior = JSON.parse(entryBefore?.value || 'null');
    const previous = resolvePreviousRevision(await getVersion.get(accountId, kind, key), prior);
    if (timestamp < previous || (expectedAt != null && expectedAt !== previous)) {
      return { code: 200, body: { ok: true, stale: true } };
    }
    const revision = Math.max(previous + 1, timestamp);
    if (entry === null) await removeEntry.run(accountId, kind, key);
    else await setEntry.run(accountId, kind, key, JSON.stringify(entry));
    await setVersion.run(accountId, kind, key, revision);
    return { code: 200, body: { ok: true, revision, prior } };
  });
}

const VALID_LIBRARY_KINDS = new Set(['saved', 'ratings', 'progress', 'reading', 'skips', 'watched', 'preferences', 'history', 'folders']);

async function handleLibraryUpdate(account, body) {
  if (!account) return status(401, 'Sign in to update this library.');
  const { accountId, kind, key, value, at, expectedAt } = body || {};
  if (account.id !== accountId) return status(409, 'The signed-in account changed. Reload to update the library.');
  if (!VALID_LIBRARY_KINDS.has(kind) || typeof key !== 'string' || !/^[a-z0-9][\w.-]*(?:\/[\w-]+)?$/i.test(key) || key.length > 145) {
    return status(400, 'Invalid library entry.');
  }
  const entry = libraryValue(kind, value, key);
  if (entry === undefined) return status(400, 'Invalid library entry.');
  if (expectedAt != null && !Number.isSafeInteger(expectedAt)) return status(400, 'Invalid library revision.');
  const now = Date.now();
  const timestamp = safeTimestamp(Number.isSafeInteger(at) ? at : entry?.updated, now, now + 60000);
  return applyLibraryEntryChange({ accountId: account.id, kind, key, entry, timestamp, expectedAt });
}

const IMPORT_ALLOWED_KINDS = ['saved', 'watched', 'ratings', 'progress', 'reading', 'history', 'preferences', 'folders'];
const LIBRARY_KEY_PATTERN = /^[a-z0-9][\w.-]*(?:\/[\w-]+)?$/i;

function collectImportBucketOps(kind, bucket, validOps, state) {
  for (const [key, rawValue] of Object.entries(bucket)) {
    if (validOps.length >= 5000 || typeof key !== 'string' || !LIBRARY_KEY_PATTERN.test(key) || key.length > 145 || rawValue === null) {
      state.skipped++;
      continue;
    }
    const entry = libraryValue(kind, rawValue, key);
    if (entry === undefined) { state.skipped++; continue; }
    validOps.push({ kind, key, entry });
  }
}

function collectImportOps(incoming) {
  const validOps = [];
  const state = { skipped: 0 };
  for (const kind of IMPORT_ALLOWED_KINDS) {
    const bucket = incoming[kind];
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
    collectImportBucketOps(kind, bucket, validOps, state);
  }
  return { validOps, skipped: state.skipped };
}

function recordImportedEntry(state, composite, kind, key, entry, version, isNew) {
  state.writes.push({ kind, key, serialized: JSON.stringify(entry), version });
  if (isNew) state.rowCount++;
  state.existingMap.set(composite, entry);
  state.versionMap.set(composite, version);
  state.counts[kind]++;
  state.totalImported++;
}

function planPreferenceImportOp(composite, key, entry, existing, state) {
  if (existing !== null || state.rowCount >= maxLibraryRowsPerAccount) {
    state.skipped++;
    return;
  }
  recordImportedEntry(state, composite, 'preferences', key, entry, state.now, true);
}

function planVersionedImportOp(composite, kind, key, entry, existing, state) {
  const incomingTs = safeTimestamp(entry?.updated ?? entry?.added, state.now, state.now + 60000);
  const existingTs = resolvePreviousRevision(
    state.versionMap.has(composite) ? { updated: state.versionMap.get(composite) } : null,
    existing,
  );
  if (existing !== null && incomingTs <= existingTs) {
    state.skipped++;
    return;
  }
  if (existing === null && state.rowCount >= maxLibraryRowsPerAccount) {
    state.skipped++;
    return;
  }
  const nextVersion = Math.max(existingTs + 1, incomingTs);
  recordImportedEntry(state, composite, kind, key, entry, nextVersion, existing === null);
}

function planSingleImportOp({ kind, key, entry }, state) {
  const composite = `${kind}\0${key}`;
  const existing = state.existingMap.has(composite) ? state.existingMap.get(composite) : null;
  if (kind === 'preferences') {
    planPreferenceImportOp(composite, key, entry, existing, state);
    return;
  }
  planVersionedImportOp(composite, kind, key, entry, existing, state);
}

function planLibraryImport(validOps, existingRows, existingVersionRows, now, counts) {
  const existingMap = new Map();
  for (const row of existingRows) existingMap.set(`${row.kind}\0${row.key}`, JSON.parse(row.value));
  const versionMap = new Map();
  for (const row of existingVersionRows) versionMap.set(`${row.kind}\0${row.key}`, Number(row.updated));
  const state = { existingMap, versionMap, rowCount: existingRows.length, now, counts, writes: [], skipped: 0, totalImported: 0 };
  for (const op of validOps) planSingleImportOp(op, state);
  return state;
}

async function applyImportWrites(accountId, writes, index = 0) {
  if (index >= writes.length) return;
  const { kind, key, serialized, version } = writes[index];
  await setEntry.run(accountId, kind, key, serialized);
  await setVersion.run(accountId, kind, key, version);
  return applyImportWrites(accountId, writes, index + 1);
}

async function handleLibraryImport(account, body) {
  if (!account) return status(401, 'Sign in to import your library.');
  const { accountId, library: incoming } = body || {};
  if (account.id !== accountId) return status(409, 'The signed-in account changed. Reload to import.');
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return status(400, 'Invalid library import payload.');
  const { validOps, skipped: initialSkipped } = collectImportOps(incoming);
  const counts = Object.fromEntries(IMPORT_ALLOWED_KINDS.map(k => [k, 0]));
  let totalImported = 0;
  let skipped = initialSkipped;
  await db.transaction(async () => {
    await db.lockAccount(account.id);
    const [existingRows, existingVersionRows] = await Promise.all([
      listLibrary.all(account.id),
      listVersions.all(account.id),
    ]);
    const plan = planLibraryImport(validOps, existingRows, existingVersionRows, Date.now(), counts);
    totalImported = plan.totalImported;
    skipped += plan.skipped;
    await applyImportWrites(account.id, plan.writes);
  });
  return { code: 200, body: { ok: true, imported: counts, totalImported, skipped, library: await readLibrary(account.id) } };
}

async function handleMarkEpisodes(account, body) {
  if (!account) return status(401, 'Sign in first.');
  const { accountId, item, episodes } = body || {};
  if (accountId !== account.id) return status(409, 'The signed-in account changed. Reload to update the library.');
  const cleanItem = sanitizeItem(item);
  if (cleanItem?.type !== 'tv' || !/^[\w.-]{1,100}$/.test(cleanItem.key)
    || !Array.isArray(episodes) || !episodes.length || episodes.length > 500
    || !episodes.every(episode => typeof episode === 'string' && /^[\w-]{1,40}$/.test(episode))) {
    return status(400, 'Invalid episode batch.');
  }
  const updated = Date.now();
  const entry = JSON.stringify({ item: cleanItem, updated });
  const mediaKeys = JSON.stringify([...new Set(episodes)].map(episode => `${cleanItem.key}/${episode}`));
  await db.transaction(async () => {
    await db.lockAccount(account.id);
    await setWatchedEpisodes.run(account.id, entry, mediaKeys);
    await clearEpisodeProgress.run(account.id, mediaKeys);
    await setEpisodeVersions.run(account.id, updated, mediaKeys);
  });
  return { code: 200, body: { ok: true, updated } };
}

function applyCompleteSeries({ accountId, key, episodes, validTotalEpisodes }) {
  return db.transaction(async () => {
    await db.lockAccount(accountId);
    const existing = await getEntry.get(accountId, 'saved', key);
    if (!existing) return status(409, 'Save the series before completing it.');
    const previous = JSON.parse(existing.value);
    if (previous.type !== 'tv') return status(400, 'This title is not a series.');
    const version = await getVersion.get(accountId, 'saved', key);
    const updated = Math.max(Date.now(), Number(version?.updated ?? 0) + 1);
    const saved = { ...previous, totalEpisodes: validTotalEpisodes ?? previous.totalEpisodes, watchStatus: 'completed', completedAt: updated };
    const entry = JSON.stringify({ item: saved, updated });
    await setEntry.run(accountId, 'saved', key, JSON.stringify(saved));
    await setVersion.run(accountId, 'saved', key, updated);
    if (episodes.length) {
      const mediaKeys = JSON.stringify([...new Set(episodes)].map(episode => `${key}/${episode}`));
      await setWatchedEpisodes.run(accountId, entry, mediaKeys);
      await clearEpisodeProgress.run(accountId, mediaKeys);
      await setEpisodeVersions.run(accountId, updated, mediaKeys);
    }
    return { code: 200, body: { saved, updated } };
  });
}

async function handleCompleteSeries(account, body) {
  if (!account) return status(401, 'Sign in first.');
  const { accountId, item, episodes } = body || {};
  if (accountId !== account.id) return status(409, 'The signed-in account changed. Reload to update the library.');
  const key = item?.key;
  if (item?.type !== 'tv' || typeof key !== 'string' || !/^[\w.-]{1,100}$/.test(key)
    || !Array.isArray(episodes) || episodes.length > 10000 || !episodes.every(episode => typeof episode === 'string' && /^[\w-]{1,40}$/.test(episode))) {
    return status(400, 'Invalid series completion.');
  }
  const validTotalEpisodes = Number.isSafeInteger(item.totalEpisodes) && item.totalEpisodes > 0 && item.totalEpisodes <= 100_000
    ? item.totalEpisodes
    : undefined;
  return applyCompleteSeries({ accountId: account.id, key, episodes, validTotalEpisodes });
}

function checkAndRecordAuthAttempts(path, ip, username, now) {
  pruneExpiredAttempts(now);
  const limitKey = `${path}:${ip}:${username.toLowerCase()}`;
  const addressKey = `${path}:ip:${ip}`;
  const globalUserKey = `${path}:user:${username.toLowerCase()}`;
  if ((attempts.get(limitKey)?.count || 0) >= 8 || (attempts.get(addressKey)?.count || 0) >= 60 || (attempts.get(globalUserKey)?.count || 0) >= 40) {
    return { limited: true, limitKey, globalUserKey };
  }
  for (const key of [limitKey, addressKey, globalUserKey]) recordAttemptKey(key, now);
  return { limited: false, limitKey, globalUserKey };
}

function validateAuthActionContext({ creating, resetting, existing, body }) {
  if (creating && process.env.AFTERFRAME_REGISTRATION === 'closed') {
    return { error: status(403, 'Registration is closed on this installation.') };
  }
  if (creating && existing) {
    return { error: status(409, 'That username is already in use.') };
  }
  const resetCode = resetting && typeof body.code === 'string' && /^[a-f0-9]{48}$/i.test(body.code) ? body.code.toLowerCase() : '';
  if (resetting && !resetCode) {
    return { error: status(400, 'The username or recovery code is invalid.') };
  }
  return { resetCode };
}

async function handlePasswordReset({ existing, resetCode, salt, passwordHash, limitKey, globalUserKey }) {
  if (!existing) return status(400, 'The username or recovery code is invalid.');
  const reset = await db.transaction(async () => {
    await db.lockAccount(existing.id);
    if (!(await consumeRecovery.run(existing.id, hashToken(resetCode))).changes) return false;
    await updatePassword.run(salt, passwordHash.toString('hex'), existing.id);
    await removeAccountSessions.run(existing.id);
    return true;
  });
  if (!reset) return status(400, 'The username or recovery code is invalid.');
  attempts.delete(limitKey);
  attempts.delete(globalUserKey);
  return { code: 200, body: { ok: true } };
}

function commitAuthSession({ creating, existing, username, salt, passwordHash, previous, token }) {
  return db.transaction(async () => {
    let record;
    if (creating) {
      record = await addAccount.get(username, salt, passwordHash.toString('hex'));
      if (!record) return null;
      record.username = username;
    } else {
      await db.lockAccount(existing.id);
      record = await accountByName.get(username);
      if (record?.password_hash !== existing.password_hash || record?.salt !== existing.salt) return null;
    }
    if (previous) await removeSession.run(hashToken(previous));
    await addSession.run(hashToken(token), record.id, Date.now() + maxAge * 1000);
    await pruneSessions.run(record.id, record.id, maxSessionsPerAccount);
    return { id: record.id, username: record.username };
  });
}

function parseAuthCredentials(body) {
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = body?.password;
  if (!/^[a-z0-9][a-z0-9_-]{2,29}$/i.test(username) || typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return null;
  }
  return { username, password };
}

function isPasswordMatch(existing, passwordHash) {
  return Boolean(existing) && timingSafeEqual(passwordHash, Buffer.from(existing.password_hash, 'hex'));
}

async function finishSessionAuth(request, response, { creating, existing, username, salt, passwordHash, limitKey, globalUserKey }) {
  if (!creating && !isPasswordMatch(existing, passwordHash)) {
    return status(401, 'Username or password is incorrect.');
  }
  const token = randomBytes(32).toString('hex');
  await expireSessions.run(Date.now());
  const user = await commitAuthSession({
    creating, existing, username, salt, passwordHash, previous: sessionToken(request), token,
  });
  if (!user) {
    return creating ? status(409, 'That username is already in use.') : status(401, 'Username or password is incorrect.');
  }
  attempts.delete(limitKey);
  attempts.delete(globalUserKey);
  response.setHeader('Set-Cookie', `${cookie}=${token}; ${cookieFlags}; Max-Age=${maxAge}`);
  return { code: creating ? 201 : 200, body: { account: user, library: await readLibrary(user.id) } };
}

async function handleAuthAction(request, response, path, body) {
  const credentials = parseAuthCredentials(body);
  if (!credentials) return status(400, 'Enter a valid username and a password of at least 8 characters.');
  const { username, password } = credentials;
  const { limited, limitKey, globalUserKey } = checkAndRecordAuthAttempts(path, clientAddress(request), username, Date.now());
  if (limited) return status(429, 'Too many attempts. Try again in 15 minutes.');
  const existing = await accountByName.get(username);
  const creating = path.endsWith('/create');
  const resetting = path.endsWith('/reset');
  const validated = validateAuthActionContext({ creating, resetting, existing, body });
  if (validated.error) return validated.error;
  const salt = creating || resetting ? randomBytes(24).toString('hex') : existing?.salt || guestSalt;
  const passwordHash = await derivePasswordHash(password, salt);
  if (!passwordHash) return status(429, 'Too many account requests are in progress. Try again in a moment.');
  if (resetting) {
    return handlePasswordReset({ existing, resetCode: validated.resetCode, salt, passwordHash, limitKey, globalUserKey });
  }
  return finishSessionAuth(request, response, {
    creating, existing, username, salt, passwordHash, limitKey, globalUserKey,
  });
}

const POST_ACCOUNT_HANDLERS = {
  '/api/account/signout': (request, response) => handleSignOut(request, response),
  '/api/account/recovery-code': (request, _response, account, body) => handleRecoveryCode(request, account, body),
  '/api/account/revoke-other': (request, _response, account) => handleRevokeOther(request, account),
  '/api/account/notifications-read-all': (_request, _response, account, body) => handleNotificationsReadAll(account, body),
  '/api/account/clear-history': (_request, _response, account, body) => handleClearHistory(account, body),
  '/api/account/notifications-read': (_request, _response, account, body) => handleNotificationRead(account, body),
  '/api/account/library': (_request, _response, account, body) => handleLibraryUpdate(account, body),
  '/api/account/import': (_request, _response, account, body) => handleLibraryImport(account, body),
  '/api/account/mark-episodes': (_request, _response, account, body) => handleMarkEpisodes(account, body),
  '/api/account/complete-series': (_request, _response, account, body) => handleCompleteSeries(account, body),
};

export async function accountApi(request, response, path, body) {
  const account = await currentAccount(request);
  if (path === '/api/account' && request.method === 'GET') {
    return handleGetAccount(request, account);
  }
  if (request.method !== 'POST') return status(405, 'Method unavailable.');
  if (Object.hasOwn(POST_ACCOUNT_HANDLERS, path)) {
    return POST_ACCOUNT_HANDLERS[path](request, response, account, body);
  }
  if (['/api/account/create', '/api/account/signin', '/api/account/reset'].includes(path)) {
    return handleAuthAction(request, response, path, body);
  }
  return status(404, 'Account action unavailable.');
}
