import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  catalogGenres, formatDate, navigate, normalizeTitles, request, routeWithParams, titleHref, webHref,
  type CatalogRating, type Comic, type MediaType, type RatingCoverage, type Title, type TitleResults,
} from './catalog';
import { Artwork, CatalogProblem, Icon, Loading, MediaCard, SaveButton, Score, Shelf } from './components';
import { ComicCard } from './Comics';
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

const resultFilterLabels: Record<string, (value: string) => string> = {
  query: value => `Title: ${value}`,
  q: value => `Search: ${value}`,
  category: value => value,
  genre: value => value,
  decade: value => `${value}s`,
  imdb: value => `IMDb ≥ ${value}`,
  from: value => `From ${value}`,
  to: value => `Through ${value}`,
  runtime: value => runtimeOptions.find(([key]) => key === value)?.[1] ?? '',
  after: value => `Added from ${value}`,
  before: value => `Added through ${value}`,
  rating: value => `Personal rating ≥ ${value}`,
  coverage: value => ({ unstarted: 'Unstarted', started: 'Started', complete: 'Complete' })[value] ?? '',
};

export function ResultsSummary({ count, route, filters, clear, labels = {}, loading = false }: {
  count?: number | null; route: string; filters: URLSearchParams; clear: string; loading?: boolean;
  labels?: Record<string, (value: string) => string>;
}) {
  const display = { ...resultFilterLabels, ...labels };
  const active = [...filters].flatMap(([key, value]) => {
    if (!value) return [];
    const label = display[key]?.(value);
    return label ? [{ key, label }] : [];
  });
  const remove = (key: string) => {
    const remaining = new URLSearchParams(filters);
    remaining.delete(key);
    remaining.delete('page');
    return webHref(routeWithParams(route, remaining));
  };
  if (count == null && !active.length && !loading) return null;
  return <div className="af-results-bar">
    {(count != null || loading) && <p className="af-meta af-results-count" role="status">{loading ? 'Loading titles…' : `${count!.toLocaleString()} ${count === 1 ? 'title' : 'titles'}`}</p>}
    {active.length > 0 && <>
      <ul className="af-applied-filters" aria-label="Applied filters">
        {active.map(({ key, label }) => <li key={key}><a href={remove(key)} aria-label={`Remove filter ${label}`}>{label}<Icon name="close" /></a></li>)}
      </ul>
      <a className="af-text-link" href={clear}>Clear filters</a>
    </>}
  </div>;
}

function filterRoute(route: string, values: FormData, current: URLSearchParams) {
  const params = new URLSearchParams();
  if (current.get('q')) params.set('q', current.get('q')!);
  if (current.get('type')) params.set('type', current.get('type')!);
  if (current.get('collection')) params.set('collection', current.get('collection')!);
  for (const [key, value] of values) if (typeof value === 'string' && value.trim()) params.set(key, value.trim());
  return routeWithParams(route, params);
}

function weekOf(date: string) {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return Number.isFinite(day.getTime()) ? day.toISOString().slice(0, 10) : '';
}

const releaseDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

function Releases({ items, controls }: { items: Title[]; controls: LibraryControls }) {
  const groups = new Map<string, Title[]>();
  for (const item of items) {
    const week = item.date && /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? weekOf(item.date) : '';
    const group = groups.get(week) ?? [];
    group.push(item);
    groups.set(week, group);
  }
  return [...groups].map(([week, releases]) => <section className="af-release-week" key={week} aria-label={week ? `Week of ${formatDate(week)}` : 'Date unavailable'}>
    <h2>{week ? `Week of ${formatDate(week)}` : 'Date unavailable'}</h2>
    {releases.map(item => <article className="af-release-row" key={item.key}>
      {week ? <time dateTime={item.date} className="af-release-date">
        {releaseDay.format(new Date(item.date!))}
      </time> : <span className="af-release-date">TBD</span>}
      <a href={titleHref(item)} className="af-release-image" tabIndex={-1} aria-hidden="true">
        <Artwork src={item.backdrop || item.poster} loading="lazy" fallback={<Icon name="film" />} />
      </a>
      <div className="af-release-copy">
        <h3><a href={titleHref(item)}>{item.title}</a></h3>
        <div className="af-meta">{item.genre}<Score rating={item.rating} /></div>
        {item.description && <p className="af-overview">{item.description}</p>}
      </div>
      <div className="af-release-save"><SaveButton item={item} controls={controls} compact /></div>
    </article>)}
  </section>);
}

type CachedCatalogue = { items: Title[]; next: number | null; total: number | null; ratingCoverage?: RatingCoverage };

