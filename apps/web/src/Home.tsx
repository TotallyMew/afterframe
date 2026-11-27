import { useEffect, useRef, useState } from 'react';
import {
  normalizeTitle, normalizeTitles, playHref, readBrowseCache, request, resumeHref, titleHref, today, webHref, writeBrowseCache,
  type CatalogRating, type Comic, type MediaType, type RawTitle, type Title, type TitleResults,
} from './catalog';
import { ComicCard, readerHref } from './ComicCard';
import { ActionLink, Artwork, CatalogProblem, HeroBackdrop, Icon, Loading, MediaCard, SaveButton, Score, Shelf } from './components';
import { progressPercent, resumeEntries, resumeFor, type LibraryControls } from './library';
import { useToast } from './Toast';

const trailingStopWordSet = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'for', 'with',
  'and', 'or', 'but', 'as', 'by', 'from', 'into', 'that', 'which', 'who',
  'his', 'her', 'their', 'its', 'is', 'are', 'was', 'were', 'be', 'been',
]);
const trailingPunctuationChars = new Set([',', ';', ':', '-', '–', '—']);

function trimTrailingPunctuation(value: string): string {
  let end = value.length;
  while (end > 0 && trailingPunctuationChars.has(value[end - 1])) end--;
  return value.slice(0, end).trim();
}

function dropTrailingWord(value: string): string {
  const lastSpace = value.lastIndexOf(' ');
  return lastSpace >= 0 ? value.slice(0, lastSpace) : value;
}

function stripTrailingStopWords(value: string): string {
  let cut = value;
  for (let i = 0; i < 3; i++) {
    const lastSpace = cut.lastIndexOf(' ');
    const lastWord = (lastSpace >= 0 ? cut.slice(lastSpace + 1) : cut).toLowerCase();
    if (!trailingStopWordSet.has(lastWord)) break;
    const prefix = lastSpace >= 0 ? cut.slice(0, lastSpace) : '';
    cut = trimTrailingPunctuation(prefix);
  }
  return cut;
}

export function trimOverview(text: string | undefined, maxChars = 195): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean || clean.length <= maxChars) return clean;
  const slice = clean.slice(0, maxChars);
  const sentenceMatch = [...slice.matchAll(/[.!?](?=\s|$)/g)].at(-1);
  if (sentenceMatch?.index != null && sentenceMatch.index >= Math.floor(maxChars * 0.45)) {
    return slice.slice(0, sentenceMatch.index + 1).trim();
  }
  const cut = stripTrailingStopWords(trimTrailingPunctuation(dropTrailingWord(slice)));
  return cut ? `${cut}…` : `${slice.trim()}…`;
}

const collections = [
  ['newMovies', 'New movies', 'new'],
  ['newTV', 'New series', 'new?type=tv'],
  ['anime', 'Anime', 'anime'],
] as const;
type ShelfKey = 'trending' | typeof collections[number][0];
type ShelfResult = { titles: Title[] } | { error: string };
type ShelfResponse = TitleResults & Partial<Record<ShelfKey, RawTitle[]>>;
const shelves: readonly [ShelfKey, string][] = [
  ['trending', '/api/trending'],
  ...collections.map(([key]): [ShelfKey, string] => [key, `/api/home?section=${key}`]),
];

type CachedHome = {
  data: Partial<Record<ShelfKey, ShelfResult>>;
  ratings: Record<string, CatalogRating>;
  recentComics: Comic[];
};

function formatHomeMinutesLeft(remaining: number): string {
  if (remaining < 60) return `${remaining} min left`;
  const mins = remaining % 60;
  const minPart = mins ? `${mins} min ` : '';
  return `${Math.floor(remaining / 60)} hr ${minPart}left`;
}

function collectVisibleRatingKeys(
  data: Partial<Record<ShelfKey, ShelfResult>>,
  filter: MediaType | 'all',
  trendingByType: Partial<Record<MediaType, Title[]>>,
): string {
  const keys: string[] = [];
  for (const [key] of shelves) {
    const shelf = data[key];
    if (!shelf || !('titles' in shelf)) continue;
    const limit = key === 'trending' ? 20 : 8;
    for (const item of shelf.titles.slice(0, limit)) keys.push(`${item.type}:${item.id}`);
  }
  if (filter !== 'all') {
    for (const item of (trendingByType[filter] ?? []).slice(0, 12)) keys.push(`${item.type}:${item.id}`);
  }
  return [...new Set(keys)].join(',');
}

