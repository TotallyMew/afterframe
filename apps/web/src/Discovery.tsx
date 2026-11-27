import { useEffect, useMemo, useRef, useState } from 'react';
import { navigate, normalizeTitles, readBrowseCache, request, routeWithParams, searchHref, webHref, writeBrowseCache, type CatalogRating, type MediaType, type RawTitle, type Title } from './catalog';
import { currentLocationHref } from './router';
import { CollectionTabs, InputField, PageHeading, ResultsSummary, SelectField } from './Catalogue';
import { Artwork, CatalogProblem, Icon, Loading, MediaCard, SaveButton, Shelf } from './components';
import { guestRecommendations, type LibraryControls } from './library';
import { FilterPopover } from './UiControls';

const seasons = [['WINTER', 'Winter'], ['SPRING', 'Spring'], ['SUMMER', 'Summer'], ['FALL', 'Fall']] as const;
const formats = [['TV', 'TV'], ['TV_SHORT', 'TV short'], ['MOVIE', 'Movie'], ['OVA', 'OVA'], ['ONA', 'ONA'], ['SPECIAL', 'Special']] as const;
const statuses = [['RELEASING', 'Currently airing'], ['NOT_YET_RELEASED', 'Upcoming'], ['FINISHED', 'Finished'], ['CANCELLED', 'Cancelled'], ['HIATUS', 'On hiatus']] as const;
const audioOptions = [['dub', 'Dubbed'], ['dub-airing', 'Dub airing'], ['sub-airing', 'Sub airing'], ['sub', 'Sub only']] as const;
const sorts = [['POPULARITY_DESC', 'Popularity'], ['START_DATE_DESC', 'Newest first'], ['START_DATE', 'Oldest first']] as const;

const genreSuggestions = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Mecha', 'Mystery', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'];
const themeSuggestions = ['Coming of Age', 'Found Family', 'Isekai', 'Magic', 'School', 'Space', 'Super Power', 'Time Manipulation', 'Urban Fantasy'];
const compactAirDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fullAirDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

type AnimeEntry = {
  id: number;
  title?: { english?: string; romaji?: string };
  coverImage?: { large?: string };
  catalog?: string;
  catalogSeason?: number;
  format?: string;
  status?: string;
  startDate?: { year?: number };
  episodes?: number;
  mal?: number;
  hasDub?: boolean;
  subAiring?: boolean;
  dubAiring?: boolean;
  nextAiringEpisode?: { episode: number; airingAt: number };
};
type AnimeResults = { results: AnimeEntry[]; nextPage?: number | null };

function animeToSavedTitle(entry: AnimeEntry, cover?: string): Title | null {
  const match = entry.catalog?.match(/^(movie|tv)\/([1-9]\d{0,9})$/);
  if (!match) return null;
  const type = match[1] as MediaType;
  const id = Number(match[2]);
  return {
    key: `${type}-${id}`,
    type,
    id,
    title: entry.title?.english || entry.title?.romaji || 'Anime',
    year: entry.startDate?.year ? String(entry.startDate.year) : undefined,
    poster: cover,
    genre: 'Animation',
    genreIds: [16],
    originalLanguage: 'ja',
  };
}

type CachedAnime = { entries: AnimeEntry[]; page: number; nextPage: number | null };

function animeAudioLabel(entry: AnimeEntry): string {
  if (entry.subAiring && entry.dubAiring) return 'Sub & Dub airing';
  if (entry.dubAiring) return 'Dub airing';
  if (entry.subAiring) return 'Sub airing';
  if (entry.hasDub) return 'Sub / Dub';
  return entry.status && entry.status !== 'NOT_YET_RELEASED' ? 'Sub' : '';
}

function animeAiringBadge(entry: AnimeEntry) {
  const next = entry.nextAiringEpisode;
  const nextDate = next ? new Date(next.airingAt * 1000) : null;
  if (next && nextDate && nextDate.getTime() > Date.now()) {
    const dubTitle = entry.dubAiring ? ' · Dub airing' : '';
    const dubBadge = entry.dubAiring ? ' · Dub' : '';
    return (
      <time className="af-poster-airing" dateTime={nextDate.toISOString()} title={`Sub Episode ${next.episode} airs ${fullAirDate.format(nextDate)}${dubTitle}`}>
        Sub Ep {next.episode} · {compactAirDate.format(nextDate)}{dubBadge}
      </time>
    );
  }
  if (entry.dubAiring) return <span className="af-poster-airing">Dub airing</span>;
  return null;
}