function recentCatalogue(route: string): CachedCatalogue | null {
  try {
    const value = JSON.parse(sessionStorage.getItem('afterframe.catalogue') ?? 'null');
    return value?.route === route && value.at > Date.now() - 120000 ? value.data : null;
  } catch { return null; }
}

export function Catalogue({ route, controls }: { route: string; controls: LibraryControls }) {
  const [rawPath, query = ''] = route.split('?', 2);
  const legacySearch = rawPath.startsWith('search=');
  const search = rawPath === 'search' || legacySearch;
  const path = search ? 'search' : rawPath;
  const params = new URLSearchParams(query);
  const text = legacySearch ? (new URLSearchParams(rawPath).get('search') || '') : (search ? (params.get('q') || '') : '');
  if (legacySearch && text && !params.has('q')) params.set('q', text);
  const releases = path === 'new';
  const selected = search ? params.get('type') ?? '' : (path === 'tv' || params.get('type') === 'tv' ? 'tv' : 'movie');
  const comicSearch = search && selected === 'comic';
  const animeSearch = search && selected === 'anime';
  const type: MediaType = selected === 'tv' ? 'tv' : 'movie';
  const heading = search ? (text ? `Results for “${text}”` : 'Search') : releases ? 'New Releases'
    : params.get('collection') === 'gems' ? 'Hidden gems' : type === 'tv' ? 'TV Shows' : 'Movies';
  const [cached] = useState(() => comicSearch ? null : recentCatalogue(route));
  const [items, setItems] = useState<Title[]>(cached?.items ?? []);
  const [comicItems, setComicItems] = useState<Comic[]>([]);
  const [inlineComics, setInlineComics] = useState<Comic[]>([]);
  const [page, setPage] = useState(1);
  const [next, setNext] = useState<number | null>(cached?.next ?? null);
  const [ratingCoverage, setRatingCoverage] = useState<RatingCoverage | undefined>(cached?.ratingCoverage);
  const [total, setTotal] = useState<number | null>(cached?.total ?? null);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [formError, setFormError] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const clear = webHref(routeWithParams(path, new URLSearchParams([...params].filter(([key]) => key === 'q' || key === 'type' || key === 'collection'))));
  const sortLabel = (value: string) => value !== 'popular' ? sortOptions.find(([key]) => key === value)?.[1] ?? '' : '';

  useEffect(() => {
    if (!comicSearch && !loading && items.length) {
      try { sessionStorage.setItem('afterframe.catalogue', JSON.stringify({ route, at: Date.now(), data: { items, next, total, ratingCoverage } })); }
      catch { /* Storage is optional. */ }
    }
  }, [items, next, total, route, loading, ratingCoverage, comicSearch]);

  useEffect(() => {
    if (!search || selected !== '' || !text.trim()) { setInlineComics([]); return; }
    const task = new AbortController();
    request<{ results: Comic[] }>(`/api/comics?q=${encodeURIComponent(text)}`, { signal: task.signal })
      .then(result => {
        if (task.signal.aborted || !Array.isArray(result.results)) return;
        const list = result.results.slice(0, 8);
        setInlineComics(list);
        const ids = list.flatMap(item => item.malId ? [String(item.malId)] : []);
        if (!ids.length) return;
        request<{ ratings: Record<string, number> }>(`/api/mal/manga/batch?ids=${ids.join(',')}`, { signal: task.signal })
          .then(({ ratings }) => {
            if (task.signal.aborted || !ratings) return;
            setInlineComics(current => current.map(item => (
              item.malId && ratings[String(item.malId)] ? { ...item, mal: ratings[String(item.malId)] } : item
            )));
          }).catch(() => {});
      })
      .catch(() => {});
    return () => task.abort();
  }, [search, selected, text]);

  useEffect(() => {
    if (cached && page === 1 && attempt === 0) {
      if (search && cached.items.some(item => !item.rating)) {
        const task = new AbortController();
        const keys = cached.items.filter(item => !item.rating).slice(0, 20).map(item => `${item.type}:${item.id}`);
        if (keys.length) {
          request<{ facts: Record<string, { rating?: CatalogRating | null; mal?: number | null }> }>(`/api/catalog/facts?titles=${keys.join(',')}`, { signal: task.signal })
            .then(({ facts }) => {
              if (task.signal.aborted || !facts) return;
              setItems(current => current.map(item => {
                const info = facts[item.key];
                return info ? { ...item, rating: info.rating ?? item.rating, mal: info.mal ?? item.mal } : item;
              }));
            }).catch(() => {});
        }
        return () => task.abort();
      }
      return;
    }
    const task = new AbortController();
    if (comicSearch) {
      const q = new URLSearchParams({ q: text, page: String(page) });
      request<{ results: Comic[]; nextPage?: number | null }>(`/api/comics?${q}`, { signal: task.signal })
        .then(result => {
          if (task.signal.aborted) return;
          const list = Array.isArray(result.results) ? result.results : [];
          setComicItems(current => page === 1 ? list : [...new Map([...current, ...list].map(item => [item.key, item])).values()]);
          setNext(result.nextPage ?? null);
          setTotal(null);
          const ids = list.flatMap(item => item.malId ? [String(item.malId)] : []);
          if (!ids.length) return;
          request<{ ratings: Record<string, number> }>(`/api/mal/manga/batch?ids=${ids.join(',')}`, { signal: task.signal })
            .then(({ ratings }) => {
              if (task.signal.aborted || !ratings) return;
              setComicItems(current => current.map(item => (
                item.malId && ratings[String(item.malId)] ? { ...item, mal: ratings[String(item.malId)] } : item
              )));
            }).catch(() => {});
        }).catch(problem => { if (!task.signal.aborted) setError(problem.message); })
        .finally(() => { if (!task.signal.aborted) setLoading(false); });
      return () => task.abort();
    }
    const [, inputQuery = ''] = route.split('?', 2);
    const queryParams = new URLSearchParams(inputQuery);
    if (queryParams.has('genre') && !queryParams.has('category')) {
      queryParams.set('category', queryParams.get('genre')!);
      queryParams.delete('genre');
    }
    if (!search) queryParams.set('type', type);
    if (animeSearch) {
      queryParams.delete('type');
      queryParams.set('category', 'Anime');
    }
    if (releases) queryParams.set('collection', 'new');
    if (search) queryParams.set('q', text);
    queryParams.set('page', String(page));
    const endpoint = search ? 'search' : 'browse';
    request<TitleResults>(`/api/${endpoint}?${queryParams}`, { signal: task.signal })
      .then(result => {
        if (task.signal.aborted) return;
        const video = normalizeTitles(result.results);
        setItems(current => page === 1 ? video : [...new Map([...current, ...video].map(item => [item.key, item])).values()]);
        setNext(result.nextPage ?? null);
        setTotal(result.total ?? null);
        setRatingCoverage(result.ratingCoverage);
        const keys = video.filter(item => !item.rating).map(item => `${item.type}:${item.id}`);
        if (!keys.length) return;
        if (search) {
          request<{ facts: Record<string, { rating?: CatalogRating | null; mal?: number | null }> }>(`/api/catalog/facts?titles=${keys.slice(0, 20).join(',')}`, { signal: task.signal })
            .then(({ facts }) => {
              if (task.signal.aborted || !facts) return;
              setItems(current => current.map(item => {
                const info = facts[item.key];
                return info ? { ...item, rating: info.rating ?? item.rating, mal: info.mal ?? item.mal } : item;
              }));
            }).catch(() => {});
        } else {
          request<{ ratings: Record<string, CatalogRating> }>(`/api/imdb/cached?titles=${keys.join(',')}`, { signal: task.signal })
            .then(({ ratings }) => {
              if (task.signal.aborted || !Object.keys(ratings).length) return;
              setItems(current => current.map(item => {
                const rating = ratings[`${item.type}:${item.id}`] ?? ratings[item.key];
                return rating && !item.rating ? { ...item, rating } : item;
              }));
            }).catch(() => {});
        }
      }).catch(problem => { if (!task.signal.aborted) setError(problem.message); })
      .finally(() => { if (!task.signal.aborted) setLoading(false); });
    return () => task.abort();
  }, [route, search, releases, type, page, attempt, cached, comicSearch, animeSearch, text]);

  function setType(value: string) {
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
    if (from && to && from > to) { setFormError('The starting year must come before the ending year.'); form.current?.querySelector<HTMLInputElement>('[name=from]')?.focus(); return; }
    setFormError('');
    navigate(filterRoute(path, values, params));
  }

  return <div className="af-wrap af-directory">
    <PageHeading title={heading}>{releases && 'Recent movies and series grouped by release week.'}</PageHeading>
    {(search || releases) && <div className="af-directory-tabs">
      <RouteTabs active={setType(selected)} label={search ? 'Search type' : 'Release type'} tabs={[
        ...(search ? [[setType(''), 'All']] as const : []),
        [setType('movie'), 'Movies'],
        [setType('tv'), 'TV Shows'],
        ...(search ? [[setType('anime'), 'Anime'], [setType('comic'), 'Comics']] as const : []),
      ]} />
    </div>}
    {!comicSearch && <form className="af-field-bar" ref={form} onSubmit={submit}>
      <SelectField label="Genre" name="category" empty="All genres" value={params.get('category') || params.get('genre') || ''} options={catalogGenres.map(genre => [genre, genre])} />
      {!releases && <SelectField label="Decade" name="decade" empty="Any decade" value={params.get('decade') || ''} options={decadeOptions} />}
      {!search && <InputField label="Minimum IMDb rating" name="imdb" type="number" min="1" max="10" step="0.1" placeholder="Any" defaultValue={params.get('imdb') || ''} />}
      {!search && !releases && <SelectField label="Sort by" name="sort" value={params.get('sort') || 'popular'} options={sortOptions} />}
      <details className="af-more-filters" open={['from', 'to', 'runtime'].some(key => params.has(key)) || undefined}>
        <summary className="af-button af-secondary">More filters</summary>
        <div className="af-filter-panel">
          {!releases && <><InputField label="From year" aria-describedby={formError ? "year-error" : undefined} aria-invalid={Boolean(formError)} name="from" type="number" min="1870" max="2099" defaultValue={params.get('from') || ''} />
            <InputField label="Through year" name="to" type="number" min="1870" max="2099" defaultValue={params.get('to') || ''} /></>}
          {!search && <SelectField label={type === 'tv' ? 'Episode runtime' : 'Runtime'} name="runtime" empty="Any length" value={params.get('runtime') || ''} options={runtimeOptions} />}
        </div>
      </details>
      <button type="submit" className="af-button af-primary">Apply filters</button>
    </form>}
    {formError && <p className="af-state" id="year-error" role="alert">{formError}</p>}
    <ResultsSummary count={comicSearch ? (!loading && !error ? comicItems.length : null) : (total ?? (!loading && !error ? items.length : null))} loading={loading && page === 1 && !(comicSearch ? comicItems.length : items.length)} route={path} filters={params} clear={clear} labels={{ sort: sortLabel }} />
    {comicSearch ? (comicItems.length > 0 && <div className="af-poster-grid">{comicItems.map((item, index) => <ComicCard item={item} controls={controls} key={item.key} eager={index < 6} />)}</div>)
      : items.length > 0 && (releases ? <Releases items={items} controls={controls} /> :
        <div className="af-poster-grid">{items.map((item, index) => <MediaCard item={item} controls={controls} key={item.key} eager={index < 6} />)}</div>)}
    {search && selected === '' && inlineComics.length > 0 && <div className="af-discovery-shelves"><Shelf title="Matching comics" href={webHref(setType('comic'))}>
      {inlineComics.map(item => <ComicCard item={item} controls={controls} key={item.key} />)}
    </Shelf></div>}
    {!comicSearch && params.get('imdb') && !loading && !error && <div className="af-rating-coverage">
      <p className="af-meta" role="status">{ratingCoverage?.total
        ? `IMDb ratings known for ${ratingCoverage.rated} of ${ratingCoverage.total} titles on the latest page. Titles without a score are excluded.`
        : 'The IMDb filter checks each page separately and excludes titles without a known score.'}</p>
      {ratingCoverage && ratingCoverage.rated < ratingCoverage.total && <>
        <button type="button" className="af-text-link" onClick={() => { setLoading(true); setAttempt(value => value + 1); }}>Retry rating lookup</button>
        <a className="af-text-link" href={webHref(routeWithParams(path, new URLSearchParams([...params].filter(([key]) => key !== 'imdb'))))}>Remove IMDb filter</a>
      </>}
    </div>}
    {loading && page === 1 && <Loading label="" shape={releases ? 'releases' : 'posters'} />}
    {error && page === 1 && <CatalogProblem error={error} retry={() => { setError(''); setLoading(true); setAttempt(value => value + 1); }} />}
    {!loading && !error && !(comicSearch ? comicItems.length : items.length) && !inlineComics.length && <p className="af-state" role="status">{ratingCoverage && ratingCoverage.total > 0 && !ratingCoverage.rated ? 'IMDb ratings are unavailable for this page.' : next ? 'No titles on this page match the filters.' : 'No matching titles.'}</p>}
    {page > 1 && <p className="af-meta" role="status">{loading ? 'Loading more titles…' : error || `${(comicSearch ? comicItems : items).length} titles shown`}</p>}
    {(next || page > 1 && (loading || error)) && <div className="af-pagination">
      <button type="button" className="af-button af-secondary" aria-disabled={loading} onClick={() => {
        if (loading) return;
        setLoading(true);
        if (error) { setError(''); setAttempt(value => value + 1); }
        else if (next) setPage(next);
      }}>{error ? 'Retry loading more' : loading ? 'Loading more…' : comicSearch ? 'Load more comics' : 'Load more titles'}</button>
    </div>}
  </div>;
}
