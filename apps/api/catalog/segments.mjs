import { animeSource } from './anime.mjs';
import { cacheMetadata } from './metadata.mjs';

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

const aniSkipKind = { op: 'intro', ed: 'credits', recap: 'recap' };

/**
 * Sanity guard so mis-timed community segments never swallow actual show content.
 * @param {'intro' | 'recap' | 'credits'} kind
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

async function loadAniSkipSegments(type, id, season, episode, durationSec) {
  const mapped = await animeSource(type, id, Number(season || 1), type === 'tv' ? Number(episode) : 1).catch(() => null);
  if (!mapped?.id) return [];
  const malId = await resolveMalId(mapped.id);
  if (!malId) return [];
  const roundedSec = Math.round(durationSec);
  return cacheMetadata(`aniskip:v1:${malId}:${mapped.episode}:${roundedSec}`, 6 * 3600000, async () => {
    const url = new URL(`https://api.aniskip.com/v2/skip-times/${malId}/${mapped.episode}`);
    url.searchParams.append('types', 'op');
    url.searchParams.append('types', 'ed');
    url.searchParams.append('types', 'recap');
    url.searchParams.set('episodeLength', String(durationSec.toFixed(2)));
    const response = await fetch(url, { signal: AbortSignal.timeout(4500) });
    if (!response.ok) {
      await response.body?.cancel();
      return [];
    }
    const payload = await response.json();
    if (!payload?.found || !Array.isArray(payload.results)) return [];
    const found = [];
    for (const entry of payload.results) {
      const kind = aniSkipKind[entry?.skipType];
      const start = Number(entry?.interval?.startTime);
      const end = Math.min(durationSec, Number(entry?.interval?.endTime));
      const reportedLen = Number(entry?.episodeLength);
      if (!kind) continue;
      if (Number.isFinite(reportedLen) && reportedLen > 0 && Math.abs(reportedLen - durationSec) > 3) continue;
      if (!isReasonableSegment(kind, start, end, durationSec)) continue;
      found.push({ kind, start, end, autoSkip: true, source: 'aniskip' });
    }
    return found;
  }).catch(() => []);
}

export async function loadSegments(searchParams) {
  const id = searchParams.get('id') || '';
  const type = searchParams.get('type');
  const duration = Number(searchParams.get('duration'));
  const season = searchParams.get('season') || '';
  const episode = searchParams.get('episode') || '';
  if (!/^\d{1,10}$/.test(id) || !['movie', 'tv'].includes(type) || !Number.isInteger(duration) || duration < 60000 || duration > 86400000
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

  // Try AniSkip first when this title is a mapped anime — AniSkip verifies exact episodeLength.
  const aniSkip = await loadAniSkipSegments(type, id, season, episode, durationSec);
  if (aniSkip.length) {
    return { status: 200, body: { segments: aniSkip } };
  }

  const upstream = new URL('https://api.theintrodb.org/v4/media');
  upstream.search = new URLSearchParams({ tmdb_id: id, type, duration_ms: String(duration), details: 'true', ...(type === 'tv' ? { season, episode } : {}) }).toString();
  const result = await fetch(upstream, { signal: AbortSignal.timeout(6000) });
  if (!result.ok) {
    await result.body?.cancel();
    return { status: 200, body: { segments: [] } };
  }
  const data = await result.json();
  // Strict cut-length tolerance (<= 1.5s) prevents applying timestamps from a differently edited release (e.g. 60m broadcast vs 57:48 stream).
  if (data.type !== type || !Number.isFinite(data.group_duration_ms) || Math.abs(data.group_duration_ms - duration) > 1500) {
    return { status: 200, body: { segments: [] } };
  }
  const segments = ['intro', 'recap', 'credits'].flatMap(kind => {
    const candidates = (Array.isArray(data[kind]) ? data[kind] : []).filter(entry => {
      if (!Number.isFinite(entry?.confidence)) return false;
      const votes = Number(entry?.submission_count ?? 0);
      return entry.confidence >= 0.7 || (votes >= 2 && entry.confidence >= 0.65);
    });
    if (kind !== 'credits') candidates.sort((a, b) => (b.submission_count ?? 0) - (a.submission_count ?? 0) || b.confidence - a.confidence);
    const matched = candidates.flatMap(entry => {
      if (entry.start_ms != null && !Number.isFinite(entry.start_ms)) return [];
      if (!Number.isFinite(entry.end_ms) && (kind !== 'credits' || entry.end_ms !== null)) return [];
      const start = (entry.start_ms ?? 0) / 1000;
      const end = (entry.end_ms === null ? Number(duration) : Math.min(entry.end_ms, duration)) / 1000;
      if (!isReasonableSegment(/** @type {'intro' | 'recap' | 'credits'} */ (kind), start, end, durationSec)) return [];
      const votes = Number(entry.submission_count ?? 0);
      // Auto-skip only on multi-user consensus or very high confidence; single borderline votes remain manual-skip only.
      const autoSkip = (votes >= 2 && entry.confidence >= 0.8) || entry.confidence >= 0.9;
      return [{ kind, start, end, autoSkip, source: 'theintrodb' }];
    });
    return kind === 'credits' ? matched.sort((a, b) => a.start - b.start) : matched.slice(0, 1);
  });
  return { status: 200, body: { segments } };
}