function FeaturedHero({
  featured,
  featuredChoices,
  featureDir,
  featureDuration,
  featuredResume,
  expandedOverviewKey,
  controls,
  onToggleOverview,
  onSwitchFeature,
  onSelectFeature,
}: Readonly<{
  featured: Title;
  featuredChoices: Title[];
  featureDir: 1 | -1;
  featureDuration: number | undefined;
  featuredResume: ReturnType<typeof resumeFor>;
  expandedOverviewKey: string;
  controls: LibraryControls;
  onToggleOverview: (next: string) => void;
  onSwitchFeature: (direction: 1 | -1) => void;
  onSelectFeature: (item: Title, index: number) => void;
}>) {
  const fullDescription = (featured.description ?? '').replace(/\s+/g, ' ').trim();
  const shortDescription = trimOverview(fullDescription);
  const canExpandDescription = Boolean(fullDescription && shortDescription !== fullDescription);
  const isDescriptionExpanded = expandedOverviewKey === featured.key;
  const facts = [featured.year, featured.genre, featureDuration ? `${featureDuration} min` : ''].filter(Boolean);

  return (
    <section className="af-wrap af-hero af-home-hero" aria-label="Featured film">
      <div className="af-feature-artwork af-hero-art-transition" data-dir={featureDir > 0 ? 'next' : 'prev'} key={`art-${featured.key}`}>
        <HeroBackdrop src={featured.backdrop} sizes="(max-width: 760px) 100vw, min(58vw, 850px)" />
      </div>
      <div className="af-copy af-hero-copy-transition" data-dir={featureDir > 0 ? 'next' : 'prev'} key={`copy-${featured.key}`}>
        <h1>{featured.title}</h1>
        <div className="af-meta af-title-facts">
          {facts.map(fact => <span key={fact}>{fact}</span>)}
          <Score rating={featured.rating} />
        </div>
        {shortDescription && <p className={`af-overview af-home-overview ${isDescriptionExpanded ? 'is-expanded' : ''}`}>
          {isDescriptionExpanded ? fullDescription : shortDescription}
          {canExpandDescription && <>
            {' '}
            <button
              type="button"
              className="af-overview-toggle"
              aria-expanded={isDescriptionExpanded}
              onClick={() => onToggleOverview(isDescriptionExpanded ? '' : featured.key)}
            >
              {isDescriptionExpanded ? 'less' : 'more'}
            </button>
          </>}
        </p>}
        <div className="af-actions">
          <ActionLink href={playHref(featured)} primary><Icon name="play" />{featuredResume ? 'Resume' : 'Play'}</ActionLink>
          <SaveButton item={featured} controls={controls} />
          <a className="af-text-link af-feature-details" href={titleHref(featured)}>Details <Icon name="right" /></a>
        </div>
      </div>
      {featuredChoices.length > 1 && <fieldset className="af-feature-choices" aria-label="Featured titles">
        <button type="button" className="af-icon-button" aria-label="Previous featured film" onClick={() => onSwitchFeature(-1)}><Icon name="left" /></button>
        <div className="af-feature-indicators">
          {featuredChoices.map((item, idx) => <button type="button" key={item.key} aria-pressed={item.key === featured.key}
            aria-label={`Feature ${item.title}`} title={item.title} onClick={() => onSelectFeature(item, idx)}>
            <Artwork src={item.backdrop?.replace('/w1280/', '/w300/')} loading="lazy" fallback={<Icon name="film" />} />
          </button>)}
        </div>
        <button type="button" className="af-icon-button" aria-label="Next featured film" onClick={() => onSwitchFeature(1)}><Icon name="right" /></button>
      </fieldset>}
    </section>
  );
}

function useHomeRecentComics(cached: CachedHome | null) {
  const [recentComics, setRecentComics] = useState<Comic[]>(cached?.recentComics ?? []);
  const [comicsError, setComicsError] = useState('');
  const [comicsAttempt, setComicsAttempt] = useState(0);

  useEffect(() => {
    if (cached && cached.recentComics.length > 0 && comicsAttempt === 0) return;
    const task = new AbortController();
    request<{ results: Comic[] }>('/api/comics/updates', { signal: task.signal })
      .then(async res => {
        if (task.signal.aborted) return;
        if (Array.isArray(res.results) && res.results.length) {
          setRecentComics(res.results.slice(0, 10));
          setComicsError('');
          return;
        }
        const fallback = await request<{ results: Comic[] }>('/api/comics', { signal: task.signal });
        if (!task.signal.aborted && Array.isArray(fallback.results)) {
          setRecentComics(fallback.results.slice(0, 10));
          setComicsError('');
        }
      })
      .catch(error_ => {
        if (!task.signal.aborted) setComicsError(error_ instanceof Error ? error_.message : 'Manga is temporarily unavailable.');
      });
    return () => task.abort();
  }, [comicsAttempt, cached]);

  const retryComics = () => {
    setComicsError('');
    setComicsAttempt(v => v + 1);
  };

  return { recentComics, comicsError, retryComics };
}

