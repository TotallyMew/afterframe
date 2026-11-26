import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Catalogue } from '../Catalogue';
import { Header } from '../components';
import { buildLibraryExport, parseLibraryImport, type LibraryControls } from '../library';
import { LibraryPage } from '../LibraryPage';
import { normalizeRouteString, searchHref, webHref } from '../router';
import { SettingsProvider } from '../Settings';
import { useSettings } from '../settings-context';
import { ShortcutsDialog } from '../ShortcutsDialog';
import { ToastProvider, useToast } from '../Toast';

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
    ...overrides,
  };
}

describe('Afterframe web enhancements', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('normalizes legacy hash routes and builds clean URLs', () => {
    expect(webHref('home')).toBe('/');
    expect(webHref('movies')).toBe('/movies');
    expect(normalizeRouteString('#search=dune?type=comic')).toBe('search?type=comic&q=dune');
    expect(webHref('search=dune?type=comic')).toBe('/search?type=comic&q=dune');
    expect(searchHref('matrix', { type: 'movie' })).toBe('/search?q=matrix&type=movie');
  });

  it('surfaces My Library matches and quick commands inside the Command Palette', async () => {
    const controls = makeControls({
      library: {
        saved: {
          'movie-603': { key: 'movie-603', id: 603, type: 'movie', title: 'The Matrix', added: 1000, watchStatus: 'planned' },
        },
        watched: {}, ratings: {}, progress: {}, preferences: {}, reading: {}, history: {}, notifications: {},
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));

    render(<Header controls={controls} route="home" />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

    // Empty query shows quick commands
    expect(await screen.findByText('Keyboard shortcuts')).toBeTruthy();

    // Typing matches saved library items instantaneously
    const input = screen.getByRole('combobox', { name: 'Search movies, TV, anime, and manga' });
    fireEvent.change(input, { target: { value: 'Matrix' } });
    expect(await screen.findByText('The Matrix')).toBeTruthy();
    expect(screen.getByText(/In Library/)).toBeTruthy();
  });

  it('displays unified toasts with Undo actions', async () => {
    const onUndo = vi.fn();
    function Trigger() {
      const { notify } = useToast();
      return <button type="button" onClick={() => notify({ message: 'Saved Dune', tone: 'success', action: { label: 'Undo', onAction: onUndo } })}>Trigger</button>;
    }
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    expect(await screen.findByText('Saved Dune')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Saved Dune')).toBeNull());
  });

  it('opens keyboard shortcuts dialog on ? key', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return <ShortcutsDialog open={open} onOpenChange={setOpen} />;
    }
    render(<Harness />);
    fireEvent.keyDown(window, { key: '?' });
    expect(await screen.findByText('Keyboard shortcuts')).toBeTruthy();
    expect(screen.getByText('Open search & command palette')).toBeTruthy();
  });

  it('renders reworked Library heading, filterable stats bar, and live-filters without Apply button or JSON export/import', async () => {
    const controls = makeControls({
      library: {
        saved: {
          'movie-1': { key: 'movie-1', id: 1, type: 'movie', title: 'Interstellar', duration: 169, added: 2000, watchStatus: 'completed' },
          'tv-2': { key: 'tv-2', id: 2, type: 'tv', title: 'Severance', added: 1000, watchStatus: 'watching' },
        },
        watched: {},
        ratings: {
          'movie-1': { item: { key: 'movie-1', id: 1, type: 'movie', title: 'Interstellar' }, score: 9, scale: 10, updated: 3000 },
        },
        progress: {}, preferences: {}, reading: {}, history: {}, notifications: {}, folders: {},
      },
    });
    const exported = buildLibraryExport(controls.library);
    expect(exported.schema).toBe('afterframe-library');
    expect(exported.version).toBe(1);
    const parsed = parseLibraryImport(exported);
    expect(Object.keys(parsed?.saved ?? {})).toEqual(['movie-1', 'tv-2']);

    render(<ToastProvider><LibraryPage path="watchlist" query="" controls={controls} /></ToastProvider>);
    expect(screen.getByRole('heading', { level: 1, name: 'Library' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Apply filters' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export JSON' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Import JSON' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Notifications/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Watched/ })).toBeNull();
    expect(screen.getByText('Mean Score:')).toBeTruthy();
    expect(screen.getByText('9.00')).toBeTruthy();

    fireEvent.click(screen.getByRole('combobox', { name: 'Type' }));
    const tvOption = await screen.findByRole('option', { name: 'TV Shows' });
    fireEvent.pointerDown(tvOption);
    fireEvent.mouseUp(tvOption);
    fireEvent.click(tvOption);
    await waitFor(() => {
      expect(window.location.pathname).toBe('/watchlist');
      expect(window.location.search).toBe('?type=tv');
    });
  });

  it('portals AfSelect options inside the Settings modal portal host and updates playback preference', async () => {
    const setPreference = vi.fn(async () => {});
    const controls = makeControls({ setPreference });
    function SettingsOpener() {
      const openSettings = useSettings();
      return <button type="button" onClick={e => openSettings('general', e.currentTarget)}>Open Settings</button>;
    }
    render(
      <SettingsProvider controls={controls}>
        <SettingsOpener />
      </SettingsProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    const trigger = await screen.findByRole('combobox', { name: 'Preferred subtitles' });
    fireEvent.click(trigger);

    const option = await screen.findByRole('option', { name: 'Japanese' });
    const portalHost = document.querySelector('.af-modal-portal-host');
    expect(portalHost).not.toBeNull();
    expect(portalHost!.contains(option)).toBe(true);

    fireEvent.pointerDown(option);
    fireEvent.mouseUp(option);
    fireEvent.click(option);
    await waitFor(() => {
      expect(setPreference).toHaveBeenCalledWith('subtitleLanguage', 'Japanese', 'Preferred subtitles');
    });
  });

  it('collapses Browse filters into a compact mobile bar and opens the Filters bottom sheet on narrow viewports', async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn((query: string) => ({
        matches: query.includes('max-width: 640px'),
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
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
        results: [{ id: 550, media_type: 'movie', title: 'Fight Club', release_date: '1999-10-15', vote_average: 8.4 }],
        nextPage: null,
        totalResults: 1,
      }), { status: 200 }));

      const { container } = render(<Catalogue route="movies" controls={makeControls()} />);
      await waitFor(() => expect(container.querySelector('.af-mobile-browse-bar')).not.toBeNull());
      fireEvent.click(screen.getByRole('button', { name: /Filters/i }));
      await waitFor(() => expect(document.querySelector('.af-filter-sheet.af-mobile-sheet')).not.toBeNull());
      expect(screen.getByRole('button', { name: 'Apply filters' })).toBeTruthy();
    } finally {
      Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: originalMatchMedia });
    }
  });
});