function animeEntryHref(entry: AnimeEntry, title: string): { href: string; matched: boolean } {
  const matched = /^(movie|tv)\/[1-9]\d{0,9}$/.test(entry.catalog || '');
  if (!matched) return { href: searchHref(entry.title?.romaji || title, { type: 'anime' }), matched: false };
  const linkParams = new URLSearchParams();
  if (entry.catalog?.startsWith('tv/') && entry.catalogSeason && entry.catalogSeason > 1) {
    linkParams.set('season', String(entry.catalogSeason));
  }
  const priorHref = currentLocationHref();
  if (priorHref) linkParams.set('back', priorHref);
  return { href: webHref(routeWithParams(entry.catalog!, linkParams)), matched: true };
}

function AnimeEntryCard({
  entry,
  index,
  isSeasonal,
  controls,
}: Readonly<{
  entry: AnimeEntry;
  index: number;
  isSeasonal: boolean;
  controls: LibraryControls;
}>) {
  const title = entry.title?.english || entry.title?.romaji || 'Anime';
  const { href, matched } = animeEntryHref(entry, title);
  const coverUrl = entry.coverImage?.large || '';
  const cover = coverUrl.startsWith('https://s4.anilist.co/') ? coverUrl : undefined;
  const saveTarget = animeToSavedTitle(entry, cover);
  const formatLabel = formats.find(([key]) => key === entry.format)?.[1];
  const meta = [
    formatLabel,
    isSeasonal && entry.catalogSeason && entry.catalogSeason > 1 ? `S${entry.catalogSeason}` : '',
    entry.episodes ? `${entry.episodes} ep` : entry.startDate?.year,
    animeAudioLabel(entry),
  ].filter(Boolean).join(' · ');
  let searchSuffix = '';
  if (!matched) searchSuffix = meta ? ' · Search' : 'Search catalog';

  return (
    <article className="af-media-card af-anime-card">
      <a href={href}>
        <span className="af-poster">
          <Artwork src={cover} loading={index < 6 ? 'eager' : 'lazy'} fallback={<Icon name="film" />} />
          {entry.mal != null && entry.mal > 0 && (
            <span className="af-poster-badge">
              <span className="sr-only">MyAnimeList score </span>
              <span aria-hidden="true">★</span> {entry.mal.toFixed(1)}
            </span>
          )}
          {animeAiringBadge(entry)}
        </span>
        <strong title={title}>{title}</strong>
        <span className="af-card-meta">
          {meta}{searchSuffix}
        </span>
      </a>
      {saveTarget && <SaveButton item={saveTarget} controls={controls} compact />}
    </article>
  );
}

function loadMoreAnimeLabel(error: string, loading: boolean): string {
  if (error) return 'Retry loading more';
  return loading ? 'Loading more…' : 'Load more anime';
}

