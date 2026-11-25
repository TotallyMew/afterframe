import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../ConfirmDialog';
import { computeLibraryStats, type Library, type LibraryControls } from '../library';
import { LibraryPage } from '../LibraryPage';
import { ToastProvider } from '../Toast';

const sampleLibrary: Library = {
  saved: {
    'movie-1': { key: 'movie-1', id: 1, type: 'movie', title: 'Dune', duration: 155, genre: 'Sci-Fi', added: 3000, watchStatus: 'completed' },
    'tv-2': { key: 'tv-2', id: 2, type: 'tv', title: 'Severance', genre: 'Thriller', totalEpisodes: 9, added: 2000, watchStatus: 'watching' },
    'tv-3': { key: 'tv-3', id: 3, type: 'tv', title: 'Frieren', genre: 'Animation', genreIds: [16], originalLanguage: 'ja', totalEpisodes: 28, added: 1000, watchStatus: 'completed' },
    'comic-c1': { key: 'comic-c1', id: 'c1', type: 'comic', title: 'Berserk', format: 'manga', added: 1500, watchStatus: 'watching' },
  },
  watched: {
    'movie-1': { item: { key: 'movie-1', id: 1, type: 'movie', title: 'Dune', duration: 155 }, updated: 3000 },
    'tv-2/cinesrc-s1e1': { item: { key: 'tv-2', id: 2, type: 'tv', title: 'Severance' }, updated: 2500 },
    'tv-3/cinesrc-s1e1': { item: { key: 'tv-3', id: 3, type: 'tv', title: 'Frieren', genreIds: [16], originalLanguage: 'ja' }, updated: 2000 },
    'tv-3/cinesrc-s1e2': { item: { key: 'tv-3', id: 3, type: 'tv', title: 'Frieren', genreIds: [16], originalLanguage: 'ja' }, updated: 2100 },
  },
  ratings: {
    'movie-1': { item: { key: 'movie-1', id: 1, type: 'movie', title: 'Dune' }, score: 9, scale: 10, updated: 3000 },
    'tv-3': { item: { key: 'tv-3', id: 3, type: 'tv', title: 'Frieren', genreIds: [16], originalLanguage: 'ja' }, score: 10, scale: 10, updated: 2500 },
    'comic-c1': { item: { key: 'comic-c1', id: 'c1', type: 'comic', title: 'Berserk' }, score: 10, scale: 10, updated: 2000 },
  },
  progress: {},
  preferences: {},
  reading: {},
  history: {
    'h-1': {
      item: { key: 'movie-1', id: 1, type: 'movie', title: 'Dune' },
      mediaKey: 'movie-1/cinesrc',
      updated: Date.now() - 60_000,
      duration: 9300,
      time: 9300,
      coverage: 9300,
      completed: true,
    },
  },
  notifications: {},
  folders: {
    'f_fav': { id: 'f_fav', name: 'Favorites', color: 'gold', items: ['movie-1', 'tv-3'], created: 100, updated: 100 },
  },
};

function makeControls(overrides: Partial<LibraryControls> = {}): LibraryControls {
  return {
    account: null,
    library: sampleLibrary,
    ready: true,
    state: 'guest',
    isPending: () => false,
    completing: [],
    problems: {},
    error: '',
    refresh: async () => {},
    toggleSaved: async () => {},
    toggleWatched: async () => {},
    rate: async () => {},
    setStatus: async () => {},
    setComicStatus: () => undefined,
    setPreference: async () => {},
    recordReading: () => undefined,
    removeReading: async () => {},
    recordProgress: () => {},
    recordHistory: () => {},
    removeHistory: vi.fn(),
    clearHistory: vi.fn(async () => {}),
    markNotification: async () => {},
    markAllNotificationsRead: vi.fn(async () => {}),
    createFolder: vi.fn(),
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
    toggleFolderItem: vi.fn(),
    importLibrary: async () => ({ totalImported: 0, skipped: 0 }),
    updateAccount: () => {},
    libraryBusy: false,
    recoverable: [],
    hasDeferredForOtherAccount: false,
    recover: async () => {},
    removeDeferred: () => {},
    replaying: false,
    recoveryStatus: '',
    recoveryError: '',
    undoable: undefined,
    undo: () => undefined,
    mutationMessage: '',
    ...overrides,
  };
}

describe('Reworked Library stats, folders, views, ratings, and history', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('computes filterable Library stats across All, Movies, TV Shows, Anime, and Reading', () => {
    const all = computeLibraryStats(sampleLibrary, 'video', '');
    expect(all.totalEntries).toBe(3);
    expect(all.counts.completed).toBe(2);
    expect(all.counts.watching).toBe(1);
    expect(all.episodes).toBe(3);
    expect(all.meanScore).toBe(9.5);

    const movies = computeLibraryStats(sampleLibrary, 'video', 'movie');
    expect(movies.totalEntries).toBe(1);
    expect(movies.counts.completed).toBe(1);
    expect(movies.meanScore).toBe(9);

    const anime = computeLibraryStats(sampleLibrary, 'video', 'anime');
    expect(anime.totalEntries).toBe(1);
    expect(anime.episodes).toBe(2);
    expect(anime.meanScore).toBe(10);

    const reading = computeLibraryStats(sampleLibrary, 'reading');
    expect(reading.totalEntries).toBe(1);
    expect(reading.counts.watching).toBe(1);
    expect(reading.meanScore).toBe(10);
  });

  it('supports custom folders, status filtering, and Grid/List toggle in Library', () => {
    const controls = makeControls();
    render(
      <ConfirmProvider>
        <ToastProvider>
          <LibraryPage path="watchlist" query="" controls={controls} />
        </ToastProvider>
      </ConfirmProvider>,
    );

    expect(screen.getByText('Favorites')).toBeTruthy();
    expect(screen.getByText('Dune')).toBeTruthy();
    expect(screen.getByText('Severance')).toBeTruthy();

    // Switch to List view
    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    expect(screen.getByRole('list', { name: 'Library items' })).toBeTruthy();
    expect(localStorage.getItem('afterframe.library.viewMode')).toBe('list');
  });

  it('renders Ratings distribution and History day groups with delete action', () => {
    const removeHistory = vi.fn();
    const controls = makeControls({ removeHistory });

    const { unmount } = render(
      <ConfirmProvider>
        <ToastProvider>
          <LibraryPage path="ratings" query="" controls={controls} />
        </ToastProvider>
      </ConfirmProvider>,
    );
    expect(screen.getByText('Dune')).toBeTruthy();
    expect(screen.getByText('Berserk')).toBeTruthy();
    unmount();

    render(
      <ConfirmProvider>
        <ToastProvider>
          <LibraryPage path="history" query="" controls={controls} />
        </ToastProvider>
      </ConfirmProvider>,
    );
    expect(screen.getByText('Today')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Dune from history' }));
    expect(removeHistory).toHaveBeenCalledWith('h-1');
  });
});
