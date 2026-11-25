import { archiveCatalog, type ArchiveEpisode, type ArchiveTitle } from '@afterframe/shared/catalog';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  episodeKey, episodePosition, isAired, navigate, normalizeTitle,
  playHref, playerHref, previousBrowse, request, timeCode, titleHref, webHref,
  type Details, type Episode, type EpisodePosition, type Title,
} from './catalog';
import { ActionLink, Icon, Loading } from './components';
import { getSeason, progressPercent, resumeFor, savedRating, type LibraryControls } from './library';
import { ArchiveEditionView } from './player/ArchiveEditionView';
import { PlayerEpisodeRow } from './player/PlayerEpisodeRow';
import { archiveMap, archiveToTitle, parsePlayerRoute, playerTitleKey } from './player/route';
import { animePlayers, cineSrcOrigin, episodeRangeSize, type ActiveMedia, type AnimeProvider, type PlayerRoute } from './player/types';
import { VideoStage } from './player/VideoStage';
import { AfSelect } from './UiControls';
import './player.css';

const playerRatingOptions = [
  { value: '0', label: 'Choose 1–10' },
  ...Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1), label: `${index + 1} / 10` })),
];

export { parsePlayerRoute, playerTitleKey, type PlayerRoute };

export function PlayerPage({ route, controls }: { route: PlayerRoute; controls: LibraryControls }) {
  const [loaded, setLoaded] = useState<ActiveMedia | null>(null);
  const [editionDetails, setEditionDetails] = useState<ArchiveTitle | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [details, setDetails] = useState<Details>();
  const [episodeTitle, setEpisodeTitle] = useState<string>('');
  const [seasonNumber, setSeasonNumber] = useState<number>(route.kind === 'catalog' && route.season !== undefined ? route.season : 1);
  const [seasonEpisodes, setSeasonEpisodes] = useState<Episode[]>([]);
  const [seasonRange, setSeasonRange] = useState(0);
  const [seasonError, setSeasonError] = useState('');
  const [seasonAttempt, setSeasonAttempt] = useState(0);
  const [adjacent, setAdjacent] = useState<{ previous?: EpisodePosition & { key?: string }; next?: EpisodePosition & { key?: string }; ready: boolean }>({ ready: false });
  const [activeProvider, setActiveProvider] = useState<AnimeProvider | null>(null);
  const [providerControls, setProviderControls] = useState(false);
  const [preferredQuality, setPreferredQuality] = useState<string | undefined>(undefined);

  const stageRef = useRef<HTMLDivElement>(null);
  const seasonCacheRef = useRef(new Map<number, Promise<Episode[]>>());
  const libraryRef = useRef(controls.library);
  libraryRef.current = controls.library;
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;

  const libraryResolved = controls.state !== 'loading';

  const backHref = useMemo(() => {
    const fallback = route.kind === 'catalog' ? `${route.type}/${route.id}` : 'home';
    return previousBrowse(fallback);
  }, [route]);

  const routeKind = route.kind;
  const routeCatalogType = route.kind === 'catalog' ? route.type : undefined;
  const routeCatalogId = route.kind === 'catalog' ? route.id : undefined;
  const routeSeason = route.kind === 'catalog' ? route.season : undefined;
  const routeEpisode = route.kind === 'catalog' ? route.episode : undefined;
  const routeEditionKey = route.kind === 'edition' ? route.key : undefined;
  const routeWatch = route.kind === 'edition' ? route.watch : true;
  const routeEditionEp = route.kind === 'edition' ? route.episodeKey : undefined;

  useEffect(() => {
    if (routeKind !== 'catalog' || document.querySelector('link[data-video-preconnect]')) return;
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = cineSrcOrigin;
    link.dataset.videoPreconnect = '';
    document.head.append(link);
  }, [routeKind]);

  useEffect(() => {
    if (!libraryResolved && routeWatch) return;
    const controller = new AbortController();
    const { signal } = controller;
    setError('');
    setEpisodeTitle('');

    async function resolve() {
      if (routeKind === 'catalog' && routeCatalogType && routeCatalogId !== undefined) {
        const episode = routeCatalogType === 'tv' && routeSeason !== undefined && routeEpisode !== undefined
          ? { season: routeSeason, number: routeEpisode, title: `Episode ${routeEpisode}` }
          : undefined;
        const itemKey = `${routeCatalogType}-${routeCatalogId}`;
        const progressKey = `${itemKey}/cinesrc${episode ? `-s${episode.season}e${episode.number}` : ''}`;

        const existing = loadedRef.current;
        if (existing && existing.embed && existing.item.key === itemKey) {
          document.title = `${episode ? `${existing.item.title} · S${episode.season} E${episode.number}` : existing.item.title} · Afterframe`;
          setLoaded({ ...existing, episode, progressKey });
          if (episode) setSeasonNumber(episode.season);
          return;
        }

        setLoaded(null);
        setEditionDetails(null);
        const raw = await request<Details>(`/api/${routeCatalogType}/${routeCatalogId}/playback`, { signal });
        if (signal.aborted) return;
        const item = normalizeTitle(raw, routeCatalogType);
        document.title = `${episode ? `${item.title} · S${episode.season} E${episode.number}` : item.title} · Afterframe`;
        setLoaded({ item, episode, embed: true, progressKey });
        if (episode) setSeasonNumber(episode.season);
        request<Details>(`/api/${routeCatalogType}/${routeCatalogId}`, { signal })
          .then(full => {
            if (signal.aborted) return;
            setDetails(full);
          }).catch(() => {});
        return;
      }

      if (routeKind === 'edition' && routeEditionKey) {
        let entry = archiveMap.get(routeEditionKey);
        if (!entry && routeEditionKey.startsWith('archive-')) {
          entry = await request<ArchiveTitle>(`/api/archive/${encodeURIComponent(routeEditionKey.slice('archive-'.length))}`, { signal });
        }
        if (signal.aborted) return;
        if (!entry) throw new Error('This edition could not be found.');
        const item = archiveToTitle(entry);
        if (!routeWatch) {
          document.title = `${entry.title} · Afterframe`;
          setLoaded(null);
          setEditionDetails(entry);
          return;
        }
        const lib = libraryRef.current;
        const resumed = lib.preferences.resume !== false ? resumeFor(lib, item) : undefined;
        const resumedKey = resumed ? Object.keys(lib.progress).find(k => lib.progress[k] === resumed)?.split('/')[1] : undefined;
        const archiveEp: ArchiveEpisode | undefined = entry.episodes
          ? entry.episodes.find(ep => ep.key === (routeEditionEp || resumedKey)) ?? entry.episodes[0]
          : undefined;
        const nativeMedia = archiveEp?.media ?? entry.media ?? undefined;
        if (!nativeMedia) throw new Error('A playable stream is unavailable for this edition.');
        const episode = archiveEp ? { key: archiveEp.key, season: archiveEp.season ?? 1, number: archiveEp.number ?? 1, title: archiveEp.title, duration: archiveEp.duration } : undefined;
        const progressKey = archiveEp ? `${entry.key}/${archiveEp.key}` : entry.key;
        document.title = `${archiveEp?.title || entry.title} · Afterframe`;
        setEditionDetails(null);
        setLoaded({ item, archive: entry, episode, nativeMedia, embed: false, progressKey });
      }
    }

    void resolve().catch(problem => {
      if (!signal.aborted) setError(problem instanceof Error ? problem.message : 'Title unavailable.');
    });
    return () => controller.abort();
  }, [libraryResolved, routeKind, routeCatalogType, routeCatalogId, routeSeason, routeEpisode, routeEditionKey, routeWatch, routeEditionEp, attempt]);

  const loadedItemId = loaded?.item.id;
  const loadedItemKey = loaded?.item.key;
  const loadedItemTitle = loaded?.item.title;
  const loadedItemType = loaded?.item.type;
  const loadedArchive = loaded?.archive;
  const loadedEpisodeSeason = loaded?.episode?.season;
  const loadedEpisodeNumber = loaded?.episode?.number;
  const loadedEpisodeKey = loaded?.episode?.key;

  const readSeason = useCallback((showId: number, season: number) => {
    let pending = seasonCacheRef.current.get(season);
    if (!pending) {
      pending = getSeason(showId, season).catch(problem => {
        seasonCacheRef.current.delete(season);
        throw problem;
      });
      seasonCacheRef.current.set(season, pending);
    }
    return pending;
  }, []);

  useEffect(() => {
    if (!loadedItemKey || loadedItemType !== 'tv' || loadedArchive?.episodes || !loadedItemId) return;
    let active = true;
    setSeasonError('');
    readSeason(loadedItemId, seasonNumber)
      .then(episodes => {
        if (!active) return;
        setSeasonEpisodes(episodes);
        if (loadedEpisodeSeason === seasonNumber && loadedEpisodeNumber !== undefined) {
          const idx = episodes.findIndex(ep => ep.episode_number === loadedEpisodeNumber);
          setSeasonRange(idx >= 0 ? Math.floor(idx / episodeRangeSize) : 0);
          const currentEp = idx >= 0 ? episodes[idx] : undefined;
          if (currentEp) {
            setEpisodeTitle(currentEp.name);
            document.title = `${currentEp.name} · ${loadedItemTitle} · Afterframe`;
          }
        } else {
          setSeasonRange(0);
        }
      })
      .catch(problem => {
        if (active) setSeasonError(problem instanceof Error ? problem.message : 'Episodes unavailable.');
      });
    return () => { active = false; };
  }, [loadedItemKey, loadedItemId, loadedItemType, loadedItemTitle, loadedArchive, loadedEpisodeSeason, loadedEpisodeNumber, seasonNumber, seasonAttempt, readSeason]);

  useEffect(() => {
    if (!loadedItemKey || loadedItemType !== 'tv') {
      setAdjacent({ ready: true });
      return;
    }
    if (loadedArchive?.episodes) {
      const list = loadedArchive.episodes;
      const idx = list.findIndex(ep => ep.key === loadedEpisodeKey);
      const toPos = (ep?: ArchiveEpisode) => ep ? { key: ep.key, season: ep.season ?? 1, number: ep.number ?? 1, title: ep.title } : undefined;
      setAdjacent({
        previous: idx > 0 ? toPos(list[idx - 1]) : undefined,
        next: idx >= 0 && idx + 1 < list.length ? toPos(list[idx + 1]) : undefined,
        ready: true,
      });
      return;
    }
    if (!loadedItemId || loadedEpisodeSeason === undefined || loadedEpisodeNumber === undefined) return;
    let active = true;
    setAdjacent({ ready: false });

    async function resolveAdjacent() {
      const episodes = await readSeason(loadedItemId!, loadedEpisodeSeason!);
      if (!active) return;
      const currentEp = episodes.find(ep => ep.episode_number === loadedEpisodeNumber);
      if (currentEp) {
        setEpisodeTitle(currentEp.name);
        document.title = `${currentEp.name} · ${loadedItemTitle} · Afterframe`;
      }
      const aired = episodes.filter(isAired);
      const idx = aired.findIndex(ep => ep.episode_number === loadedEpisodeNumber);
      if (idx < 0) {
        setAdjacent({ ready: true });
        return;
      }
      let prev: (EpisodePosition & { key?: string }) | undefined = idx > 0 ? episodePosition(aired[idx - 1]) : undefined;
      let next: (EpisodePosition & { key?: string }) | undefined = idx + 1 < aired.length ? episodePosition(aired[idx + 1]) : undefined;
      setAdjacent({ previous: prev, next, ready: false });

      if (loadedEpisodeSeason! > 0 && (!prev || !next) && details?.seasons?.length) {
        const regularSeasons = details.seasons
          .filter(s => s.season_number > 0 && s.episode_count > 0)
          .sort((a, b) => a.season_number - b.season_number);
        const seasonIdx = regularSeasons.findIndex(s => s.season_number === loadedEpisodeSeason);
        if (seasonIdx >= 0) {
          const findEdge = async (step: number, edge: number) => {
            for (let cursor = seasonIdx + step; regularSeasons[cursor]; cursor += step) {
              const eps = (await readSeason(loadedItemId!, regularSeasons[cursor].season_number)).filter(isAired);
              const candidate = eps.at(edge);
              if (candidate) return episodePosition(candidate);
            }
            return undefined;
          };
          const [crossPrev, crossNext] = await Promise.all([
            prev ? Promise.resolve(prev) : findEdge(-1, -1).catch(() => undefined),
            next ? Promise.resolve(next) : findEdge(1, 0).catch(() => undefined),
          ]);
          if (!active) return;
          prev = crossPrev;
          next = crossNext;
        }
      }
      if (active) setAdjacent({ previous: prev, next, ready: true });
    }

    void resolveAdjacent().catch(() => {
      if (active) setAdjacent({ ready: true });
    });
    return () => { active = false; };
  }, [loadedItemKey, loadedItemId, loadedItemType, loadedItemTitle, loadedArchive, loadedEpisodeSeason, loadedEpisodeNumber, loadedEpisodeKey, details, readSeason]);

  const navigateEpisode = useCallback((target: EpisodePosition & { key?: string }) => {
    const current = loadedRef.current;
    if (!current) return;
    const nextHref = target.key
      ? playerHref(`edition/${encodeURIComponent(current.item.key)}/watch/${encodeURIComponent(target.key)}`, backHref)
      : playHref(current.item, target);
    navigate(nextHref);
  }, [backHref]);

  if (error) {
    const alternate = route.kind === 'catalog' && route.type === 'movie'
      ? archiveCatalog.find(entry => entry.type === 'movie' && entry.id === route.id && entry.media)
      : undefined;
    return <section className="af-wrap af-directory">
      <h1 tabIndex={-1}>Title unavailable</h1>
      <p className="af-state" role="alert">{error}</p>
      <div className="af-actions">
        <button type="button" className="af-button af-secondary" onClick={() => setAttempt(v => v + 1)}>Retry</button>
        <ActionLink href={backHref}>Back</ActionLink>
        {alternate && <ActionLink primary href={playerHref(`edition/${encodeURIComponent(alternate.key)}/watch`, backHref)}>Play licensed Archive edition</ActionLink>}
      </div>
    </section>;
  }

  if (editionDetails) {
    return <ArchiveEditionView entry={editionDetails} backHref={backHref} controls={controls} />;
  }

  if (!loaded) {
    return <section className="af-wrap af-directory">
      <a className="af-text-link" href={backHref}><Icon name="left" /> Back</a>
      <Loading label="Loading playback…" shape="hero" />
    </section>;
  }

  const hydratedItem: Title = details && loaded.embed
    ? { ...loaded.item, ...normalizeTitle(details, loaded.item.type), totalEpisodes: details.number_of_episodes }
    : loaded.item;
  const hydratedEpisode = loaded.episode
    ? { ...loaded.episode, title: episodeTitle || loaded.episode.title }
    : undefined;

  const seasons = (details?.seasons ?? []).filter(season => season.season_number >= 0 && season.episode_count > 0);
  const watchTitle = hydratedEpisode?.title || hydratedItem.title;
  const sourcePage = loaded.nativeMedia?.page || (loaded.nativeMedia?.archive ? `https://archive.org/details/${encodeURIComponent(loaded.nativeMedia.archive)}` : '');
  const airedInSeason = seasonEpisodes.filter(isAired);
  const watchedInSeason = airedInSeason.filter(ep => controls.library.watched[episodeKey(hydratedItem, ep)]).length;
  const rangeCount = Math.ceil(seasonEpisodes.length / episodeRangeSize);
  const clampedRange = Math.min(seasonRange, Math.max(0, rangeCount - 1));
  const rangeStart = clampedRange * episodeRangeSize;

  return <div className="af-wrap af-player-page">
    <h1 className="sr-only" tabIndex={-1}>{watchTitle}</h1>
    <div className="af-watch-stage" ref={stageRef}>
      <VideoStage
        key={loaded.progressKey}
        stageRef={stageRef}
        media={loaded}
        displayItem={hydratedItem}
        displayEpisode={hydratedEpisode}
        backHref={route.kind === 'catalog' ? titleHref(hydratedItem) : webHref(`edition/${encodeURIComponent(loaded.item.key)}`)}
        adjacent={adjacent}
        controls={controls}
        initialProvider={activeProvider}
        onProviderChange={setActiveProvider}
        providerControls={providerControls}
        onProviderControlsChange={setProviderControls}
        preferredQuality={preferredQuality}
        onPreferredQualityChange={setPreferredQuality}
        onNavigateEpisode={navigateEpisode}
      />
    </div>
    <div className="af-watch-body">
      {!hydratedEpisode && <div className="af-watch-overview">
        {hydratedItem.description && <p className="af-overview">{hydratedItem.description}</p>}
        <div className="af-rating">
          <span>Your rating</span>
          <AfSelect
            ariaLabel="Your rating"
            value={String(savedRating(controls.library.ratings[hydratedItem.key]))}
            disabled={!controls.ready || controls.isPending(hydratedItem.key)}
            options={playerRatingOptions}
            onChange={value => void controls.rate(hydratedItem, Number(value))}
          />
        </div>
      </div>}

      {loaded.archive?.episodes && <section className="af-section" aria-label="Episodes">
        <header className="af-section-head"><h2>Episodes</h2></header>
        <div className={`af-episode-grid ${controls.library.preferences.compact ? 'af-compact' : ''}`}>
          {loaded.archive.episodes.map(ep => {
            const epKey = `${loaded.item.key}/${ep.key}`;
            const current = loaded.episode?.key === ep.key;
            const marked = Boolean(controls.library.watched[epKey]);
            const epProgress = !marked ? controls.library.progress[epKey] : undefined;
            return <article className="af-episode af-episode-archive" key={ep.key} aria-current={current ? 'true' : undefined}>
              <div className="af-episode-copy">
                <a className="af-episode-title" href={playerHref(`edition/${encodeURIComponent(loaded.item.key)}/watch/${encodeURIComponent(ep.key)}`, backHref)}>
                  {ep.title} {current && <span className="af-meta">(Playing)</span>}
                </a>
                {ep.duration && <p className="af-meta">{ep.duration} min</p>}
                {epProgress && epProgress.time > 5 && epProgress.time < epProgress.duration && <div className="af-episode-progress">
                  <span>{controls.library.preferences.resume !== false ? 'Resume at' : 'Last position'} {timeCode(epProgress.time)}</span>
                  <progress className="af-progress" value={progressPercent(epProgress)} max={100} aria-label={`${ep.title} watched progress`} />
                </div>}
              </div>
              <button type="button" className="af-icon-button af-watched" aria-pressed={marked}
                aria-label={`${marked ? 'Watched' : 'Mark watched'}: ${ep.title}`}
                disabled={!controls.ready || controls.isPending(epKey)}
                onClick={() => void controls.toggleWatched(hydratedItem, epKey)}>
                <span>{marked && <Icon name="check" />}</span><small>{marked ? 'Watched' : 'Mark watched'}</small>
              </button>
            </article>;
          })}
        </div>
      </section>}

      {!loaded.archive && hydratedItem.type === 'tv' && seasons.length > 0 && <section className="af-section" aria-label="Episodes">
        <header className="af-section-head">
          <div>
            <h2>Episodes</h2>
            {airedInSeason.length > 0 && <p className="af-meta">{watchedInSeason} of {airedInSeason.length} aired episodes watched</p>}
          </div>
          <div className="af-episode-pickers">
            <AfSelect
              ariaLabel="Select season"
              value={String(seasonNumber)}
              options={seasons.map(season => ({ value: String(season.season_number), label: season.name }))}
              onChange={value => { setSeasonNumber(Number(value)); setSeasonRange(0); }}
            />
            {rangeCount > 1 && <AfSelect
              ariaLabel="Episode range"
              value={String(clampedRange)}
              options={Array.from({ length: rangeCount }, (_, index) => {
                const first = seasonEpisodes[index * episodeRangeSize].episode_number;
                const last = seasonEpisodes[Math.min(seasonEpisodes.length, (index + 1) * episodeRangeSize) - 1].episode_number;
                return { value: String(index), label: `Episodes ${first}${first === last ? '' : `–${last}`}` };
              })}
              onChange={value => setSeasonRange(Number(value))}
            />}
          </div>
        </header>
        {seasonError
          ? <p className="af-state" role="alert">{seasonError} <button type="button" className="af-text-link" onClick={() => setSeasonAttempt(v => v + 1)}>Retry</button></p>
          : <div className={`af-episode-grid ${controls.library.preferences.compact ? 'af-compact' : ''}`}>
            {seasonEpisodes.slice(rangeStart, rangeStart + episodeRangeSize).map(ep => (
              <PlayerEpisodeRow
                key={episodeKey(hydratedItem, ep)}
                item={hydratedItem}
                episode={ep}
                current={loaded.episode?.season === ep.season_number && loaded.episode?.number === ep.episode_number}
                controls={controls}
              />
            ))}
          </div>}
      </section>}

      {sourcePage && loaded.archive && <div className="af-watch-source">
        {loaded.archive.credit && <span>{loaded.archive.credit}</span>}
        <a href={sourcePage} target="_blank" rel="noopener noreferrer">{loaded.nativeMedia?.source || 'Internet Archive'}</a>
        {loaded.archive.license && <a href={loaded.archive.license[1]} target="_blank" rel="noopener noreferrer">{loaded.archive.license[0]}</a>}
      </div>}
      {loaded.embed && <div className="af-watch-source">
        <span>Playback by {animePlayers[activeProvider ?? 'cinesrc'].label}</span>
      </div>}
    </div>
  </div>;
}