export function AnimePage({ query, controls }: Readonly<{ query: string; controls: LibraryControls }>) {
  const params = new URLSearchParams(query);
  const date = new Date();
  if (!query) {
    params.set('season', seasons[Math.floor(date.getMonth() / 3)][0]);
    params.set('year', String(date.getFullYear()));
  }
  const isSeasonal = params.has('season') || params.has('year');
  const baseQuery = params.toString();
  const cacheKey = `anime:${baseQuery}`;
  const [cached] = useState(() => readBrowseCache<CachedAnime>(cacheKey));
  const [entries, setEntries] = useState<AnimeEntry[]>(cached?.entries ?? []);
  const [page, setPage] = useState(cached?.page ?? 1);
  const [nextPage, setNextPage] = useState<number | null>(cached?.nextPage ?? null);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [rangeError, setRangeError] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (!loading && entries.length) {
      writeBrowseCache<CachedAnime>(cacheKey, { entries, page, nextPage });
    }
  }, [cacheKey, entries, page, nextPage, loading]);

  useEffect(() => {
    if (cached && page === cached.page && retry === 0) return;
    const task = new AbortController();
    const reqParams = new URLSearchParams(baseQuery);
    reqParams.set('page', String(page));
    request<AnimeResults>(`/api/anime-discovery?${reqParams}`, { signal: task.signal })
      .then(result => {
        if (!Array.isArray(result.results) || result.results.some(item => !item || !Number.isInteger(item.id))) {
          throw new Error('The anime catalog returned invalid results.');
        }
        if (task.signal.aborted) return;
        setEntries(current => {
          const combined = page === 1 ? result.results : [...current, ...result.results];
          const seenIds = new Set<number>();
          const seenCatalogs = new Set<string>();
          return combined.filter(item => {
            if (seenIds.has(item.id)) return false;
            seenIds.add(item.id);
            // Deduplicate multi-season AniList entries pointing to the same TMDb series in All Anime view.
            if (!isSeasonal && item.catalog) {
              if (seenCatalogs.has(item.catalog)) return false;
              seenCatalogs.add(item.catalog);
            }
            return true;
          });
        });
        setNextPage(result.nextPage ?? null);
      })
      .catch(error_ => { if (!task.signal.aborted) setError(error_.message); })
      .finally(() => { if (!task.signal.aborted) setLoading(false); });
    return () => task.abort();
  }, [baseQuery, page, retry, isSeasonal, cached]);

  const moreAnimeCount = ['genre', 'theme', 'min', 'max', 'sort'].filter(name => {
    const val = params.get(name);
    return Boolean(val) && !(name === 'sort' && val === 'POPULARITY_DESC');
  }).length;

  return <div className="af-wrap af-directory">
    <PageHeading title="Anime" />
    <div className="af-catalog-tools">
      <CollectionTabs type="anime" active={isSeasonal ? 'anime' : 'anime?view=all'} />
      <form className="af-field-bar" onSubmit={event => {
        event.preventDefault();
        const formEl = event.currentTarget;
        const next = new URLSearchParams();
        for (const [key, value] of new FormData(formEl)) if (typeof value === 'string' && value.trim()) next.set(key, value.trim());
        if (next.has('min') && next.has('max') && Number(next.get('min')) > Number(next.get('max'))) {
          setRangeError('Minimum episodes must be less than or equal to maximum episodes.');
          setMoreOpen(true);
          requestAnimationFrame(() => formEl.querySelector<HTMLInputElement>('[name=min]')?.focus());
          return;
        }
        setRangeError('');
        setMoreOpen(false);
        if (!next.size || next.toString() === 'sort=POPULARITY_DESC') next.set('view', 'all');
        navigate(routeWithParams('anime', next));
      }}>
        <SelectField label="Season" name="season" empty="Any season" value={params.get('season') || ''} options={seasons} />
        <InputField label="Year" type="number" name="year" min="1900" max="2100" defaultValue={params.get('year') || ''} />
        <SelectField label="Format" name="format" empty="Any format" value={params.get('format') || ''} options={formats} />
        <SelectField label="Status" name="status" empty="Any status" value={params.get('status') || ''} options={statuses} />
        <SelectField label="Audio" name="audio" empty="Any audio" value={params.get('audio') || ''} options={audioOptions} />
        <FilterPopover activeCount={moreAnimeCount} open={moreOpen} onOpenChange={setMoreOpen}>
          <SelectField
            label="Genre"
            name="genre"
            empty="Any genre"
            value={params.get('genre') || ''}
            options={genreSuggestions.map(name => [name, name] as const)}
          />
          <SelectField
            label="Theme"
            name="theme"
            empty="Any theme"
            value={params.get('theme') || ''}
            options={themeSuggestions.map(name => [name, name] as const)}
          />
          <InputField label="Minimum episodes" name="min" placeholder="Any" aria-invalid={Boolean(rangeError)} aria-describedby={rangeError ? 'episode-range-error' : undefined} type="number" min="1" max="5000" defaultValue={params.get('min') || ''} />
          <InputField label="Maximum episodes" name="max" placeholder="Any" aria-invalid={Boolean(rangeError)} aria-describedby={rangeError ? 'episode-range-error' : undefined} type="number" min="1" max="5000" defaultValue={params.get('max') || ''} />
          <SelectField label="Sort by" name="sort" value={params.get('sort') || 'POPULARITY_DESC'} options={sorts} />
        </FilterPopover>
        <button className="af-button af-primary" type="submit">Apply filters</button>
      </form>
    </div>
    <ResultsSummary count={!loading || entries.length ? entries.length : null} loading={loading && page === 1 && !entries.length} route="anime" filters={params} clear={webHref('anime?view=all')} labels={{
      season: value => seasons.find(([key]) => key === value)?.[1] ?? '',
      year: value => value,
      format: value => formats.find(([key]) => key === value)?.[1] ?? '',
      status: value => statuses.find(([key]) => key === value)?.[1] ?? '',
      audio: value => audioOptions.find(([key]) => key === value)?.[1] ?? '',
      theme: value => value,
      min: value => `At least ${value} episodes`,
      max: value => `At most ${value} episodes`,
      sort: value => value === 'POPULARITY_DESC' ? '' : sorts.find(([key]) => key === value)?.[1] ?? '',
    }} />
    {rangeError && <p id="episode-range-error" className="af-state" role="alert">{rangeError}</p>}
    {entries.length > 0 && (
      <div className="af-poster-grid">
        {entries.map((entry, index) => (
          <AnimeEntryCard key={entry.id} entry={entry} index={index} isSeasonal={isSeasonal} controls={controls} />
        ))}
      </div>
    )}
    {loading && page === 1 && <Loading label="Loading anime…" />}
    {error && page === 1 && <p className="af-state" role="alert">{error} <button className="af-text-link" type="button" onClick={() => { setError(''); setLoading(true); setRetry(value => value + 1); }}>Retry</button></p>}
    {!loading && !error && !entries.length && <output className="af-state">No anime match these filters.</output>}
    {page > 1 && <output className="af-meta">{loading ? 'Loading more anime…' : error || `${entries.length} anime shown`}</output>}
    {(nextPage || (page > 1 && (loading || error))) && <div className="af-pagination">
      <button type="button" className="af-button af-secondary" aria-disabled={loading} onClick={() => {
        if (loading) return;
        setLoading(true);
        if (error) { setError(''); setRetry(value => value + 1); }
        else if (nextPage) setPage(nextPage);
      }}>{loadMoreAnimeLabel(error, loading)}</button>
    </div>}
  </div>;
}

