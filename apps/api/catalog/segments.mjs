import { animeSource } from './anime.mjs';
import { cacheMetadata } from './metadata.mjs';
import { basicTitle, hasTmdbCredential } from './tmdb.mjs';

const verifiedCuts = {
  // Slow Horses S5E2, checked against the 47:55 CineSrc cut.
  'cinesrc/tv/95480/5/2': {
    durationMs: 2875957,
    segments: [
      { kind: 'intro', start: 490, end: 533.5 },
      { kind: 'credits', start: 2799.678, end: null },
    ],
  },
};

/** @type {Record<string, 'intro' | 'recap' | 'credits'>} */
const aniSkipKind = {
  op: 'intro',
  'mixed-op': 'intro',
  ed: 'credits',
  'mixed-ed': 'credits',
  recap: 'recap',
};

/** @type {readonly ('intro' | 'recap' | 'credits')[]} */
const segmentKinds = ['intro', 'recap', 'credits'];
const imdbIdPattern = /^tt\d{6,10}$/;

/**
 * @typedef {'intro' | 'recap' | 'credits'} SegmentKind
 * @typedef {'verified' | 'aniskip' | 'skipdb' | 'theintrodb' | 'introdb'} SegmentSource
 * @typedef {{ kind: SegmentKind, start: number, end: number, autoSkip: boolean, source: SegmentSource, score: number }} SegmentCandidate
 * @typedef {{ kind: SegmentKind, start: number, end: number, autoSkip: boolean, source: SegmentSource }} SkipSegmentOut
 */

/**
 * Sanity guard so mis-timed community segments never swallow actual show content.
 * @param {SegmentKind} kind
 * @param {number} start
 * @param {number} end
 * @param {number} durationSec
 */
export function isReasonableSegment(kind, start, end, durationSec) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(durationSec) || durationSec <= 0) return false;
  if (start < 0 || end <= start || end > durationSec + 0.5) return false;
  const length = end - start;
  if (length < 5) return false;
  if (kind === 'intro') {
    return length <= 180 && length <= durationSec * 0.16 && start <= durationSec * 0.35;
  }
  if (kind === 'recap') {
    return length <= 240 && length <= durationSec * 0.18 && start <= durationSec * 0.25;
  }
  if (kind === 'credits') {
    return start >= durationSec * 0.65 && length <= durationSec * 0.35;
  }
  return false;
}

/**
 * Merge skip segment candidates from multiple independent databases per kind.
 * Promotes autoSkip when two distinct sources agree on start/end within ±4s.
 * @param {SegmentCandidate[]} candidates
 * @param {number} durationSec
 * @returns {SkipSegmentOut[]}
 */
export function mergeSkipCandidates(candidates, durationSec) {
  const valid = candidates.filter(entry =>
    entry && segmentKinds.includes(entry.kind)
    && isReasonableSegment(entry.kind, entry.start, Math.min(entry.end, durationSec), durationSec),
  ).map(entry => ({
    ...entry,
    end: Math.min(entry.end, durationSec),
  }));

  /** @type {SkipSegmentOut[]} */
  const merged = [];
  for (const kind of segmentKinds) {
    const group = valid.filter(entry => entry.kind === kind);
    if (!group.length) continue;

    // Cross-source consensus: two independent databases agreeing within ±4s boosts score & confirms autoSkip.
    const scored = group.map(entry => {
      const corroborated = group.some(other =>
        other.source !== entry.source
        && Math.abs(other.start - entry.start) <= 4
        && Math.abs(other.end - entry.end) <= 4,
      );
      return {
        ...entry,
        score: entry.score + (corroborated ? 15 : 0),
        autoSkip: entry.autoSkip || corroborated,
      };
    });

    scored.sort((a, b) => b.score - a.score || Number(b.autoSkip) - Number(a.autoSkip));
    const winner = scored[0];

    if (kind === 'credits') {
      // Preserve multiple non-overlapping credit blocks (e.g. mid-credits / post-credits gap) from the winning source.
      const sameSource = scored
        .filter(entry => entry.source === winner.source)
        .sort((a, b) => a.start - b.start);
      /** @type {SegmentCandidate[]} */
      const deduped = [];
      for (const seg of sameSource) {
        const last = deduped[deduped.length - 1];
        if (!last || seg.start >= last.end - 1) deduped.push(seg);
        else if (seg.score > last.score) deduped[deduped.length - 1] = seg;
      }
      for (const seg of deduped) {
        merged.push({ kind: seg.kind, start: seg.start, end: seg.end, autoSkip: seg.autoSkip, source: seg.source });
      }
    } else {
      merged.push({
        kind: winner.kind,
        start: winner.start,
        end: winner.end,
        autoSkip: winner.autoSkip,
        source: winner.source,
      });
    }
  }
  return merged;
}

