import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiringSchedulePage } from '../AiringSchedule';
import { airingCountdown, airingWeek, localDayKey } from '../airing';
import { CollectionTabs } from '../Catalogue';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Weekly airing schedule', () => {
  it('exposes schedule navigation beside Seasonal and All anime and on TV', () => {
    const { rerender } = render(<CollectionTabs type="anime" active="anime?view=schedule" />);
    expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual(['Seasonal', 'All anime', 'Weekly airing schedule']);
    expect(screen.getByRole('link', { name: 'Weekly airing schedule' }).getAttribute('aria-current')).toBe('page');
    rerender(<CollectionTabs type="tv" active="tv" />);
    expect(screen.getByRole('link', { name: 'Weekly airing schedule' }).getAttribute('href')).toBe('/tv?view=schedule');
  });

  it('uses Sunday to Saturday calendar days and local midnight across DST', () => {
    const week = airingWeek(new Date(2026, 2, 10, 12), 0);
    expect(week.start.getDay()).toBe(0);
    expect(week.days.map(day => day.getDate())).toEqual([8, 9, 10, 11, 12, 13, 14]);
    expect(week.days.every(day => day.getHours() === 0)).toBe(true);
    expect(localDayKey(week.end)).toBe('2026-03-15');
    expect(localDayKey(airingWeek(new Date(2026, 11, 31), 1).end)).toBe('2027-01-10');
  });

  it('renders real episode metadata in the right day, highlights today and changes weeks', async () => {
    const week = airingWeek(new Date(), 0);
    const date = new Date(week.days[2]);
    date.setHours(18);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ results: [{
      id: 'episode-1', title: 'Example anime', episode: 8, airingAt: date.getTime() / 1000, timeKnown: true, catalog: 'tv/123', catalogSeason: 2,
    }] })));
    const { container } = render(<AiringSchedulePage type="anime" />);
    const link = await screen.findByRole('link', { name: /Example anime/ });
    expect(link.getAttribute('href')).toContain('/tv/123?');
    expect(link.getAttribute('href')).toContain('season=2');
    const tuesday = screen.getByRole('region', { name: /Tuesday,/ });
    expect(within(tuesday).getByText('Example anime')).toBeTruthy();
    expect(container.querySelector('[data-today="true"] h3')?.textContent).toContain('Today');
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'This week' })).toBeTruthy();
    const request = String(fetchMock.mock.calls[1][0]);
    expect(new URL(request, 'http://localhost').searchParams.get('from')).toBe(String(week.end.getTime() / 1000));
  });

  it('offers retry after provider failure and renders an empty schedule on recovery', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Schedule unavailable' }), { status: 502 }))
      .mockImplementation(async () => new Response(JSON.stringify({ results: [] })));
    render(<AiringSchedulePage type="tv" />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Live')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No episodes are scheduled for this week. Try another week.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/US TV & worldwide streaming/)).toBeTruthy();
  });

  it('labels unmatched anime instead of linking to an empty season-title search', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ results: [{
      id: 'unmatched', title: 'Unknown Anime Season 3', episode: 2, airingAt: Date.now() / 1000, timeKnown: true,
    }] })));
    render(<AiringSchedulePage type="anime" />);
    expect(await screen.findByText('Not in catalog')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Unknown Anime/ })).toBeNull();
  });

  it('counts down to an episode without displaying negative times', () => {
    const now = 1000000000;
    expect(airingCountdown(now / 1000 - 1, now)).toBe('Aired');
    expect(airingCountdown(now / 1000 + 1, now)).toBe('In 1m');
    expect(airingCountdown(now / 1000 + 3660, now)).toBe('In 1h 1m');
    expect(airingCountdown(now / 1000 + 2 * 86400 + 3600, now)).toBe('In 2d 1h');
  });
});
