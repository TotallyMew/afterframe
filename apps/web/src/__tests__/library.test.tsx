import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider, useConfirm } from '../ConfirmDialog';
import { useLibrary } from '../library';
import type { Title } from '../catalog';

const sampleMovie: Title = {
  key: 'movie-42',
  id: 42,
  type: 'movie',
  title: 'Arrival',
  year: '2016',
};

const sampleSeries: Title = {
  key: 'tv-99',
  id: 99,
  type: 'tv',
  title: 'Severance',
  year: '2022',
};

function Harness() {
  const confirm = useConfirm();
  const controls = useLibrary(confirm);
  return <div>
    <p data-testid="state">{controls.state}</p>
    <p data-testid="saved">{controls.library.saved[sampleMovie.key] ? 'yes' : 'no'}</p>
    <p data-testid="series-status">{controls.library.saved[sampleSeries.key]?.watchStatus ?? 'none'}</p>
    <p data-testid="msg">{controls.mutationMessage}</p>
    <p data-testid="error">{controls.error}</p>
    <p data-testid="recoverable">{controls.recoverable.length}</p>
    <button type="button" onClick={() => void controls.toggleSaved(sampleMovie)}>Toggle save</button>
    <button type="button" onClick={() => void controls.toggleWatched(sampleSeries, 'tv-99/s1e1')}>Watch ep 1</button>
    <button type="button" onClick={() => controls.recordProgress('tv-99/s1e1', {
      item: sampleSeries,
      episode: { season: 1, number: 1 },
      time: 20,
      duration: 2400,
      updated: Date.now(),
      ranges: [[0, 20]],
    })}>Brief click</button>
    <button type="button" onClick={() => controls.recordProgress('tv-99/s1e1', {
      item: sampleSeries,
      episode: { season: 1, number: 1 },
      time: 300,
      duration: 2400,
      updated: Date.now(),
      ranges: [[0, 300]],
    })}>Watch 5 min</button>
    <button type="button" onClick={() => void controls.setPreference('autoAddWatching', false, 'Auto-add')}>Disable auto-add</button>
    {controls.undoable && <button type="button" onClick={() => void controls.undo(controls.undoable!)}>Undo</button>}
  </div>;
}

describe('useLibrary and ConfirmProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('saves, confirms removal via Base UI dialog, and undoes guest edits', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ account: null, library: null }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    render(<ConfirmProvider><Harness /></ConfirmProvider>);
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('guest'));

    fireEvent.click(screen.getByText('Toggle save'));
    await waitFor(() => expect(screen.getByTestId('saved').textContent).toBe('yes'));

    // Removing opens Base UI confirm dialog (never window.confirm)
    fireEvent.click(screen.getByText('Toggle save'));
    const confirmBtn = await screen.findByRole('button', { name: 'Remove' });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(screen.getByTestId('saved').textContent).toBe('no'));

    // Undo restores the removed movie
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.getByTestId('saved').textContent).toBe('yes'));
  });

  it('transitions to expired state and defers edit on 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/account') {
        return new Response(JSON.stringify({ account: { id: 7, username: 'alex' }, library: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: 'Sign in to update this library.' }), { status: 401, headers: { 'content-type': 'application/json' } });
    });

    render(<ConfirmProvider><Harness /></ConfirmProvider>);
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('account'));

    fireEvent.click(screen.getByText('Toggle save'));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('expired'));
    expect(screen.getByTestId('error').textContent).toContain('alex');
    expect(JSON.parse(sessionStorage.getItem('afterframe.deferred-edits') || '[]')).toHaveLength(1);
  });

  it('auto-adds a series as Watching after meaningful playback or an episode, and respects the setting toggle', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ account: null, library: null }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    render(<ConfirmProvider><Harness /></ConfirmProvider>);
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('guest'));

    // A brief 20-second click should NOT auto-add the series
    fireEvent.click(screen.getByText('Brief click'));
    expect(screen.getByTestId('series-status').textContent).toBe('none');

    // Watching 5 minutes auto-adds the series as Watching
    fireEvent.click(screen.getByText('Watch 5 min'));
    await waitFor(() => expect(screen.getByTestId('series-status').textContent).toBe('watching'));

    // When disabled in settings, marking an episode watched does not re-add an unsaved series
    cleanup();
    localStorage.clear();
    render(<ConfirmProvider><Harness /></ConfirmProvider>);
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('guest'));
    fireEvent.click(screen.getByText('Disable auto-add'));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('afterframe.preferences') || '{}').autoAddWatching).toBe(false));
    fireEvent.click(screen.getByText('Watch ep 1'));
    await waitFor(() => expect(Object.keys(JSON.parse(localStorage.getItem('afterframe.watched') || '{}'))).toContain('tv-99/s1e1'));
    expect(screen.getByTestId('series-status').textContent).toBe('none');
  });
});
