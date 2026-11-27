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
    toggleSaved: async () => true,
    toggleWatched: vi.fn(async () => {}),
    markEpisodesWatched: vi.fn(async () => true),
    rate: async () => true,
    setStatus: async () => true,
    setComicStatus: () => undefined,
    setPreference: vi.fn(async () => true),
    recordReading: () => undefined,
    removeReading: async () => true,
    recordProgress: vi.fn(),
    recordHistory: vi.fn(),
    removeHistory: () => undefined,
    clearHistory: async () => true,
    markNotification: async () => true,
    markAllNotificationsRead: async () => true,
    createFolder: async () => undefined,
    renameFolder: () => undefined,
    deleteFolder: async () => true,
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
    undo: async () => {},
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
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/movie/550/playback', expect.anything()));
    expect(container.querySelector('iframe')).toBeNull();

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

  it('plays anime via EmnexAnime HLS video and falls back to CineSrc when EmnexAnime fails', async () => {
    let failStream = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/tv/95479/playback' || url === '/api/tv/95479') {
        return new Response(JSON.stringify({
          id: 95479, name: 'Jujutsu Kaisen', original_language: 'ja', genres: [{ id: 16, name: 'Animation' }],
          seasons: [{ season_number: 1, name: 'Season 1', episode_count: 2 }],
        }), { status: 200 });
      }
      if (url.startsWith('/api/anime/tv/95479')) {
        return new Response(JSON.stringify({ source: { id: 113415, episode: 1 }, emnex: true }), { status: 200 });
      }
      if (url.startsWith('/api/anime/stream/113415/1')) {
        if (failStream) return new Response(JSON.stringify({ error: 'Unavailable' }), { status: 502 });
        return new Response(JSON.stringify({
          provider: 'HD-2',
          type: 'sub',
          hls: 'https://api.emnexanime.site/hls?u=test',
          subtitles: [{ lang: 'English', url: 'https://api.emnexanime.site/sub?u=en', default: true }],
          intro: { start: 10, end: 90 },
          outro: { start: 1325, end: 1414 },
        }), { status: 200 });
      }
      if (url === 'https://api.emnexanime.site/sub?u=en') {
        return new Response('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello', { status: 200 });
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
    const { container, unmount } = render(<PlayerPage route={route} controls={makeControls()} />);

    await waitFor(() => {
      expect(container.querySelector('video')).not.toBeNull();
      expect(screen.getByText(/EmnexAnime · HD-2 · SUB/)).toBeTruthy();
    });
    expect(container.querySelector('iframe')).toBeNull();
    unmount();

    // When EmnexAnime stream resolution fails, automatically falls back to CineSrc iframe
    failStream = true;
    const { container: fallbackContainer } = render(<PlayerPage route={route} controls={makeControls()} />);
    const cineFrame = await waitFor(() => {
      const node = fallbackContainer.querySelector('iframe');
      expect(node?.src).toContain('https://cinesrc.st/embed/tv/95479');
      return node!;
    });
    expect(cineFrame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-presentation');
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

  it('initializes fullscreen as false, supports EmnexAnime video, and supports Theatre mode & Episodes drawer', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/tv/95479/playback' || url === '/api/tv/95479') {
        return new Response(JSON.stringify({
          id: 95479, name: 'Jujutsu Kaisen', original_language: 'ja', genres: [{ id: 16, name: 'Animation' }],
          seasons: [{ season_number: 1, name: 'Season 1', episode_count: 2 }],
        }), { status: 200 });
      }
      if (url.startsWith('/api/anime/tv/95479')) {
        return new Response(JSON.stringify({ source: { id: 113415, episode: 1 }, emnex: true }), { status: 200 });
      }
      if (url.startsWith('/api/anime/stream/113415/1')) {
        return new Response(JSON.stringify({
          provider: 'HD-1',
          type: 'sub',
          hls: 'https://api.emnexanime.site/hls?u=test',
          subtitles: [],
          intro: null,
          outro: null,
        }), { status: 200 });
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

    await waitFor(() => {
      expect(container.querySelector('video')).not.toBeNull();
    });

    // Theatre mode toggle in persistent topbar
    const theatreBtn = screen.getAllByRole('button', { name: /Theatre/i })[0];
    fireEvent.click(theatreBtn);
    expect(container.querySelector('.af-player-page')?.classList.contains('is-theatre')).toBe(true);

    // Slide-over Episodes drawer opens inside stage
    const episodesBtn = screen.getAllByRole('button', { name: /Episodes/i })[0];
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

  it('portals mobile player settings and episodes as bottom sheets outside .af-video-box on narrow viewports', async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn((query: string) => ({
        matches: query.includes('max-width: 720px'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    try {
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
              { season_number: 1, episode_number: 1, name: 'Pilot', air_date: '2008-01-20' },
              { season_number: 1, episode_number: 2, name: 'Cat\'s in the Bag', air_date: '2008-01-27' },
            ],
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ segments: [] }), { status: 200 });
      });

      const route = parsePlayerRoute('tv/1396/s1e1')!;
      const { container } = render(<PlayerPage route={route} controls={makeControls()} />);
      await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
      const videoBox = container.querySelector('.af-video-box')!;

      // Episodes drawer opens as a portaled bottom sheet outside .af-video-box
      const topbarEpisodesBtn = container.querySelector<HTMLButtonElement>('.af-player-topbar .af-topbar-btn')!;
      fireEvent.click(topbarEpisodesBtn);
      const episodesSheet = await waitFor(() => {
        const node = document.querySelector('.af-episodes-sheet.af-mobile-sheet');
        expect(node).not.toBeNull();
        return node!;
      });
      expect(videoBox.contains(episodesSheet)).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Close episodes' }));

      // Playback settings opens as a portaled bottom sheet outside .af-video-box
      fireEvent.click(screen.getByRole('button', { name: 'Playback settings' }));
      const settingsSheet = await waitFor(() => {
        const node = document.querySelector('.af-player-sheet.af-mobile-sheet');
        expect(node).not.toBeNull();
        return node!;
      });
      expect(videoBox.contains(settingsSheet)).toBe(false);
      expect(screen.getByText('Speed')).toBeTruthy();
    } finally {
      Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: originalMatchMedia });
    }
  });

  it('persists Dub across episodes, disables unavailable Dub, and preserves fullscreen stage on next episode', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const requestedStreams: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/tv/95479/playback' || url === '/api/tv/95479') {
        return new Response(JSON.stringify({
          id: 95479, name: 'Jujutsu Kaisen', original_language: 'ja', genres: [{ id: 16, name: 'Animation' }],
          seasons: [{ season_number: 1, name: 'Season 1', episode_count: 2 }],
        }), { status: 200 });
      }
      if (url.startsWith('/api/anime/tv/95479')) {
        const ep = new URL(url, 'http://localhost').searchParams.get('e') || '1';
        return new Response(JSON.stringify({ source: { id: 113415, episode: Number(ep), idType: 'anilist' }, emnex: true }), { status: 200 });
      }
      if (url.startsWith('/api/anime/stream/113415/')) {
        requestedStreams.push(url);
        const isEp2 = url.includes('/113415/2');
        const wantDub = url.includes('type=dub');
        if (isEp2) {
          // Simulate E2 having Sub only -> server returns sub + fallbackFrom: 'dub' + availableTypes.dub = false
          return new Response(JSON.stringify({
            provider: 'HD-1',
            type: 'sub',
            hls: 'https://api.emnexanime.site/hls?u=ep2sub',
            subtitles: [],
            intro: null,
            outro: null,
            servers: [{ provider: 'HD-1', type: 'sub' }, { provider: 'HD-2', type: 'sub' }],
            availableTypes: { sub: true, dub: false },
            fallbackFrom: wantDub ? 'dub' : undefined,
          }), { status: 200 });
        }
        return new Response(JSON.stringify({
          provider: 'HD-1',
          type: wantDub ? 'dub' : 'sub',
          hls: `https://api.emnexanime.site/hls?u=ep1${wantDub ? 'dub' : 'sub'}`,
          subtitles: [],
          intro: null,
          outro: null,
          servers: [{ provider: 'HD-1', type: 'sub' }, { provider: 'HD-1', type: 'dub' }],
          availableTypes: { sub: true, dub: true },
        }), { status: 200 });
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

    const ep1 = parsePlayerRoute('tv/95479/s1e1')!;
    const ep2 = parsePlayerRoute('tv/95479/s1e2')!;
    const controls = makeControls();
    const { container, rerender } = render(<PlayerPage route={ep1} controls={controls} />);

    await waitFor(() => expect(screen.getByText(/EmnexAnime · HD-1 · SUB/)).toBeTruthy());

    // Select Dub in E1
    fireEvent.click(screen.getByRole('button', { name: 'Dub' }));
    await waitFor(() => expect(screen.getByText(/EmnexAnime · HD-1 · DUB/)).toBeTruthy());

    // Simulate active fullscreen on .af-watch-stage before advancing to E2
    const stage = container.querySelector('.af-watch-stage')!;
    const origFsEl = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
    Object.defineProperty(document, 'fullscreenElement', { value: stage, configurable: true });
    try {
      rerender(<PlayerPage route={ep2} controls={controls} />);
      // E2 must carry over Dub preference and request type=dub
      await waitFor(() => expect(requestedStreams.some(u => u.includes('/113415/2') && u.includes('type=dub'))).toBe(true));
      // E2 is Sub-only -> displays fallback notice and disables Dub (N/A)
      await waitFor(() => expect(screen.getByText(/Dub unavailable for this episode/i)).toBeTruthy());
      const dubBtn = screen.getByRole('button', { name: /Dub \(N\/A\)/i }) as HTMLButtonElement;
      expect(dubBtn.disabled).toBe(true);
      // Switching to another server after Dub->Sub fallback must request type=sub, not type=dub
      fireEvent.click(screen.getByRole('button', { name: 'HD-2' }));
      await waitFor(() => expect(requestedStreams.some(u => u.includes('/113415/2') && u.includes('provider=HD-2') && u.includes('type=sub'))).toBe(true));
      // Same stage stays mounted and fullscreen state carries over into E2
      expect(container.querySelector('.af-watch-stage')).toBe(stage);
      expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeTruthy();
    } finally {
      if (origFsEl) Object.defineProperty(document, 'fullscreenElement', origFsEl);
      else Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    }
  });

  it('marks Forced and SDH subtitle tracks in the menu and lets users filter to Forced tracks', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/movie/273481/playback' || url === '/api/movie/273481') {
        return new Response(JSON.stringify({
          id: 273481, title: 'Sicario', runtime: 121, original_language: 'en', imdb_id: 'tt3397884',
          genres: [{ id: 80, name: 'Crime' }],
        }), { status: 200 });
      }
      if (url.startsWith('https://opensubtitles-v3.strem.io/subtitles/movie/tt3397884.json')) {
        return new Response(JSON.stringify({
          subtitles: [
            {
              id: '1',
              url: 'https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/1001',
              lang: 'eng',
              subtitleFileName: 'Sicario.2015.BluRay.SPARKS.srt',
              movieReleaseName: 'Sicario.2015.BluRay.SPARKS',
            },
            {
              id: '2',
              url: 'https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/1002',
              lang: 'eng',
              subtitleFileName: 'Sicario.2015.BluRay.SPARKS.HI.srt',
              movieReleaseName: 'Sicario.2015.BluRay.SPARKS.HI',
            },
            {
              id: '3',
              url: 'https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/1003',
              lang: 'eng',
              subtitleFileName: 'Sicario.2015.Non English Parts Only.srt',
              movieReleaseName: 'Sicario.2015 (Foreign parts only)',
            },
          ],
        }), { status: 200 });
      }
      if (url.startsWith('https://subs.bright67.online/search')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify({ segments: [] }), { status: 200 });
    });

    const route = parsePlayerRoute('movie/273481/watch')!;
    const { container } = render(<PlayerPage route={route} controls={makeControls()} />);
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());

    const subDetails = container.querySelector<HTMLDetailsElement>('.af-player-subtitles')!;
    subDetails.open = true;
    fireEvent(subDetails, new Event('toggle'));

    await waitFor(() => expect(screen.getByRole('button', { name: 'English · Track 3 Forced' })).toBeTruthy());
    expect(screen.getByTitle('Sicario.2015 (Foreign parts only)')).toBeTruthy();
    expect(screen.getByText('Forced')).toBeTruthy();
    expect(screen.getByText('SDH')).toBeTruthy();

    // Filter down to Forced tracks only
    fireEvent.click(screen.getByRole('button', { name: 'Forced (1)' }));
    expect(screen.queryByRole('button', { name: 'English · Track 1' })).toBeNull();
    expect(screen.getByRole('button', { name: 'English · Track 3 Forced' })).toBeTruthy();
  });
});
