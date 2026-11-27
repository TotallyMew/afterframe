import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  catalogGenres, formatDate, navigate, normalizeTitles, readBrowseCache, request, routeWithParams, titleHref, webHref, writeBrowseCache,
  type CatalogRating, type Comic, type MediaType, type RatingCoverage, type Title, type TitleResults,
} from './catalog';
import { Artwork, CatalogProblem, Icon, Loading, MediaCard, SaveButton, Score, Shelf } from './components';
import { ComicCard } from './Comics';
import type { LibraryControls } from './library';
import { AfSelect, FilterPopover, MobileFilterSheet, useMediaQuery } from './UiControls';

const sortOptions = [['popular', 'Popular'], ['newest', 'Newest'], ['oldest', 'Oldest']] as const;
const runtimeOptions = [['short', 'Under 90 min'], ['standard', '90–119 min'], ['long', '120–149 min'], ['epic', '150 min and up']] as const;
const decadeOptions = Array.from({ length: 14 }, (_, index) => 2020 - index * 10).map(year => [String(year), `${year}s`] as const);
const imdbPresetOptions = [
  ['9', '9.0+'],
  ['8.5', '8.5+'],
  ['8', '8.0+'],
  ['7.5', '7.5+'],
  ['7', '7.0+'],
  ['6.5', '6.5+'],
  ['6', '6.0+'],
  ['5', '5.0+'],
] as const;

