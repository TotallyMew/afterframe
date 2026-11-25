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

function Harness() {
  const confirm = useConfirm();
  const controls = useLibrary(confirm);
  return <div>
    <p data-testid="state">{controls.state}</p>
    <p data-testid="saved">{controls.library.saved[sampleMovie.key] ? 'yes' : 'no'}</p>
    <p data-testid="msg">{controls.mutationMessage}</p>
    <p data-testid="error">{controls.error}</p>
    <p data-testid="recoverable">{controls.recoverable.length}</p>
    <button type="button" onClick={() => void controls.toggleSaved(sampleMovie)}>Toggle save</button>
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
});