type Recommendations = { mode?: string; personalized: boolean; sections: { label: string; items: RawTitle[] }[] };

export function RecommendationsPage({ controls }: Readonly<{ controls: LibraryControls }>) {
  const [data, setData] = useState<Recommendations>();
  const [ratings, setRatings] = useState<Record<string, CatalogRating>>({});
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [updating, setUpdating] = useState(false);
  const { account, library, ready } = controls;
  const { history, saved, ratings: userRatings, watched } = library;
  const libraryRef = useRef(library);
  libraryRef.current = library;
  useEffect(() => {
    if (!ready) return;
    setUpdating(true);
    const task = new AbortController();
    const guest = account ? undefined : guestRecommendations(libraryRef.current);
    request<Recommendations>('/api/recommendations', {
      signal: task.signal,
      ...(guest ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(guest) } : {}),
    }).then(result => {
      if (!Array.isArray(result.sections) || result.sections.some(section => !Array.isArray(section?.items))) throw new Error('Could not read these recommendations.');
      if (!task.signal.aborted) { setData(result); setError(''); }
    }).catch(error_ => { if (!task.signal.aborted) setError(error_.message); })
      .finally(() => { if (!task.signal.aborted) setUpdating(false); });
    return () => task.abort();
  }, [ready, account, history, saved, userRatings, watched, retry]);

  const visible = useMemo(() => (data?.sections ?? []).filter(section => section.items.length > 0), [data]);
  const ratingKeys = useMemo(() => [...new Set(visible.flatMap(section =>
    normalizeTitles(section.items).map(item => `${item.type}:${item.id}`),
  ))].slice(0, 100).join(','), [visible]);

  useEffect(() => {
    if (!ratingKeys) return;
    const task = new AbortController();
    request<{ ratings: Record<string, CatalogRating> }>(`/api/imdb/cached?titles=${ratingKeys}`, { signal: task.signal })
      .then(({ ratings: found }) => { if (!task.signal.aborted) setRatings(current => ({ ...found, ...current })); })
      .catch(() => {});
    return () => task.abort();
  }, [ratingKeys]);

  const retryRecommendations = () => { setError(''); setRetry(value => value + 1); };
  return <div className="af-wrap af-directory">
    <PageHeading title="For You">{data && data.mode !== 'unavailable' && (data.personalized
      ? 'Picked from your viewing activity and library.'
      : 'Finish two series or watch a substantial part of three films or episodes to personalize your picks.')}</PageHeading>
    {error && <CatalogProblem error={error} retry={retryRecommendations} />}
    {!ready && controls.error && <p className="af-state">Reconnect your library to refresh recommendations.</p>}
    {!data && !error && !controls.error && <Loading label="Loading recommendations…" />}
    {updating && data && <output className="af-state">Updating recommendations…</output>}
    {data?.mode === 'unavailable' && <CatalogProblem error="Connect the catalog to get recommendations." retry={retryRecommendations} />}
    {data && data.mode !== 'unavailable' && !visible.length && <output className="af-state">No recommendations are available yet. <a className="af-text-link" href={webHref('movies')}>Browse movies</a></output>}
    {visible.length > 0 && <div className="af-content af-discovery-shelves">{visible.map(section => <Shelf title={section.label} key={section.label}>
      {normalizeTitles(section.items).map(item => (
        <MediaCard item={{ ...item, rating: ratings[item.key] ?? ratings[`${item.type}:${item.id}`] ?? item.rating }} controls={controls} key={item.key} />
      ))}
    </Shelf>)}</div>}
  </div>;
}
