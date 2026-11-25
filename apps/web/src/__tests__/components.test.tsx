import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { previousBrowse } from '../catalog';
import { CatalogProblem, Header } from '../components';
import { parsePlayerRoute } from '../PlayerPage';
import type { LibraryControls } from '../library';

const stubControls = {
  account: null,
  library: { saved: {}, watched: {}, ratings: {}, progress: {}, preferences: {}, reading: {}, history: {}, notifications: {} },
  ready: true,
  state: 'guest',
} as unknown as LibraryControls;

describe('Navigation, shortcuts, and error states', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.location.hash = '';
  });

  it('preserves notifications in previousBrowse() for both legacy hash and clean URLs', () => {
    window.location.hash = '#tv/1396?back=%23notifications';
    expect(previousBrowse('tv')).toBe('/notifications');
    window.location.hash = '';
    window.history.replaceState(null, '', '/tv/1396?back=%2Fnotifications');
    expect(previousBrowse('tv')).toBe('/notifications');
    window.history.replaceState(null, '', '/');
  });

  it('parses catalog and edition playback routes', () => {
    expect(parsePlayerRoute('movie/550/watch')).toEqual({ kind: 'catalog', type: 'movie', id: 550 });
    expect(parsePlayerRoute('tv/1396/s1e2')).toEqual({ kind: 'catalog', type: 'tv', id: 1396, season: 1, episode: 2 });
    expect(parsePlayerRoute('edition/sintel/watch')).toEqual({ kind: 'edition', key: 'sintel', watch: true, episodeKey: undefined });
    expect(parsePlayerRoute('edition/step/watch/dream')).toEqual({ kind: 'edition', key: 'step', watch: true, episodeKey: 'dream' });
    expect(parsePlayerRoute('home')).toBeNull();
  });

  it('opens Search dialog on / shortcut and shows unified video and comic results', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/search?')) {
        return new Response(JSON.stringify({
          results: [{ id: 1396, media_type: 'tv', name: 'Frieren', first_air_date: '2023-09-29', original_language: 'ja', genre_ids: [16] }],
        }), { status: 200 });
      }
      if (url.startsWith('/api/comics?')) {
        return new Response(JSON.stringify({
          results: [{ id: 'c-frieren', key: 'comic-c-frieren', type: 'comic', title: 'Frieren Manga', format: 'manga', formatLabel: 'Manga', year: 2020, malId: 126287 }],
        }), { status: 200 });
      }
      if (url.startsWith('/api/catalog/facts?')) {
        return new Response(JSON.stringify({
          facts: { 'tv-1396': { rating: { score: 8.9, votes: 80000 }, mal: 9.31 } },
        }), { status: 200 });
      }
      if (url.startsWith('/api/mal/manga/batch?')) {
        return new Response(JSON.stringify({
          ratings: { '126287': 8.78 },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(<Header controls={stubControls} route="home" />);
    fireEvent.keyDown(window, { key: '/' });
    const input = await screen.findByRole('combobox', { name: 'Search movies, TV, anime, and comics' });
    fireEvent.change(input, { target: { value: 'Frieren' } });

    await waitFor(() => expect(screen.getByText('Frieren')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Frieren Manga')).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/8\.9/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/9\.31/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/8\.78/)).toBeTruthy());
  });

  it('shows administrator guidance for managed installations in CatalogProblem', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ managedIntegrations: true }), { status: 200 }),
    );
    render(<CatalogProblem error="Connect the catalog in Settings." retry={() => {}} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('server administrator'));
    expect(screen.queryByRole('button', { name: 'Configure catalog' })).toBeNull();
  });
});
