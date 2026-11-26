import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Home, trimOverview } from '../Home';
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
    setStatus: async () => {},
    setComicStatus: () => undefined,
    setPreference: async () => {},
    recordReading: () => undefined,
    removeReading: async () => {},
    recordProgress: () => {},
    recordHistory: () => {},
    removeHistory: () => undefined,
    clearHistory: async () => {},
    markNotification: async () => {},
    markAllNotificationsRead: async () => {},
    createFolder: () => undefined,
    renameFolder: () => undefined,
    deleteFolder: () => undefined,
    toggleFolderItem: () => undefined,
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

  it('allows expanding and collapsing long featured hero descriptions via the inline more/less button', async () => {
    const longOverview = 'Return to the world of Panem 24 years before Katniss Everdeen volunteers in her sister\'s place, commencing on the morning of the reaping of the 50th Hunger Games, also known as the Second Quarter Quell, where twice as many tributes are taken from every district across Panem.';
    const movie = {
      id: 999,
      media_type: 'movie',
      title: 'Sunrise on the Reaping',
      release_date: '2025-11-20',
      poster_path: '/poster.jpg',
      backdrop_path: '/backdrop.jpg',
      overview: longOverview,
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/trending') return new Response(JSON.stringify({ results: [movie] }), { status: 200 });
      if (url.startsWith('/api/home?section=')) return new Response(JSON.stringify({ results: [] }), { status: 200 });
      if (url.startsWith('/api/comics')) return new Response(JSON.stringify({ results: [] }), { status: 200 });
      if (url.startsWith('/api/imdb')) return new Response(JSON.stringify({ ratings: {} }), { status: 200 });
      if (url === '/api/movie/999') return new Response(JSON.stringify(movie), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(<Home controls={makeControls()} />);
    const moreBtn = await screen.findByRole('button', { name: 'more' });
    expect(moreBtn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(/twice as many tributes/)).toBeNull();

    fireEvent.click(moreBtn);
    const lessBtn = await screen.findByRole('button', { name: 'less' });
    expect(lessBtn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/twice as many tributes/)).toBeTruthy();

    fireEvent.click(lessBtn);
    expect(await screen.findByRole('button', { name: 'more' })).toBeTruthy();
  });

  it('fetches /api/trending?type=tv when filtering Trending this week to TV Shows', async () => {
    const movie = { id: 550, media_type: 'movie', title: 'Fight Club', release_date: '1999-10-15', backdrop_path: '/m.jpg' };
    const tvShow = { id: 1396, media_type: 'tv', name: 'Severance', first_air_date: '2022-02-18', backdrop_path: '/tv.jpg' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/trending') return new Response(JSON.stringify({ results: [movie] }), { status: 200 });
      if (url === '/api/trending?type=tv') return new Response(JSON.stringify({ results: [tvShow] }), { status: 200 });
      if (url.startsWith('/api/home?section=')) return new Response(JSON.stringify({ results: [] }), { status: 200 });
      if (url.startsWith('/api/comics')) return new Response(JSON.stringify({ results: [] }), { status: 200 });
      if (url.startsWith('/api/imdb/cached')) return new Response(JSON.stringify({ ratings: {} }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(<Home controls={makeControls()} />);
    const tvBtn = await screen.findByRole('button', { name: 'TV Shows' });
    fireEvent.click(tvBtn);
    await waitFor(() => expect(screen.getByText('Severance')).toBeTruthy());
    expect(fetchSpy).toHaveBeenCalledWith('/api/trending?type=tv', expect.anything());
  });

  it('trims long hero overviews cleanly without mid-phrase dangling articles', () => {
    const raw = 'Return to the world of Panem 24 years before Katniss Everdeen volunteers in her sister’s place, commencing on the morning of the reaping of the 50th Hunger Games, also known as the Second Quarter Quell.';
    const trimmed = trimOverview(raw, 180);
    expect(trimmed.endsWith('the…')).toBe(false);
    expect(trimmed.endsWith('the.')).toBe(false);
    expect(trimmed.length).toBeLessThanOrEqual(181);
  });
});