/** @param {number} anilistId */
async function resolveMalId(anilistId) {
  return cacheMetadata(`anilist-mal:${anilistId}`, 7 * 86400000, async () => {
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'query($id:Int!) { Media(id:$id,type:ANIME) { idMal } }', variables: { id: anilistId } }),
      signal: AbortSignal.timeout(4500),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    return (await response.json()).data?.Media?.idMal || null;
  }).catch(() => null);
}

/**
 * Resolve IMDb ID from cached TMDB basic title metadata.
 * @param {'movie' | 'tv'} type
 * @param {string} id
 * @returns {Promise<string | null>}
 */
async function resolveImdbId(type, id) {
  if (!hasTmdbCredential()) return null;
  const details = await basicTitle(type, id).catch(() => null);
  const raw = details?.imdb_id || details?.external_ids?.imdb_id || '';
  return imdbIdPattern.test(raw) ? raw : null;
}

/**
 * Parse AniSkip v2 response entries into scored candidates.
 * @param {any} payload
 * @param {number} durationSec
 * @returns {SegmentCandidate[]}
 */
export function parseAniSkipPayload(payload, durationSec) {
  if (!payload?.found || !Array.isArray(payload.results)) return [];
  /** @type {SegmentCandidate[]} */
  const found = [];
  for (const entry of payload.results) {
    const skipType = String(entry?.skipType || '');
    const kind = aniSkipKind[skipType];
    const start = Number(entry?.interval?.startTime);
    const rawEnd = Number(entry?.interval?.endTime);
    const reportedLen = Number(entry?.episodeLength);
    if (!kind || !Number.isFinite(start) || !Number.isFinite(rawEnd)) continue;
    const end = Math.min(durationSec, rawEnd);
    const isMixed = skipType.startsWith('mixed-');
    let score = isMixed ? 86 : 98;
    let autoSkip = !isMixed;
    if (Number.isFinite(reportedLen) && reportedLen > 0) {
      const diff = Math.abs(reportedLen - durationSec);
      if (diff > 12) continue;
      if (diff > 3.5) {
        score = isMixed ? 64 : 74;
        autoSkip = false;
      }
    } else {
      score = isMixed ? 60 : 68;
      autoSkip = false;
    }
    if (!isReasonableSegment(kind, start, end, durationSec)) continue;
    found.push({ kind, start, end, autoSkip, source: 'aniskip', score });
  }
  return found;
}

/**
 * AniSkip v2: best-in-class anime opening/ending/recap database (keyed by MAL ID).
 * @param {'movie' | 'tv'} type
 * @param {string} id
 * @param {string} season
 * @param {string} episode
 * @param {number} durationSec
 * @returns {Promise<SegmentCandidate[]>}
 */
async function loadAniSkipSegments(type, id, season, episode, durationSec) {
  const mapped = await animeSource(type, id, Number(season || 1), type === 'tv' ? Number(episode) : 1).catch(() => null);
  if (!mapped?.id) return [];
  const malId = await resolveMalId(mapped.id);
  if (!malId) return [];
  // Fetch with episodeLength=0 so all crowdsourced cuts are returned and scored against durationSec locally.
  const payload = await cacheMetadata(`aniskip:v2:${malId}:${mapped.episode}`, 6 * 3600000, async () => {
    const url = new URL(`https://api.aniskip.com/v2/skip-times/${malId}/${mapped.episode}`);
    for (const skipType of ['op', 'ed', 'recap', 'mixed-op', 'mixed-ed']) {
      url.searchParams.append('types', skipType);
    }
    url.searchParams.set('episodeLength', '0');
    const response = await fetch(url, { signal: AbortSignal.timeout(4500) });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    return response.json();
  }).catch(() => null);
  return parseAniSkipPayload(payload, durationSec);
}

