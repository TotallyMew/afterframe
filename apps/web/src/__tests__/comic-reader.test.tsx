import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComicReader } from '../ComicReader';
import { ComicDetailsPage } from '../Comics';
import type { LibraryControls } from '../library';

const stubControls = {
  account: null,
  library: { saved: {}, watched: {}, ratings: {}, progress: {}, preferences: {}, reading: {}, history: {}, notifications: {} },
  ready: true,
  state: 'guest',
  replaying: false,
  isPending: () => false,
  completing: [],
  problems: {},
  recordReading: vi.fn(),
} as unknown as LibraryControls;

describe('ComicReader', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders chapter pages, switches pages, and displays authorized transcripts', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/comics/abc') {
        return new Response(JSON.stringify({ id: 'abc', key: 'comic-abc', type: 'comic', title: 'Sample Manga' }), { status: 200 });
      }
      if (url === '/api/comics/abc/chapters/ch-1') {
        return new Response(JSON.stringify({
          chapter: { id: 'ch-1', label: 'Chapter 1', language: 'en' },
          pages: ['/comic-page/abc/ch-1/1', '/comic-page/abc/ch-1/2'],
          transcript: { pages: ['First page dialogue', 'Second page dialogue'], source: 'https://publisher.example/ch1' },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ neighbors: { previous: null, next: null } }), { status: 200 });
    });

    render(<ComicReader id="abc" chapterId="ch-1" query="lang=en" controls={stubControls} />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Chapter 1' })).toBeTruthy());
    expect(screen.getByText('First page dialogue')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByAltText('Manga page 2')).toBeTruthy();
  });

  it('supports MangaFire-style double spreads, RTL/LTR direction, long strip, subtle HUD toggle, dim/grayscale, and scrubber', async () => {
    window.localStorage.clear();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/comics/mf-1') {
        return new Response(JSON.stringify({ id: 'mf-1', key: 'comic-mf-1', type: 'comic', title: 'Sample Manga', format: 'manga' }), { status: 200 });
      }
      if (url === '/api/comics/mf-1/chapters/ch-1') {
        return new Response(JSON.stringify({
          chapter: { id: 'ch-1', label: 'Chapter 1', language: 'en' },
          pages: ['/p/1', '/p/2', '/p/3', '/p/4'],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        results: [
          { id: 'ch-1', label: 'Chapter 1', language: 'en' },
          { id: 'ch-2', label: 'Chapter 2', language: 'en' },
        ],
        neighbors: { previous: null, next: { entry: { id: 'ch-2', label: 'Chapter 2', language: 'en' }, page: 1 } },
      }), { status: 200 });
    });

    const { container } = render(<ComicReader id="mf-1" chapterId="ch-1" query="lang=en" controls={stubControls} />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Chapter 1' })).toBeTruthy());

    // Default for manga is RTL
    const stage = container.querySelector('.af-reader-pages') as HTMLElement;
    expect(stage.dataset.direction).toBe('rtl');
    expect(container.querySelector('.af-reader-edge-rail.is-left')).toBeTruthy();

    // Open Settings modal and switch to Double page mode
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Double' }));
    expect(stage.dataset.layout).toBe('double');

    // Close modal before interacting with the background page navigation (focus-trapped modal)
    fireEvent.click(screen.getByRole('button', { name: 'Close reader menu' }));

    // Offset cover keeps page 1 solo; Next page moves to spread 2-3
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByAltText('Manga page 2')).toBeTruthy();
    expect(screen.getByAltText('Manga page 3')).toBeTruthy();

    // Re-open Settings modal to adjust direction, dim/grayscale, and layout
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    // Flip direction to Left to Right
    fireEvent.click(screen.getByRole('button', { name: 'Left to Right' }));
    expect(stage.dataset.direction).toBe('ltr');

    // Test Dim screen and Grayscale image controls + edge progress bar placement
    fireEvent.change(screen.getByLabelText('Dim screen'), { target: { value: '20' } });
    fireEvent.click(screen.getByLabelText('Grayscale pages'));
    expect(stage.style.filter).toContain('brightness(0.8)');
    expect(stage.style.filter).toContain('grayscale(1)');
    fireEvent.click(screen.getByRole('button', { name: 'Bottom' }));
    expect(container.querySelector('.af-reader-edge-rail.is-bottom')).toBeTruthy();

    // Switch to Long strip to show all 4 pages stacked
    fireEvent.click(screen.getByRole('button', { name: 'Long strip' }));
    expect(stage.dataset.layout).toBe('scroll');
    expect(container.querySelector('img[alt="Manga page 4"]')).toBeTruthy();

    // Switch to Chapters tab in the centered modal
    fireEvent.click(screen.getByRole('tab', { name: 'Chapters' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Chapter 2' })).toBeTruthy());

    // Close modal and verify tap toggles subtle HUD off and back on
    fireEvent.click(screen.getByRole('button', { name: 'Close reader menu' }));
    const shell = container.querySelector('.af-reader-shell') as HTMLElement;
    expect(shell.classList.contains('is-hud-hidden')).toBe(false);
    fireEvent.click(container.querySelector('.af-reader-stage') as HTMLElement);
    expect(shell.classList.contains('is-hud-hidden')).toBe(true);
    expect(screen.getByRole('heading', { level: 1, name: 'Chapter 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show reader controls' })).toBeTruthy();
    fireEvent.click(container.querySelector('.af-reader-stage') as HTMLElement);
    expect(shell.classList.contains('is-hud-hidden')).toBe(false);

    // Scrubber range input jumps pages
    const scrubber = screen.getByRole('slider', { name: 'Page progress' });
    fireEvent.change(scrubber, { target: { value: '3' } });
    expect((scrubber as HTMLInputElement).value).toBe('3');
  });

  it('lets users search all comic chapters directly without a range dropdown', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/comics/one-piece') {
        return new Response(JSON.stringify({
          id: 'one-piece', key: 'comic-one-piece', type: 'comic', title: 'One Piece', format: 'manga',
          languages: ['en'], defaultLanguage: 'en',
        }), { status: 200 });
      }
      if (url.startsWith('/api/comics/one-piece/chapters')) {
        return new Response(JSON.stringify({
          results: [
            { id: 'c1', label: 'Chapter 1', number: '1', title: 'Romance Dawn', language: 'en' },
            { id: 'c55', label: 'Chapter 55', number: '55', title: 'Jungle', language: 'en' },
            { id: 'c105', label: 'Chapter 105', number: '105', title: 'Log Pose', language: 'en' },
          ],
          totalChapters: 3,
          ranges: [],
          nextPage: null,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    });

    render(<ComicDetailsPage id="one-piece" query="" controls={stubControls} />);
    await waitFor(() => expect(screen.getByText(/Romance Dawn/)).toBeTruthy());
    expect(screen.queryByRole('combobox', { name: 'Chapter range' })).toBeNull();

    const searchInput = screen.getByRole('searchbox', { name: 'Search chapters' });
    fireEvent.change(searchInput, { target: { value: '105' } });
    expect(screen.getByText(/Log Pose/)).toBeTruthy();
    expect(screen.queryByText(/Romance Dawn/)).toBeNull();
  });
});
