import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

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
  DROP TABLE IF EXISTS kino_connections;
`);

const hashPassword = promisify(scrypt);
const work = { N: 2 ** 17, r: 8, p: 1, maxmem: 160 * 1024 ** 2 };
const guestSalt = randomBytes(24).toString('hex');
const cookie = 'afterframe_session';
const maxAge = 30 * 24 * 60 * 60;
let hashing = false;

const accountByName = db.prepare('SELECT * FROM accounts WHERE username = ?');
const addAccount = db.prepare('INSERT INTO accounts (username, salt, password_hash) VALUES (?, ?, ?)');
const addSession = db.prepare('INSERT INTO sessions (token_hash, account_id, expires) VALUES (?, ?, ?)');
const removeSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
const expireSessions = db.prepare('DELETE FROM sessions WHERE expires <= ?');
const sessionAccount = db.prepare('SELECT accounts.id, accounts.username FROM sessions JOIN accounts ON accounts.id = sessions.account_id WHERE token_hash = ? AND expires > ?');
const listLibrary = db.prepare('SELECT kind, key, value FROM library WHERE account_id = ? ORDER BY rowid');
const setEntry = db.prepare('INSERT INTO library (account_id, kind, key, value) VALUES (?, ?, ?, ?) ON CONFLICT (account_id, kind, key) DO UPDATE SET value = excluded.value');
const removeEntry = db.prepare('DELETE FROM library WHERE account_id = ? AND kind = ? AND key = ?');

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function sessionToken(request) {
  return request.headers.cookie?.match(/(?:^|;\s*)afterframe_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}

function currentAccount(request) {
  const token = sessionToken(request);
  return token ? sessionAccount.get(hashToken(token), Date.now()) : null;
}

function readLibrary(id) {
  const result = { saved: Object.create(null), progress: Object.create(null), ratings: Object.create(null), skips: Object.create(null) };
  for (const row of listLibrary.all(id)) result[row.kind][row.key] = JSON.parse(row.value);
  return result;
}

function status(code, error) {
  return { code, body: { error } };
}

function libraryValue(kind, value, key) {
  if (value === null) return null;
  if (kind === 'saved') return value?.key === key && typeof value.title === 'string' && ['movie', 'tv'].includes(value.type) ? value : undefined;
  if (kind === 'ratings') return Number.isInteger(value?.score) && value.score >= 1 && value.score <= 5 && value.item?.key === key && typeof value.item.title === 'string' && ['movie', 'tv'].includes(value.item.type) ? value : undefined;
  if (kind === 'progress') return Number.isFinite(value?.time) && value.time >= 0 && Number.isFinite(value.duration) && value.duration > value.time && Number.isFinite(value.updated) ? value : undefined;
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
    response.setHeader('Set-Cookie', `${cookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    return { code: 200, body: { account: null } };
  }

  if (path === '/api/account/library') {
    if (!account) return status(401, 'Sign in to update this library.');
    const { accountId, kind, key, value } = body || {};
    if (account.id !== accountId) return status(409, 'The signed-in account changed. Reload to update the library.');
    if (!['saved', 'ratings', 'progress', 'skips'].includes(kind) || typeof key !== 'string' || !/^[a-z0-9][\w.-]*(?:\/[\w-]+)?$/i.test(key) || key.length > 145) return status(400, 'Invalid library entry.');
    const entry = libraryValue(kind, value, key);
    if (entry === undefined) return status(400, 'Invalid library entry.');
    if (entry === null) removeEntry.run(account.id, kind, key);
    else setEntry.run(account.id, kind, key, JSON.stringify(entry));
    return { code: 200, body: { ok: true } };
  }

  if (!['/api/account/create', '/api/account/signin'].includes(path)) return status(404, 'Account action unavailable.');
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = body?.password;
  if (!/^[a-z0-9][a-z0-9_-]{2,29}$/i.test(username) || typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return status(400, 'Enter a valid username and a password of at least 8 characters.');
  }
  if (hashing) return status(429, 'An account request is in progress. Try again in a moment.');
  const existing = accountByName.get(username);
  const creating = path.endsWith('/create');
  if (creating && existing) return status(409, 'That username is already in use.');
  const salt = creating ? randomBytes(24).toString('hex') : existing?.salt || guestSalt;
  let passwordHash;
  hashing = true;
  try { passwordHash = await hashPassword(password, salt, 64, work); } finally { hashing = false; }
  if (!creating && (!existing || !timingSafeEqual(passwordHash, Buffer.from(existing.password_hash, 'hex')))) return status(401, 'Username or password is incorrect.');
  if (creating && accountByName.get(username)) return status(409, 'That username is already in use.');
  const user = creating ? { id: Number(addAccount.run(username, salt, passwordHash.toString('hex')).lastInsertRowid), username }
    : { id: existing.id, username: existing.username };
  const previous = sessionToken(request);
  if (previous) removeSession.run(hashToken(previous));
  const token = randomBytes(32).toString('hex');
  expireSessions.run(Date.now());
  addSession.run(hashToken(token), user.id, Date.now() + maxAge * 1000);
  response.setHeader('Set-Cookie', `${cookie}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`);
  return { code: creating ? 201 : 200, body: { account: user, library: readLibrary(user.id) } };
}
