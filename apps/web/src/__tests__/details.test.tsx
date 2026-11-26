import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { playbackLanguage } from '@afterframe/shared/subtitles';
import { DetailsPage } from '../Details';
import { ComicDetailsPage } from '../Comics';
import type { LibraryControls } from '../library';

function makeControls(overrides: Partial<LibraryControls> = {}): LibraryControls {
  return {
    account: null,
    library: { saved: {}, watched: {}, ratings: {}, progress: {}, preferences: {}, reading: {}, history: {}, notifications: {}, folders: {} },
    ready: true,
    state: 'guest',
    isPending: () => false,
    completing: [],
    problems: {},
    error: '',
    refresh: async () => {},
    toggleSaved: async () => {},
    toggleWatched: vi.fn(async () => {}),
    rate: async () => {},
    setStatus: async () => {},
    setComicStatus: () => undefined,
    setPreference: vi.fn(async () => {}),
    recordReading: () => undefined,
    removeReading: async () => {},
    recordProgress: vi.fn(),
    recordHistory: vi.fn(),
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
    ...overrides,
  };
}

describe('DetailsPage & ComicDetailsPage regressions', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('defaults to Season 1 (never Specials S0), orders Specials last, renders PNG logo & Trailer, and links Play S1 E1 immediately', async () => {
    window.history.replaceState(null, '', '/tv/1405');
    let resolveSeason1!: (res: Response) => void;
    const pendingSeason1 = new Promise<Response>(resolve => { resolveSeason1 = resolve; });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/tv/1405') {
        return new Response(JSON.stringify({
          id: 1405,
          name: 'Dexter',
          first_air_date: '2006-10-01',
          last_episode_to_air: { air_date: '2013-09-22' },
          status: 'Ended',
          number_of_seasons: 2,
          number_of_episodes: 24,
          overview: 'Miami blood spatter analyst with a dark secret.',
          backdrop_path: '/dexterbg.jpg',
          genres: [{ id: 80, name: 'Crime' }],
          seasons: [
            { season_number: 0, name: 'Specials', episode_count: 85 },
            { season_number: 2, name: 'Season 2', episode_count: 12 },
            { season_number: 1, name: 'Season 1', episode_count: 12 },
          ],
          images: { logos: [{ file_path: '/dexterlogo.png', iso_639_1: 'en', vote_average: 9 }] },
          videos: { results: [{ id: 'v1', key: 'YQeUmSD1c3g', name: 'Official Trailer', site: 'YouTube', type: 'Trailer', official: true }] },
          credits: { cast: [{ id: 1, name: 'Michael C. Hall', character: 'Dexter Morgan' }], crew: [] },
        }), { status: 200 });
      }
      if (url === '/api/tv/1405/season/1') return pendingSeason1;
      if (url === '/api/tv/1405/related') return new Response(JSON.stringify({ results: [] }), { status: 200 });
      if (url === '/api/tv/1405/ratings-map') return new Response(JSON.stringify({ seasons: [] }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const { container } = render(<DetailsPage type="tv" id={1405} controls={makeControls()} />);

    // Primary CTA must be an immediate link to /tv/1405/s1e1 even while Season 1 is still loading!
    const playLink = await waitFor(() => {
      const el = screen.getByRole('link', { name: /Play S1 E1/i });
      return el as HTMLAnchorElement;
    });
    expect(playLink.getAttribute('href')).toContain('/tv/1405/s1e1');

    // Season tabs must order Season 1, Season 2, then Specials last — with Season 1 selected by default
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(t => t.textContent)).toEqual(['Season 1', 'Season 2', 'Specials']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');

    // PNG logo + accessible sr-only H1 + Trailer button
    expect(container.querySelector('img.af-title-logo')?.getAttribute('src')).toContain('/dexterlogo.png');
    expect(screen.getByRole('button', { name: /Trailer/i })).toBeTruthy();

    resolveSeason1(new Response(JSON.stringify({
      episodes: [{ season_number: 1, episode_number: 1, name: 'Dexter', air_date: '2006-10-01', runtime: 53 }],
    }), { status: 200 }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Dexter' })).toBeTruthy());
  });

  it('displays Manga chapter count directly inside the hero metadata facts bar', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/comics/manga-1') {
        return new Response(JSON.stringify({
          id: 'manga-1',
          key: 'comic-manga-1',
          type: 'comic',
          format: 'manga',
          title: 'Vagabond',
          year: 1998,
          status: 'hiatus',
          lastChapter: '327',
          author: ['Takehiko Inoue'],
          genres: [{ id: 'g1', name: 'Action' }],
          languages: ['en'],
          defaultLanguage: 'en',
        }), { status: 200 });
      }
      if (url.startsWith('/api/comics/manga-1/chapters')) {
        return new Response(JSON.stringify({
          results: [{ id: 'ch-1', label: 'Chapter 1', number: '1', language: 'en' }],
          totalChapters: 327,
        }), { status: 200 });
      }
      if (url === '/api/comics/manga-1/related') return new Response(JSON.stringify({ results: [] }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const { container } = render(<ComicDetailsPage id="manga-1" query="" controls={makeControls()} />);

    const chapterLink = await waitFor(() => {
      const el = container.querySelector('.af-title-facts a.af-fact-link');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(chapterLink.textContent).toBe('327 chapters');
    expect(chapterLink.getAttribute('href')).toBe('#chapters');
  });

  it('normalizes legacy OpenSubtitles ISO-639-2/B codes like pob to human-readable names', () => {
    expect(playbackLanguage('pob')).toBe('Portuguese (Brazil)');
    expect(playbackLanguage('scc')).toBe('Serbian');
    expect(playbackLanguage('rum')).toBe('Romanian');
    expect(playbackLanguage('en')).toBe('English');
  });
});
