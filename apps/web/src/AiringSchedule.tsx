import { useEffect, useMemo, useRef, useState } from 'react';
import { CollectionTabs, PageHeading } from './Catalogue';
import { Artwork, Icon, Loading } from './components';
import { request, routeWithParams, searchHref, webHref } from './catalog';
import { currentLocationHref } from './router';
import { airingCountdown, airingWeek, localDayKey, type AiringEntry } from './airing';
import './airing.css';

const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });
const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function scheduleHref(entry: AiringEntry, type: 'anime' | 'tv') {
  if (!/^(tv|movie)\/[1-9]\d{0,9}$/.test(entry.catalog || '')) return type === 'tv' ? searchHref(entry.title, { type }) : null;
  const params = new URLSearchParams({ back: currentLocationHref() });
  if (entry.catalog?.startsWith('tv/') && entry.catalogSeason) params.set('season', String(entry.catalogSeason));
  return webHref(routeWithParams(entry.catalog!, params));
}

function ScheduleEntry({ entry, type, now }: Readonly<{ entry: AiringEntry; type: 'anime' | 'tv'; now: number }>) {
  const date = new Date(entry.airingAt * 1000);
  const poster = /^https:\/\/(s4\.anilist\.co|static\.tvmaze\.com)\//.test(entry.poster || '') ? entry.poster : undefined;
  const episode = entry.episode ? `Ep ${entry.episode}` : 'Special';
  const label = entry.season ? `S${entry.season} · ${episode}` : episode;
  const href = scheduleHref(entry, type);
  const content = <>
      <span className="af-airing-art"><Artwork src={poster} loading="lazy" width={38} height={55} fallback={<Icon name="film" />} /></span>
      <span className="af-airing-copy">
        <strong title={entry.title}>{entry.title}</strong>
        <span className="af-airing-episode">{label} · <time dateTime={date.toISOString()} title={fullDate.format(date)}>{entry.timeKnown ? airingCountdown(entry.airingAt, now) : shortDate.format(date)}</time></span>
        <span className="af-airing-time">{entry.timeKnown ? clock.format(date) : 'Time TBA'}{entry.network ? ` · ${entry.network}` : ''}</span>
        {!href && <span className="af-airing-time">Not in catalog</span>}
      </span>
  </>;
  return <li>
    {href ? <a className="af-airing-entry" href={href}>{content}</a>
      : <div className="af-airing-entry is-unavailable" title="This anime has no match in the connected catalog.">{content}</div>}
  </li>;
}

export function AiringSchedulePage({ type }: Readonly<{ type: 'anime' | 'tv' }>) {
  const [now, setNow] = useState(Date.now);
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<AiringEntry[]>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const board = useRef<HTMLDivElement>(null);
  const today = localDayKey(new Date(now));
  const week = useMemo(() => airingWeek(new Date(now), offset), [today, offset]); // eslint-disable-line react-hooks/exhaustive-deps
  const from = week.start.getTime() / 1000;
  const to = week.end.getTime() / 1000;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    const refresh = window.setInterval(() => setRetry(value => value + 1), 5 * 60000);
    return () => { clearInterval(timer); clearInterval(refresh); };
  }, []);

  useEffect(() => {
    const task = new AbortController();
    setLoading(true);
    setData(undefined);
    setError('');
    request<{ results: AiringEntry[] }>(`/api/airing-schedule?${new URLSearchParams({ type, from: String(from), to: String(to) })}`, { signal: task.signal })
      .then(result => {
        if (!Array.isArray(result.results) || result.results.some(entry => !entry || typeof entry.title !== 'string' || !Number.isFinite(entry.airingAt))) {
          throw new Error('Could not read the airing schedule. Please try again.');
        }
        if (!task.signal.aborted) setData(result.results);
      })
      .catch(cause => { if (!task.signal.aborted) setError(cause.message); })
      .finally(() => { if (!task.signal.aborted) setLoading(false); });
    return () => task.abort();
  }, [type, from, to, retry]);

  // On compact screens start at today, while retaining the Sunday–Saturday reading order.
  useEffect(() => {
    const container = board.current;
    const column = container?.querySelector<HTMLElement>('[data-today="true"]');
    if (container && column) container.scrollLeft = column.offsetLeft - container.offsetLeft;
  }, [from, data]);

  const groups = new Map(week.days.map(date => [localDayKey(date), [] as AiringEntry[]]));
  for (const entry of data ?? []) groups.get(localDayKey(new Date(entry.airingAt * 1000)))?.push(entry);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll('_', ' ');

  return <div className="af-wrap af-directory af-airing-page">
    <PageHeading title={type === 'anime' ? 'Anime' : 'TV Shows'} />
    <div className="af-directory-tabs"><CollectionTabs type={type} active={`${type}?view=schedule`} /></div>
    <section className="af-airing" aria-labelledby="airing-heading">
      <header className="af-airing-header">
        <div className="af-airing-heading"><Icon name="clock" /><h2 id="airing-heading">Weekly Airing Schedule</h2>{!loading && !error && <span className="af-airing-live">Live</span>}</div>
        <div className="af-airing-navigation" aria-label="Schedule week">
          <button className="af-button af-secondary" type="button" aria-label="Previous week" disabled={offset <= -4} onClick={() => setOffset(value => value - 1)}><Icon name="left" /></button>
          <span>{shortDate.format(week.start)} – {shortDate.format(week.days[6])}</span>
          <button className="af-button af-secondary" type="button" aria-label="Next week" disabled={offset >= 4} onClick={() => setOffset(value => value + 1)}><Icon name="right" /></button>
          {offset !== 0 && <button className="af-text-link" type="button" onClick={() => setOffset(0)}>This week</button>}
        </div>
      </header>
      <p className="af-airing-context">Times in {timezone}.{type === 'tv' ? ' US TV & worldwide streaming.' : ' Japanese anime with weekly episode releases. Original broadcast times; streaming availability may vary.'}</p>
      {loading && <Loading shape="rows" label="Loading weekly schedule…" />}
      {error && <p className="af-state" role="alert">{error} <button className="af-text-link" type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></p>}
      {!loading && !error && <>
        {data?.length === 0 && <output className="af-state">No episodes are scheduled for this week. Try another week.</output>}
        <div className="af-airing-board" ref={board} role="region" aria-label="Seven-day airing schedule" tabIndex={0}>
          {week.days.map(date => {
            const key = localDayKey(date);
            const isToday = key === today;
            const entries = groups.get(key)!;
            return <section key={key} className="af-airing-day" data-today={isToday} aria-label={`${weekday.format(date)}, ${shortDate.format(date)}${isToday ? ', today' : ''}`}>
              <header><h3>{weekday.format(date)}{isToday && <span>Today</span>}</h3><time dateTime={key}>{shortDate.format(date)}</time></header>
              {entries.length ? <ul>{entries.map(entry => <ScheduleEntry key={entry.id} entry={entry} type={type} now={now} />)}</ul> : <p className="af-airing-empty">No episodes scheduled</p>}
            </section>;
          })}
        </div>
      </>}
      <p className="af-airing-source">Schedule data by {type === 'anime' ? <a href="https://anilist.co">AniList</a> : <><a href="https://www.tvmaze.com">TVmaze</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA</a></>}. Schedules may change.</p>
    </section>
  </div>;
}
