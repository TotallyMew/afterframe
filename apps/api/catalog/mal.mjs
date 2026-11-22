import { cacheMetadata } from './metadata.mjs';
import { animeSource } from './anime.mjs';

export async function malRating(type, id, strict = false) {
  const clientId = process.env.MAL_CLIENT_ID?.trim();
  if (!clientId || !['anime', 'manga'].includes(type) || !/^[1-9]\d{0,9}$/.test(String(id))) return null;
  return cacheMetadata(`mal:${type}:${id}`, 24 * 3600000, async () => {
    const response = await fetch(`https://api.myanimelist.net/v2/${type}/${id}?fields=mean`, {
      headers: { 'X-MAL-CLIENT-ID': clientId }, signal: AbortSignal.timeout(4500),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404) return null;
      throw new Error('MyAnimeList is unavailable.');
    }
    const { mean } = await response.json();
    return Number.isFinite(mean) && mean > 0 && mean <= 10 ? mean : null;
  }).catch(error => { if (strict) throw error; return null; });
}

export async function catalogAnimeRating(type, id, season, strict = false) {
  if (!process.env.MAL_CLIENT_ID?.trim()) return null;
  const source = await animeSource(type, id, season, 1).catch(error => { if (strict) throw error; return null; });
  if (!source) return null;
  const mal = await cacheMetadata(`anilist-mal:${source.id}`, 7 * 86400000, async () => {
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'query($id:Int!) { Media(id:$id,type:ANIME) { idMal } }', variables: { id: source.id } }),
      signal: AbortSignal.timeout(5500),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error('AniList is unavailable.'); }
    return (await response.json()).data?.Media?.idMal || null;
  }).catch(error => { if (strict) throw error; return null; });
  return malRating('anime', mal, strict);
}
