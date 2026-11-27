import { cacheMetadata } from './metadata.mjs';
import { animeMalSource } from './anime.mjs';

const malEndpoints = {
  anime: 'https://api.myanimelist.net/v2/anime/',
  manga: 'https://api.myanimelist.net/v2/manga/',
};

export async function malRating(type, id, strict = false) {
  const clientId = process.env.MAL_CLIENT_ID?.trim();
  const endpoint = Object.hasOwn(malEndpoints, type) ? malEndpoints[type] : null;
  const numericId = Number(id);
  if (!clientId || !endpoint || !Number.isSafeInteger(numericId) || numericId < 1 || numericId > 9_999_999_999) return null;
  const safeId = String(numericId);
  return cacheMetadata(`mal:${type}:${safeId}`, 24 * 3600000, async () => {
    const url = new URL(encodeURIComponent(safeId), endpoint);
    url.searchParams.set('fields', 'mean');
    const response = await fetch(url.href, {
      headers: { 'X-MAL-CLIENT-ID': clientId }, redirect: 'error', signal: AbortSignal.timeout(4500),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404) return null;
      throw new Error('MyAnimeList is unavailable.');
    }
    const { mean } = await response.json();
    return Number.isFinite(mean) && mean > 0 && mean <= 10 ? mean : null;
  }).catch(error => {
    if (strict) {
      throw error;
    }
    return null;
  });
}

export async function catalogAnimeRating(type, id, season, strict = false) {
  if (!process.env.MAL_CLIENT_ID?.trim()) return null;
  const source = await animeMalSource(type, id, season, 1).catch(error => {
    if (strict) {
      throw error;
    }
    return null;
  });
  if (!source?.malId) return null;
  return malRating('anime', source.malId, strict);
}