/**
 * Parse SkipDB response into scored candidates.
 * @param {any} data
 * @param {number} durationSec
 * @returns {SegmentCandidate[]}
 */
export function parseSkipDbPayload(data, durationSec) {
  const segs = data?.segments;
  if (!segs || typeof segs !== 'object') return [];
  /** @type {readonly [string, SegmentKind][]} */
  const mapping = [['intro', 'intro'], ['recap', 'recap'], ['outro', 'credits']];
  /** @type {SegmentCandidate[]} */
  const found = [];
  for (const [key, kind] of mapping) {
    const entry = segs[key];
    if (!entry || typeof entry !== 'object') continue;
    const startMs = Number(entry.start_ms ?? (Number.isFinite(entry.start_sec) ? entry.start_sec * 1000 : NaN));
    const endMs = Number(entry.end_ms ?? (Number.isFinite(entry.end_sec) ? entry.end_sec * 1000 : NaN));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    const match = String(entry.match || '');
    const confidence = Number(entry.confidence ?? 0.7);
    const offsetMs = Number(entry.offset_ms ?? 0);
    if (match === 'out-of-range' && Math.abs(offsetMs) > 20000) continue;
    const start = startMs / 1000;
    const end = Math.min(durationSec, endMs / 1000);
    if (!isReasonableSegment(kind, start, end, durationSec)) continue;

    let score = 70;
    let autoSkip = false;
    if (match === 'exact') {
      score = 94 + Math.min(5, confidence * 5);
      autoSkip = confidence >= 0.8;
    } else if (match === 'shifted' || entry.adjusted === true) {
      score = 84 + Math.min(5, confidence * 5);
      autoSkip = confidence >= 0.8;
    } else if (match === 'out-of-range') {
      score = 52;
      autoSkip = false;
    } else {
      score = 72 + Math.min(6, confidence * 6);
      autoSkip = confidence >= 0.85;
    }
    found.push({ kind, start, end, autoSkip, source: 'skipdb', score });
  }
  return found;
}

/**
 * SkipDB (skipdb.tv): duration-aware skip segments with smart offset shifting for movies & TV.
 * @param {'movie' | 'tv'} type
 * @param {string | null} imdbId
 * @param {string} season
 * @param {string} episode
 * @param {number} durationSec
 * @returns {Promise<SegmentCandidate[]>}
 */
async function loadSkipDbSegments(type, imdbId, season, episode, durationSec) {
  if (!imdbId) return [];
  const roundedSec = Math.round(durationSec);
  const cacheKey = `skipdb:v1:${imdbId}:${type === 'tv' ? `${season}:${episode}` : 'movie'}:${roundedSec}`;
  const data = await cacheMetadata(cacheKey, 6 * 3600000, async () => {
    const url = new URL('https://api.skipdb.tv/api/segments');
    url.searchParams.set('imdb_id', imdbId);
    url.searchParams.set('duration', String(roundedSec));
    if (type === 'tv') {
      url.searchParams.set('season', season);
      url.searchParams.set('episode', episode);
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(4500) });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    return response.json();
  }).catch(() => null);
  return parseSkipDbPayload(data, durationSec);
}

/**
 * Parse TheIntroDB v4 response into scored candidates.
 * @param {any} data
 * @param {'movie' | 'tv'} type
 * @param {number} durationMs
 * @returns {SegmentCandidate[]}
 */
