import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Home } from '../Home';
import type { LibraryControls } from '../library';

function makeControls(): LibraryControls {
  return {
    account: null,
    library: { saved: {}, watched: {}, ratings: {}, progress: {}, preferences: {}, reading: {}, history: {}, notifications: {} },
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
    setStatus: () => undefined,
    setComicStatus: () => undefined,
    setPreference: async () => {},
    recordReading: () => undefined,
    recordProgress: () => {},
    recordHistory: () => {},
    markNotification: async () => {},
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
  };
}

describe('Home cached IMDb rating hydration', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('matches hyphenated keys returned by /api/imdb/cached on Home shelves', async () => {
    const movie = {
      id: 550,
      media_type: 'movie',
      title: 'Fight Club',
      release_date: '1999-10-15',
      poster_path: '/poster.jpg',
      backdrop_path: '/backdrop.jpg',
      overview: 'An insomniac office worker...',
    };
    const show = {
      id: 1396,
      media_type: 'tv',
      name: 'Breaking Bad',
      first_air_date: '2008-01-20',
      poster_path: '/bb.jpg',
      backdrop_path: '/bb-wide.jpg',
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/trending') return new Response(JSON.stringify({ results: [movie, show] }), { status: 200 });
      if (url.startsWith('/api/home?section=')) return new Response(JSON.stringify({ results: [] }), { status: 200 });
      if (url.startsWith('/api/comics/updates')) {
        return new Response(JSON.stringify({
          results: [{ id: 'c-1', key: 'comic-c-1', type: 'comic', title: 'Chainsaw Man', format: 'manga', formatLabel: 'Manga', year: 2018, cover: '/cover.jpg' }],
        }), { status: 200 });
      }
      if (url.startsWith('/api/imdb/cached?')) {
        return new Response(JSON.stringify({ ratings: { 'tv-1396': { score: 9.5, votes: 2100000 } } }), { status: 200 });
      }
      if (url === '/api/movie/550') return new Response(JSON.stringify(movie), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(<Home controls={makeControls()} />);
    await waitFor(() => expect(screen.getByText(/9\.5/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Chainsaw Man')).toBeTruthy());
  });
});
