import pg from 'pg';

const database = process.env.DATABASE_URL?.trim();
const pool = database ? new pg.Pool({ connectionString: database, max: 3, connectionTimeoutMillis: 2500, statement_timeout: 3500 }) : null;
pool?.on('error', () => { /* Metadata remains available from TMDb. */ });
let omdbKey = process.env.OMDB_API_KEY?.trim();
const requests = new Map();
const memory = new Map();
const writes = new Map();
const missingRatings = new Map();
const missingRatingsLimit = 500;
const missingRatingsTtl = 3 * 60_000;
let schema;
let quotaDay;
let used = 0;
const refreshWindow = 36 * 3600000;

async function dbQuery(sql, values) {
  if (!pool) return;
  try {
    schema ??= pool.query(`CREATE TABLE IF NOT EXISTS afterframe_metadata (
      cache_key text PRIMARY KEY, payload jsonb NOT NULL, expires_at timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS afterframe_metadata_expires ON afterframe_metadata (expires_at)`).catch(error => { schema = undefined; throw error; });
    await schema;
    return await pool.query(sql, values);
  } catch {
    return undefined;
  }
}

const memoryLimit = 600;

function writeMemory(key, payload, expires) {
  memory.delete(key);
  if (memory.size >= memoryLimit) memory.delete(memory.keys().next().value);
  memory.set(key, { payload, expires });
  if (key.startsWith('imdb:') || key.startsWith('title:v2:')) missingRatings.clear();
}

export function peekMetadata(key) {
  const saved = memory.get(key);
  if (!saved || saved.expires <= Date.now()) return undefined;
  memory.delete(key);
  memory.set(key, saved);
  return saved.payload;
}

export function closeMetadataPool() {
  return pool?.end();
}

function persistMetadata(key, payload, expires) {
  if (!pool || (writes.size >= 100 && !writes.has(key))) return;
  const write = (writes.get(key) || Promise.resolve()).then(() => dbQuery(`
    INSERT INTO afterframe_metadata (cache_key, payload, expires_at) VALUES ($1, $2, $3)
    ON CONFLICT (cache_key) DO UPDATE SET payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at`,
  [key, JSON.stringify(payload), new Date(expires)]));
  writes.set(key, write);
  const finish = () => { if (writes.get(key) === write) writes.delete(key); };
  void write.then(finish, finish);
}

export async function cacheMetadata(key, ttl, load, refresh = false) {
  const saved = memory.get(key);
  if (!refresh && saved?.expires > Date.now()) {
    memory.delete(key);
    memory.set(key, saved);
    return saved.payload;
  }
  if (requests.has(key)) return requests.get(key);
  const pending = (async () => {
    const result = await dbQuery('SELECT payload, expires_at FROM afterframe_metadata WHERE cache_key = $1', [key]);
    const stored = result?.rows[0];
    if (!refresh && stored?.expires_at > new Date()) {
      writeMemory(key, stored.payload, stored.expires_at.getTime());
      return stored.payload;
    }
    try {
      const payload = await load();
      const expires = Date.now() + ttl;
      writeMemory(key, payload, expires);
      persistMetadata(key, payload, expires);
      return payload;
    } catch (error) {
      if (saved || stored) return saved ? saved.payload : stored.payload;
      throw error;
    }
  })().finally(() => requests.delete(key));
  requests.set(key, pending);
  return pending;
}

export async function imdbRating(id, strict = false) {
  if (!omdbKey || !/^tt\d{7,12}$/.test(id || '')) return null;
  return cacheMetadata(`imdb:${id}`, 7 * 86400000, async () => {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== quotaDay) { quotaDay = day; used = 0; }
    if (used >= 900) throw new Error('OMDb daily budget reached');
    used++;
    const response = await requestOmdb(omdbKey, id);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('OMDb unavailable');
    }
    const data = await response.json();
    if (data.Response !== 'True') {
      if (/not found/i.test(data.Error || '')) return null;
      throw new Error('OMDb lookup failed');
    }
    const score = Number(data.imdbRating);
    const votes = Number(String(data.imdbVotes || '').replaceAll(',', ''));
    return score > 0 && score <= 10 && Number.isInteger(votes) && votes > 0 ? { score, votes } : null;
  }).catch(error => { if (strict) throw error; return null; });
}

