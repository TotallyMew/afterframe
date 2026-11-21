export type MediaType = 'movie' | 'tv';

export interface CatalogRating {
  score: number;
  votes?: number;
}

export interface RawTitle {
  id: number;
  media_type?: MediaType;
  title?: string;
  name?: string;
  overview?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
  original_language?: string;
  runtime?: number;
  imdb_id?: string;
  external_ids?: { imdb_id?: string };
  catalog_facts?: { rating?: CatalogRating };
}

export interface Title {
  key: string;
  type: MediaType;
  id: number;
  title: string;
  year?: string;
  date?: string;
  description?: string;
  poster?: string;
  backdrop?: string;
  genre?: string;
  genreIds?: number[];
  originalLanguage?: string;
  archiveId?: string;
  duration?: number;
  imdb?: string;
  rating?: CatalogRating;
  totalEpisodes?: number;
}

export interface Comic {
  key: string;
  id: string;
  type: 'comic';
  title: string;
  format?: string;
  year?: number;
  poster?: string;
  status?: string;
  updated?: number;
  genres?: { id: string; name: string }[];
}

export interface Episode {
  season_number: number;
  episode_number: number;
  name: string;
  air_date?: string;
  runtime?: number;
  overview?: string;
  still_path?: string | null;
}

export interface EpisodePosition {
  season: number;
  number: number;
  title?: string;
}

export interface Season {
  season_number: number;
  name: string;
  episode_count: number;
  air_date?: string;
}

export interface Details extends RawTitle {
  status?: string;
  number_of_seasons?: number;
  number_of_episodes?: number;
  seasons?: Season[];
  next_episode_to_air?: Episode | null;
  last_episode_to_air?: Episode | null;
  created_by?: { name: string }[];
  credits?: {
    cast?: { id: number; name: string; character?: string; profile_path?: string | null }[];
    crew?: { id: number; name: string; job: string }[];
  };
}

export interface TitleResults { results: RawTitle[]; nextPage?: number | null; total?: number | null }

export const catalogGenres = [
  'Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family',
  'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance', 'Science Fiction', 'Thriller', 'War', 'Western', 'Anime',
];

export function webHref(route: string) {
  return `/#${route}`;
}

export function routeWithParams(route: string, params: URLSearchParams) {
  return params.size ? `${route}?${params}` : route;
}

const genres: Record<number, string> = {
  12: 'Adventure', 14: 'Fantasy', 16: 'Animation', 18: 'Drama', 27: 'Horror',
  28: 'Action', 35: 'Comedy', 36: 'History', 37: 'Western', 53: 'Thriller',
  80: 'Crime', 99: 'Documentary', 878: 'Science Fiction', 9648: 'Mystery',
  10402: 'Music', 10749: 'Romance', 10751: 'Family', 10752: 'War',
  10759: 'Action & Adventure', 10762: 'Kids', 10765: 'Sci-Fi & Fantasy', 10768: 'War & Politics',
};

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const result = await response.json().catch(() => null);
  if (!response.ok || result === null) {
    throw new Error(result?.error || `Afterframe returned an unexpected response (${response.status}).`);
  }
  return result as T;
}

export function post<T>(path: string, data: unknown) {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    keepalive: path === '/api/account/library',
  });
}

export function imagePath(path: string | null | undefined, size = 'w500') {
  return /^\/[a-z0-9]+\.(jpg|png|webp)$/i.test(path || '') ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;
}

export function normalizeTitle(raw: RawTitle, type = raw.media_type): Title {
  const mediaType = type ?? (raw.first_air_date || raw.name ? 'tv' : 'movie');
  const date = raw.release_date || raw.first_air_date || undefined;
  const genreIds = raw.genre_ids ?? raw.genres?.map(({ id }) => id);
  return {
    key: `${mediaType}-${raw.id}`, type: mediaType, id: raw.id, title: raw.title || raw.name || 'Untitled',
    year: date?.slice(0, 4), date, description: raw.overview,
    poster: imagePath(raw.poster_path), backdrop: imagePath(raw.backdrop_path, 'w1280'),
    genre: raw.genres?.[0]?.name || genres[genreIds?.[0] ?? 0], genreIds,
    originalLanguage: raw.original_language, duration: raw.runtime || undefined,
    imdb: raw.external_ids?.imdb_id || raw.imdb_id, rating: raw.catalog_facts?.rating,
  };
}

export function normalizeTitles(raw: RawTitle[] = []) {
  return raw.map(item => normalizeTitle(item));
}

export function titleHref(item: Pick<Title, 'type' | 'id'>) {
  return `/#${item.type}/${item.id}`;
}

export function legacyHref(route: string, panel?: 'settings' | 'account') {
  return `/legacy/${panel ? `?panel=${panel}` : ''}#${route}`;
}

export function libraryItemHref(item: Title | Comic) {
  if (item.type === 'comic') return webHref(`comic/${encodeURIComponent(item.id)}`);
  if (Number.isSafeInteger(item.id) && item.id > 0 && /^(movie|tv)-\d+$/.test(item.key) && !item.archiveId) return titleHref(item);
  return legacyHref(`edition/${encodeURIComponent(item.key)}`);
}

export function comicCover(poster?: string) {
  return poster?.replace(/^https:\/\/uploads\.mangadex\.org\/covers\/(.+)\.512\.jpg$/, '/comic-cover/$1.256.jpg');
}

export function playHref(item: Pick<Title, 'type' | 'id'>, episode?: EpisodePosition) {
  return legacyHref(`${item.type}/${item.id}/${episode ? `s${episode.season}e${episode.number}` : 'watch'}`);
}

export function resumeHref(item: Title, key: string, episode?: EpisodePosition) {
  if (Number.isInteger(item.id) && /^(movie|tv)-\d+$/.test(item.key) && !item.archiveId && (item.type === 'movie' || episode)) return playHref(item, episode);
  const editionEpisode = key.startsWith(`${item.key}/`) ? key.slice(item.key.length + 1) : '';
  return legacyHref(`edition/${encodeURIComponent(item.key)}/watch${editionEpisode ? `/${encodeURIComponent(editionEpisode)}` : ''}`);
}

export function episodePosition(episode: Episode): EpisodePosition {
  return { season: episode.season_number, number: episode.episode_number, title: episode.name };
}

export function episodeLabel(episode: Episode) {
  return `S${episode.season_number} E${episode.episode_number}`;
}

export function episodeKey(item: Pick<Title, 'key'>, episode: Episode) {
  return `${item.key}/cinesrc-s${episode.season_number}e${episode.episode_number}`;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function isAired(episode: Pick<Episode, 'air_date'>) {
  return !episode.air_date || episode.air_date <= today();
}

export function canMarkCompleted(episode: Episode, last?: Episode | null) {
  return Boolean(episode.air_date && episode.air_date < today()) || (
    (!episode.air_date || episode.air_date === today()) && last != null &&
    (episode.season_number < last.season_number ||
      (episode.season_number === last.season_number && episode.episode_number <= last.episode_number))
  );
}

export function formatDate(date?: string) {
  if (!date) return '';
  const value = new Date(date);
  return Number.isNaN(value.valueOf()) ? '' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(value);
}

export function timeCode(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