export function SelectField({ label, name, value = '', options, empty, onChange }: {
  label: string;
  name: string;
  value?: string;
  options: readonly (readonly [string, string])[];
  empty?: string;
  onChange?: (value: string) => void;
}) {
  const labelId = useId();
  const selectOptions = [
    ...(empty ? [{ value: '', label: empty }] : []),
    ...options.map(([key, text]) => ({ value: key, label: text })),
  ];
  return <div className="af-field-group">
    <span className="af-field-label" id={labelId}>{label}</span>
    <AfSelect
      name={name}
      defaultValue={onChange ? undefined : value}
      value={onChange ? value : undefined}
      onChange={onChange}
      ariaLabelledBy={labelId}
      options={selectOptions}
    />
  </div>;
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
    return remaining.size ? webHref(routeWithParams(route, remaining)) : clear;
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

type CachedCatalogue = {
  items: Title[];
  comicItems: Comic[];
  inlineComics: Comic[];
  page: number;
  next: number | null;
  total: number | null;
  ratingCoverage?: RatingCoverage;
};

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
  const cacheKey = `catalogue:${route}`;
  const [cached] = useState(() => readBrowseCache<CachedCatalogue>(cacheKey));
  const [items, setItems] = useState<Title[]>(cached?.items ?? []);
  const [comicItems, setComicItems] = useState<Comic[]>(cached?.comicItems ?? []);
  const [inlineComics, setInlineComics] = useState<Comic[]>(cached?.inlineComics ?? []);
  const [page, setPage] = useState(cached?.page ?? 1);
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
    if (!loading && (comicSearch ? comicItems.length : items.length)) {
      writeBrowseCache<CachedCatalogue>(cacheKey, { items, comicItems, inlineComics, page, next, total, ratingCoverage });
    }
  }, [cacheKey, items, comicItems, inlineComics, page, next, total, loading, ratingCoverage, comicSearch]);

  useEffect(() => {
    if (!search || selected !== '' || !text.trim()) { setInlineComics([]); return; }
    if (cached && cached.inlineComics.length > 0) return;
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
  }, [search, selected, text, cached]);

  useEffect(() => {
    if (cached && page === cached.page && attempt === 0) {
      if (search && !comicSearch && cached.items.some(item => !item.rating)) {
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
    if (from && to && from > to) { setFormError('The starting year must come before the ending year.'); form.current?.querySelector<HTMLInputElement>('[name=from]')?.focus(); return false; }
    setFormError('');
    navigate(filterRoute(path, values, params));
    return true;
  }

  const imdbValue = params.get('imdb') || '';
  const imdbOptions = imdbValue && !imdbPresetOptions.some(([key]) => key === imdbValue)
    ? [[imdbValue, `${imdbValue}+`] as const, ...imdbPresetOptions]
    : imdbPresetOptions;
  const moreFilterCount = ['from', 'to', 'runtime'].filter(key => Boolean(params.get(key))).length;
  const totalFilterCount = ['category', 'genre', 'decade', 'imdb', 'from', 'to', 'runtime'].filter(key => Boolean(params.get(key))).length;
  const isCompactBrowse = useMediaQuery('(max-width: 640px)');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  function submitMobile(event: FormEvent<HTMLFormElement>) {
    if (submit(event)) setMobileFiltersOpen(false);
  }

  return <div className="af-wrap af-directory">
    <PageHeading title={heading} />
    {(search || releases) && <div className="af-directory-tabs">
      <RouteTabs active={setType(selected)} label={search ? 'Search type' : 'Release type'} tabs={[
        ...(search ? [[setType(''), 'All']] as const : []),
        [setType('movie'), 'Movies'],
        [setType('tv'), 'TV Shows'],
        ...(search ? [[setType('anime'), 'Anime'], [setType('comic'), 'Manga']] as const : []),
      ]} />
    </div>}
    {!comicSearch && (isCompactBrowse ? (
      <div className="af-mobile-browse-bar">
        {!search && !releases && (
          <AfSelect
            ariaLabel="Sort by"
            className="af-mobile-quick-sort"
            value={params.get('sort') || 'popular'}
            options={sortOptions.map(([val, label]) => ({ value: val, label }))}
            onChange={value => {
              const nextParams = new URLSearchParams(params);
              nextParams.set('sort', value);
              nextParams.delete('page');
              navigate(routeWithParams(path, nextParams));
            }}
          />
        )}
        <MobileFilterSheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen} title="Filters" activeCount={totalFilterCount}>
          <form className="af-mobile-filter-form" ref={form} onSubmit={submitMobile}>
            {!animeSearch && <SelectField label="Genre" name="category" empty="All genres" value={params.get('category') || params.get('genre') || ''} options={catalogGenres.map(genre => [genre, genre])} />}
            {!releases && <SelectField label="Decade" name="decade" empty="Any decade" value={params.get('decade') || ''} options={decadeOptions} />}
            {!search && <SelectField label="Minimum IMDb rating" name="imdb" empty="Any rating" value={imdbValue} options={imdbOptions} />}
            {!search && !releases && <SelectField label="Sort by" name="sort" value={params.get('sort') || 'popular'} options={sortOptions} />}
            {!releases && <div className="af-mobile-year-pair">
              <InputField label="From year" aria-describedby={formError ? 'year-error' : undefined} aria-invalid={Boolean(formError)} name="from" type="number" min="1870" max="2099" defaultValue={params.get('from') || ''} />
              <InputField label="Through year" name="to" type="number" min="1870" max="2099" defaultValue={params.get('to') || ''} />
            </div>}
            {!search && <SelectField label={type === 'tv' ? 'Episode runtime' : 'Runtime'} name="runtime" empty="Any length" value={params.get('runtime') || ''} options={runtimeOptions} />}
            <button type="submit" className="af-button af-primary af-sheet-submit">Apply filters</button>
          </form>
        </MobileFilterSheet>
      </div>
    ) : (
      <form className="af-field-bar" ref={form} onSubmit={submit}>
        {!animeSearch && <SelectField label="Genre" name="category" empty="All genres" value={params.get('category') || params.get('genre') || ''} options={catalogGenres.map(genre => [genre, genre])} />}
        {!releases && <SelectField label="Decade" name="decade" empty="Any decade" value={params.get('decade') || ''} options={decadeOptions} />}
        {!search && <SelectField label="Minimum IMDb rating" name="imdb" empty="Any rating" value={imdbValue} options={imdbOptions} />}
        {!search && !releases && <SelectField label="Sort by" name="sort" value={params.get('sort') || 'popular'} options={sortOptions} />}
        <FilterPopover activeCount={moreFilterCount}>
          {!releases && <><InputField label="From year" aria-describedby={formError ? "year-error" : undefined} aria-invalid={Boolean(formError)} name="from" type="number" min="1870" max="2099" defaultValue={params.get('from') || ''} />
            <InputField label="Through year" name="to" type="number" min="1870" max="2099" defaultValue={params.get('to') || ''} /></>}
          {!search && <SelectField label={type === 'tv' ? 'Episode runtime' : 'Runtime'} name="runtime" empty="Any length" value={params.get('runtime') || ''} options={runtimeOptions} />}
        </FilterPopover>
        <button type="submit" className="af-button af-primary">Apply filters</button>
      </form>
    ))}
    {formError && <p className="af-state" id="year-error" role="alert">{formError}</p>}
    <ResultsSummary count={comicSearch ? (!loading && !error ? comicItems.length : null) : (total ?? (!loading && !error ? items.length : null))} loading={loading && page === 1 && !(comicSearch ? comicItems.length : items.length)} route={path} filters={params} clear={clear} labels={{ sort: sortLabel }} />
    {comicSearch ? (comicItems.length > 0 && <div className="af-poster-grid">{comicItems.map((item, index) => <ComicCard item={item} controls={controls} key={item.key} eager={index < 6} />)}</div>)
      : items.length > 0 && (releases ? <Releases items={items} controls={controls} /> :
        <div className="af-poster-grid">{items.map((item, index) => <MediaCard item={item} controls={controls} key={item.key} eager={index < 6} />)}</div>)}
    {search && selected === '' && inlineComics.length > 0 && <div className="af-discovery-shelves"><Shelf title="Matching manga" href={webHref(setType('comic'))}>
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
      }}>{error ? 'Retry loading more' : loading ? 'Loading more…' : comicSearch ? 'Load more manga' : 'Load more titles'}</button>
    </div>}
  </div>;
}
