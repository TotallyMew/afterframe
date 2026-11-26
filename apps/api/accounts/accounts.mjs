import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { comicChapterIdPattern, comicIdPattern } from '@afterframe/shared/comic-ids';
import { preferenceDefaults } from '@afterframe/shared/playback';
import { ratingOnTen, watchStatuses, watchStatus } from '@afterframe/shared/library';
import { openAccountStorage } from './account-storage.mjs';

const db = await openAccountStorage();
export const accountStorageHealth = db.health;
export const closeAccountStorage = () => db.close();

/** @type {(password: string, salt: string, keylen: number, options: import('node:crypto').ScryptOptions) => Promise<Buffer>} */
const hashPassword = /** @type {any} */ (promisify(scrypt));
const work = { N: 2 ** 17, r: 8, p: 1, maxmem: 160 * 1024 ** 2 };
const guestSalt = randomBytes(24).toString('hex');
const cookie = 'afterframe_session';
const maxAge = 30 * 24 * 60 * 60;
const cookieFlags = `Path=/; HttpOnly; SameSite=Strict${process.env.AFTERFRAME_ORIGIN ? '; Secure' : ''}`;
const maxConcurrentHashes = 2;
const maxQueuedHashes = 16;
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
  if (trustProxy) {
    const forwarded = request.headers?.['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      const parts = forwarded.split(',').map(part => part.trim()).filter(Boolean);
      if (parts.length) return parts.at(-1);
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
const addAccount = db.prepare('INSERT INTO accounts (username, salt, password_hash) VALUES (?, ?, ?) ON CONFLICT DO NOTHING RETURNING id');
const addSession = db.prepare('INSERT INTO sessions (token_hash, account_id, expires) VALUES (?, ?, ?)');
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
const setEntry = db.prepare('INSERT INTO library (account_id, kind, key, value) VALUES (?, ?, ?, ?) ON CONFLICT (account_id, kind, key) DO UPDATE SET value = excluded.value');
const removeEntry = db.prepare('DELETE FROM library WHERE account_id = ? AND kind = ? AND key = ?');
const getEntry = db.prepare('SELECT value FROM library WHERE account_id = ? AND kind = ? AND key = ?');
const listKindEntries = db.prepare('SELECT key, value FROM library WHERE account_id = ? AND kind = ?');
const clearKindEntries = db.prepare('DELETE FROM library WHERE account_id = ? AND kind = ?');
const clearKindVersions = db.prepare('DELETE FROM playback_versions WHERE account_id = ? AND kind = ?');
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
  return request.headers.cookie?.match(/(?:^|;\s*)afterframe_session=([a-f0-9]{64})(?:;|$)/)?.[1];
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
  for (const row of await followedSeries.all()) {
    const item = JSON.parse(row.value);
    if (!Number.isSafeInteger(item.id) || item.id <= 0 || watchStatus(item) === 'dropped') continue;
    if (!targets.has(item.id)) targets.set(item.id, []);
    targets.get(item.id).push({ accountId: row.account_id, title: item.title, watchKey: item.key });
  }
  return targets;
}

export function storeReleaseEvents(seriesId, followers, makeEvents) {
  return db.transaction(async () => {
    await db.lockRelease(seriesId);
    const previous = await releaseSnapshot(seriesId);
    const { snapshot, events } = makeEvents(previous);
    for (const { accountId, title, watchKey } of [...followers].sort((a, b) => a.accountId - b.accountId)) {
      if (!events.length) break;
      await db.lockAccount(accountId);
      const followed = await getEntry.get(accountId, 'saved', watchKey ?? `tv-${seriesId}`);
      if (!followed || watchStatus(JSON.parse(followed.value)) === 'dropped') continue;
      for (const { key, message, preference, source } of events) {
        if ((await getEntry.get(accountId, 'preferences', preference))?.value === 'false') continue;
        await addNotification.run(accountId, key, JSON.stringify({ seriesId, title, message, source, created: Date.now(), read: false }));
      }
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
    && value.item?.key === key && typeof value.item.title === 'string' && ['movie', 'tv', 'comic'].includes(value.item.type) ? ratingOnTen(value) : undefined;
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
  if (kind === 'folders') {
    const name = typeof value?.name === 'string' ? value.name.trim() : '';
    const allowedColors = ['ember', 'gold', 'sage', 'steel', 'slate'];
    const color = value?.color === undefined ? 'ember' : value.color;
    if (value?.id !== key || !name || name.length > 50 || /[\x00-\x1f\x7f]/.test(name)
      || !allowedColors.includes(color) || !Array.isArray(value?.items) || value.items.length > 500
      || !Number.isFinite(value?.created) || !Number.isFinite(value?.updated)) return undefined;
    const seen = new Set();
    const items = [];
    for (const itemKey of value.items) {
      if (typeof itemKey !== 'string' || !/^[a-z0-9][\w.-]{0,120}$/i.test(itemKey)) return undefined;
      if (!seen.has(itemKey)) { seen.add(itemKey); items.push(itemKey); }
    }
    return { id: key, name, color, items, created: value.created, updated: value.updated };
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
  const account = await currentAccount(request);
  if (path === '/api/account' && request.method === 'GET') {
    return { code: 200, body: { account, library: account ? await readLibrary(account.id) : null } };
  }
  if (request.method !== 'POST') return status(405, 'Method unavailable.');

  if (path === '/api/account/signout') {
    const token = sessionToken(request);
    if (token) await removeSession.run(hashToken(token));
    response.setHeader('Set-Cookie', `${cookie}=; ${cookieFlags}; Max-Age=0`);
    return { code: 200, body: { account: null } };
  }

  if (['/api/account/recovery-code', '/api/account/revoke-other', '/api/account/notifications-read', '/api/account/notifications-read-all', '/api/account/clear-history'].includes(path)) {
    if (!account) return status(401, 'Sign in first.');
    if (path.endsWith('/recovery-code')) {
      const code = randomBytes(24).toString('hex');
      await createRecovery.run(account.id, hashToken(code));
      return { code: 200, body: { code } };
    }
    if (path.endsWith('/revoke-other')) {
      await removeOtherSessions.run(account.id, hashToken(sessionToken(request)));
    } else if (path.endsWith('/notifications-read-all')) {
      if (body?.accountId != null && account.id !== body.accountId) return status(409, 'The signed-in account changed.');
      await db.transaction(async () => {
        await db.lockAccount(account.id);
        for (const row of await listKindEntries.all(account.id, 'notifications')) {
          const parsed = JSON.parse(row.value);
          if (!parsed.read) await setEntry.run(account.id, 'notifications', row.key, JSON.stringify({ ...parsed, read: true }));
        }
      });
    } else if (path.endsWith('/clear-history')) {
      if (body?.accountId != null && account.id !== body.accountId) return status(409, 'The signed-in account changed.');
      await db.transaction(async () => {
        await db.lockAccount(account.id);
        await clearKindEntries.run(account.id, 'history');
        await clearKindVersions.run(account.id, 'history');
      });
    } else {
      if (body?.accountId != null && account.id !== body.accountId) return status(409, 'The signed-in account changed.');
      if (typeof body?.key !== 'string' || !/^[\w-]{1,100}$/.test(body.key)) return status(400, 'Invalid notification.');
      const entry = await getEntry.get(account.id, 'notifications', body.key);
      if (entry) await setEntry.run(account.id, 'notifications', body.key, JSON.stringify({ ...JSON.parse(entry.value), read: true }));
    }
    return { code: 200, body: { ok: true } };
  }

  if (path === '/api/account/library') {
    if (!account) return status(401, 'Sign in to update this library.');
    const { accountId, kind, key, value, at, expectedAt } = body || {};
    if (account.id !== accountId) return status(409, 'The signed-in account changed. Reload to update the library.');
    if (!['saved', 'ratings', 'progress', 'reading', 'skips', 'watched', 'preferences', 'history', 'folders'].includes(kind) || typeof key !== 'string' || !/^[a-z0-9][\w.-]*(?:\/[\w-]+)?$/i.test(key) || key.length > 145) return status(400, 'Invalid library entry.');
    const entry = libraryValue(kind, value, key);
    if (entry === undefined) return status(400, 'Invalid library entry.');
    if (expectedAt != null && !Number.isSafeInteger(expectedAt)) return status(400, 'Invalid library revision.');
    const now = Date.now();
    const timestamp = safeTimestamp(Number.isSafeInteger(at) ? at : entry?.updated, now, now + 60000);
    return db.transaction(async () => {
      await db.lockAccount(account.id);
      const entryBefore = await getEntry.get(account.id, kind, key);
      const prior = JSON.parse(entryBefore?.value || 'null');
      const version = await getVersion.get(account.id, kind, key);
      const rawPrevious = version ? Number(version.updated) : Number(prior?.updated ?? prior?.added ?? 0);
      const previous = Number.isFinite(rawPrevious) ? Math.trunc(rawPrevious) : 0;
      if (timestamp < previous || expectedAt != null && expectedAt !== previous) {
        return { code: 200, body: { ok: true, stale: true } };
      }
      const revision = Math.max(previous + 1, timestamp);
      if (entry === null) await removeEntry.run(account.id, kind, key);
      else await setEntry.run(account.id, kind, key, JSON.stringify(entry));
      await setVersion.run(account.id, kind, key, revision);
      return { code: 200, body: { ok: true, revision, prior } };
    });
  }

  if (path === '/api/account/import') {
    if (!account) return status(401, 'Sign in to import your library.');
    const { accountId, library: incoming } = body || {};
    if (account.id !== accountId) return status(409, 'The signed-in account changed. Reload to import.');
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return status(400, 'Invalid library import payload.');
    const allowedKinds = ['saved', 'watched', 'ratings', 'progress', 'reading', 'history', 'preferences', 'folders'];
    const keyPattern = /^[a-z0-9][\w.-]*(?:\/[\w-]+)?$/i;
    const validOps = [];
    let skipped = 0;
    for (const kind of allowedKinds) {
      const bucket = incoming[kind];
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
      for (const [key, rawValue] of Object.entries(bucket)) {
        if (validOps.length >= 5000) { skipped++; continue; }
        if (typeof key !== 'string' || !keyPattern.test(key) || key.length > 145 || rawValue === null) {
          skipped++;
          continue;
        }
        const entry = libraryValue(kind, rawValue, key);
        if (entry === undefined) { skipped++; continue; }
        validOps.push({ kind, key, entry });
      }
    }
    const counts = Object.fromEntries(allowedKinds.map(k => [k, 0]));
    let totalImported = 0;
    await db.transaction(async () => {
      await db.lockAccount(account.id);
      const now = Date.now();
      for (const { kind, key, entry } of validOps) {
        const existingRow = await getEntry.get(account.id, kind, key);
        const existing = existingRow ? JSON.parse(existingRow.value) : null;
        if (kind === 'preferences') {
          if (existing !== null) { skipped++; continue; }
          await setEntry.run(account.id, kind, key, JSON.stringify(entry));
          await setVersion.run(account.id, kind, key, now);
          counts[kind]++;
          totalImported++;
          continue;
        }
        const incomingTs = safeTimestamp(entry?.updated ?? entry?.added, now, now + 60000);
        const version = await getVersion.get(account.id, kind, key);
        const rawExistingTs = version ? Number(version.updated) : Number(existing?.updated ?? existing?.added ?? 0);
        const existingTs = Number.isFinite(rawExistingTs) ? Math.trunc(rawExistingTs) : 0;
        if (existing !== null && incomingTs <= existingTs) {
          skipped++;
          continue;
        }
        await setEntry.run(account.id, kind, key, JSON.stringify(entry));
        await setVersion.run(account.id, kind, key, Math.max(existingTs + 1, incomingTs));
        counts[kind]++;
        totalImported++;
      }
    });
    return { code: 200, body: { ok: true, imported: counts, totalImported, skipped, library: await readLibrary(account.id) } };
  }

  if (path === '/api/account/complete-series') {
    if (!account) return status(401, 'Sign in first.');
    const { accountId, item, episodes } = body || {};
    if (accountId !== account.id) return status(409, 'The signed-in account changed. Reload to update the library.');
    const key = item?.key;
    if (item?.type !== 'tv' || typeof key !== 'string' || !/^[\w.-]{1,100}$/.test(key)
      || !Array.isArray(episodes) || episodes.length > 10000 || !episodes.every(episode => typeof episode === 'string' && /^[\w-]{1,40}$/.test(episode))) return status(400, 'Invalid series completion.');
    const validTotalEpisodes = Number.isSafeInteger(item.totalEpisodes) && item.totalEpisodes > 0 && item.totalEpisodes <= 100_000
      ? item.totalEpisodes
      : undefined;
    return db.transaction(async () => {
      await db.lockAccount(account.id);
      const existing = await getEntry.get(account.id, 'saved', key);
      if (!existing) return status(409, 'Save the series before completing it.');
      const previous = JSON.parse(existing.value);
      if (previous.type !== 'tv') return status(400, 'This title is not a series.');
      const version = await getVersion.get(account.id, 'saved', key);
      const updated = Math.max(Date.now(), Number(version?.updated ?? 0) + 1);
      const saved = { ...previous, totalEpisodes: validTotalEpisodes ?? previous.totalEpisodes, watchStatus: 'completed', completedAt: updated };
      const entry = JSON.stringify({ item: saved, updated });
      await setEntry.run(account.id, 'saved', key, JSON.stringify(saved));
      await setVersion.run(account.id, 'saved', key, updated);
      if (episodes.length) {
        const mediaKeys = JSON.stringify([...new Set(episodes)].map(episode => `${key}/${episode}`));
        await setWatchedEpisodes.run(account.id, entry, mediaKeys);
        await clearEpisodeProgress.run(account.id, mediaKeys);
        await setEpisodeVersions.run(account.id, updated, mediaKeys);
      }
      return { code: 200, body: { saved, updated } };
    });
  }

  if (!['/api/account/create', '/api/account/signin', '/api/account/reset'].includes(path)) return status(404, 'Account action unavailable.');
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = body?.password;
  if (!/^[a-z0-9][a-z0-9_-]{2,29}$/i.test(username) || typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return status(400, 'Enter a valid username and a password of at least 8 characters.');
  }
  const now = Date.now();
  for (const [key, entry] of attempts) if (now >= entry.expires) attempts.delete(key);
  const ip = clientAddress(request);
  const limitKey = `${path}:${ip}:${username.toLowerCase()}`;
  const addressKey = `${path}:ip:${ip}`;
  const globalUserKey = `${path}:user:${username.toLowerCase()}`;
  if ((attempts.get(limitKey)?.count || 0) >= 8 || (attempts.get(addressKey)?.count || 0) >= 60 || (attempts.get(globalUserKey)?.count || 0) >= 40) {
    return status(429, 'Too many attempts. Try again in 15 minutes.');
  }
  for (const key of [limitKey, addressKey, globalUserKey]) {
    if (!attempts.has(key) && attempts.size >= MAX_ATTEMPT_KEYS) {
      const oldest = attempts.keys().next().value;
      if (oldest) attempts.delete(oldest);
    }
    const entry = attempts.get(key) || { count: 0, expires: now + 15 * 60000 };
    entry.count++;
    attempts.set(key, entry);
  }
  const existing = await accountByName.get(username);
  const creating = path.endsWith('/create');
  const resetting = path.endsWith('/reset');
  if (creating && process.env.AFTERFRAME_REGISTRATION === 'closed') return status(403, 'Registration is closed on this installation.');
  if (creating && existing) return status(409, 'That username is already in use.');
  const resetCode = resetting && typeof body.code === 'string' && /^[a-f0-9]{48}$/i.test(body.code) ? body.code.toLowerCase() : '';
  if (resetting && !resetCode) return status(400, 'The username or recovery code is invalid.');
  const salt = creating || resetting ? randomBytes(24).toString('hex') : existing?.salt || guestSalt;
  const passwordHash = await derivePasswordHash(password, salt);
  if (!passwordHash) return status(429, 'Too many account requests are in progress. Try again in a moment.');
  if (resetting) {
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
  if (!creating && (!existing || !timingSafeEqual(passwordHash, Buffer.from(existing.password_hash, 'hex')))) return status(401, 'Username or password is incorrect.');
  const previous = sessionToken(request);
  const token = randomBytes(32).toString('hex');
  await expireSessions.run(Date.now());
  const user = await db.transaction(async () => {
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
    return { id: record.id, username: record.username };
  });
  if (!user) return creating ? status(409, 'That username is already in use.') : status(401, 'Username or password is incorrect.');
  attempts.delete(limitKey);
  attempts.delete(globalUserKey);
  response.setHeader('Set-Cookie', `${cookie}=${token}; ${cookieFlags}; Max-Age=${maxAge}`);
  return { code: creating ? 201 : 200, body: { account: user, library: await readLibrary(user.id) } };
}
