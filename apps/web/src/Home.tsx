import { useEffect, useState } from 'react';
import {
  legacyHref, normalizeTitle, normalizeTitles, playHref, request, resumeHref, titleHref, today,
  type CatalogRating, type MediaType, type RawTitle, type Title, type TitleResults,
} from './catalog';
import { ActionLink, Icon, MediaCard, SaveButton, Score, Shelf } from './components';
import { progressPercent, resumeEntries, resumeFor, type LibraryControls } from './library';

interface CollectionData { newMovies?: RawTitle[]; newTV?: RawTitle[]; anime?: RawTitle[] }
interface HomeData { trending: Title[]; newMovies: Title[]; newTV: Title[]; anime: Title[]; partial: boolean }
const collections = [
  ['newMovies', 'New movies', 'new'],
  ['newTV', 'New series', 'new?type=tv'],
  ['anime', 'Anime', 'anime'],
] as const;

export function Home({ controls }: { controls: LibraryControls }) {
  const [data, setData] = useState<HomeData>();
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState<MediaType | 'all'>('all');
  const [featuredKey, setFeaturedKey] = useState('');
  const [ratings, setRatings] = useState<Record<string, CatalogRating>>({});
  const [featuredDetails, setFeaturedDetails] = useState<Title>();

  useEffect(() => {
    document.title = 'Afterframe · Movies, TV & Comics';
    const controller = new AbortController();
    const { signal } = controller;
    Promise.allSettled([
      request<TitleResults>('/api/trending', { signal }),
      request<CollectionData>('/api/home', { signal }),
    ]).then(([trending, home]) => {
      if (signal.aborted) return;
      if (trending.status === 'rejected' && home.status === 'rejected') {
        setError(trending.reason.message || 'Could not load the catalogue.');
        return;
      }
      const collection = home.status === 'fulfilled' ? home.value : {};
      const next: HomeData = {
        trending: normalizeTitles(trending.status === 'fulfilled' ? trending.value.results : []),
        newMovies: normalizeTitles(collection.newMovies),
        newTV: normalizeTitles(collection.newTV),
        anime: normalizeTitles(collection.anime),
        partial: trending.status === 'rejected' || home.status === 'rejected',
      };
      setData(next);
      const keys = [...new Set([...next.trending, ...next.newMovies, ...next.newTV, ...next.anime].map(item => `${item.type}:${item.id}`))];
      if (keys.length) request<{ ratings: Record<string, CatalogRating> }>(`/api/imdb/cached?titles=${keys.join(',')}`, { signal })
        .then(({ ratings }) => { if (!signal.aborted) setRatings(current => ({ ...ratings, ...current })); }).catch(() => {});
    });
    return () => controller.abort();
  }, [reload]);

  function withRating(item: Title) {
    return { ...item, rating: ratings[`${item.type}:${item.id}`] ?? item.rating };
  }

  const featuredChoices = [...new Map([...(data?.trending ?? []), ...(data?.newMovies ?? [])]
    .filter(item => item.type === 'movie' && item.backdrop && item.date && item.date <= today())
    .map(item => [item.key, item])).values()].slice(0, 3).map(withRating);
  const featured = featuredChoices.find(item => item.key === featuredKey) ?? featuredChoices[0];
  const featuredId = featured?.id;

  useEffect(() => {
    if (!featuredId) return;
    const task = new AbortController();
    const { signal } = task;
    request<RawTitle>(`/api/movie/${featuredId}`, { signal }).then(raw => {
      if (signal.aborted) return;
      const details = normalizeTitle(raw, 'movie');
      setFeaturedDetails(details);
      if (details.imdb) request<{ rating?: CatalogRating }>(`/api/imdb?id=${encodeURIComponent(details.imdb)}`, { signal })
        .then(({ rating }) => {
          if (rating && !signal.aborted) setRatings(current => ({ ...current, [`movie:${featuredId}`]: rating }));
        }).catch(() => {});
    }).catch(() => {});
    return () => task.abort();
  }, [featuredId]);

  const featureIndex = featuredChoices.findIndex(item => item.key === featured?.key);
  const featureDuration = featuredDetails?.key === featured?.key ? featuredDetails?.duration : featured?.duration;
  const featuredResume = featured && resumeFor(controls.library, featured);
  const likelyTrending = (data?.trending ?? []).filter(item => filter === 'all' || item.type === filter);
  const freshTrending = likelyTrending.filter(item => item.key !== featured?.key);
  const trending = freshTrending.length ? freshTrending : likelyTrending;
  const resume = controls.ready ? resumeEntries(controls.library).slice(0, 12) : [];
  const retry = () => { setError(''); setReload(value => value + 1); };

  function switchFeature(direction: number) {
    const next = (featureIndex + direction + featuredChoices.length) % featuredChoices.length;
    setFeaturedKey(featuredChoices[next].key);
  }

  return <>
    {featured ? <section className="af-hero af-home-hero" aria-label="Featured film">
      <img className="af-backdrop" src={featured.backdrop} alt="" fetchPriority="high" />
      <div className="af-wrap af-hero-inner">
        <div className="af-copy">
          <p className="af-kicker">Featured film</p>
          <h1>{featured.title}</h1>
          <p className="af-meta">{[featured.year, featured.genre, featureDuration ? `${featureDuration} min` : ''].filter(Boolean).join(' · ')} <Score rating={featured.rating} /></p>
          {featured.description && <p className="af-overview af-home-overview">{featured.description}</p>}
          <div className="af-actions">
            <ActionLink href={playHref(featured)} primary><Icon name="play" />{featuredResume ? 'Resume' : 'Play'}</ActionLink>
            <SaveButton item={featured} controls={controls} />
            <a className="af-text-link af-feature-details" href={titleHref(featured)}>Details <Icon name="right" /></a>
          </div>
        </div>
        {featuredChoices.length > 1 && <div className="af-feature-choices" role="group" aria-label="Featured titles">
          <button type="button" className="af-icon-button" aria-label="Previous featured film" onClick={() => switchFeature(-1)}><Icon name="left" /></button>
          <div className="af-feature-indicators">
            {featuredChoices.map(item => <button type="button" key={item.key} aria-pressed={item.key === featured.key}
              aria-label={`Feature ${item.title}`} onClick={() => setFeaturedKey(item.key)} />)}
          </div>
          <button type="button" className="af-icon-button" aria-label="Next featured film" onClick={() => switchFeature(1)}><Icon name="right" /></button>
        </div>}
      </div>
    </section> : <div className="af-wrap af-title-page">
      <h1>Home</h1>
      {error ? <div className="af-state" role="alert"><p>{error}</p>
        <div className="af-actions">
          <button type="button" className="af-button af-primary" onClick={retry}>Retry</button>
          <ActionLink href={legacyHref('home', 'settings')}>Open settings</ActionLink>
        </div>
      </div> : !data && <p className="af-state" role="status">Loading the catalogue…</p>}
    </div>}
    <div className="af-wrap af-content">
      {resume.length > 0 && <Shelf title="Continue Watching" href={legacyHref('history')} landscape>
        {resume.map(([key, entry]) => {
          const episode = entry.episode;
          const remaining = Math.ceil((entry.duration - entry.time) / 60);
          const left = remaining >= 60 ? `${Math.floor(remaining / 60)} hr ${remaining % 60 ? `${remaining % 60} min ` : ''}left` : `${remaining} min left`;
          return <MediaCard key={key} item={entry.item} controls={controls} href={resumeHref(entry.item, key, episode)} landscape
            context={episode ? `S${episode.season} E${episode.number} · ${left}` : left}
            percent={progressPercent(entry)} />;
        })}
      </Shelf>}
      {(data?.trending.length ?? 0) > 0 && <Shelf title="Trending this week" landscape actions={
        <div className="af-filters" role="group" aria-label="Filter trending">
          {([['all', 'All'], ['movie', 'Movies'], ['tv', 'TV Shows']] as const).map(([value, label]) =>
            <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
      }>
        {trending.length ? trending.slice(0, 12).map(item => <MediaCard key={item.key} item={withRating(item)} controls={controls} landscape />)
          : <p className="af-state">No trending titles for this filter.</p>}
      </Shelf>}
      {data && collections.map(([key, label, path]) => data[key].length > 0 && <Shelf title={label} key={key} href={legacyHref(path)}>
        {data[key].slice(0, 8).map(item => <MediaCard key={item.key} item={withRating(item)} controls={controls} />)}
      </Shelf>)}
      {data?.partial && <p className="af-state" role="status">Some shelves are unavailable. <button type="button" className="af-text-link" onClick={retry}>Retry</button></p>}
    </div>
  </>;
}
