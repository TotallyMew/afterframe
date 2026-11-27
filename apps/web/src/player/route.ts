import { archiveCatalog, type ArchiveTitle } from '@afterframe/shared/catalog';
import type { Title } from '../catalog';
import { cineSrcServers, type PlayerRoute } from './types';

export const archiveMap = new Map(archiveCatalog.map(entry => [entry.key, entry]));

export function parsePlayerRoute(path: string): PlayerRoute | null {
  const catalogMatch = /^(movie|tv)\/([1-9]\d{0,9})\/(?:(watch)|s(\d{1,4})e([1-9]\d{0,3}))$/.exec(path);
  if (catalogMatch) {
    const [, type, id, watch, season, ep] = catalogMatch;
    if (type === 'movie' && watch) return { kind: 'catalog', type: 'movie', id: Number(id) };
    if (type === 'tv' && season !== undefined && ep !== undefined) {
      return { kind: 'catalog', type: 'tv', id: Number(id), season: Number(season), episode: Number(ep) };
    }
    return null;
  }
  const editionMatch = /^edition\/([\w.-]+)(?:\/(watch)(?:\/([\w-]+))?)?$/.exec(path);
  if (editionMatch) {
    const [, key, watch, episodeKey] = editionMatch;
    return { kind: 'edition', key: decodeURIComponent(key), watch: Boolean(watch), episodeKey: episodeKey ? decodeURIComponent(episodeKey) : undefined };
  }
  return null;
}

export function playerTitleKey(route: PlayerRoute): string {
  if (route.kind === 'catalog') {
    return `player:${route.type}/${route.id}`;
  }
  const mode = route.watch ? 'watch' : 'details';
  return `player:edition/${route.key}/${mode}`;
}

export function archiveToTitle(entry: ArchiveTitle): Title {
  return {
    key: entry.key,
    type: entry.type,
    id: entry.id ?? 0,
    title: entry.title,
    year: entry.year ? String(entry.year) : undefined,
    description: entry.description,
    poster: entry.poster,
    backdrop: entry.backdrop,
    genre: entry.genre,
    archiveId: entry.archiveId,
    duration: entry.duration ?? undefined,
    totalEpisodes: entry.episodes?.length,
  };
}

export function formatClock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(whole / 60);
  const tail = String(whole % 60).padStart(2, '0');
  return mins < 60 ? `${mins}:${tail}` : `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}:${tail}`;
}

export function rememberCineServer(itemKey: string, sourceId: string) {
  if (!sourceId || sourceId.length > 100 || cineSrcServers.get(itemKey) === sourceId) return;
  cineSrcServers.delete(itemKey);
  if (cineSrcServers.size >= 32) {
    const oldest = cineSrcServers.keys().next().value;
    if (oldest) cineSrcServers.delete(oldest);
  }
  cineSrcServers.set(itemKey, sourceId);
}