function HomeHeroSection({
  featured,
  featuredChoices,
  featureDir,
  featureDuration,
  featuredResume,
  expandedOverviewKey,
  controls,
  pending,
  error,
  allShelvesEmpty,
  onRetry,
  onToggleOverview,
  onSwitchFeature,
  onSelectFeature,
}: Readonly<{
  featured: Title | undefined;
  featuredChoices: Title[];
  featureDir: 1 | -1;
  featureDuration: number | undefined;
  featuredResume: ReturnType<typeof resumeFor>;
  expandedOverviewKey: string;
  controls: LibraryControls;
  pending: boolean;
  error: string;
  allShelvesEmpty: boolean;
  onRetry: () => void;
  onToggleOverview: (key: string) => void;
  onSwitchFeature: (direction: 1 | -1) => void;
  onSelectFeature: (item: Title, index: number) => void;
}>) {
  if (featured) {
    return (
      <FeaturedHero
        featured={featured}
        featuredChoices={featuredChoices}
        featureDir={featureDir}
        featureDuration={featureDuration}
        featuredResume={featuredResume}
        expandedOverviewKey={expandedOverviewKey}
        controls={controls}
        onToggleOverview={onToggleOverview}
        onSwitchFeature={onSwitchFeature}
        onSelectFeature={onSelectFeature}
      />
    );
  }
  if (pending) {
    return (
      <div className="af-wrap af-home-hero af-home-loading" data-route-loading>
        <div className="af-feature-artwork" aria-hidden="true" />
        <div className="af-copy">
          <h1 className="sr-only">Home</h1>
          <span className="af-feature-title-placeholder" aria-hidden="true" />
          <output className="af-meta">Loading the catalog…</output>
        </div>
        <div className="af-feature-choices" aria-hidden="true" />
      </div>
    );
  }
  return (
    <div className="af-wrap af-title-page">
      <h1>Home</h1>
      {error ? <CatalogProblem error={error} retry={onRetry} />
        : allShelvesEmpty && <div className="af-state">
          <output>No featured titles are available yet.</output><ActionLink href={webHref('comics')}>Browse manga</ActionLink>
        </div>}
    </div>
  );
}

function HomeResumeShelves({
  resume,
  reading,
  controls,
  notify,
}: Readonly<{
  resume: ReturnType<typeof resumeEntries>;
  reading: LibraryControls['library']['reading'][string][];
  controls: LibraryControls;
  notify: ReturnType<typeof useToast>['notify'];
}>) {
  return <>
    {resume.length > 0 && <Shelf title="Continue Watching" href={webHref('history')} hrefLabel="Watch history" landscape>
      {resume.map(([key, entry]) => {
        const episode = entry.episode;
        const remaining = Math.ceil((entry.duration - entry.time) / 60);
        const left = formatHomeMinutesLeft(remaining);
        return <MediaCard key={key} item={entry.item} controls={controls} href={resumeHref(entry.item, key, episode)} landscape
          context={episode ? `S${episode.season} E${episode.number} · ${left}` : left}
          percent={progressPercent(entry)}
          onDismiss={() => {
            controls.recordProgress(key, null);
            notify({
              message: `Removed “${entry.item.title}” from Continue Watching.`,
              tone: 'default',
              action: {
                label: 'Undo',
                onAction: () => controls.recordProgress(key, { ...entry, updated: Date.now() }),
              },
            });
          }} />;
      })}
    </Shelf>}
    {reading.length > 0 && <Shelf title="Continue reading" href={webHref('reading')} hrefLabel="Reading list">
      {reading.map(entry => <ComicCard item={entry.item} controls={controls} key={entry.item.key}
        href={readerHref(entry.item, entry.chapter, entry.language, entry.listPage, entry.page)}
        context={`${entry.label} · Page ${entry.page}`}
        onDismiss={() => {
          void controls.removeReading(entry.item.key);
          notify({ message: `Removed “${entry.item.title}” from Continue reading.`, tone: 'default' });
        }} />)}
    </Shelf>}
  </>;
}

