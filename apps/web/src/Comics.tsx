import { comicEditionCredit, comicLanguage, groupComicEditions } from '@afterframe/shared/comic-display';
import { useEffect, useMemo, useRef, useState } from 'react';
import { comicCover, comicDetailsHref, navigate, previousBrowse, readBrowseCache, request, routeWithParams, webHref, writeBrowseCache, type Comic } from './catalog';
import { currentLocationHref, currentSearchParams } from './router';
import { InputField, PageHeading, ResultsSummary, RouteTabs, SelectField } from './Catalogue';
import { ActionLink, Artwork, Icon, Loading, RatingProblem, SaveButton, Score, Shelf, useOptionalRating } from './components';
import { readingStatuses, savedRating, type LibraryControls, type WatchStatus } from './library';
import { FolderPickerPopover } from './library/FolderPickerPopover';
import { AfSelect, MobileFilterSheet, useMediaQuery } from './UiControls';

const formats = [['', 'All'], ['manga', 'Manga'], ['manhwa', 'Manhwa'], ['manhua', 'Manhua']] as const;
const statuses = [['ongoing', 'Ongoing'], ['completed', 'Completed'], ['hiatus', 'On hiatus'], ['cancelled', 'Cancelled']] as const;
const sorts = [['popular', 'Popularity'], ['trending', 'Trending'], ['updated', 'Latest updates'], ['newest', 'Newly added'], ['rating', 'Top rated'], ['year', 'Publication year'], ['title', 'Title A–Z']] as const;
const quickSorts = [['trending', 'Trending'], ['updated', 'Latest updates'], ['newest', 'Newly added'], ['rating', 'Top rated']] as const;
const readingStatusOptions = Object.entries(readingStatuses).map(([value, label]) => ({ value, label }));
const comicRatingOptions = [
  { value: '0', label: 'Choose 1–10' },
  ...Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1), label: `${index + 1} / 10` })),
];
const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function releasedAgo(iso?: string, now = Date.now()) {
  const time = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(time)) return '';
  const minutes = Math.max(0, Math.round((now - time) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

function LatestRelease({ item }: { item: Comic }) {
  const ago = releasedAgo(item.latestAt);
  if (!ago) return null;
  const chapter = item.latestChapter ? `Ch. ${item.latestChapter}` : 'Updated';
  return <time className="af-poster-airing af-poster-latest" dateTime={item.latestAt}
    title={`${item.latestChapter ? `Chapter ${item.latestChapter}` : 'Latest chapter'} released ${fullDate.format(new Date(item.latestAt!))}`}>
    {chapter} · {ago}
  </time>;
}

export function comicHref(item: Pick<Comic, 'id'>) {
  return comicDetailsHref(item.id);
}

export function readerHref(item: Pick<Comic, 'id'>, chapter: string, language: string, page = 1, position = 1) {
  const variables = new URLSearchParams({ lang: language });
  if (page > 1) variables.set('page', String(page));
  if (position > 1) variables.set('position', String(position));
  const prior = currentLocationHref();
  const back = prior.startsWith('/comic/') ? currentSearchParams().get('back') : prior;
  if (back) variables.set('back', back);
  return webHref(routeWithParams(`comic/${encodeURIComponent(item.id)}/read/${encodeURIComponent(chapter)}`, variables));
}

function comicFacts(item: Comic, includeChapters = true) {
  const format = formats.find(([key]) => key && key === item.format)?.[1] ?? 'Manga';
  const status = statuses.find(([key]) => key === item.status)?.[1];
  const chapters = includeChapters ? (item.chapterCount || item.lastChapter) : '';
  const chapterLabel = chapters ? `${chapters} ch` : '';
  return [format, chapterLabel || item.year, status].filter(Boolean).join(' · ');
}

export function ComicCard({ item, controls, href, context, eager, onDismiss }: {
  item: Comic; controls: LibraryControls; href?: string; context?: string; eager?: boolean; onDismiss?: () => void;
}) {
  const cover = comicCover(item.poster);
  return <article className="af-media-card"><a href={href || comicHref(item)}>
    <span className="af-poster"><Artwork src={cover} loading={eager ? 'eager' : 'lazy'} decoding="async" fallback={<Icon name="book" />} />{!context && <LatestRelease item={item} />}</span>
    <strong>{item.title}</strong><span className="af-card-meta">{context || comicFacts(item)}</span>
    {!context && <Score mal={item.mal} />}
  </a>
    {onDismiss ? <button type="button" className="af-icon-button af-card-save af-card-dismiss"
      aria-label={`Remove ${item.title} from Continue reading`} title="Remove from Continue reading"
      onClick={onDismiss}><Icon name="close" /></button>
      : <SaveButton item={item} controls={controls} compact />}
  </article>;
}

type ComicsResults = { results: Comic[]; nextPage?: number | null };
type CachedComics = {
  items: Comic[];
  page: number;
  nextPage: number | null;
  recent: Comic[];
  trending: Comic[];
  chapterCounts: Record<string, string>;
};

export function ComicsPage({ query, controls }: { query: string; controls: LibraryControls }) {
  const params = new URLSearchParams(query);
  const cacheKey = `comics:${query}`;
  const [cached] = useState(() => readBrowseCache<CachedComics>(cacheKey));
  const [items, setItems] = useState<Comic[]>(cached?.items ?? []);
  const [page, setPage] = useState(cached?.page ?? 1);
  const [nextPage, setNextPage] = useState<number | null>(cached?.nextPage ?? null);
  const [loading, setLoading] = useState(!cached);
  const [recent, setRecent] = useState<Comic[]>(cached?.recent ?? []);
  const [trending, setTrending] = useState<Comic[]>(cached?.trending ?? []);
  const [genres, setGenres] = useState<NonNullable<Comic['genres']>>([]);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [auxError, setAuxError] = useState({ genres: false, updates: false });
  const [genreAttempt, setGenreAttempt] = useState(0);
  const [updateAttempt, setUpdateAttempt] = useState(0);
  const [chapterCounts, setChapterCounts] = useState<Record<string, string>>(cached?.chapterCounts ?? {});
  const requestedCountsRef = useRef<Set<string>>(new Set(Object.keys(cached?.chapterCounts ?? {})));
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const isCompactBrowse = useMediaQuery('(max-width: 640px)');
  const type = params.get('type') || '';
  const text = params.get('q') || '';
  const selectedGenre = params.get('genre') || '';
  const sort = params.get('sort') || '';
  const genreOptions = genres.map(genre => [genre.id, genre.name] as const);
  if (selectedGenre && !genreOptions.some(([id]) => id === selectedGenre)) genreOptions.unshift([selectedGenre, 'Selected genre']);
  const comicFilterCount = ['genre', 'status', 'sort'].filter(key => Boolean(params.get(key))).length;

  useEffect(() => {
    if (!loading && items.length) {
      writeBrowseCache<CachedComics>(cacheKey, { items, page, nextPage, recent, trending, chapterCounts });
    }
  }, [cacheKey, items, page, nextPage, recent, trending, chapterCounts, loading]);

  useEffect(() => {
    if (cached && page === cached.page && attempt === 0) return;
    const task = new AbortController();
    const { signal } = task;
    const reqParams = new URLSearchParams(query);
    reqParams.set('page', String(page));
    request<ComicsResults>(`/api/comics?${reqParams}`, { signal })
      .then(value => {
        if (!Array.isArray(value.results)) throw new Error('The manga catalog returned invalid results.');
        if (signal.aborted) return;
        setItems(current => page === 1 ? value.results : [...new Map([...current, ...value.results].map(item => [item.key, item])).values()]);
        setNextPage(value.nextPage ?? null);
      })
      .catch(problem => { if (!signal.aborted) setError(problem.message); })
      .finally(() => { if (!signal.aborted) setLoading(false); });
    return () => task.abort();
  }, [query, page, attempt, cached]);

  useEffect(() => {
    const task = new AbortController();
    request<{ genres: NonNullable<Comic['genres']> }>('/api/comics/genres', { signal: task.signal })
      .then(data => {
        if (!Array.isArray(data.genres)) throw new Error('Genres unavailable.');
        if (!task.signal.aborted) {
          setGenres(data.genres);
          setAuxError(current => ({ ...current, genres: false }));
        }
      }).catch(() => { if (!task.signal.aborted) setAuxError(current => ({ ...current, genres: true })); });
    return () => task.abort();
  }, [genreAttempt]);

  useEffect(() => {
    if (query) return;
    if (cached && cached.recent.length > 0 && updateAttempt === 0) return;
    const task = new AbortController();
    request<ComicsResults>('/api/comics/updates', { signal: task.signal })
      .then(data => {
        if (!Array.isArray(data.results)) throw new Error('Updates unavailable.');
        if (!task.signal.aborted) {
          setRecent(data.results);
          setAuxError(current => ({ ...current, updates: false }));
        }
      }).catch(() => { if (!task.signal.aborted) setAuxError(current => ({ ...current, updates: true })); });
    return () => task.abort();
  }, [query, updateAttempt, cached]);

  useEffect(() => {
    if (query) return;
    if (cached && cached.trending.length > 0) return;
    const task = new AbortController();
    request<ComicsResults>('/api/comics?sort=trending', { signal: task.signal })
      .then(data => { if (!task.signal.aborted && Array.isArray(data.results)) setTrending(data.results.slice(0, 18)); })
      .catch(() => {});
    return () => task.abort();
  }, [query, cached]);

  useEffect(() => {
    const requested = requestedCountsRef.current;
    const missing = [...new Set([...recent, ...trending, ...items]
      .filter(item => !item.lastChapter && !item.chapterCount && !requested.has(item.id))
      .map(item => item.id))];
    if (!missing.length) return;
    const task = new AbortController();
    const { signal } = task;
    for (const id of missing) requested.add(id);
    const pending = new Set(missing);
    void (async () => {
      for (let i = 0; i < missing.length; i += 8) {
        if (signal.aborted) break;
        const batch = missing.slice(i, i + 8);
        try {
          const data = await request<{ counts?: Record<string, string> }>(`/api/comics/counts?ids=${encodeURIComponent(batch.join(','))}`, { signal });
          for (const id of batch) pending.delete(id);
          if (!signal.aborted && data.counts && Object.keys(data.counts).length) {
            setChapterCounts(current => ({ ...current, ...data.counts }));
          }
        } catch {
          if (signal.aborted) break;
          for (const id of batch) pending.delete(id);
        }
      }
    })();
    return () => {
      task.abort();
      for (const id of pending) requested.delete(id);
    };
  }, [recent, trending, items]);

  const withChapterCount = (item: Comic) => (
    item.chapterCount || item.lastChapter || !chapterCounts[item.id]
      ? item
      : { ...item, chapterCount: chapterCounts[item.id] }
  );

  function withParam(name: string, value: string) {
    const update = new URLSearchParams(params);
    update.delete('page');
    if (value) update.set(name, value); else update.delete(name);
    return routeWithParams('comics', update);
  }

  return <div className="af-wrap af-directory">
    <PageHeading title="Manga" />
    <div className="af-catalog-tools">
      <RouteTabs tabs={formats.map(([key, label]) => [withParam('type', key), label])} active={withParam('type', type)} label="Manga formats" />
      {isCompactBrowse ? (
        <div className="af-mobile-browse-bar af-mobile-comic-bar">
          <form className="af-mobile-search-inline" onSubmit={event => {
            event.preventDefault();
            const update = new URLSearchParams(params);
            update.delete('page');
            const val = String(new FormData(event.currentTarget).get('q') || '').trim();
            if (val) update.set('q', val); else update.delete('q');
            navigate(routeWithParams('comics', update));
          }}>
            <input name="q" className="af-select af-input" type="search" placeholder="Search manga…" aria-label="Find manga" maxLength={180} defaultValue={text} />
          </form>
          <MobileFilterSheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen} title="Filters" activeCount={comicFilterCount}>
            <form className="af-mobile-filter-form" onSubmit={event => {
              event.preventDefault();
              const update = new URLSearchParams();
              if (type) update.set('type', type);
              if (text) update.set('q', text);
              for (const [key, value] of new FormData(event.currentTarget)) if (typeof value === 'string' && value.trim()) update.set(key, value.trim());
              setMobileFiltersOpen(false);
              navigate(routeWithParams('comics', update));
            }}>
              <div className="af-facet-with-status">
                <SelectField label="Genre" name="genre" empty="All genres" value={selectedGenre} options={genreOptions} />
                {auxError.genres && <p className="af-meta" role="status">Genres are unavailable. <button type="button" className="af-text-link" onClick={() => setGenreAttempt(value => value + 1)}>Retry genres</button></p>}
              </div>
              <SelectField label="Status" name="status" empty="Any status" value={params.get('status') || ''} options={statuses} />
              <SelectField label="Sort by" name="sort" empty={text ? 'Relevance' : 'Default order'} value={params.get('sort') || ''} options={sorts} />
              <button className="af-button af-primary af-sheet-submit" type="submit">Apply filters</button>
            </form>
          </MobileFilterSheet>
        </div>
      ) : (
        <form className="af-field-bar" onSubmit={event => {
          event.preventDefault();
          const update = new URLSearchParams();
          if (type) update.set('type', type);
          for (const [key, value] of new FormData(event.currentTarget)) if (typeof value === 'string' && value.trim()) update.set(key, value.trim());
          navigate(routeWithParams('comics', update));
        }}>
          <div className="af-catalog-search"><InputField name="q" label="Find manga" type="search" placeholder="Search manga…" maxLength={180} defaultValue={text} /></div>
          <div className="af-facet-with-status">
            <SelectField label="Genre" name="genre" empty="All genres" value={selectedGenre} options={genreOptions} />
            {auxError.genres && <p className="af-meta" role="status">Genres are unavailable. <button type="button" className="af-text-link" onClick={() => setGenreAttempt(value => value + 1)}>Retry genres</button></p>}
          </div>
          <SelectField label="Status" name="status" empty="Any status" value={params.get('status') || ''} options={statuses} />
          <SelectField label="Sort by" name="sort" empty={text ? 'Relevance' : 'Default order'} value={params.get('sort') || ''} options={sorts} />
          <button className="af-button af-primary" type="submit">Apply filters</button>
        </form>
      )}
    </div>
    {auxError.updates && <p className="af-state" role="alert">Recently updated manga could not load. <button type="button" className="af-text-link" onClick={() => setUpdateAttempt(value => value + 1)}>Retry updates</button></p>}
    {!query && recent.length > 0 && <Shelf title="Latest updates" href={webHref(withParam('sort', 'updated'))} hrefLabel="See all updates">
      {recent.map((item, index) => <ComicCard item={withChapterCount(item)} key={item.key} controls={controls} eager={index < 5} />)}
    </Shelf>}
    {!query && trending.length > 0 && <Shelf title="Trending now" href={webHref(withParam('sort', 'trending'))} hrefLabel="See all trending">
      {trending.map(item => <ComicCard item={withChapterCount(item)} key={item.key} controls={controls} />)}
    </Shelf>}
    {!query && (recent.length > 0 || trending.length > 0) && <h2 className="af-comic-catalog-heading">Browse the catalog</h2>}
    <div className="af-comic-sort"><RouteTabs
      label="Sort manga"
      tabs={[[withParam('sort', ''), text ? 'Best match' : 'Popular'], ...quickSorts.map(([key, label]) => [withParam('sort', key), label] as const)]}
      active={withParam('sort', sort === 'popular' && !text ? '' : sort)}
    /></div>
    <ResultsSummary count={!loading || items.length ? items.length : null} loading={loading && page === 1 && !items.length} route="comics" filters={params} clear={webHref('comics')} labels={{
      type: value => formats.find(([key]) => key === value)?.[1] ?? '',
      genre: value => genreOptions.find(([id]) => id === value)?.[1] ?? '',
      status: value => statuses.find(([key]) => key === value)?.[1] ?? '',
      sort: value => sorts.find(([key]) => key === value)?.[1] ?? '',
    }} />
    {items.length > 0 && <div className="af-poster-grid">{items.map((item, index) => <ComicCard item={withChapterCount(item)} key={item.key} controls={controls} eager={!recent.length && index < 6} />)}</div>}
    {loading && page === 1 && <Loading label="Loading manga…" />}
    {error && page === 1 && <p className="af-state" role="alert">{error} <button className="af-text-link" type="button" onClick={() => { setError(''); setLoading(true); setAttempt(value => value + 1); }}>Retry</button></p>}
    {!loading && !error && !items.length && <p className="af-state" role="status">{query ? 'No manga match these filters.' : 'No manga are available in the catalog yet.'}</p>}
    {page > 1 && <p className="af-meta" role="status">{loading ? 'Loading more manga…' : error || `${items.length} manga shown`}</p>}
    {(nextPage || (page > 1 && (loading || error))) && <div className="af-pagination">
      <button type="button" className="af-button af-secondary" aria-disabled={loading} onClick={() => {
        if (loading) return;
        setLoading(true);
        if (error) { setError(''); setAttempt(value => value + 1); }
        else if (nextPage) setPage(nextPage);
      }}>{error ? 'Retry loading more' : loading ? 'Loading more…' : 'Load more manga'}</button>
    </div>}
  </div>;
}

type ComicRecord = Comic & { synopsis?: string; author?: string[]; languages: string[]; defaultLanguage: string; malId?: number };
type Chapter = { id: string; label: string; number?: string | number; title?: string; language: string; groups?: (string | { name?: string })[]; source?: string; releasedAt?: string };
type Chapters = { results: Chapter[]; nextPage?: number | null; ranges?: { start: string; end: string }[]; totalChapters?: number; partial?: boolean; preview?: boolean };

export function ComicDetailsPage({ id, query, controls }: { id: string; query: string; controls: LibraryControls }) {
  const [item, setItem] = useState<ComicRecord>();
  const [chapterResult, setChapterResult] = useState<{ key: string; data: Chapters }>();
  const [related, setRelated] = useState<Comic[]>([]);
  const mal = useOptionalRating<number>(item?.malId ? `/api/mal/manga/${item.malId}?status=1` : undefined);
  const [error, setError] = useState('');
  const [chapterError, setChapterError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [chapterAttempt, setChapterAttempt] = useState(0);
  const [chapterPending, setChapterPending] = useState(false);
  const [chapterQuery, setChapterQuery] = useState('');
  const [chapterOrder, setChapterOrder] = useState<'asc' | 'desc'>('asc');
  const [coverFailed, setCoverFailed] = useState(false);
  const params = new URLSearchParams(query);
  const recent = item && controls.library.reading[item.key];
  const preferred = params.get('lang') || recent?.language || item?.defaultLanguage || 'en';
  const language = item?.languages.includes(preferred) ? preferred : item?.defaultLanguage;
  const chapterKey = `${id}:${language}`;
  const chapters = chapterResult?.key === chapterKey ? chapterResult.data : undefined;

  useEffect(() => {
    const task = new AbortController();
    const { signal } = task;
    request<ComicRecord>(`/api/comics/${id}`, { signal })
      .then(value => {
        if (signal.aborted) return;
        if (!Array.isArray(value.languages) || typeof value.title !== 'string') throw new Error('This manga record is incomplete.');
        setItem(value);
        document.title = `${value.title} · Afterframe`;
      }).catch(problem => { if (!signal.aborted) setError(problem.message); });
    return () => task.abort();
  }, [id, attempt]);

  useEffect(() => {
    const task = new AbortController();
    request<{ results: Comic[] }>(`/api/comics/${id}/related`, { signal: task.signal })
      .then(result => { if (!task.signal.aborted && Array.isArray(result.results)) setRelated(result.results); })
      .catch(() => {});
    return () => task.abort();
  }, [id]);

  useEffect(() => {
    if (!language) return;
    const task = new AbortController();
    const { signal } = task;
    const path = `/api/comics/${id}/chapters?${new URLSearchParams({ lang: language, all: '1' })}`;
    let complete = false;
    setChapterError('');
    setChapterPending(true);
    request<Chapters>(path, { signal })
      .then(result => {
        if (!Array.isArray(result.results)) throw new Error('The chapter source returned invalid results.');
        complete = true;
        if (!signal.aborted) setChapterResult({ key: chapterKey, data: result });
      })
      .catch(problem => { if (!signal.aborted) setChapterError(problem.message); })
      .finally(() => { if (!signal.aborted) setChapterPending(false); });
    request<Chapters>(`${path}&scope=native`, { signal }).then(result => {
      if (!signal.aborted && !complete && result.results.length) setChapterResult({ key: chapterKey, data: result });
    }).catch(() => {});
    return () => task.abort();
  }, [id, language, chapterAttempt, chapterKey]);

  const groupedChapters = useMemo(() => (chapters ? groupComicEditions(chapters.results) : []), [chapters]);
  const filteredChapters = useMemo(() => {
    const ordered = chapterOrder === 'desc' ? [...groupedChapters].reverse() : groupedChapters;
    const needle = chapterQuery.trim().toLowerCase();
    if (!needle) return ordered;
    const numeric = /^\d+(?:\.\d+)?$/.test(needle);
    const matches = ordered.filter(editions => editions.some(entry => {
      const num = entry.number != null ? String(entry.number).toLowerCase() : '';
      const credit = comicEditionCredit(entry).toLowerCase();
      return num.includes(needle)
        || entry.label.toLowerCase().includes(needle)
        || (entry.title?.toLowerCase().includes(needle) ?? false)
        || credit.includes(needle);
    }));
    if (!numeric) return matches;
    return matches.sort((a, b) => {
      const aExact = a.some(entry => String(entry.number ?? '') === needle) ? 0 : 1;
      const bExact = b.some(entry => String(entry.number ?? '') === needle) ? 0 : 1;
      return aExact - bExact;
    });
  }, [groupedChapters, chapterQuery, chapterOrder]);

  if (!item || !language) return <div className="af-wrap af-directory">
    <PageHeading title={error ? 'Manga unavailable' : 'Manga'} />
    {error ? <p className="af-state" role="alert">{error} <button className="af-text-link" type="button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry</button></p>
      : <Loading label="Loading manga…" shape="hero" />}
  </div>;

  const cover = coverFailed ? undefined : comicCover(item.poster);
  const first = chapters?.results[0];
  const synopsis = item.synopsis?.split(/\n(?:-{3,}|\*\*Links:)/i)[0].trim();
  const retryChapters = () => { setChapterError(''); setChapterAttempt(value => value + 1); };
  const saved = controls.library.saved[item.key];
  const listing = (lang: string) => routeWithParams(`comic/${id}`, new URLSearchParams({ lang, ...(params.has('back') ? { back: params.get('back')! } : {}) }));
  const chapterTotal = chapters?.totalChapters ?? (groupedChapters.length > 0 ? groupedChapters.length : null);
  const lastRelease = chapters?.results.reduce<string | undefined>((latest, entry) => entry.releasedAt && (!latest || entry.releasedAt > latest) ? entry.releasedAt : latest, undefined);
  const chapterFact = chapterTotal != null
    ? `${chapterTotal} ${chapterTotal === 1 ? 'chapter' : 'chapters'}`
    : item.lastChapter
      ? `${item.lastChapter} ${item.lastChapter === '1' ? 'chapter' : 'chapters'}`
      : '';

  return <>
    <section className={`af-hero af-details-hero af-comic-hero ${cover ? '' : 'af-no-backdrop'}`}>
      {cover && <img className="af-backdrop af-comic-hero-backdrop" src={cover} alt="" aria-hidden="true" />}
      <div className="af-wrap af-hero-inner">
        <a href={previousBrowse('comics')} className="af-text-link af-back"><Icon name="left" /> Back to browse</a>
        <div className={`af-comic-intro ${cover ? '' : 'af-no-cover'}`}>
          {cover && <img className="af-comic-cover" src={cover} alt="" fetchPriority="high" onError={() => setCoverFailed(true)} />}
          <div className="af-copy">
            <h1>{item.title}</h1>
            <div className="af-meta af-details-meta af-title-facts">
              <span>{comicFacts(item, false)}</span>
              {chapterFact && <a href="#chapters" className="af-fact-link af-tabular">{chapterFact}</a>}
              {lastRelease && <time dateTime={lastRelease} title={fullDate.format(new Date(lastRelease))}>Updated {releasedAgo(lastRelease)}</time>}
              {item.genres?.slice(0, 3).map(g => <span key={g.id}>{g.name}</span>)}
              <Score mal={mal.value} />
            </div>
            <RatingProblem name="MyAnimeList" rating={mal} />
            {item.author && item.author.length > 0 && <p className="af-meta">By {item.author.join(', ')}</p>}
            {synopsis && <p className="af-overview">{synopsis}</p>}
            <div className="af-actions">
              {recent ? <ActionLink primary href={readerHref(item, recent.chapter, recent.language, recent.listPage, recent.page)}><Icon name="book" /> Resume {recent.label} · Page {recent.page}</ActionLink>
                : first ? <ActionLink primary href={readerHref(item, first.id, first.language, 1)}><Icon name="book" /> Start reading</ActionLink>
                  : <button type="button" className="af-button af-primary" disabled><Icon name="book" /> {chapterPending ? 'Loading chapters…' : 'No chapters yet'}</button>}
              <SaveButton item={item} controls={controls} />
              {saved && <AfSelect
                ariaLabel="Reading status"
                value={saved.watchStatus ?? 'planned'}
                disabled={!controls.ready || controls.isPending(item.key)}
                options={readingStatusOptions}
                onChange={value => void controls.setComicStatus(item, value as WatchStatus)}
              />}
              <FolderPickerPopover itemKey={item.key} itemTitle={item.title} controls={controls} />
            </div>
          </div>
        </div>
        <div className="af-details-footer">
          <div className="af-rating">
            <span>Your rating</span>
            <AfSelect
              ariaLabel="Your rating"
              value={String(savedRating(controls.library.ratings[item.key]))}
              disabled={!controls.ready || controls.isPending(item.key)}
              options={comicRatingOptions}
              onChange={value => void controls.rate(item, Number(value))}
            />
          </div>
        </div>
      </div>
    </section>

    <div className="af-wrap af-content">
      <section id="chapters" className="af-section" tabIndex={-1} aria-labelledby="chapters-heading">
        <header className="af-section-head">
          <div>
            <h2 id="chapters-heading">Chapters</h2>
            {chapters?.totalChapters != null && <p className="af-meta" role="status">
              {chapterQuery.trim() ? `${filteredChapters.length} of ${chapters.totalChapters} chapters` : `${chapters.totalChapters} chapters`}
            </p>}
          </div>
          <div className="af-actions af-chapter-controls">
            <input
              type="search"
              className="af-select af-input af-chapter-search"
              placeholder="Search chapter # or title"
              aria-label="Search chapters"
              value={chapterQuery}
              onChange={event => setChapterQuery(event.target.value)}
            />
            <button
              type="button"
              className="af-button af-secondary"
              onClick={() => setChapterOrder(order => order === 'asc' ? 'desc' : 'asc')}
            >
              {chapterOrder === 'asc' ? 'Oldest first' : 'Newest first'}
            </button>
            <AfSelect
              ariaLabel="Language"
              value={language}
              options={[...new Set(item.languages)].sort().map(code => ({ value: code, label: comicLanguage(code) }))}
              onChange={value => { setChapterQuery(''); navigate(listing(value)); }}
            />
          </div>
        </header>
        {chapterError && <p className="af-state" role="alert">{chapterError} <button type="button" className="af-text-link" onClick={retryChapters}>Retry</button></p>}
        {chapterPending && chapters && <p className="af-state" role="status">{chapters.preview ? 'Checking other chapter sources…' : 'Updating chapters…'}</p>}
        {!chapters && !chapterError && <Loading label="Loading chapters…" shape="rows" />}
        {chapters && !chapters.results.length && !chapters.partial && !chapterPending && <p className="af-state" role="status">No chapters are available in this language.</p>}
        {chapters?.partial && !chapterError && <p className="af-state" role="status">Some chapter sources are temporarily unavailable. <button type="button" className="af-text-link" onClick={retryChapters}>Retry sources</button></p>}
        {chapters && chapters.results.length > 0 && !filteredChapters.length && <p className="af-state" role="status">No chapters match “{chapterQuery.trim()}”.</p>}
        {filteredChapters.length > 0 && <div className="af-chapter-list">
          {filteredChapters.map(editions => {
            const chapter = editions.find(release => release.id === recent?.chapter) ?? editions[0];
            const credits = comicEditionCredit(chapter);
            const released = chapter.releasedAt ?? editions.find(release => release.releasedAt)?.releasedAt;
            const otherEditions = editions.filter(release => release.id !== chapter.id);
            return <article className="af-activity-row" key={chapter.id}>
              <div><strong>{chapter.label}{chapter.title ? ` · ${chapter.title}` : ''}</strong>{chapter.id === recent?.chapter && <p className="af-meta">Last read · Page {recent.page}</p>}
                {(credits || released) && <p className="af-meta">
                  {credits}{credits && released ? ' · ' : ''}
                  {released && <time dateTime={released} title={fullDate.format(new Date(released))}>{shortDate.format(new Date(released))}</time>}
                </p>}
                {otherEditions.length > 0 && <details>
                  <summary>{otherEditions.length} other {otherEditions.length === 1 ? 'edition' : 'editions'}</summary>
                  <ul>{otherEditions.map((release, index) => <li key={release.id}>
                    <a className="af-text-link" href={readerHref(item, release.id, release.language, 1)}>
                      Read {release.label} · {comicEditionCredit(release) || release.title || `Edition ${index + 2}`}
                    </a>
                  </li>)}</ul>
                </details>}
              </div>
              <ActionLink href={readerHref(item, chapter.id, chapter.language, 1, chapter.id === recent?.chapter ? recent.page : 1)} label={`${chapter.id === recent?.chapter ? 'Resume' : 'Read'} ${chapter.label}${credits ? ` from ${credits}` : ''}`}>{chapter.id === recent?.chapter ? 'Resume' : 'Read'}</ActionLink>
            </article>;
          })}
        </div>}
      </section>

      {related.length > 0 && <div id="related" tabIndex={-1}><Shelf title="Related manga">
        {related.map(other => <ComicCard item={other} controls={controls} key={other.key} />)}
      </Shelf></div>}
    </div>
  </>;
}
