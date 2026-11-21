import { useCallback, useEffect, useRef, useState } from 'react';
import { canMarkCompleted, episodeKey, isAired, post, request, type Details, type Episode, type EpisodePosition, type Title } from './catalog';

export const watchStatuses = {
  planned: 'Plan to Watch',
  watching: 'Watching',
  completed: 'Completed',
  hold: 'On Hold',
  dropped: 'Dropped',
} as const;

export type WatchStatus = keyof typeof watchStatuses;
type SavedTitle = Title & { added: number; watchStatus?: WatchStatus; completedAt?: number };
type WatchedEntry = { item: Title; updated: number };
type PersonalRating = { item: Title; score: number; scale?: number; updated: number };
export type Progress = {
  item: Title;
  episode?: EpisodePosition;
  time: number;
  duration: number;
  updated: number;
  ranges?: [number, number][];
};

type Preferences = Partial<Record<'resume' | 'blur' | 'hideSynopsis' | 'confirmRemoval' | 'compact', boolean>>;
type Library = {
  saved: Record<string, SavedTitle>;
  watched: Record<string, WatchedEntry>;
  ratings: Record<string, PersonalRating>;
  progress: Record<string, Progress>;
  preferences: Preferences;
};
type Account = { id: number; username: string };
type Session = { account: Account | null; library: Library };
type ApiAccount = { account: Account | null; library: Partial<Library> | null };

function readGuest<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(`afterframe.${key}`) || 'null') ?? fallback; }
  catch { return fallback; }
}

function guestLibrary(): Library {
  return {
    saved: readGuest('saved', {}), watched: readGuest('watched', {}),
    ratings: readGuest('ratings', {}), progress: readGuest('progress', {}),
    preferences: readGuest('preferences', {}),
  };
}

function writeGuest<K extends keyof Library>(library: Library, keys: K[]) {
  for (const key of keys) localStorage.setItem(`afterframe.${key}`, JSON.stringify(library[key]));
}

export function savedRating(entry?: PersonalRating) {
  return entry ? entry.score * (entry.scale === 10 ? 1 : 2) : 0;
}

export function resumeEntries(library: Library) {
  if (library.preferences.resume === false) return [];
  return Object.entries(library.progress)
    .filter(([key, entry]) => entry.item?.key && entry.time > 5 && entry.duration - entry.time > 2 &&
      !library.watched[key] && !library.watched[entry.item.key])
    .sort(([, a], [, b]) => b.updated - a.updated);
}

export function resumeFor(library: Library, item: Title) {
  return resumeEntries(library).find(([key, value]) => value.item.key === item.key &&
    (item.type === 'movie' ? key === `${item.key}/cinesrc` : value.episode && Number.isInteger(value.episode.season) && Number.isInteger(value.episode.number)))?.[1];
}

export function progressPercent(entry: Progress) {
  const seconds = (entry.ranges ?? []).reduce((sum, [from, to]) => sum + Math.max(0, Math.min(entry.duration, to) - Math.max(0, from)), 0);
  return entry.duration > 0 ? Math.min(100, Math.floor(seconds / entry.duration * 100)) : 0;
}

export async function getSeason(id: number, season: number, signal?: AbortSignal) {
  const result = await request<{ episodes: Episode[] }>(`/api/tv/${id}/season/${season}`, { signal });
  return result.episodes ?? [];
}

function replaceEntry<T>(records: Record<string, T>, key: string, value: T | null) {
  const next = { ...records };
  if (value === null) delete next[key];
  else next[key] = value;
  return next;
}