export function Home({ controls }: Readonly<{ controls: LibraryControls }>) {
  const { notify } = useToast();
  const [cached] = useState(() => readBrowseCache<CachedHome>('home:shelves'));
  const [data, setData] = useState<Partial<Record<ShelfKey, ShelfResult>>>(cached?.data ?? {});
  const [filter, setFilter] = useState<MediaType | 'all'>('all');
  const [trendingByType, setTrendingByType] = useState<Partial<Record<MediaType, Title[]>>>({});
  const [featuredKey, setFeaturedKey] = useState('');
  const [featureDir, setFeatureDir] = useState<1 | -1>(1);
  const [expandedOverviewKey, setExpandedOverviewKey] = useState('');
  const [ratings, setRatings] = useState<Record<string, CatalogRating>>(cached?.ratings ?? {});
  const [featuredDetails, setFeaturedDetails] = useState<Title>();
  const { recentComics, comicsError, retryComics } = useHomeRecentComics(cached);

  const jobs = useRef<Partial<Record<ShelfKey, AbortController>>>({});
  const [retrying, setRetrying] = useState<Partial<Record<ShelfKey, boolean>>>({});

  useEffect(() => {
    const loadedShelves = Object.entries(data).filter(([, value]) => value && 'titles' in value);
    if (loadedShelves.length > 0 || recentComics.length > 0) {
      writeBrowseCache<CachedHome>('home:shelves', {
        data: Object.fromEntries(loadedShelves),
        ratings,
        recentComics,
      });
    }
  }, [data, ratings, recentComics]);

  function loadShelf(key: ShelfKey) {
    const path = shelves.find(([name]) => name === key)?.[1];
    if (!path) return;
    jobs.current[key]?.abort();
    const task = new AbortController();
    const { signal } = task;
    jobs.current[key] = task;
    setRetrying(state => ({ ...state, [key]: true }));
    request<ShelfResponse>(path, { signal }).then(result => {
      if (signal.aborted) return;
      const titles = normalizeTitles(result.results ?? result[key] ?? []);
      setData(current => ({ ...current, [key]: { titles } }));
    }).catch(error_ => {
      if (!signal.aborted) setData(current => ({ ...current, [key]: { error: error_.message } }));
    }).finally(() => { if (!signal.aborted) setRetrying(state => ({ ...state, [key]: false })); });
  }

  useEffect(() => {
    document.title = 'Afterframe · Movies, TV & Manga';
    for (const [key] of shelves) {
      if (cached?.data[key] && 'titles' in cached.data[key]!) continue;
      loadShelf(key);
    }
    const currentJobs = jobs.current;
    return () => { for (const task of Object.values(currentJobs)) task?.abort(); };
  }, [cached]);

  useEffect(() => {
    if (filter === 'all' || trendingByType[filter]) return;
    const task = new AbortController();
    request<TitleResults>(`/api/trending?type=${filter}`, { signal: task.signal })
      .then(result => {
        if (task.signal.aborted) return;
        const titles = normalizeTitles(result.results);
        setTrendingByType(current => ({ ...current, [filter]: titles }));
      })
      .catch(() => {});
    return () => task.abort();
  }, [filter, trendingByType]);

  const ratingKeys = collectVisibleRatingKeys(data, filter, trendingByType);
  useEffect(() => {
    if (!ratingKeys) return;
    const task = new AbortController();
    const timer = window.setTimeout(() => {
      request<{ ratings: Record<string, CatalogRating> }>(`/api/imdb/cached?titles=${ratingKeys}`, { signal: task.signal })
        .then(({ ratings }) => { if (!task.signal.aborted) setRatings(current => ({ ...ratings, ...current })); }).catch(() => {});
    }, 80);
    return () => { clearTimeout(timer); task.abort(); };
  }, [ratingKeys]);

  function shelfTitles(key: ShelfKey) {
    const shelf = data[key];
    return shelf && 'titles' in shelf ? shelf.titles : [];
  }
  const failures = Object.values(data).flatMap(shelf => 'error' in shelf ? [shelf.error] : []);
  const refreshing = Object.values(retrying).some(Boolean);
  const error = failures.length === shelves.length && !refreshing ? failures[0] : '';
  const pending = Object.keys(data).length < shelves.length || (failures.length === shelves.length && refreshing);

  function withRating(item: Title) {
    return { ...item, rating: ratings[item.key] ?? ratings[`${item.type}:${item.id}`] ?? item.rating };
  }

  const featuredChoices = [...new Map([...shelfTitles('trending'), ...(data.trending ? shelfTitles('newMovies') : [])]
    .filter(item => item.type === 'movie' && item.backdrop && item.date && item.date <= today())
    .map(item => [item.key, item])).values()].slice(0, 3).map(withRating);
  const featured = featuredChoices.find(item => item.key === featuredKey) ?? featuredChoices[0];
  const featuredId = featured?.id;

  useEffect(() => {
    if (!featuredId) return;
    const task = new AbortController();
    const { signal } = task;
    (async () => {
      const raw = await request<RawTitle>(`/api/movie/${featuredId}`, { signal });
      if (signal.aborted) return;
      const details = normalizeTitle(raw, 'movie');
      setFeaturedDetails(details);
      if (!details.imdb) return;
      const { rating } = await request<{ rating?: CatalogRating }>(`/api/imdb?id=${encodeURIComponent(details.imdb)}`, { signal });
      if (rating && !signal.aborted) setRatings(current => ({ ...current, [`movie:${featuredId}`]: rating }));
    })().catch(() => {});
    return () => task.abort();
  }, [featuredId]);

  const featureIndex = featuredChoices.findIndex(item => item.key === featured?.key);
  const featureDuration = featuredDetails?.key === featured?.key ? featuredDetails?.duration : featured?.duration;
  const featuredResume = featured && resumeFor(controls.library, featured);
  const likelyTrending = filter === 'all'
    ? shelfTitles('trending')
    : (trendingByType[filter] ?? shelfTitles('trending').filter(item => item.type === filter));
  const freshTrending = likelyTrending.filter(item => item.key !== featured?.key);
  const trending = freshTrending.length ? freshTrending : likelyTrending;
  const resume = resumeEntries(controls.library).slice(0, 12);
  const reading = Object.values(controls.library.reading).sort((a, b) => b.updated - a.updated).slice(0, 8);
  const retry = () => { for (const [key] of shelves) if (data[key] && 'error' in data[key]!) loadShelf(key); };
  const shelfStatus = (key: ShelfKey, label: string) => {
    const shelf = data[key];
    if (!shelf || ('error' in shelf && retrying[key])) return <section className="af-section" key={key}><h2>{label}</h2><Loading label={`Loading ${label.toLowerCase()}…`} /></section>;
    if ('error' in shelf) return <section className="af-section" key={key}><h2>{label}</h2><CatalogProblem error={shelf.error} retry={() => loadShelf(key)} /></section>;
    return null;
  };

  function switchFeature(direction: 1 | -1) {
    const next = (featureIndex + direction + featuredChoices.length) % featuredChoices.length;
    setFeatureDir(direction);
    setFeaturedKey(featuredChoices[next].key);
  }

  function selectFeature(item: Title, index: number) {
    if (item.key === featured?.key) return;
    setFeatureDir(index >= featureIndex ? 1 : -1);
    setFeaturedKey(item.key);
  }

  return <>
    <HomeHeroSection
      featured={featured}
      featuredChoices={featuredChoices}
      featureDir={featureDir}
      featureDuration={featureDuration}
      featuredResume={featuredResume}
      expandedOverviewKey={expandedOverviewKey}
      controls={controls}
      pending={pending}
      error={error}
      allShelvesEmpty={shelves.every(([key]) => !shelfTitles(key).length)}
      onRetry={retry}
      onToggleOverview={setExpandedOverviewKey}
      onSwitchFeature={switchFeature}
      onSelectFeature={selectFeature}
    />
    <div className="af-wrap af-content">
      <HomeResumeShelves resume={resume} reading={reading} controls={controls} notify={notify} />
      {!error && !pending && shelfStatus('trending', 'Trending this week')}
      {shelfTitles('trending').length > 0 && <Shelf title="Trending this week" landscape actions={
        <fieldset className="af-filters" aria-label="Filter trending">
          {([['all', 'All'], ['movie', 'Movies'], ['tv', 'TV Shows']] as const).map(([value, label]) =>
            <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
        </fieldset>
      }>
        {trending.length ? trending.slice(0, 12).map((item, idx) => <MediaCard key={item.key} item={withRating(item)} controls={controls} landscape eager={idx < 4} />)
          : <p className="af-state">No trending titles for this filter.</p>}
      </Shelf>}
      {collections.map(([key, label, path]) => shelfTitles(key).length ? <Shelf title={label} key={key} href={webHref(path)}>
        {shelfTitles(key).slice(0, 8).map(item => <MediaCard key={item.key} item={withRating(item)} controls={controls} />)}
      </Shelf> : !error && !pending && shelfStatus(key, label))}
      {recentComics.length > 0 ? <Shelf title="Manga" href={webHref('comics')}>
        {recentComics.map(item => <ComicCard key={item.key} item={item} controls={controls} />)}
      </Shelf> : comicsError && <section className="af-section"><h2>Manga</h2>
        <p className="af-state" role="alert">{comicsError} <button type="button" className="af-text-link" onClick={retryComics}>Retry manga</button></p>
      </section>}
    </div>
  </>;
}
