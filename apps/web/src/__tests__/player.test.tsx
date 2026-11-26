import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerPage, parsePlayerRoute, playerTitleKey } from '../PlayerPage';
import type { LibraryControls } from '../library';

function makeControls(overrides: Partial<LibraryControls> = {}): LibraryControls {
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

describe('PlayerPage regressions', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.location.hash = '';
  });

  it('waits for library readiness before mounting playback iframe so resume time applies', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/movie/550/playback' || url === '/api/movie/550') {
        return new Response(JSON.stringify({
          id: 550, title: 'Fight Club', runtime: 139, original_language: 'en', genres: [{ id: 18, name: 'Drama' }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ segments: [] }), { status: 200 });
    });

    const route = parsePlayerRoute('movie/550/watch')!;
    const loadingControls = makeControls({ state: 'loading', ready: false });
    const { rerender, container } = render(<PlayerPage route={route} controls={loadingControls} />);
    expect(container.querySelector('iframe')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    const readyControls = makeControls({
      state: 'account',
      ready: true,
      library: {
        saved: {}, watched: {}, ratings: {}, preferences: { quality: '1080' }, reading: {}, history: {}, notifications: {},
        progress: {
          'movie-550/cinesrc': {
            item: { key: 'movie-550', id: 550, type: 'movie', title: 'Fight Club' },
            time: 325.7,
            duration: 8340,
            updated: Date.now(),
          },
        },
      },
    });
    rerender(<PlayerPage route={route} controls={readyControls} />);

    const iframe = await waitFor(() => {
      const node = container.querySelector('iframe');
      expect(node).not.toBeNull();
      return node!;
    });
    const src = new URL(iframe.src);
    expect(src.origin).toBe('https://cinesrc.st');
    expect(src.searchParams.get('t')).toBe('325');
    expect(src.searchParams.get('quality')).toBe('1080');
  });

  it('does not re-show Loading player or stick paused overlay when details, segments, and timeupdate arrive', async () => {
    let resolveFullDetails!: (res: Response) => void;
    const fullDetailsPromise = new Promise<Response>(resolve => { resolveFullDetails = resolve; });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/movie/550/playback') {
        return new Response(JSON.stringify({
          id: 550, title: 'Fight Club', runtime: 139, original_language: 'en', genres: [{ id: 18, name: 'Drama' }],
        }), { status: 200 });
      }
      if (url === '/api/movie/550') return fullDetailsPromise;
      if (url.startsWith('/api/segments')) {
        return new Response(JSON.stringify({ segments: [{ kind: 'intro', start: 60, end: 120 }] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const controls = makeControls();
    const route = parsePlayerRoute('movie/550/watch')!;
    const { container } = render(<PlayerPage route={route} controls={controls} />);

    const iframe = await waitFor(() => {
      const node = container.querySelector('iframe');
      expect(node).not.toBeNull();
      return node!;
    });
    const postMessage = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage }, configurable: true });

    // Before playback starts, picture overlay must NOT block clicks into iframe
    expect(container.querySelector('.af-video-picture')).toBeNull();
    expect(container.querySelector('.af-embed-loading')).not.toBeNull();

    // CineSrc sends loadedmetadata -> clears loading overlay immediately
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://cinesrc.st',
        source: iframe.contentWindow,
        data: { type: 'cinesrc:loadedmetadata', duration: 8340 },
      }));
    });
    await waitFor(() => expect(container.querySelector('.af-embed-loading')).toBeNull());

    // CineSrc sends advancing timeupdate without explicit play event -> clears paused state & shows picture layer
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://cinesrc.st',
        source: iframe.contentWindow,
        data: { type: 'cinesrc:timeupdate', currentTime: 10, duration: 8340 },
      }));
      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://cinesrc.st',
        source: iframe.contentWindow,
        data: { type: 'cinesrc:timeupdate', currentTime: 11, duration: 8340 },
      }));
    });
    const box = container.querySelector('.af-video-box')!;
    expect(box.classList.contains('is-paused')).toBe(false);
    expect(box.classList.contains('has-played')).toBe(true);
    expect(container.querySelector('.af-video-picture')).not.toBeNull();

    // Full details arrive later -> iframe MUST NOT reload and loading overlay MUST NOT reappear
    const initialIframe = container.querySelector('iframe');
    await act(async () => {
      resolveFullDetails(new Response(JSON.stringify({
        id: 550, title: 'Fight Club', overview: 'An insomniac office worker.', runtime: 139,
        original_language: 'en', genres: [{ id: 18, name: 'Drama' }],
      }), { status: 200 }));
    });
    await waitFor(() => expect(screen.getAllByText('An insomniac office worker.').length).toBeGreaterThan(0));
    expect(container.querySelector('iframe')).toBe(initialIframe);
    await waitFor(() => expect(container.querySelector('.af-embed-loading')).toBeNull());

    // Switching to CineSrc controls preserves current playback timestamp
    fireEvent.click(screen.getByRole('button', { name: /Provider video sources/i }));
    const reloaded = container.querySelector('iframe')!;
    expect(new URL(reloaded.src).searchParams.get('controls')).toBe('true');
    expect(new URL(reloaded.src).searchParams.get('t')).toBe('11');
  });

  it('keeps anime player iframes uncovered, falls back to Ani.pm on error, and sends hello on Ani.pm load', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/tv/95479/playback' || url === '/api/tv/95479') {
        return new Response(JSON.stringify({
          id: 95479, name: 'Jujutsu Kaisen', original_language: 'ja', genres: [{ id: 16, name: 'Animation' }],
          seasons: [{ season_number: 1, name: 'Season 1', episode_count: 2 }],
        }), { status: 200 });
      }
      if (url.startsWith('/api/anime/tv/95479')) {
        return new Response(JSON.stringify({ source: { id: 113415, episode: 1 } }), { status: 200 });
      }
      if (url === '/api/tv/95479/season/1') {
        return new Response(JSON.stringify({
          episodes: [
            { season_number: 1, episode_number: 1, name: 'Ryomen Sukuna', air_date: '2020-10-03' },
            { season_number: 1, episode_number: 2, name: 'For Myself', air_date: '2020-10-10' },
          ],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ segments: [] }), { status: 200 });
    });

    const route = parsePlayerRoute('tv/95479/s1e1')!;
    const { container } = render(<PlayerPage route={route} controls={makeControls()} />);

    const animeFrame = await waitFor(() => {
      const node = container.querySelector('iframe');
      expect(node?.src).toContain('https://animeembed.com/embed/ani/113415/1');
      return node!;
    });
    // Anime iframes must never be covered by .af-embed-loading
    await waitFor(() => expect(container.querySelector('.af-embed-loading')).toBeNull());

    // AnimeEmbed error before ready automatically falls back to Ani.pm
    const animeWin = { postMessage: vi.fn() };
    Object.defineProperty(animeFrame, 'contentWindow', { value: animeWin, configurable: true });
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://animeembed.com',
        source: animeWin as unknown as Window,
        data: { channel: 'animeembed', version: 1, event: 'error' },
      }));
    });

    const anipmFrame = await waitFor(() => {
      const node = container.querySelector('iframe');
      expect(node?.src).toContain('https://ani.pm/embed/ani/113415/1/sub');
      return node!;
    });
    const anipmPost = vi.fn();
    Object.defineProperty(anipmFrame, 'contentWindow', { value: { postMessage: anipmPost }, configurable: true });
    fireEvent.load(anipmFrame);
    expect(anipmPost).toHaveBeenCalledWith(
      { ns: 'anipm.player', v: 1, cmd: 'hello', args: {} },
      'https://ani.pm',
    );
  });

  it('preserves the watch stage element across episode switches on the same TV show', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/tv/1396/playback' || url === '/api/tv/1396') {
        return new Response(JSON.stringify({
          id: 1396, name: 'Breaking Bad', original_language: 'en', genres: [{ id: 18, name: 'Drama' }],
          seasons: [{ season_number: 1, name: 'Season 1', episode_count: 2 }],
        }), { status: 200 });
      }
      if (url === '/api/tv/1396/season/1') {
        return new Response(JSON.stringify({
          episodes: [
            { season_number: 1, episode_number: 1, name: 'Pilot', air_date: '2008-01-20', still_path: '/ep1.jpg' },
            { season_number: 1, episode_number: 2, name: 'Cat\'s in the Bag', air_date: '2008-01-27', still_path: '/ep2.jpg' },
          ],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ segments: [] }), { status: 200 });
    });

    const ep1 = parsePlayerRoute('tv/1396/s1e1')!;
    const ep2 = parsePlayerRoute('tv/1396/s1e2')!;
    expect(playerTitleKey(ep1)).toBe(playerTitleKey(ep2));

    const controls = makeControls();
    const { container, rerender } = render(<PlayerPage route={ep1} controls={controls} />);
    const stage1 = await waitFor(() => {
      const node = container.querySelector('.af-watch-stage');
      expect(node).not.toBeNull();
      return node!;
    });

    rerender(<PlayerPage route={ep2} controls={controls} />);
    await waitFor(() => {
      const iframe = container.querySelector('iframe');
      expect(iframe?.src).toContain('e=2');
    });
    // Same .af-watch-stage DOM node stays mounted so browser fullscreen is never exited
    expect(container.querySelector('.af-watch-stage')).toBe(stage1);
  });

  it('initializes fullscreen as false, enforces strict sandbox on embeds, and supports Theatre mode & Episodes drawer', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/tv/95479/playback' || url === '/api/tv/95479') {
        return new Response(JSON.stringify({
          id: 95479, name: 'Jujutsu Kaisen', original_language: 'ja', genres: [{ id: 16, name: 'Animation' }],
          seasons: [{ season_number: 1, name: 'Season 1', episode_count: 2 }],
        }), { status: 200 });
      }
      if (url.startsWith('/api/anime/tv/95479')) {
        return new Response(JSON.stringify({ source: { id: 113415, episode: 1 } }), { status: 200 });
      }
      if (url === '/api/tv/95479/season/1') {
        return new Response(JSON.stringify({
          episodes: [
            { season_number: 1, episode_number: 1, name: 'Ryomen Sukuna', air_date: '2020-10-03' },
            { season_number: 1, episode_number: 2, name: 'For Myself', air_date: '2020-10-10' },
          ],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ segments: [] }), { status: 200 });
    });

    const route = parsePlayerRoute('tv/95479/s1e1')!;
    const { container } = render(<PlayerPage route={route} controls={makeControls()} />);

    const animeFrame = await waitFor(() => {
      const node = container.querySelector('iframe');
      expect(node?.src).toContain('https://animeembed.com/embed/ani/113415/1');
      return node!;
    });
    expect(animeFrame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-presentation');
    expect(animeFrame.getAttribute('referrerpolicy')).toBe('no-referrer');

    // Theatre mode toggle in persistent topbar
    const theatreBtn = screen.getByRole('button', { name: /Theatre/i });
    fireEvent.click(theatreBtn);
    expect(container.querySelector('.af-player-page')?.classList.contains('is-theatre')).toBe(true);

    // Slide-over Episodes drawer opens inside stage
    const episodesBtn = screen.getByRole('button', { name: /Episodes/i });
    fireEvent.click(episodesBtn);
    expect(container.querySelector('.af-player-drawer')).not.toBeNull();
  });

  it('starts fullscreen button as Fullscreen (never Exit fullscreen) on mount', async () => {
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/movie/550/playback' || url === '/api/movie/550') {
        return new Response(JSON.stringify({
          id: 550, title: 'Fight Club', runtime: 139, original_language: 'en', genres: [{ id: 18, name: 'Drama' }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ segments: [] }), { status: 200 });
    });

    const route = parsePlayerRoute('movie/550/watch')!;
    render(<PlayerPage route={route} controls={makeControls()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Exit fullscreen' })).toBeNull();
  });
});
