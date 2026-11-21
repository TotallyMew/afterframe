import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  catalogGenres, formatDate, legacyHref, normalizeTitles, request, routeWithParams, titleHref, webHref,
  type CatalogRating, type MediaType, type Title, type TitleResults,
} from './catalog';
import { ActionLink, Icon, MediaCard, SaveButton, Score } from './components';
import type { LibraryControls } from './library';

const sortOptions = [['popular', 'Popular'], ['newest', 'Newest'], ['oldest', 'Oldest']] as const;
const runtimeOptions = [['short', 'Under 90 min'], ['standard', '90–119 min'], ['long', '120–149 min'], ['epic', '150 min and up']] as const;
const decadeOptions = Array.from({ length: 14 }, (_, index) => 2020 - index * 10).map(year => [String(year), `${year}s`] as const);

export function SelectField({ label, name, value = '', options, empty }: {
  label: string; name: string; value?: string; options: readonly (readonly [string, string])[]; empty?: string;
}) {
  return <label>{label}
    <select className="af-select" name={name} defaultValue={value}>
      {empty && <option value="">{empty}</option>}
      {options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
    </select>
  </label>;
}

export function InputField({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <label>{label}<input className="af-select af-input" {...props} /></label>;
}

export function PageHeading({ title, children }: { title: string; children?: ReactNode }) {
  useEffect(() => { document.title = `${title} · Afterframe`; }, [title]);
  return <header className="af-directory-heading"><h1>{title}</h1>{children && <p className="af-meta">{children}</p>}</header>;
}

export function RouteTabs({ tabs, active, label }: { tabs: readonly (readonly [string, string])[]; active: string; label: string }) {
  return <nav className="af-route-tabs" aria-label={label}>
    {tabs.map(([href, title]) => <a href={webHref(href)} key={href} aria-current={href === active ? 'page' : undefined}>{title}</a>)}
  </nav>;
}

function filterRoute(route: string, values: FormData, current: URLSearchParams) {
  const params = new URLSearchParams();
  if (current.get('type')) params.set('type', current.get('type')!);
  if (current.get('collection')) params.set('collection', current.get('collection')!);
  for (const [key, value] of values) if (typeof value === 'string' && value.trim()) params.set(key, value.trim());
  return routeWithParams(route, params);
}

function weekOf(date: string) {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}

function Releases({ items, controls }: { items: Title[]; controls: LibraryControls }) {
  const groups = new Map<string, Title[]>();
  for (const item of items) if (item.date && /^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
    const week = weekOf(item.date);
    const group = groups.get(week) ?? [];
    group.push(item);
    groups.set(week, group);
  }
  return [...groups].map(([week, releases]) => <section className="af-release-week" key={week} aria-label={`Week of ${formatDate(week)}`}>
    <h2>Week of {formatDate(week)}</h2>
    {releases.map(item => <article className="af-release-row" key={item.key}>
      <time dateTime={item.date} className="af-release-date">
        <span>{new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' }).format(new Date(item.date!))}</span>
        <strong>{Number(item.date!.slice(-2))}</strong>
      </time>
      <a href={titleHref(item)} className="af-release-image" tabIndex={-1} aria-hidden="true">
        {item.backdrop || item.poster ? <img src={item.backdrop || item.poster} alt="" loading="lazy" /> : <Icon name="film" />}
      </a>
      <div className="af-release-copy">
        <h3><a href={titleHref(item)}>{item.title}</a></h3>
        <div className="af-meta">{item.genre}<Score rating={item.rating} /></div>
        {item.description && <p>{item.description}</p>}
      </div>
      <div className="af-release-save"><SaveButton item={item} controls={controls} /></div>
    </article>)}
  </section>);
}

export function Catalogue({ route, controls }: { route: string; controls: LibraryControls }) {
  const [path, query = ''] = route.split('?', 2);
  const text = path.startsWith('search=') ? new URLSearchParams(path).get('search') || '' : '';
  const search = path.startsWith('search=');
  const releases = path === 'new';
  const params = new URLSearchParams(query);
  const type = path === 'tv' || params.get('type') === 'tv' ? 'tv' : 'movie';
  const selected = search ? params.get('type') ?? '' : type;
  const heading = search ? `Results for “${text}”` : releases ? 'New Releases'
    : params.get('collection') === 'gems' ? 'Hidden gems' : type === 'tv' ? 'TV Shows' : 'Movies';
  const [items, setItems] = useState<Title[]>([]);
  const [page, setPage] = useState(1);
  const [next, setNext] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    const task = new AbortController();
    const [inputPath, inputQuery = ''] = route.split('?', 2);
    const queryParams = new URLSearchParams(inputQuery);
    if (queryParams.has('genre') && !queryParams.has('category')) {
      queryParams.set('category', queryParams.get('genre')!);
      queryParams.delete('genre');
    }
    if (!search) queryParams.set('type', type);
    if (releases) queryParams.set('collection', 'new');
    if (search) queryParams.set('q', new URLSearchParams(inputPath).get('search') || '');
    queryParams.set('page', String(page));
    const endpoint = search ? 'search' : 'browse';
    request<TitleResults>(`/api/${endpoint}?${queryParams}`, { signal: task.signal })
      .then(result => {
        if (task.signal.aborted) return;
        const video = normalizeTitles(result.results);
        setItems(current => page === 1 ? video : [...new Map([...current, ...video].map(item => [item.key, item])).values()]);
        setNext(result.nextPage ?? null);
        setTotal(result.total ?? null);
        if (!video.length) return;
        const keys = video.map(item => `${item.type}:${item.id}`);
        request<{ ratings: Record<string, CatalogRating> }>(`/api/imdb/cached?titles=${keys.join(',')}`, { signal: task.signal })
          .then(({ ratings }) => {
            if (!task.signal.aborted) setItems(current => current.map(item => ({
              ...item, rating: item.rating ?? ratings[`${item.type}:${item.id}`] ?? ratings[item.key],
            })));
          }).catch(() => {});
      }).catch(problem => { if (!task.signal.aborted) setError(problem.message); })
      .finally(() => { if (!task.signal.aborted) setLoading(false); });
    return () => task.abort();
  }, [route, search, releases, type, page, attempt]);

  function setType(value: MediaType | '') {
    const nextParams = new URLSearchParams(params);
    if (value) nextParams.set('type', value);
    else nextParams.delete('type');
    return routeWithParams(path, nextParams);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const from = Number(values.get('from'));
    const to = Number(values.get('to'));
    if (from && to && from > to) { setFormError('The starting year must come before the ending year.'); return; }
    setFormError('');
    window.location.hash = filterRoute(path, values, params);
  }

  return <div className="af-wrap af-directory">
    <PageHeading title={heading}>{releases && 'Recent movies and series grouped by release week.'}</PageHeading>
    {(search || releases) && <div className="af-directory-tabs">
      <RouteTabs active={setType(selected as MediaType | '')} label={search ? 'Search type' : 'Release type'} tabs={[
        ...(search ? [[setType(''), 'All']] as const : []), [setType('movie'), 'Movies'], [setType('tv'), 'TV Shows'],
      ]} />
      {search && <a className="af-text-link" href={webHref(`comics?q=${encodeURIComponent(text)}`)}>Search comics <Icon name="right" /></a>}
    </div>}
    <form className="af-field-bar" onSubmit={submit}>
      <SelectField label="Genre" name="category" empty="All genres" value={params.get('category') || params.get('genre') || ''} options={catalogGenres.map(genre => [genre, genre])} />
      {!releases && <SelectField label="Decade" name="decade" empty="Any decade" value={params.get('decade') || ''} options={decadeOptions} />}
      {!search && <InputField label="Minimum IMDb rating" name="imdb" type="number" min="1" max="10" step="0.1" placeholder="Any" defaultValue={params.get('imdb') || ''} />}
      {!search && !releases && <SelectField label="Sort by" name="sort" value={params.get('sort') || 'popular'} options={sortOptions} />}
      <details className="af-more-filters">
        <summary className="af-button af-secondary">More filters</summary>
        <div className="af-filter-panel">
          {!releases && <><InputField label="From year" name="from" type="number" min="1870" max="2099" defaultValue={params.get('from') || ''} />
            <InputField label="Through year" name="to" type="number" min="1870" max="2099" defaultValue={params.get('to') || ''} /></>}
          {!search && <SelectField label={type === 'tv' ? 'Episode runtime' : 'Runtime'} name="runtime" empty="Any length" value={params.get('runtime') || ''} options={runtimeOptions} />}
        </div>
      </details>
      <button type="submit" className="af-button af-secondary">Apply filters</button>
      {params.size > (params.has('type') ? 1 : 0) && <a className="af-text-link" href={webHref(routeWithParams(path, params.has('type') ? new URLSearchParams({ type: params.get('type')! }) : new URLSearchParams()))}>Clear filters</a>}
    </form>
    {formError && <p className="af-state" role="alert">{formError}</p>}
    {typeof total === 'number' && !releases && <p className="af-meta af-results-count">{total.toLocaleString()} titles</p>}
    {items.length > 0 && (releases ? <Releases items={items} controls={controls} /> :
      <div className="af-poster-grid">{items.map(item => <MediaCard item={item} controls={controls} key={item.key} />)}</div>)}
    {loading && <p className="af-state" role="status">Loading titles…</p>}
    {error && <div className="af-state" role="alert">{error} <button type="button" className="af-text-link" onClick={() => { setError(''); setLoading(true); setAttempt(value => value + 1); }}>Retry</button>
      {error.includes('Connect') && <ActionLink href={legacyHref('home', 'settings')}>Open settings</ActionLink>}</div>}
    {!loading && !error && !items.length && <p className="af-state">{next ? 'No titles on this page match the filters.' : 'No matching titles.'}</p>}
    {next && !loading && !error && <div className="af-pagination">
      <button type="button" className="af-button af-secondary" onClick={() => { setLoading(true); setPage(next); }}>Load more titles</button>
    </div>}
  </div>;
}