export function parseTheIntroDbPayload(data, type, durationMs) {
  if (!data || data.type !== type || !Number.isFinite(data.group_duration_ms)) return [];
  const deltaMs = Math.abs(data.group_duration_ms - durationMs);
  // Reject wildly different cuts (> 10s mismatch); exact <= 2s gets autoSkip eligibility, 2s..10s becomes manual skip.
  if (deltaMs > 10000) return [];
  const exactCut = deltaMs <= 2000;
  const durationSec = durationMs / 1000;
  /** @type {SegmentCandidate[]} */
  const found = [];
  for (const kind of segmentKinds) {
    const entries = Array.isArray(data[kind]) ? data[kind] : [];
    const filtered = entries.filter(entry => {
      if (!Number.isFinite(entry?.confidence)) return false;
      const votes = Number(entry?.submission_count ?? 0);
      return entry.confidence >= 0.65 || (votes >= 2 && entry.confidence >= 0.6);
    });
    if (kind !== 'credits') {
      filtered.sort((a, b) => (b.submission_count ?? 0) - (a.submission_count ?? 0) || b.confidence - a.confidence);
    }
    for (const entry of filtered) {
      if (entry.start_ms != null && !Number.isFinite(entry.start_ms)) continue;
      if (!Number.isFinite(entry.end_ms) && (kind !== 'credits' || entry.end_ms !== null)) continue;
      const start = (entry.start_ms ?? 0) / 1000;
      const end = (entry.end_ms === null ? durationMs : Math.min(entry.end_ms, durationMs)) / 1000;
      if (!isReasonableSegment(kind, start, end, durationSec)) continue;
      const votes = Number(entry.submission_count ?? 0);
      const confidence = Number(entry.confidence);
      const base = exactCut ? 86 : 68;
      const voteBonus = Math.min(8, votes * 2);
      const confBonus = Math.min(6, confidence * 6);
      const autoSkip = exactCut && ((votes >= 2 && confidence >= 0.78) || confidence >= 0.9);
      found.push({ kind, start, end, autoSkip, source: 'theintrodb', score: base + voteBonus + confBonus });
    }
  }
  return found;
}

/**
 * TheIntroDB v4 (theintrodb.org): high-consensus multi-user segments for movies & TV.
 * @param {'movie' | 'tv'} type
 * @param {string} id
 * @param {string} season
 * @param {string} episode
 * @param {number} durationMs
 * @returns {Promise<SegmentCandidate[]>}
 */