function requestOmdb(key, id) {
  const url = new URL('https://www.omdbapi.com/');
  url.search = new URLSearchParams({ apikey: key, i: id }).toString();
  return fetch(url, { redirect: 'error', signal: AbortSignal.timeout(4000) });
}

export function hasOmdbKey() {
  return Boolean(omdbKey);
}

export function setOmdbKey(key) {
  if (omdbKey === key) return;
  omdbKey = key;
  used = 0;
}

export async function validateOmdbKey(key) {
  const response = await requestOmdb(key, 'tt0111161');
  const data = await response.json().catch(() => null);
  if (response.status === 429 || /limit/i.test(data?.Error || '')) {
    return { status: 429, error: 'OMDb has reached its request limit. Try again later.' };
  }
  if (response.status === 401 || response.status === 403 || /key/i.test(data?.Error || '')) {
    return { status: 401, error: 'OMDb rejected the API key.' };
  }
  if (response.ok && data?.Response === 'True') return null;
  return { status: 502, error: 'OMDb could not verify the API key. Try again later.' };
}

export async function cachedRatings(keys) {
  const ratings = {};
  const now = Date.now();
  const missing = [];
  for (const key of keys) {
    const details = peekMetadata(`title:v2:${key}:`) || peekMetadata(`title:${key}:`) || peekMetadata(`basic:${key}:`);
    const id = details?.external_ids?.imdb_id || details?.imdb_id;
    const rating = peekMetadata(`imdb:${id}`);
    const cardKey = key.replace(':', '-');
    if (rating) {
      ratings[cardKey] = rating;
    } else if ((missingRatings.get(key) || 0) <= now) {
      missing.push(key);
    }
  }
  if (!missing.length) return ratings;
  const result = await dbQuery(`SELECT regexp_replace(t.cache_key, '^(?:title:v2:|title:|basic:)|:$', '', 'g') AS title, r.payload
    FROM afterframe_metadata t JOIN afterframe_metadata r ON r.cache_key =
      'imdb:' || COALESCE(t.payload #>> '{external_ids,imdb_id}', t.payload ->> 'imdb_id')
    WHERE t.cache_key = ANY($1::text[]) AND r.payload <> 'null'::jsonb
    ORDER BY t.expires_at`,
  [missing.flatMap(key => [`title:v2:${key}:`, `title:${key}:`, `basic:${key}:`])]);
  for (const row of result?.rows || []) ratings[row.title.replace(':', '-')] = row.payload;
  if (result) {
    for (const key of missing) {
      if (!ratings[key.replace(':', '-')]) {
        if (missingRatings.size >= missingRatingsLimit) {
          const oldest = missingRatings.keys().next().value;
          if (oldest) missingRatings.delete(oldest);
        }
        missingRatings.set(key, now + missingRatingsTtl);
      }
    }
  }
  return ratings;
}

export function refreshMetadataPeriodically(refreshTitle) {
  if (!pool) return () => {};
  const timer = setInterval(async () => {
    await dbQuery("DELETE FROM afterframe_metadata WHERE expires_at < now() - interval '7 days'");
    const result = await dbQuery(`SELECT cache_key FROM afterframe_metadata
      WHERE (cache_key LIKE 'title:v2:%' OR cache_key LIKE 'imdb:%')
      AND expires_at <= now() AND expires_at >= $1
      ORDER BY expires_at LIMIT 12`, [new Date(Date.now() - refreshWindow)]);
    for (const { cache_key: key } of result?.rows || []) {
      if (key.startsWith('imdb:')) await imdbRating(key.slice(5));
      else await refreshTitle(key).catch(() => {});
    }
  }, 30 * 60000);
  timer.unref();
  return () => clearInterval(timer);
}
