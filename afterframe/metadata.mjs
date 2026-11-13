import pg from 'pg';

const database = process.env.DATABASE_URL?.trim();
const pool = database ? new pg.Pool({ connectionString: database, max: 3, connectionTimeoutMillis: 2500, statement_timeout: 3500 }) : null;
pool?.on('error', () => { /* Metadata remains available from TMDb. */ });
const omdbKey = process.env.OMDB_API_KEY?.trim();
const requests = new Map();
const memory = new Map();
let schema;
let quotaDay;
let used = 0;
const refreshWindow = 36 * 3600000;

async function dbQuery(sql, values) {
  if (!pool) return;
  try {
    schema ??= pool.query(`CREATE TABLE IF NOT EXISTS afterframe_metadata (
      cache_key text PRIMARY KEY, payload jsonb NOT NULL, expires_at timestamptz NOT NULL
    )`).catch(error => { schema = undefined; throw error; });
    await schema;
    return await pool.query(sql, values);
  } catch {
    return undefined;
  }
}

export async function cacheMetadata(key, ttl, load, refresh = false) {
  const saved = memory.get(key);
  if (!refresh && saved?.expires > Date.now()) return saved.payload;
  if (requests.has(key)) return requests.get(key);
  const pending = (async () => {
    const result = await dbQuery('SELECT payload, expires_at FROM afterframe_metadata WHERE cache_key = $1', [key]);
    const stored = result?.rows[0];
    if (!refresh && stored?.expires_at > new Date()) {
      if (memory.size >= 600) memory.delete(memory.keys().next().value);
      memory.set(key, { payload: stored.payload, expires: stored.expires_at.getTime() });
      return stored.payload;
    }
    try {
      const payload = await load();
      const expires = Date.now() + ttl;
      if (memory.size >= 600) memory.delete(memory.keys().next().value);
      memory.set(key, { payload, expires });
      await dbQuery(`INSERT INTO afterframe_metadata (cache_key, payload, expires_at) VALUES ($1, $2, $3)
        ON CONFLICT (cache_key) DO UPDATE SET payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at`,
      [key, JSON.stringify(payload), new Date(expires)]);
      return payload;
    } catch (error) {
      if (saved || stored) return saved ? saved.payload : stored.payload;
      throw error;
    }
  })().finally(() => requests.delete(key));
  requests.set(key, pending);
  return pending;
}

export async function imdbRating(id) {
  if (!omdbKey || !/^tt\d{7,12}$/.test(id || '')) return null;
  return cacheMetadata(`imdb:${id}`, 7 * 86400000, async () => {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== quotaDay) { quotaDay = day; used = 0; }
    if (used >= 900) throw new Error('OMDb daily budget reached');
    used++;
    const url = new URL('https://www.omdbapi.com/');
    url.search = new URLSearchParams({ apikey: omdbKey, i: id });
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error('OMDb unavailable');
    const data = await response.json();
    if (data.Response !== 'True') {
      if (/not found/i.test(data.Error || '')) return null;
      throw new Error('OMDb lookup failed');
    }
    const score = Number(data.imdbRating);
    const votes = Number(String(data.imdbVotes || '').replaceAll(',', ''));
    return score > 0 && score <= 10 && Number.isInteger(votes) && votes > 0 ? { score, votes } : null;
  }).catch(() => null);
}

export async function cachedRatings(keys) {
  const ratings = {};
  for (const key of keys) {
    const details = memory.get(`title:${key}:`)?.payload;
    const id = details?.external_ids?.imdb_id || details?.imdb_id;
    const rating = memory.get(`imdb:${id}`)?.payload;
    if (rating) ratings[key.replace(':', '-')] = rating;
  }
  const result = await dbQuery(`SELECT left(substr(t.cache_key, 7), -1) AS title, r.payload
    FROM afterframe_metadata t JOIN afterframe_metadata r ON r.cache_key =
      'imdb:' || COALESCE(t.payload #>> '{external_ids,imdb_id}', t.payload ->> 'imdb_id')
    WHERE t.cache_key = ANY($1::text[]) AND r.payload <> 'null'::jsonb`, [keys.map(key => `title:${key}:`)]);
  for (const row of result?.rows || []) ratings[row.title.replace(':', '-')] = row.payload;
  return ratings;
}

export function refreshMetadataPeriodically(refreshTitle) {
  if (!pool) return;
  const timer = setInterval(async () => {
    const result = await dbQuery(`SELECT cache_key FROM afterframe_metadata
      WHERE (cache_key LIKE 'title:%' OR cache_key LIKE 'imdb:%')
      AND expires_at <= now() AND expires_at >= $1
      ORDER BY expires_at LIMIT 12`, [new Date(Date.now() - refreshWindow)]);
    for (const { cache_key: key } of result?.rows || []) {
      if (key.startsWith('imdb:')) await imdbRating(key.slice(5));
      else await refreshTitle(key).catch(() => {});
    }
  }, 30 * 60000);
  timer.unref();
}
