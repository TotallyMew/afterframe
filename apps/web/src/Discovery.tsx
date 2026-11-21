import { useEffect, useState } from 'react';
import { legacyHref, normalizeTitles, request, routeWithParams, webHref, type RawTitle } from './catalog';
import { InputField, PageHeading, SelectField } from './Catalogue';
import { ActionLink, Icon, MediaCard, Shelf } from './components';
import { guestRecommendations, type LibraryControls } from './library';

const seasons = [['WINTER', 'Winter'], ['SPRING', 'Spring'], ['SUMMER', 'Summer'], ['FALL', 'Fall']] as const;
const formats = [['TV', 'TV'], ['TV_SHORT', 'TV short'], ['MOVIE', 'Movie'], ['OVA', 'OVA'], ['ONA', 'ONA'], ['SPECIAL', 'Special']] as const;
const statuses = [['RELEASING', 'Currently airing'], ['NOT_YET_RELEASED', 'Upcoming'], ['FINISHED', 'Finished'], ['CANCELLED', 'Cancelled'], ['HIATUS', 'On hiatus']] as const;
const sorts = [['POPULARITY_DESC', 'Popularity'], ['START_DATE_DESC', 'Newest first'], ['START_DATE', 'Oldest first']] as const;

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
      .then(result => { if (!task.signal.aborted) setData(result); })
      .catch(error => { if (!task.signal.aborted) setError(error.message); });
    return () => task.abort();
  }, [queryString, retry]);

  return <div className="af-wrap af-directory">
    <PageHeading title="Anime">Browse releases and airing schedules.</PageHeading>
    <form className="af-field-bar" onSubmit={event => {
      event.preventDefault();
      const next = new URLSearchParams();
      for (const [key, value] of new FormData(event.currentTarget)) if (typeof value === 'string' && value.trim()) next.set(key, value.trim());
      if (!next.size || next.toString() === 'sort=POPULARITY_DESC') next.set('view', 'all');
      window.location.hash = routeWithParams('anime', next);
    }}>
      <SelectField label="Season" name="season" empty="Any season" value={params.get('season') || ''} options={seasons} />
      <InputField label="Year" type="number" name="year" min="1900" max="2100" defaultValue={params.get('year') || ''} />
      <SelectField label="Format" name="format" empty="Any format" value={params.get('format') || ''} options={formats} />
      <SelectField label="Status" name="status" empty="Any status" value={params.get('status') || ''} options={statuses} />
      <details className="af-more-filters"><summary className="af-button af-secondary">More filters</summary>
        <div className="af-filter-panel">
          <InputField label="Genre" name="genre" maxLength={60} defaultValue={params.get('genre') || ''} />
          <InputField label="Theme" name="theme" maxLength={60} defaultValue={params.get('theme') || ''} />
          <InputField label="Minimum episodes" name="min" type="number" min="1" max="5000" defaultValue={params.get('min') || ''} />
          <InputField label="Maximum episodes" name="max" type="number" min="1" max="5000" defaultValue={params.get('max') || ''} />
          <SelectField label="Sort by" name="sort" value={params.get('sort') || 'POPULARITY_DESC'} options={sorts} />
        </div>
      </details>
      <button className="af-button af-secondary" type="submit">Apply filters</button>
      <a className="af-text-link" href={webHref(query ? 'anime' : 'anime?view=all')}>{query ? 'This season' : 'All anime'}</a>
    </form>
    {error ? <p className="af-state" role="alert">{error} <button className="af-text-link" type="button" onClick={() => { setError(''); setRetry(value => value + 1); }}>Retry</button></p>
      : !data ? <p className="af-state" role="status">Loading anime…</p> : !data.results.length ? <p className="af-state">No anime match these filters.</p>
        : <div className="af-poster-grid">{data.results.map(entry => {
          const title = entry.title?.english || entry.title?.romaji || 'Anime';
          const href = /^(movie|tv)\/[1-9]\d{0,9}$/.test(entry.catalog || '') ? webHref(entry.catalog!)
            : webHref(`search=${encodeURIComponent(entry.title?.romaji || title)}`);
          const cover = /^https:\/\/s4\.anilist\.co\//.test(entry.coverImage?.large || '') ? entry.coverImage?.large : undefined;
          const meta = [formats.find(([key]) => key === entry.format)?.[1], entry.startDate?.year,
            statuses.find(([key]) => key === entry.status)?.[1], entry.episodes ? `${entry.episodes} ep` : ''].filter(Boolean).join(' · ');
          const next = entry.nextAiringEpisode;
          return <article className="af-media-card" key={entry.id}><a href={href}>
            <span className="af-poster">{cover ? <img src={cover} alt="" loading="lazy" /> : <Icon name="film" />}</span>
            <strong>{title}</strong><span className="af-meta">{meta}</span>
            {entry.mal && <span className="af-score">MAL {entry.mal.toFixed(2)}</span>}
            {next && next.airingAt * 1000 > Date.now() && <span className="af-card-meta">Episode {next.episode} airs {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(next.airingAt * 1000))}</span>}
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
  const { account, library, ready } = controls;
  const { history, saved, ratings, watched } = library;
  useEffect(() => {
    if (!ready) return;
    const task = new AbortController();
    const guest = account ? undefined : guestRecommendations(library);
    request<Recommendations>('/api/recommendations', {
      signal: task.signal,
      ...(guest ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(guest) } : {}),
    }).then(result => { if (!task.signal.aborted) { setData(result); setError(''); } })
      .catch(problem => { if (!task.signal.aborted) setError(problem.message); });
    return () => task.abort();
  }, [ready, account, history, saved, ratings, watched, retry]);
  const visible = data?.sections.filter(section => section.items.length > 0) ?? [];
  return <div className="af-wrap af-directory">
    <PageHeading title="Recommendations">{data && data.mode !== 'unavailable' && (data.personalized
      ? 'Picked from your viewing activity and library.'
      : 'Complete two series or meaningfully watch three titles or episodes to personalize your picks.')}</PageHeading>
    {error ? <p role="alert" className="af-state">{error} <button className="af-text-link" type="button" onClick={() => { setError(''); setRetry(value => value + 1); }}>Retry</button></p>
      : !ready && controls.error ? <p className="af-state">Reload your library to see recommendations.</p>
        : !data ? <p className="af-state" role="status">Loading recommendations…</p>
          : data.mode === 'unavailable' ? <div className="af-state"><p>Connect the catalog to get recommendations.</p><ActionLink href={legacyHref('home', 'settings')}>Open settings</ActionLink></div>
            : !visible.length ? <p className="af-state">No recommendations are available yet.</p>
              : <div className="af-discovery-shelves">{visible.map(section => <Shelf title={section.label} key={section.label}>
                {normalizeTitles(section.items).map(item => <MediaCard item={item} controls={controls} key={item.key} />)}
              </Shelf>)}</div>}
  </div>;
}
