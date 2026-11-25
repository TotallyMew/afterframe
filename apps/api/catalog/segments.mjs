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
  const verified = verifiedCuts[`${searchParams.get('source')}/${type}/${id}/${season}/${episode}`];
  if (verified && Math.abs(verified.durationMs - duration) <= 200) {
    return { status: 200, body: { segments: verified.segments.map(segment => ({ ...segment, end: segment.end ?? duration / 1000 })) } };
  }
  const upstream = new URL('https://api.theintrodb.org/v4/media');
  upstream.search = new URLSearchParams({ tmdb_id: id, type, duration_ms: String(duration), details: 'true', ...(type === 'tv' ? { season, episode } : {}) }).toString();
  const result = await fetch(upstream, { signal: AbortSignal.timeout(6000) });
  if (!result.ok) {
    await result.body?.cancel();
    return { status: 200, body: { segments: [] } };
  }
  const data = await result.json();
  if (data.type !== type || !Number.isFinite(data.group_duration_ms) || Math.abs(data.group_duration_ms - duration) > 2500) {
    return { status: 200, body: { segments: [] } };
  }
  const segments = ['intro', 'recap', 'credits'].flatMap(kind => {
    const candidates = (Array.isArray(data[kind]) ? data[kind] : []).filter(entry => Number.isFinite(entry?.confidence) && entry.confidence >= .5);
    // A tightly clustered timestamp can describe a different cut of nearly the same length.
    if (kind !== 'credits') candidates.sort((a, b) => (b.submission_count ?? 0) - (a.submission_count ?? 0) || b.confidence - a.confidence);
    const matched = candidates.flatMap(entry => {
      if (entry.start_ms != null && !Number.isFinite(entry.start_ms)) return [];
      if (!Number.isFinite(entry.end_ms) && (kind !== 'credits' || entry.end_ms !== null)) return [];
      const start = (entry.start_ms ?? 0) / 1000;
      const end = (entry.end_ms === null ? Number(duration) : Math.min(entry.end_ms, duration)) / 1000;
      return start >= 0 && end > start && (kind !== 'credits' || start >= duration / 2000)
        ? [{ kind, start, end }] : [];
    });
    return kind === 'credits' ? matched.sort((a, b) => a.start - b.start) : matched.slice(0, 1);
  });
  return { status: 200, body: { segments } };
}
