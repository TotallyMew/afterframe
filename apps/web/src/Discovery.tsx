import { useEffect, useState } from 'react';
import { normalizeTitles, request, routeWithParams, webHref, type RawTitle } from './catalog';
import { InputField, PageHeading, ResultsSummary, RouteTabs, SelectField } from './Catalogue';
import { ActionLink, Artwork, CatalogProblem, Icon, Loading, MediaCard, Score, Shelf } from './components';
import { guestRecommendations, type LibraryControls } from './library';

const seasons = [['WINTER', 'Winter'], ['SPRING', 'Spring'], ['SUMMER', 'Summer'], ['FALL', 'Fall']] as const;
const formats = [['TV', 'TV'], ['TV_SHORT', 'TV short'], ['MOVIE', 'Movie'], ['OVA', 'OVA'], ['ONA', 'ONA'], ['SPECIAL', 'Special']] as const;
const statuses = [['RELEASING', 'Currently airing'], ['NOT_YET_RELEASED', 'Upcoming'], ['FINISHED', 'Finished'], ['CANCELLED', 'Cancelled'], ['HIATUS', 'On hiatus']] as const;
const sorts = [['POPULARITY_DESC', 'Popularity'], ['START_DATE_DESC', 'Newest first'], ['START_DATE', 'Oldest first']] as const;

const genreSuggestions = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Mecha', 'Mystery', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'];
const themeSuggestions = ['Coming of Age', 'Found Family', 'Isekai', 'Magic', 'School', 'Space', 'Super Power', 'Time Manipulation', 'Urban Fantasy'];
const airDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

type AnimeEntry = {
  id: number;
  title?: { english?: string; romaji?: string };
  coverImage?: { large?: string };
  catalog?: string;
  format?: string;
  status?: string;
  startDate?: { year?: number };
  episodes?: number;
  mal?: number;
  nextAiringEpisode?: { episode: number; airingAt: number };
};
type AnimeResults = { results: AnimeEntry[]; nextPage?: number | null };

function animeHref(route: URLSearchParams, page: number) {
  const params = new URLSearchParams(route);
  if (page > 1) params.set('page', String(page));
  else params.delete('page');
  return webHref(routeWithParams('anime', params));
}

export function AnimePage({ query }: { query: string }) {
  const [data, setData] = useState<AnimeResults>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [rangeError, setRangeError] = useState('');
  const params = new URLSearchParams(query);
  const date = new Date();
  if (!query) {
    params.set('season', seasons[Math.floor(date.getMonth() / 3)][0]);
    params.set('year', String(date.getFullYear()));
  }
  const queryString = params.toString();
  const currentPage = Number(params.get('page') || 1);

  useEffect(() => {
    const task = new AbortController();
    request<AnimeResults>(`/api/anime-discovery?${queryString}`, { signal: task.signal })
      .then(result => {
        if (!Array.isArray(result.results) || result.results.some(item => !item || !Number.isInteger(item.id))) throw new Error('The anime catalog returned invalid results.');
        if (!task.signal.aborted) setData(result);
      })
      .catch(error => { if (!task.signal.aborted) setError(error.message); });
    return () => task.abort();
  }, [queryString, retry]);

  return <div className="af-wrap af-directory">
    <PageHeading title="Anime">Browse releases and airing schedules.</PageHeading>
    <div className="af-catalog-tools">
    <RouteTabs label="Anime collection" active={params.has('season') || params.has('year') ? 'anime' : 'anime?view=all'}
      tabs={[[ 'anime', 'Seasonal' ], [ 'anime?view=all', 'All anime' ]]} />
    <form className="af-field-bar" onSubmit={event => {
      event.preventDefault();
      const next = new URLSearchParams();
      for (const [key, value] of new FormData(event.currentTarget)) if (typeof value === 'string' && value.trim()) next.set(key, value.trim());
      if (next.has('min') && next.has('max') && Number(next.get('min')) > Number(next.get('max'))) {
        setRangeError('Minimum episodes must be less than or equal to maximum episodes.');
        event.currentTarget.querySelector<HTMLInputElement>('[name=min]')?.focus();
        return;
      }
      setRangeError('');
      if (!next.size || next.toString() === 'sort=POPULARITY_DESC') next.set('view', 'all');
      window.location.hash = routeWithParams('anime', next);
    }}>
      <SelectField label="Season" name="season" empty="Any season" value={params.get('season') || ''} options={seasons} />
      <InputField label="Year" type="number" name="year" min="1900" max="2100" defaultValue={params.get('year') || ''} />
      <SelectField label="Format" name="format" empty="Any format" value={params.get('format') || ''} options={formats} />
      <SelectField label="Status" name="status" empty="Any status" value={params.get('status') || ''} options={statuses} />
      <details className="af-more-filters" open={['genre', 'theme', 'min', 'max', 'sort'].some(name => params.has(name)) || undefined}><summary className="af-button af-secondary">More filters</summary>
        <div className="af-filter-panel">
          <InputField label="Genre" name="genre" list="anime-genres" maxLength={60} defaultValue={params.get('genre') || ''} />
          <InputField label="Theme" name="theme" list="anime-themes" maxLength={60} defaultValue={params.get('theme') || ''} />
          <InputField label="Minimum episodes" name="min" aria-invalid={Boolean(rangeError)} aria-describedby={rangeError ? "episode-range-error" : undefined} type="number" min="1" max="5000" defaultValue={params.get('min') || ''} />
          <InputField label="Maximum episodes" name="max" type="number" min="1" max="5000" defaultValue={params.get('max') || ''} />
          <SelectField label="Sort by" name="sort" value={params.get('sort') || 'POPULARITY_DESC'} options={sorts} />
        </div>
      </details>
      <datalist id="anime-genres">{genreSuggestions.map(name => <option key={name} value={name} />)}</datalist>
      <datalist id="anime-themes">{themeSuggestions.map(name => <option key={name} value={name} />)}</datalist>
      <button className="af-button af-primary" type="submit">Apply filters</button>
    </form>
    </div>
    <ResultsSummary count={data?.results.length} route="anime" filters={params} clear={webHref('anime?view=all')} labels={{
      season: value => seasons.find(([key]) => key === value)?.[1] ?? '',
      year: value => value,
      format: value => formats.find(([key]) => key === value)?.[1] ?? '',
      status: value => statuses.find(([key]) => key === value)?.[1] ?? '',
      theme: value => value,
      min: value => `At least ${value} episodes`,
      max: value => `At most ${value} episodes`,
      sort: value => value === 'POPULARITY_DESC' ? '' : sorts.find(([key]) => key === value)?.[1] ?? '',
    }} />
    {rangeError && <p id="episode-range-error" className="af-state" role="alert">{rangeError}</p>}
    {error ? <p className="af-state" role="alert">{error} <button className="af-text-link" type="button" onClick={() => { setError(''); setRetry(value => value + 1); }}>Retry</button></p>
      : !data ? <Loading label="Loading anime…" /> : !data.results.length ? <p className="af-state" role="status">No anime match these filters.</p>
        : <div className="af-poster-grid">{data.results.map(entry => {
          const title = entry.title?.english || entry.title?.romaji || 'Anime';
          const matched = /^(movie|tv)\/[1-9]\d{0,9}$/.test(entry.catalog || '');
          const href = matched ? webHref(entry.catalog!)
            : webHref(`search=${encodeURIComponent(entry.title?.romaji || title)}`);
          const cover = /^https:\/\/s4\.anilist\.co\//.test(entry.coverImage?.large || '') ? entry.coverImage?.large : undefined;
          const meta = [formats.find(([key]) => key === entry.format)?.[1], entry.startDate?.year,
            statuses.find(([key]) => key === entry.status)?.[1], entry.episodes ? `${entry.episodes} ep` : ''].filter(Boolean).join(' · ');
          const next = entry.nextAiringEpisode;
          const nextDate = next && new Date(next.airingAt * 1000);
          return <article className="af-media-card af-anime-card" key={entry.id}><a href={href}>
            <span className="af-poster"><Artwork src={cover} loading="lazy" fallback={<Icon name="film" />} /></span>
            <strong>{title}</strong>
            {meta && <span className="af-card-meta">{meta}</span>}
            <Score mal={entry.mal} />
            {next && nextDate && nextDate.getTime() > Date.now() && <time className="af-anime-timing" dateTime={nextDate.toISOString()}>
              <Icon name="clock" /><span>Episode {next.episode} airs {airDate.format(nextDate)}</span>
            </time>}
            {!matched && <span className="af-card-meta">Search for this title</span>}
          </a></article>;
        })}</div>}
    {data && <div className="af-pagination">
      {currentPage > 1 && <ActionLink href={animeHref(params, currentPage - 1)}>Previous page</ActionLink>}
      {data.nextPage && <ActionLink href={animeHref(params, data.nextPage)}>Next page</ActionLink>}
    </div>}
  </div>;
}

