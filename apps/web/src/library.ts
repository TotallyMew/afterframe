import { withGuestLibraryLock, writeGuestRecords } from '../../../afterframe/public/guest-storage.js';
import type { preferenceDefaults } from '../../../afterframe/public/playback.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { canMarkCompleted, episodeKey, isAired, post, request, RequestError, type Comic, type Details, type Episode, type EpisodePosition, type Title } from './catalog';

export const watchStatuses = {
  planned: 'Plan to Watch',
  watching: 'Watching',
  completed: 'Completed',
  hold: 'On Hold',
  dropped: 'Dropped',
} as const;

export type WatchStatus = keyof typeof watchStatuses;
export type SavedTitle = (Title | Comic) & { added: number; watchStatus?: WatchStatus; completedAt?: number };
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

export type BooleanPreference = keyof typeof preferenceDefaults;
type Preferences = Partial<Record<BooleanPreference | 'captions', boolean> & Record<'subtitleLanguage' | 'audioLanguage' | 'quality', string>>;
export type Reading = { item: Comic; chapter: string; label: string; page: number; language: string; listPage: number; updated: number };
export type History = { item: Title; episode?: EpisodePosition; mediaKey: string; updated: number; duration: number; time: number; coverage: number; completed: boolean };
type Notification = { seriesId: number; title: string; message: string; source?: string; read: boolean; created: number };
export type Library = {
  saved: Record<string, SavedTitle>;
  watched: Record<string, WatchedEntry>;
  ratings: Record<string, PersonalRating>;
  progress: Record<string, Progress>;
  preferences: Preferences;
  reading: Record<string, Reading>;
  history: Record<string, History>;
  notifications: Record<string, Notification>;
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
    reading: readGuest('reading', {}), history: readGuest('history', {}), notifications: {},
  };
}

