import { cacheMetadata } from './metadata.mjs';
import { animeMalSource } from './anime.mjs';

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
  const source = await animeMalSource(type, id, season, 1).catch(error => { if (strict) throw error; return null; });
  if (!source?.malId) return null;
  return malRating('anime', source.malId, strict);
}
