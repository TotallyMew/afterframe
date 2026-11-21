import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { comicChapterIdPattern, comicIdPattern } from './public/comic-ids.js';
import { preferenceDefaults } from './public/playback.js';
import { ratingOnTen, watchStatuses, watchStatus } from './public/library.js';
import { migrateAccounts } from './account-migrations.mjs';

const directory = new URL('./data/', import.meta.url);
mkdirSync(directory, { recursive: true });
const db = new DatabaseSync(process.env.AFTERFRAME_DB || fileURLToPath(new URL('accounts.sqlite', directory)));
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 3000;
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    salt TEXT NOT NULL, password_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS library (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
    PRIMARY KEY (account_id, kind, key)
  );
  CREATE TABLE IF NOT EXISTS provider_credentials (
    provider TEXT PRIMARY KEY, credential TEXT NOT NULL
  );
`);

migrateAccounts(db);

const hashPassword = promisify(scrypt);
const work = { N: 2 ** 17, r: 8, p: 1, maxmem: 160 * 1024 ** 2 };
const guestSalt = randomBytes(24).toString('hex');
const cookie = 'afterframe_session';
const maxAge = 30 * 24 * 60 * 60;
const cookieFlags = `Path=/; HttpOnly; SameSite=Strict${process.env.AFTERFRAME_ORIGIN ? '; Secure' : ''}`;
let hashing = false;
const attempts = new Map();

const accountByName = db.prepare('SELECT * FROM accounts WHERE username = ?');
const addAccount = db.prepare('INSERT INTO accounts (username, salt, password_hash) VALUES (?, ?, ?)');
const addSession = db.prepare('INSERT INTO sessions (token_hash, account_id, expires) VALUES (?, ?, ?)');
const removeSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
const removeAccountSessions = db.prepare('DELETE FROM sessions WHERE account_id = ?');
const updatePassword = db.prepare('UPDATE accounts SET salt = ?, password_hash = ? WHERE id = ?');
const createRecovery = db.prepare('INSERT INTO recovery_codes VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET code_hash = excluded.code_hash');
const consumeRecovery = db.prepare('DELETE FROM recovery_codes WHERE account_id = ? AND code_hash = ?');
const expireSessions = db.prepare('DELETE FROM sessions WHERE expires <= ?');
const sessionAccount = db.prepare('SELECT accounts.id, accounts.username FROM sessions JOIN accounts ON accounts.id = sessions.account_id WHERE token_hash = ? AND expires > ?');
const listLibrary = db.prepare('SELECT kind, key, value FROM library WHERE account_id = ? ORDER BY rowid');
const setEntry = db.prepare('INSERT INTO library (account_id, kind, key, value) VALUES (?, ?, ?, ?) ON CONFLICT (account_id, kind, key) DO UPDATE SET value = excluded.value');
const removeEntry = db.prepare('DELETE FROM library WHERE account_id = ? AND kind = ? AND key = ?');
const getEntry = db.prepare('SELECT value FROM library WHERE account_id = ? AND kind = ? AND key = ?');
const getVersion = db.prepare('SELECT updated FROM playback_versions WHERE account_id = ? AND kind = ? AND key = ?');
const setVersion = db.prepare('INSERT INTO playback_versions VALUES (?, ?, ?, ?) ON CONFLICT(account_id,kind,key) DO UPDATE SET updated = max(playback_versions.updated, excluded.updated)');
const followedSeries = db.prepare(`SELECT account_id, value FROM library WHERE kind = 'saved' AND json_extract(value, '$.type') = 'tv'`);
const getReleaseSnapshot = db.prepare('SELECT value FROM release_snapshots WHERE series_id = ?');
const setReleaseSnapshot = db.prepare('INSERT INTO release_snapshots VALUES (?, ?) ON CONFLICT(series_id) DO UPDATE SET value = excluded.value');
const addNotification = db.prepare('INSERT OR IGNORE INTO library (account_id, kind, key, value) VALUES (?, \'notifications\', ?, ?)');
const readProviderCredential = db.prepare('SELECT credential FROM provider_credentials WHERE provider = ?');
const writeProviderCredential = db.prepare(`INSERT INTO provider_credentials (provider, credential) VALUES (?, ?)
  ON CONFLICT (provider) DO UPDATE SET credential = excluded.credential`);

export function providerCredential(provider) {
  return readProviderCredential.get(provider)?.credential;
}

export function saveProviderCredential(provider, credential) {
  writeProviderCredential.run(provider, credential);
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function sessionToken(request) {
  return request.headers.cookie?.match(/(?:^|;\s*)afterframe_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}

export function currentAccount(request) {
  const token = sessionToken(request);
  return token ? sessionAccount.get(hashToken(token), Date.now()) ?? null : null;
}

export function readLibrary(id) {
  const result = Object.fromEntries(['saved', 'progress', 'reading', 'ratings', 'skips', 'watched', 'preferences', 'history', 'notifications'].map(kind => [kind, Object.create(null)]));
  for (const row of listLibrary.all(id)) result[row.kind][row.key] = JSON.parse(row.value);
  return result;
}

export function releaseTargets() {
  const targets = new Map();
  for (const row of followedSeries.all()) {
    const item = JSON.parse(row.value);
    if (!Number.isSafeInteger(item.id) || item.id <= 0 || watchStatus(item) === 'dropped') continue;
    if (!targets.has(item.id)) targets.set(item.id, []);
    targets.get(item.id).push({ accountId: row.account_id, title: item.title, watchKey: item.key });
  }
  return targets;
}

export function storeReleaseEvents(seriesId, followers, makeEvents) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const previous = JSON.parse(getReleaseSnapshot.get(seriesId)?.value ?? 'null');
    const { snapshot, events } = makeEvents(previous);
    for (const { accountId, title, watchKey } of followers) {
      const followed = getEntry.get(accountId, 'saved', watchKey ?? `tv-${seriesId}`);
      if (!followed || watchStatus(JSON.parse(followed.value)) === 'dropped') continue;
      for (const { key, message, preference, source } of events) {
        if (getEntry.get(accountId, 'preferences', preference)?.value === 'false') continue;
        addNotification.run(accountId, key, JSON.stringify({ seriesId, title, message, source, created: Date.now(), read: false }));
      }
    }
    if (snapshot) setReleaseSnapshot.run(seriesId, JSON.stringify(snapshot));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function releaseSnapshot(seriesId) {
  return JSON.parse(getReleaseSnapshot.get(seriesId)?.value ?? 'null');
}

function status(code, error) {
  return { code, body: { error } };
}

function libraryValue(kind, value, key) {
  if (value === null) return null;
  if (kind === 'preferences') {
    if (Object.hasOwn(preferenceDefaults, key) && typeof value === 'boolean') return value;
    if (key === 'level' && Number.isFinite(value) && value >= 0 && value <= 1) return value;
    if (['muted', 'captions'].includes(key) && typeof value === 'boolean') return value;
    if (key === 'quality' && ['', '1080', '720', '480'].includes(value)) return value;
    if (['subtitleLanguage', 'audioLanguage'].includes(key) && typeof value === 'string' && value.length <= 60 && !/[\x00-\x1f\x7f]/.test(value)) return value;
    return undefined;
  }
  if (kind === 'saved') return value?.key === key && typeof value.title === 'string' && ['movie', 'tv', 'comic'].includes(value.type)
    && (value.watchStatus === undefined || (typeof value.watchStatus === 'string' && Object.hasOwn(watchStatuses, value.watchStatus))) ? value : undefined;
  if (kind === 'reading') {
    const item = value?.item;
    return item?.type === 'comic' && item.key === key && key === `comic-${item.id}` && comicIdPattern.test(item.id)
      && typeof item.title === 'string' && typeof value.chapter === 'string' && comicChapterIdPattern.test(value.chapter) && typeof value.label === 'string'
      && /^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(value.language)
      && (value.source === undefined || value.source === 'afterframe')
      && Number.isInteger(value.page) && value.page >= 1 && value.page <= 10_000
      && Number.isInteger(value.listPage) && value.listPage >= 1 && value.listPage <= 200
      && Number.isFinite(value.updated) ? value : undefined;
  }
  if (kind === 'ratings') return Number.isInteger(value?.score) && value.score >= 1 && value.score <= (value.scale === 10 ? 10 : 5)
    && value.item?.key === key && typeof value.item.title === 'string' && ['movie', 'tv'].includes(value.item.type) ? ratingOnTen(value) : undefined;
  if (kind === 'history') return /^[a-f0-9-]{36}$/.test(key) && typeof value?.item?.key === 'string' && typeof value.item.title === 'string' && ['movie', 'tv'].includes(value.item.type)
    && typeof value.mediaKey === 'string' && (value.mediaKey === value.item.key || value.mediaKey.startsWith(`${value.item.key}/`))
    && Number.isFinite(value.duration) && value.duration > 0 && value.duration <= 86400 && Number.isFinite(value.time) && value.time >= 0 && value.time <= value.duration
    && Number.isFinite(value.coverage) && value.coverage >= 0 && value.coverage <= value.duration && typeof value.completed === 'boolean'
    && Number.isSafeInteger(value.started) && value.started > 0 && Number.isSafeInteger(value.updated) && value.started <= value.updated && value.updated <= Date.now() + 60000 ? value : undefined;
  if (kind === 'watched') {
    const item = value?.item;
    return Number.isFinite(value?.updated) && typeof item?.key === 'string' && typeof item.title === 'string'
      && ['movie', 'tv'].includes(item.type) && (item.key === key || key.startsWith(`${item.key}/`)) ? value : undefined;
  }
  if (kind === 'progress') {
    const validRanges = ranges => ranges === undefined || (Array.isArray(ranges) && ranges.length <= 100 && ranges.every(range => Array.isArray(range) && range.length === 2
      && Number.isFinite(range[0]) && Number.isFinite(range[1]) && range[0] >= 0 && range[1] > range[0] && range[1] <= 86400));
    return Number.isFinite(value?.time) && value.time >= 0 && Number.isFinite(value.duration) && value.duration > value.time && value.duration <= 86400
      && Number.isFinite(value.updated) && validRanges(value.ranges) && validRanges(value.skipped) ? value : undefined;
  }
  if (kind === 'skips') {
    if (!Array.isArray(value) || value.length > 3) return undefined;
    const kinds = new Set();
    for (const segment of value) {
      if (!['intro', 'recap', 'credits'].includes(segment?.kind) || kinds.has(segment.kind) || !Number.isFinite(segment.start) || !Number.isFinite(segment.end)
        || segment.start < 0 || segment.end <= segment.start || segment.end > 86400) return undefined;
      kinds.add(segment.kind);
    }
    return value;
  }
}

export async function accountApi(request, response, path, body) {
  const account = currentAccount(request);
  if (path === '/api/account' && request.method === 'GET') {
    return { code: 200, body: { account, library: account ? readLibrary(account.id) : null } };
  }
  if (request.method !== 'POST') return status(405, 'Method unavailable.');

  if (path === '/api/account/signout') {
    const token = sessionToken(request);
    if (token) removeSession.run(hashToken(token));
    response.setHeader('Set-Cookie', `${cookie}=; ${cookieFlags}; Max-Age=0`);
    return { code: 200, body: { account: null } };
  }

  if (['/api/account/recovery-code', '/api/account/revoke-other', '/api/account/notifications-read'].includes(path)) {
    if (!account) return status(401, 'Sign in first.');
    if (path.endsWith('/recovery-code')) {
      const code = randomBytes(24).toString('hex');
      createRecovery.run(account.id, hashToken(code));
      return { code: 200, body: { code } };
    }
    if (path.endsWith('/revoke-other')) {
      db.prepare('DELETE FROM sessions WHERE account_id = ? AND token_hash <> ?').run(account.id, hashToken(sessionToken(request)));
    } else {
      if (typeof body?.key !== 'string' || !/^[\w-]{1,100}$/.test(body.key)) return status(400, 'Invalid notification.');
      const entry = getEntry.get(account.id, 'notifications', body.key);
      if (entry) setEntry.run(account.id, 'notifications', body.key, JSON.stringify({ ...JSON.parse(entry.value), read: true }));
    }
    return { code: 200, body: { ok: true } };
  }

  if (path === '/api/account/library') {
    if (!account) return status(401, 'Sign in to update this library.');
    const { accountId, kind, key, value, at } = body || {};
    if (account.id !== accountId) return status(409, 'The signed-in account changed. Reload to update the library.');
    if (!['saved', 'ratings', 'progress', 'reading', 'skips', 'watched', 'preferences', 'history'].includes(kind) || typeof key !== 'string' || !/^[a-z0-9][\w.-]*(?:\/[\w-]+)?$/i.test(key) || key.length > 145) return status(400, 'Invalid library entry.');
    const entry = libraryValue(kind, value, key);
    if (entry === undefined) return status(400, 'Invalid library entry.');
    const timestamped = ['progress', 'reading', 'watched', 'history'].includes(kind);
    const now = Date.now();
    const timestamp = Math.min(Number.isSafeInteger(at) ? at : entry?.updated || now, now + 60000);
    if (timestamped) db.exec('BEGIN IMMEDIATE');
    try {
      if (timestamped) {
        const previous = getVersion.get(account.id, kind, key)?.updated ?? JSON.parse(getEntry.get(account.id, kind, key)?.value || 'null')?.updated ?? 0;
        if (timestamp < previous) {
          db.exec('ROLLBACK');
          return { code: 200, body: { ok: true, stale: true } };
        }
      }
      if (entry === null) removeEntry.run(account.id, kind, key);
      else setEntry.run(account.id, kind, key, JSON.stringify(entry));
      if (timestamped) {
        setVersion.run(account.id, kind, key, timestamp);
        db.exec('COMMIT');
      }
    } catch (error) {
      if (timestamped) db.exec('ROLLBACK');
      throw error;
    }
    return { code: 200, body: { ok: true } };
  }

  if (path === '/api/account/complete-series') {
    if (!account) return status(401, 'Sign in first.');
    const { accountId, item, episodes } = body || {};
    const key = item?.key;
    if (accountId !== account.id || item?.type !== 'tv' || typeof key !== 'string' || !/^[\w.-]{1,100}$/.test(key)
      || !Array.isArray(episodes) || episodes.length > 10000 || !episodes.every(episode => typeof episode === 'string' && /^[\w-]{1,40}$/.test(episode))) return status(400, 'Invalid series completion.');
    const existing = getEntry.get(account.id, 'saved', key);
    if (!existing) return status(409, 'Save the series before completing it.');
    const previous = JSON.parse(existing.value);
    if (previous.type !== 'tv') return status(400, 'This title is not a series.');
    const updated = Date.now();
    const saved = { ...previous, totalEpisodes: item.totalEpisodes || previous.totalEpisodes, watchStatus: 'completed', completedAt: updated };
    const entry = { item: saved, updated };
    db.exec('BEGIN IMMEDIATE');
    try {
      setEntry.run(account.id, 'saved', key, JSON.stringify(saved));
      for (const episode of new Set(episodes)) {
        const mediaKey = `${key}/${episode}`;
        if (!getEntry.get(account.id, 'watched', mediaKey)) setEntry.run(account.id, 'watched', mediaKey, JSON.stringify(entry));
        setVersion.run(account.id, 'watched', mediaKey, updated);
        removeEntry.run(account.id, 'progress', mediaKey);
        setVersion.run(account.id, 'progress', mediaKey, updated);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return { code: 200, body: { saved, updated } };
  }

  if (!['/api/account/create', '/api/account/signin', '/api/account/reset'].includes(path)) return status(404, 'Account action unavailable.');
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = body?.password;
  if (!/^[a-z0-9][a-z0-9_-]{2,29}$/i.test(username) || typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return status(400, 'Enter a valid username and a password of at least 8 characters.');
  }
  if (hashing) return status(429, 'An account request is in progress. Try again in a moment.');
  const now = Date.now();
  for (const [key, entry] of attempts) if (now >= entry.expires) attempts.delete(key);
  const limitKey = `${path}:${username.toLowerCase()}`;
  const addressKey = `${path}:ip:${request.socket?.remoteAddress || 'local'}`;
  if ((attempts.get(limitKey)?.count || 0) >= 8 || (attempts.get(addressKey)?.count || 0) >= 60) return status(429, 'Too many attempts. Try again in 15 minutes.');
  for (const key of [limitKey, addressKey]) {
    const entry = attempts.get(key) || { count: 0, expires: now + 15 * 60000 };
    entry.count++;
    attempts.set(key, entry);
  }
  const existing = accountByName.get(username);
  const creating = path.endsWith('/create');
  const resetting = path.endsWith('/reset');
  if (creating && process.env.AFTERFRAME_REGISTRATION === 'closed') return status(403, 'Registration is closed on this installation.');
  if (creating && existing) return status(409, 'That username is already in use.');
  const salt = creating || resetting ? randomBytes(24).toString('hex') : existing?.salt || guestSalt;
  let passwordHash;
  hashing = true;
  try { passwordHash = await hashPassword(password, salt, 64, work); } finally { hashing = false; }
  if (resetting) {
    const code = typeof body.code === 'string' && /^[a-f0-9]{48}$/i.test(body.code) ? body.code.toLowerCase() : '';
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!existing || !code || !consumeRecovery.run(existing.id, hashToken(code)).changes) {
        db.exec('ROLLBACK');
        return status(400, 'The username or recovery code is invalid.');
      }
      updatePassword.run(salt, passwordHash.toString('hex'), existing.id);
      removeAccountSessions.run(existing.id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    attempts.delete(limitKey);
    return { code: 200, body: { ok: true } };
  }
  if (!creating && (!existing || !timingSafeEqual(passwordHash, Buffer.from(existing.password_hash, 'hex')))) return status(401, 'Username or password is incorrect.');
  if (creating && accountByName.get(username)) return status(409, 'That username is already in use.');
  const user = creating ? { id: Number(addAccount.run(username, salt, passwordHash.toString('hex')).lastInsertRowid), username }
    : { id: existing.id, username: existing.username };
  const previous = sessionToken(request);
  if (previous) removeSession.run(hashToken(previous));
  const token = randomBytes(32).toString('hex');
  expireSessions.run(Date.now());
  addSession.run(hashToken(token), user.id, Date.now() + maxAge * 1000);
  attempts.delete(limitKey);
  response.setHeader('Set-Cookie', `${cookie}=${token}; ${cookieFlags}; Max-Age=${maxAge}`);
  return { code: creating ? 201 : 200, body: { account: user, library: readLibrary(user.id) } };
}