async function loadTheIntroDbSegments(type, id, season, episode, durationMs) {
  const roundedSec = Math.round(durationMs / 1000);
  const cacheKey = `theintrodb:v4:${type}:${id}:${type === 'tv' ? `${season}:${episode}` : 'movie'}:${roundedSec}`;
  const data = await cacheMetadata(cacheKey, 6 * 3600000, async () => {
    const upstream = new URL('https://api.theintrodb.org/v4/media');
    upstream.search = new URLSearchParams({
      tmdb_id: id,
      type,
      duration_ms: String(durationMs),
      details: 'true',
      ...(type === 'tv' ? { season, episode } : {}),
    }).toString();
    const response = await fetch(upstream, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    return response.json();
  }).catch(() => null);
  return parseTheIntroDbPayload(data, type, durationMs);
}

/**
 * Parse IntroDB (introdb.app) response into scored candidates.
 * @param {any} data
 * @param {number} durationSec
 * @returns {SegmentCandidate[]}
 */
export function parseIntroDbPayload(data, durationSec) {
  if (!data || typeof data !== 'object') return [];
  /** @type {readonly [string, SegmentKind][]} */
  const mapping = [['intro', 'intro'], ['recap', 'recap'], ['outro', 'credits']];
  /** @type {SegmentCandidate[]} */
  const found = [];
  for (const [key, kind] of mapping) {
    const entry = data[key];
    if (!entry || typeof entry !== 'object') continue;
    const startMs = Number(entry.start_ms ?? (Number.isFinite(entry.start_sec) ? entry.start_sec * 1000 : NaN));
    const endMs = Number(entry.end_ms ?? (Number.isFinite(entry.end_sec) ? entry.end_sec * 1000 : NaN));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    // Reject wildly mismatched episode lengths (> 15s past stream end).
    if (endMs > durationSec * 1000 + 15000) continue;
    const start = startMs / 1000;
    const end = Math.min(durationSec, endMs / 1000);
    if (!isReasonableSegment(kind, start, end, durationSec)) continue;
    const votes = Number(entry.submission_count ?? 1);
    const confidence = Number(entry.confidence ?? 0.7);
    if (confidence < 0.65) continue;
    const score = (votes >= 2 ? 78 : 64) + Math.min(6, confidence * 6);
    const fitsCleanly = endMs <= durationSec * 1000 + 2500;
    // IntroDB does not verify duration server-side; require multi-user high confidence + clean fit for autoSkip.
    const autoSkip = votes >= 2 && confidence >= 0.9 && fitsCleanly;
    found.push({ kind, start, end, autoSkip, source: 'introdb', score });
  }
  return found;
}

/**
 * IntroDB (introdb.app): broad community TV skip timestamps keyed by IMDb ID.
 * @param {'movie' | 'tv'} type
 * @param {string | null} imdbId
 * @param {string} season
 * @param {string} episode
 * @param {number} durationSec
 * @returns {Promise<SegmentCandidate[]>}
 */
async function loadIntroDbSegments(type, imdbId, season, episode, durationSec) {
  if (type !== 'tv' || !imdbId) return [];
  const cacheKey = `introdb:v1:${imdbId}:${season}:${episode}`;
  const data = await cacheMetadata(cacheKey, 6 * 3600000, async () => {
    const url = new URL('https://api.introdb.app/segments');
    url.searchParams.set('imdb_id', imdbId);
    url.searchParams.set('season', season);
    url.searchParams.set('episode', episode);
    const response = await fetch(url, { signal: AbortSignal.timeout(4500) });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    return response.json();
  }).catch(() => null);
  return parseIntroDbPayload(data, durationSec);
}

/** @param {URLSearchParams} searchParams */
export async function loadSegments(searchParams) {
  const id = searchParams.get('id') || '';
  const type = searchParams.get('type');
  const duration = Number(searchParams.get('duration'));
  const season = searchParams.get('season') || '';
  const episode = searchParams.get('episode') || '';
  if (!/^\d{1,10}$/.test(id) || (type !== 'movie' && type !== 'tv') || !Number.isInteger(duration) || duration < 60000 || duration > 86400000
    || (type === 'tv' && (!/^\d{1,4}$/.test(season) || !/^[1-9]\d{0,3}$/.test(episode)))) {
    return { status: 400, body: { error: 'Invalid playback coordinates.' } };
  }
  const durationSec = duration / 1000;
  const verified = verifiedCuts[`${searchParams.get('source')}/${type}/${id}/${season}/${episode}`];
  if (verified && Math.abs(verified.durationMs - duration) <= 200) {
    return {
      status: 200,
      body: {
        segments: verified.segments.map(segment => ({
          ...segment,
          end: segment.end ?? durationSec,
          autoSkip: true,
          source: 'verified',
        })),
      },
    };
  }

  // Resolve IMDb ID from cached TMDB metadata (instant hit during playback) so SkipDB & IntroDB run in parallel with AniSkip & TheIntroDB.
  const imdbPromise = resolveImdbId(type, id);
  const [aniSkipRes, theIntroDbRes, skipDbRes, introDbRes] = await Promise.allSettled([
    loadAniSkipSegments(type, id, season, episode, durationSec),
    loadTheIntroDbSegments(type, id, season, episode, duration),
    imdbPromise.then(imdbId => loadSkipDbSegments(type, imdbId, season, episode, durationSec)),
    imdbPromise.then(imdbId => loadIntroDbSegments(type, imdbId, season, episode, durationSec)),
  ]);

  /** @type {SegmentCandidate[]} */
  const candidates = [
    ...(aniSkipRes.status === 'fulfilled' ? aniSkipRes.value : []),
    ...(theIntroDbRes.status === 'fulfilled' ? theIntroDbRes.value : []),
    ...(skipDbRes.status === 'fulfilled' ? skipDbRes.value : []),
    ...(introDbRes.status === 'fulfilled' ? introDbRes.value : []),
  ];

  return { status: 200, body: { segments: mergeSkipCandidates(candidates, durationSec) } };
}