export function useLibrary() {
  const [session, setSession] = useState<Session>(() => ({ account: null, library: guestLibrary() }));
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const revision = useRef(0);

  const refresh = useCallback(async () => {
    if (running.current) return;
    const current = ++revision.current;
    try {
      const { account, library } = await request<ApiAccount>('/api/account');
      if (current !== revision.current) return;
      setSession({ account, library: account ? { saved: {}, watched: {}, ratings: {}, progress: {}, preferences: {}, ...library } : guestLibrary() });
      setReady(true);
      setError('');
    } catch {
      if (current === revision.current) setError('Could not load your library. Reload to try again.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const restore = (event: PageTransitionEvent) => { if (event.persisted) void refresh(); };
    window.addEventListener('pageshow', restore);
    return () => window.removeEventListener('pageshow', restore);
  }, [refresh]);

  async function change(operation: (current: Session) => Promise<Library>) {
    if (!ready || running.current) return;
    const current = ++revision.current;
    running.current = true;
    setSaving(true);
    setError('');
    try {
      const library = await operation(session);
      if (current === revision.current) setSession({ ...session, library });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not save this change.');
    } finally {
      running.current = false;
      setSaving(false);
    }
  }

  function edit<K extends 'saved' | 'watched' | 'ratings'>(kind: K, key: string, value: Library[K][string] | null) {
    return change(async ({ account, library }) => {
      const records = library[kind] as Record<string, Library[K][string]>;
      const next = { ...library, [kind]: replaceEntry(records, key, value) };
      if (account) {
        const result = await post<{ stale?: boolean }>('/api/account/library', { accountId: account.id, kind, key, value, at: Date.now() });
        if (result.stale) {
          const { account: owner, library: latest } = await request<ApiAccount>('/api/account');
          if (owner?.id !== account.id || !latest) throw new Error('Your session changed. Reload and try again.');
          return { ...library, ...latest };
        }
      } else writeGuest(next, [kind]);
      return next;
    });
  }

  function toggleSaved(item: Title) {
    const exists = Boolean(session.library.saved[item.key]);
    if (exists && session.library.preferences.confirmRemoval !== false && !confirm('Remove this title from your watchlist?')) return;
    return edit('saved', item.key, exists ? null : { ...item, added: Date.now(), watchStatus: 'planned' });
  }

  function toggleWatched(item: Title, key = item.key) {
    return edit('watched', key, session.library.watched[key] ? null : { item, updated: Date.now() });
  }

  function rate(item: Title, score: number) {
    return edit('ratings', item.key, score ? { item, score, scale: 10, updated: Date.now() } : null);
  }

  function setStatus(item: Title, value: WatchStatus, details: Details) {
    const saved = session.library.saved[item.key];
    if (!saved) return;
    if (item.type !== 'tv' || value !== 'completed') {
      return edit('saved', item.key, { ...saved, totalEpisodes: item.totalEpisodes ?? saved.totalEpisodes, watchStatus: value });
    }
    return change(async ({ account, library }) => {
      const seasons = (details.seasons || []).filter(season => season.season_number > 0 && season.episode_count > 0 && isAired(season));
      const aired: Episode[] = [];
      for (let offset = 0; offset < seasons.length; offset += 5) {
        const batch = await Promise.all(seasons.slice(offset, offset + 5).map(season => getSeason(item.id, season.season_number)));
        aired.push(...batch.flat().filter(episode => canMarkCompleted(episode, details.last_episode_to_air)));
      }
      const mediaKeys = aired.map(episode => episodeKey(item, episode));
      const now = Date.now();
      const result = account ? await post<{ saved: SavedTitle; updated: number }>('/api/account/complete-series', {
        accountId: account.id,
        item: { key: item.key, type: item.type, totalEpisodes: item.totalEpisodes },
        episodes: mediaKeys.map(key => key.slice(item.key.length + 1)),
      }) : {
        saved: { ...saved, totalEpisodes: item.totalEpisodes ?? saved.totalEpisodes, watchStatus: 'completed' as const, completedAt: now },
        updated: now,
      };
      const next = { ...library, saved: { ...library.saved, [item.key]: result.saved }, watched: { ...library.watched }, progress: { ...library.progress } };
      for (const key of mediaKeys) {
        next.watched[key] ??= { item, updated: result.updated };
        delete next.progress[key];
      }
      if (!account) writeGuest(next, ['saved', 'watched', 'progress']);
      return next;
    });
  }

  return { ...session, ready, saving, error, refresh, toggleSaved, toggleWatched, rate, setStatus };
}

export type LibraryControls = ReturnType<typeof useLibrary>;
