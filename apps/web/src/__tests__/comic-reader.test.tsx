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
    expect(screen.getByAltText('Comic page 2')).toBeTruthy();
  });

  it('supports MangaFire-style double spreads, RTL/LTR direction, long strip, drawer, and scrubber', async () => {
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

    // Open Settings drawer and switch to Double page mode
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Double' }));
    expect(stage.dataset.layout).toBe('double');

    // Offset cover keeps page 1 solo; Next page moves to spread 2-3
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByAltText('Comic page 2')).toBeTruthy();
    expect(screen.getByAltText('Comic page 3')).toBeTruthy();

    // Flip direction to Left to Right
    fireEvent.click(screen.getByRole('button', { name: 'Left to Right' }));
    expect(stage.dataset.direction).toBe('ltr');

    // Switch to Long strip to show all 4 pages stacked
    fireEvent.click(screen.getByRole('button', { name: 'Long strip' }));
    expect(stage.dataset.layout).toBe('scroll');
    expect(screen.getByAltText('Comic page 4')).toBeTruthy();

    // Switch to Chapters tab in the slide-over drawer
    fireEvent.click(screen.getByRole('tab', { name: 'Chapters' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Chapter 2' })).toBeTruthy());

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