function guestChange(update: (library: Library) => Library, keys: (keyof Library)[]) {
  return withGuestLibraryLock(() => {
    const current = guestLibrary();
    const next = update(current);
    try {
      writeGuestRecords(keys.map(key => [key, next[key]] as const));
    } catch {
      throw new Error('This browser could not store your change.');
    }
    return next;
  });
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

export function titleCoverage(item: Title, library: Library) {
  if (library.watched[item.key] || library.saved[item.key]?.watchStatus === 'completed') return 100;
  const prefix = `${item.key}/`;
  const completeEpisodes = Object.keys(library.watched).filter(key => key.startsWith(prefix) && !key.startsWith(`${prefix}cinesrc-s0e`)).length;
  const latest = Object.entries(library.progress).filter(([key]) => !library.watched[key] && (key === item.key || key.startsWith(prefix)))
    .sort(([, a], [, b]) => b.updated - a.updated)[0]?.[1];
  const partial = latest ? progressPercent(latest) : 0;
  const total = item.totalEpisodes;
  if (item.type === 'tv' && total && (completeEpisodes || partial)) return Math.max(1, Math.min(100, Math.floor((completeEpisodes + partial / 100) / total * 100)));
  return partial ? Math.min(item.type === 'tv' ? 99 : 100, partial) : completeEpisodes ? 1 : 0;
}

export function guestRecommendations(library: Library) {
  const compact = (item: Title) => ({ key: item.key, id: item.id, title: item.title.slice(0, 120), type: item.type, genreIds: item.genreIds?.slice(0, 12) });
  const latest = <T extends { updated: number }>(records: Record<string, T>, limit: number) =>
    Object.values(records).sort((a, b) => b.updated - a.updated).slice(0, limit);
  const saved = Object.values(library.saved).sort((a, b) => b.added - a.added)
    .filter((item): item is SavedTitle & Title => item.type !== 'comic').slice(0, 75);
  return {
    history: latest(library.history, 60).map(({ item, mediaKey, completed, coverage, duration, updated }) => ({ item: compact(item), mediaKey, completed, coverage, duration, updated })),
    saved: Object.fromEntries(saved.map(item => [item.key, { ...compact(item), watchStatus: item.watchStatus }])),
    ratings: latest(library.ratings, 50).map(({ item, score, scale }) => ({ item: compact(item), score, scale })),
    watched: latest(library.watched, 50).filter(({ item }) => item.type === 'movie').map(({ item }) => ({ item: compact(item) })),
  };
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

type MutationKind = 'saved' | 'watched' | 'ratings' | 'preferences' | 'reading' | 'complete-series' | 'notification';
type DeferredEdit = {
  accountId: number;
  key: string;
  kind: MutationKind;
  label: string;
  at: number;
  expectedAt?: number;
  value: unknown;
};
type UndoableEdit = {
  accountId: number | null;
  kind: 'saved' | 'watched' | 'ratings';
  key: string;
  previous: unknown;
  value: unknown;
  revision?: number;
  label: string;
};

const deferredKey = 'afterframe.deferred-edits';

function readDeferred(): DeferredEdit[] {
  try {
    const entries: unknown = JSON.parse(sessionStorage.getItem(deferredKey) || '[]');
    if (!Array.isArray(entries)) return [];
    return entries.filter(entry => Number.isSafeInteger(entry?.accountId) && typeof entry.key === 'string' &&
      typeof entry.label === 'string' && Number.isSafeInteger(entry.at) && entry.at > Date.now() - 15 * 60_000 &&
      ['saved', 'watched', 'ratings', 'preferences', 'reading', 'complete-series', 'notification'].includes(entry.kind));
  } catch { return []; }
}

function writeDeferred(edits: DeferredEdit[]) {
  try {
    if (edits.length) sessionStorage.setItem(deferredKey, JSON.stringify(edits));
    else sessionStorage.removeItem(deferredKey);
  } catch { /* The tab can still recover while its current document is open. */ }
}

type MutationResponse = { stale?: boolean; saved?: SavedTitle; updated?: number; revision?: number; prior?: unknown };

function deferredPost(edit: DeferredEdit) {
  const { accountId, key, kind, at, value, expectedAt } = edit;
  if (kind === 'complete-series') {
    const data = value as { item: { key: string; type: 'tv'; totalEpisodes?: number }; episodes: string[] };
    return post<MutationResponse>('/api/account/complete-series', { accountId, ...data });
  }
  if (kind === 'notification') return post<MutationResponse>('/api/account/notifications-read', { accountId, key });
  return post<MutationResponse>('/api/account/library', { accountId, kind, key, value, at, expectedAt });
}

export function useLibrary() {
  const [session, setSession] = useState<Session>(() => ({ account: null, library: guestLibrary() }));
  const [state, setState] = useState<'loading' | 'guest' | 'account' | 'expired' | 'unavailable'>('loading');
  const [pending, setPending] = useState<string[]>([]);
  const [completing, setCompleting] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [undoable, setUndoable] = useState<UndoableEdit>();
  const [mutationMessage, setMutationMessage] = useState('');
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [deferred, setDeferred] = useState(readDeferred);
  const [recoveryStatus, setRecoveryStatus] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [replaying, setReplaying] = useState(false);
  const replayingRef = useRef(false);
  const running = useRef(new Set<string>());
  const queuedReading = useRef(new Map<string, { accountId: number | null; entry: Reading }>());
  const revision = useRef(0);
  const identity = useRef<number | null>(null);
  const expiredIdentity = useRef<number | null>(null);
  const ready = state === 'guest' || state === 'account';

  const applyAccount = useCallback((account: ApiAccount['account'], library: ApiAccount['library']) => {
    identity.current = account?.id ?? null;
    expiredIdentity.current = null;
    setSession({ account, library: account
      ? { saved: {}, watched: {}, ratings: {}, progress: {}, preferences: {}, reading: {}, history: {}, notifications: {}, ...library }
      : guestLibrary() });
    setState(account ? 'account' : 'guest');
    setError('');
    setProblems({});
    setUndoable(current => current?.accountId === identity.current ? current : undefined);
  }, []);

  function updateAccount(account: ApiAccount['account'], library: ApiAccount['library']) {
    revision.current++;
    applyAccount(account, library);
    setUndoable(undefined);
    setMutationMessage('');
    setRecoveryStatus('');
    setRecoveryError('');
  }

  const refresh = useCallback(async () => {
    if (running.current.size || replayingRef.current) return;
    const current = ++revision.current;
    try {
      const { account, library } = await request<ApiAccount>('/api/account');
      if (current !== revision.current || running.current.size) return;
      if (!account && expiredIdentity.current !== null) return;
      applyAccount(account, library);
    } catch {
      if (current === revision.current) {
        setState(current => current === 'expired' ? current : 'unavailable');
        setError('Could not verify your session. Your library is read-only until it reconnects.');
      }
    }
  }, [applyAccount]);

  useEffect(() => {
    void refresh();
    const restore = () => { if (!document.hidden) void refresh(); };
    const storage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith('afterframe.')) {
        if (identity.current === null && expiredIdentity.current === null) {
          setSession(current => ({ ...current, library: guestLibrary() }));
        }
      }
    };
    window.addEventListener('pageshow', restore);
    document.addEventListener('visibilitychange', restore);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('pageshow', restore);
      document.removeEventListener('visibilitychange', restore);
      window.removeEventListener('storage', storage);
    };
  }, [refresh]);

  function removeDeferred(edit: DeferredEdit) {
    setDeferred(current => {
      const next = current.filter(entry => entry.accountId !== edit.accountId || entry.key !== edit.key || entry.kind !== edit.kind || entry.at !== edit.at);
      writeDeferred(next);
      return next;
    });
  }

  function holdEdit(edit: DeferredEdit) {
    setDeferred(current => {
      const next = [...current.filter(entry => entry.accountId !== edit.accountId || entry.key !== edit.key || entry.kind !== edit.kind), edit];
      writeDeferred(next);
      return next;
    });
  }

  async function change(key: string, operation: (account: Account | null, send: (edit: DeferredEdit) => ReturnType<typeof deferredPost>) => Promise<(library: Library) => Library>) {
    if (!ready || replayingRef.current || running.current.has(key)) return;
    revision.current++;
    running.current.add(key);
    setPending([...running.current]);
    setProblems(current => ({ ...current, [key]: '' }));
    const owner = session.account;
    let attempted: DeferredEdit | undefined;
    try {
      const update = await operation(owner, edit => { attempted = edit; return deferredPost(edit); });
      if (identity.current === (owner?.id ?? null)) setSession(current => ({ ...current, library: update(current.library) }));
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : 'Could not save this change.';
      if (owner && problem instanceof RequestError && problem.status === 401) {
        expiredIdentity.current = owner.id;
        if (attempted) holdEdit(attempted);
        setState('expired');
        setError(`Your session expired. Sign back in as ${owner.username} to recover your change.`);
        setSession(current => ({ ...current, account: null }));
      }
      if (owner && attempted && (!(problem instanceof RequestError) || problem.status >= 500 || problem.status === 429)) holdEdit(attempted);
      setProblems(current => ({ ...current, [key]: problem instanceof RequestError && problem.status === 403
        ? 'This account does not have permission to make the change.' : message }));
    } finally {
      running.current.delete(key);
      setPending([...running.current]);
    }
  }

  function edit<K extends 'saved' | 'watched' | 'ratings'>(
    kind: K, key: string, value: Library[K][string] | null, label: string, reverse?: UndoableEdit,
  ) {
    setUndoable(undefined);
    setMutationMessage('');
    return change(key, async (account, send) => {
      let prior: unknown = (session.library[kind] as Record<string, unknown>)[key] ?? null;
      let revision: number | undefined;
      const update = (library: Library) => {
        const records = library[kind] as Record<string, Library[K][string]>;
        return { ...library, [kind]: replaceEntry(records, key, value) };
      };
      if (!account) {
        await guestChange(current => {
          prior = (current[kind] as Record<string, unknown>)[key] ?? null;
          if (reverse && JSON.stringify(prior) !== JSON.stringify(reverse.value)) {
            throw new Error('This item changed after your edit. Its newer state was kept.');
          }
          return update(current);
        }, [kind]);
      } else {
        const result = await send({ accountId: account.id, kind, key, value, label, at: Date.now(), expectedAt: reverse?.revision });
        if (result.stale) {
          if (reverse) throw new Error('This item changed after your edit. Its newer state was kept.');
          const { account: owner, library: latest } = await request<ApiAccount>('/api/account');
          if (owner?.id !== account.id || !latest) throw new RequestError('Your session changed.', 401);
          return library => ({ ...library, [kind]: replaceEntry(library[kind] as Record<string, Library[K][string]>, key,
            (latest[kind] as Record<string, Library[K][string]> | undefined)?.[key] ?? null) });
        }
        if ('prior' in result) prior = result.prior;
        revision = result.revision;
      }
      setMutationMessage(reverse ? 'Change undone.' : `${label} · saved`);
      if (!reverse) setUndoable({ accountId: account?.id ?? null, kind, key, previous: prior, value, revision, label });
      return account ? update : guestLibrary;
    });
  }

  function undo(inverse: UndoableEdit) {
    if ((session.account?.id ?? null) !== inverse.accountId || running.current.has(inverse.key)) return;
    return edit(inverse.kind, inverse.key,
      inverse.previous as Library[typeof inverse.kind][string] | null, `Undo ${inverse.label.toLowerCase()}`, inverse);
  }

  function setPreference<K extends keyof Preferences>(key: K, value: NonNullable<Preferences[K]>, label: string) {
    return change(`preference/${key}`, async (account, send) => {
      const update = (library: Library) => ({ ...library, preferences: { ...library.preferences, [key]: value } });
      if (!account) {
        await guestChange(update, ['preferences']);
        return guestLibrary;
      }
      const result = await send({ accountId: account.id, kind: 'preferences', key, value, label, at: Date.now() });
      if (!result.stale) return update;
      const { account: owner, library: latest } = await request<ApiAccount>('/api/account');
      if (owner?.id !== account.id || !latest) throw new RequestError('Your session changed.', 401);
      return library => ({ ...library, preferences: { ...library.preferences, [key]: latest.preferences?.[key] } });
    });
  }

  function recordReading(entry: Reading) {
    if (!ready || replayingRef.current) return;
    const key = entry.item.key;
    const mutationKey = `reading/${key}`;
    const accountId = session.account?.id ?? null;
    queuedReading.current.set(key, { accountId, entry });
    if (running.current.has(mutationKey)) return;
    return change(mutationKey, async (account, send) => {
      try {
        for (let next = queuedReading.current.get(key); next?.accountId === accountId && identity.current === accountId; next = queuedReading.current.get(key)) {
          queuedReading.current.delete(key);
          const value = next.entry;
          const update = (library: Library, stored: Reading | null = value) => ({ ...library, reading: replaceEntry(library.reading, key, stored) });
          if (!account) {
            await guestChange(library => (library.reading[key]?.updated ?? 0) > value.updated ? library : update(library), ['reading']);
            if (identity.current === null && expiredIdentity.current === null) setSession(current => ({ ...current, library: guestLibrary() }));
            continue;
          }
          const result = await send({ accountId: account.id, key, kind: 'reading', value, label: `Save reading position for ${value.item.title}`, at: value.updated });
          let stored: Reading | null = value;
          if (result.stale) {
            const latest = await request<ApiAccount>('/api/account');
            if (latest.account?.id !== account.id || !latest.library) throw new RequestError('Your session changed.', 401);
            stored = latest.library.reading?.[key] ?? null;
          }
          if (identity.current === accountId) setSession(current => ({ ...current, library: update(current.library, stored) }));
        }
      } finally {
        if (queuedReading.current.get(key)?.accountId === accountId) queuedReading.current.delete(key);
      }
      return library => library;
    });
  }

  function toggleSaved(item: Title | Comic) {
    const exists = Boolean(session.library.saved[item.key]);
    if (exists && session.library.preferences.confirmRemoval !== false && !confirm(`Remove “${item.title}” from your ${item.type === 'comic' ? 'reading list' : 'watchlist'}?`)) return;
    return edit('saved', item.key, exists ? null : { ...item, added: Date.now(), ...(item.type !== 'comic' ? { watchStatus: 'planned' as const } : {}) }, `${exists ? 'Remove' : 'Save'} ${item.title}`);
  }

  function toggleWatched(item: Title, key = item.key) {
    if (session.library.watched[key] && session.library.preferences.confirmRemoval !== false && !confirm(`Mark “${item.title}” as unwatched?`)) return;
    return edit('watched', key, session.library.watched[key] ? null : { item, updated: Date.now() }, `Update watched status for ${item.title}`);
  }

  function rate(item: Title, score: number) {
    if (!score && session.library.ratings[item.key] && session.library.preferences.confirmRemoval !== false && !confirm(`Clear your rating for “${item.title}”?`)) return;
    return edit('ratings', item.key, score ? { item, score, scale: 10, updated: Date.now() } : null, `Update rating for ${item.title}`);
  }

  function setStatus(item: Title, value: WatchStatus, details: Details) {
    const saved = session.library.saved[item.key];
    if (!saved || saved.type === 'comic') return;
    if (item.type !== 'tv' || value !== 'completed') {
      return edit('saved', item.key, { ...saved, totalEpisodes: item.totalEpisodes ?? saved.totalEpisodes, watchStatus: value }, `Update watch plan for ${item.title}`);
    }
    setUndoable(undefined);
    setMutationMessage('');
    setCompleting(current => [...current, item.key]);
    return change(item.key, async (account, send) => {
      const seasons = (details.seasons || []).filter(season => season.season_number > 0 && season.episode_count > 0 && isAired(season));
      const aired: Episode[] = [];
      for (let offset = 0; offset < seasons.length; offset += 5) {
        const batch = await Promise.all(seasons.slice(offset, offset + 5).map(season => getSeason(item.id, season.season_number)));
        aired.push(...batch.flat().filter(episode => canMarkCompleted(episode, details.last_episode_to_air)));
      }
      const mediaKeys = aired.map(episode => episodeKey(item, episode));
      if (!mediaKeys.length) throw new Error('No aired episodes are available to mark watched.');
      const positions = mediaKeys.filter(key => session.library.progress[key]).length;
      if (!confirm(`Mark ${mediaKeys.length} aired episodes of “${item.title}” as watched and clear ${positions} saved playback ${positions === 1 ? 'position' : 'positions'}?`)) return library => library;
      const now = Date.now();
      const result = account ? await send({ accountId: account.id, key: item.key, kind: 'complete-series', label: `Complete ${item.title}`, at: now, value: {
        item: { key: item.key, type: item.type, totalEpisodes: item.totalEpisodes },
        episodes: mediaKeys.map(key => key.slice(item.key.length + 1)),
      } }) : {
        saved: { ...saved, totalEpisodes: item.totalEpisodes ?? saved.totalEpisodes, watchStatus: 'completed' as const, completedAt: now },
        updated: now,
      };
      if (!('saved' in result) || !result.saved || !result.updated) throw new Error('The series could not be marked complete.');
      const { saved: completed, updated } = result;
      const update = (library: Library) => {
        const next = { ...library, saved: { ...library.saved, [item.key]: completed }, watched: { ...library.watched }, progress: { ...library.progress } };
        for (const key of mediaKeys) {
          next.watched[key] ??= { item, updated };
          delete next.progress[key];
        }
        return next;
      };
      if (account) return update;
      await guestChange(library => {
        if (!library.saved[item.key]) throw new Error('Save the series before completing it.');
        return update(library);
      }, ['saved', 'watched', 'progress']);
      return guestLibrary;
    }).finally(() => setCompleting(current => current.filter(key => key !== item.key)));
  }

  function markNotification(key: string) {
    return change(key, async (account, send) => {
      if (!account) throw new Error('Sign in to update your notifications.');
      await send({ accountId: account.id, kind: 'notification', key, value: true, label: `Mark notification for ${session.library.notifications[key]?.title ?? 'a series'} as read`, at: Date.now() });
      return library => {
        const item = library.notifications[key];
        return item ? { ...library, notifications: { ...library.notifications, [key]: { ...item, read: true } } } : library;
      };
    });
  }

  async function recover(edit: DeferredEdit) {
    if (identity.current !== edit.accountId || session.account?.id !== edit.accountId || replayingRef.current || running.current.size) return;
    if (edit.at < Date.now() - 15 * 60_000) {
      removeDeferred(edit);
      setRecoveryStatus('That change has expired. You can make it again from the item.');
      return;
    }
    replayingRef.current = true;
    setReplaying(true);
    setRecoveryError('');
    setRecoveryStatus('');
    try {
      const result = await deferredPost(edit);
      removeDeferred(edit);
      setRecoveryStatus(result.stale ? 'A newer change is already saved.' : 'Your change was saved.');
    } catch (error) {
      const status = error instanceof RequestError ? error.status : 0;
      if (status === 401) {
        expiredIdentity.current = edit.accountId;
        setState('expired');
        setSession(current => ({ ...current, account: null }));
        setError('Your session expired again. Sign in to finish your change.');
      } else if (status === 409 || status === 403) {
        setRecoveryError('The signed-in account or library changed. Check that this is still the change you want to make.');
      } else setRecoveryError('Could not save the change. Try again.');
    } finally {
      replayingRef.current = false;
      setReplaying(false);
      void refresh();
    }
  }

  const isPending = (key: string) => pending.includes(key);
  return {
    ...session, ready, state, isPending, completing, problems, error, refresh, toggleSaved, toggleWatched, rate, setStatus, setPreference, recordReading, markNotification,
    updateAccount, libraryBusy: pending.length > 0 || replaying,
    recoverable: session.account ? deferred.filter(edit => session.account?.id === edit.accountId) : [],
    hasDeferredForOtherAccount: Boolean(session.account && deferred.some(edit => session.account?.id !== edit.accountId)),
    recover, removeDeferred, replaying, recoveryStatus, recoveryError, undoable, undo, mutationMessage,
  };
}

export type LibraryControls = ReturnType<typeof useLibrary>;