type Recommendations = { mode?: string; personalized: boolean; sections: { label: string; items: RawTitle[] }[] };

export function RecommendationsPage({ controls }: { controls: LibraryControls }) {
  const [data, setData] = useState<Recommendations>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [updating, setUpdating] = useState(false);
  const { account, library, ready } = controls;
  const { history, saved, ratings, watched } = library;
  useEffect(() => {
    if (!ready) return;
    setUpdating(true);
    const task = new AbortController();
    const guest = account ? undefined : guestRecommendations(library);
    request<Recommendations>('/api/recommendations', {
      signal: task.signal,
      ...(guest ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(guest) } : {}),
    }).then(result => {
      if (!Array.isArray(result.sections) || result.sections.some(section => !Array.isArray(section?.items))) throw new Error('Could not read these recommendations.');
      if (!task.signal.aborted) { setData(result); setError(''); }
    }).catch(problem => { if (!task.signal.aborted) setError(problem.message); })
      .finally(() => { if (!task.signal.aborted) setUpdating(false); });
    return () => task.abort();
  }, [ready, account, history, saved, ratings, watched, retry]);
  const visible = data?.sections.filter(section => section.items.length > 0) ?? [];
  const retryRecommendations = () => { setError(''); setRetry(value => value + 1); };
  return <div className="af-wrap af-directory">
    <PageHeading title="For You">{data && data.mode !== 'unavailable' && (data.personalized
      ? 'Picked from your viewing activity and library.'
      : 'Finish two series or watch a substantial part of three films or episodes to personalize your picks.')}</PageHeading>
    {error && <CatalogProblem error={error} retry={retryRecommendations} />}
    {!ready && controls.error && <p className="af-state">Reconnect your library to refresh recommendations.</p>}
    {!data && !error && !controls.error && <Loading label="Loading recommendations…" />}
    {updating && data && <p className="af-state" role="status">Updating recommendations…</p>}
    {data?.mode === 'unavailable' && <CatalogProblem error="Connect the catalog to get recommendations." retry={retryRecommendations} />}
    {data && data.mode !== 'unavailable' && !visible.length && <p className="af-state" role="status">No recommendations are available yet. <a className="af-text-link" href={webHref('movies')}>Browse movies</a></p>}
    {visible.length > 0 && <div className="af-content af-discovery-shelves">{visible.map(section => <Shelf title={section.label} key={section.label}>
      {normalizeTitles(section.items).map(item => <MediaCard item={item} controls={controls} key={item.key} />)}
    </Shelf>)}</div>}
  </div>;
}
