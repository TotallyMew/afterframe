const mappingUrl = 'https://github.com/anibridge/anibridge-mappings/releases/download/v3/mappings.min.json';
const day = 24 * 60 * 60 * 1000;
const rangePattern = /^([1-9]\d*)(?:-([1-9]\d*|))?$/;
let mapping;
let mappingExpiry = 0;
let mappingRequest;

async function animeMappings() {
  if (mapping && Date.now() < mappingExpiry) return mapping;
  mappingRequest ??= (async () => {
    const response = await fetch(mappingUrl, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Anime episode mappings are temporarily unavailable.');
    }
    const data = await response.json();
    const entries = Object.entries(data).filter(([key]) => /^tmdb_(?:show|movie):/.test(key));
    if (!entries.length) throw new Error('Anime episode mappings are invalid.');
    mapping = new Map(entries);
    mappingExpiry = Date.now() + day;
    return mapping;
  })().catch(error => {
    if (!mapping) throw error;
    mappingExpiry = Date.now() + 5 * 60_000;
    return mapping;
  }).finally(() => { mappingRequest = null; });
  return mappingRequest;
}

function range(value) {
  const match = value.match(rangePattern);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] === undefined ? start : Number(match[2]) || Infinity;
  return end >= start ? { start, end } : null;
}

export function matchAnimeEpisode(targets = {}, episode) {
  const matches = new Map();
  for (const [descriptor, rules] of Object.entries(targets)) {
    const id = descriptor.match(/^anilist:([1-9]\d*)$/)?.[1];
    if (!id) continue;
    for (const [from, to] of Object.entries(rules)) {
      const source = range(from);
      if (!source || episode < source.start || episode > source.end) continue;
      // Split or combined episodes may use a different cut. Only use one-to-one mappings.
      const [intervals, ratio = '1'] = to.split('|');
      const targets = intervals.split(',').map(range);
      if (ratio !== '1' || targets.some(target => !target)) return null;
      const lengths = targets.map(target => target.end - target.start + 1);
      if (lengths.reduce((sum, length) => sum + length, 0) !== source.end - source.start + 1) return null;
      let offset = episode - source.start;
      let index = 0;
      while (offset >= lengths[index]) offset -= lengths[index++];
      const number = targets[index].start + offset;
      matches.set(`${id}/${number}`, { id: Number(id), episode: number });
    }
  }
  return matches.size === 1 ? matches.values().next().value : null;
}

export async function animeSource(type, id, season, episode) {
  const descriptor = type === 'tv' ? `tmdb_show:${id}:s${season}` : `tmdb_movie:${id}`;
  return matchAnimeEpisode((await animeMappings()).get(descriptor), episode);
}
