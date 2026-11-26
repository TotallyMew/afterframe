import { archiveCatalog, type ArchiveEpisode, type ArchiveTitle } from '@afterframe/shared/catalog';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  episodeKey, episodeLabel, episodePosition, formatDate, imagePath, isAired, navigate, normalizeTitle,
  playerHref, previousBrowse, request, timeCode, titleHref, webHref,
  type Details, type Episode, type EpisodePosition, type Title,
} from './catalog';
import { ActionLink, Artwork, Icon, Loading, SaveButton } from './components';
import { orderSeasons } from './Details';
import { effectiveWatchStatus, getSeason, progressPercent, resumeFor, savedRating, watchStatuses, type LibraryControls, type WatchStatus } from './library';
import { FolderPickerPopover } from './library/FolderPickerPopover';
import { ArchiveEditionView } from './player/ArchiveEditionView';
import { PlayerEpisodeRow } from './player/PlayerEpisodeRow';
import { PlayerGlyph } from './player/PlayerGlyph';
import { archiveMap, archiveToTitle, parsePlayerRoute, playerTitleKey } from './player/route';
import { animePlayers, cineSrcOrigin, type ActiveMedia, type AnimeProvider, type PlayerRoute } from './player/types';
import { VideoStage } from './player/VideoStage';
import { AfSelect } from './UiControls';
import './player.css';

const playerEpisodeRangeSize = 24;
const playerRatingOptions = [
  { value: '0', label: 'Choose 1–10' },
  ...Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1), label: `${index + 1} / 10` })),
];
const watchStatusOptions = Object.entries(watchStatuses).map(([value, label]) => ({ value, label }));

function isPlayerUrl(href: string): boolean {
  return /^\/(?:movie\/\d+\/watch|tv\/\d+\/s\d+e\d+|edition\/[^/]+\/watch)(?:$|\?)/.test(href);
}

export { parsePlayerRoute, playerTitleKey, type PlayerRoute };

export function PlayerPage({ route, controls }: { route: PlayerRoute; controls: LibraryControls }) {
  const [loaded, setLoaded] = useState<ActiveMedia | null>(null);
  const [editionDetails, setEditionDetails] = useState<ArchiveTitle | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [details, setDetails] = useState<Details>();
  const [episodeTitle, setEpisodeTitle] = useState<string>('');
  const [currentEpisodeData, setCurrentEpisodeData] = useState<Episode | null>(null);
  const [nextEpisodeStill, setNextEpisodeStill] = useState<string | null>(null);
  const [seasonNumber, setSeasonNumber] = useState<number>(route.kind === 'catalog' && route.season !== undefined ? route.season : 1);
  const [seasonEpisodes, setSeasonEpisodes] = useState<Episode[]>([]);
  const [seasonRange, setSeasonRange] = useState(0);
  const [seasonError, setSeasonError] = useState('');
  const [seasonAttempt, setSeasonAttempt] = useState(0);
  const [adjacent, setAdjacent] = useState<{ previous?: EpisodePosition & { key?: string }; next?: EpisodePosition & { key?: string }; ready: boolean }>({ ready: false });
  const [activeProvider, setActiveProvider] = useState<AnimeProvider | null>(null);
  const [providerControls, setProviderControls] = useState(false);
  const [preferredQuality, setPreferredQuality] = useState<string | undefined>(undefined);
  const [theatreMode, setTheatreMode] = useState(false);
  const [episodesOpen, setEpisodesOpen] = useState(false);
  const [synopsisExpanded, setSynopsisExpanded] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const seasonCacheRef = useRef(new Map<number, Promise<Episode[]>>());
  const libraryRef = useRef(controls.library);
  libraryRef.current = controls.library;
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;

  const libraryResolved = controls.state !== 'loading';

  // Preserve a clean, non-recursive back origin across episode-to-episode navigation
  const originBack = useMemo(() => {
    const fallback = route.kind === 'catalog' ? `${route.type}/${route.id}` : 'home';
    const candidate = previousBrowse(fallback);
    if (isPlayerUrl(candidate)) return webHref(fallback);
    return candidate;
  }, [route]);

  const detailsHref = useMemo(() => {
    if (route.kind === 'catalog') return titleHref({ type: route.type, id: route.id });
    return webHref(`edition/${encodeURIComponent(route.key)}`);
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
    setCurrentEpisodeData(null);
    setNextEpisodeStill(null);
    setSynopsisExpanded(false);

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
          setSeasonRange(idx >= 0 ? Math.floor(idx / playerEpisodeRangeSize) : 0);
          const currentEp = idx >= 0 ? episodes[idx] : undefined;
          if (currentEp) {
            setEpisodeTitle(currentEp.name);
            setCurrentEpisodeData(currentEp);
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
        setCurrentEpisodeData(currentEp);
        document.title = `${currentEp.name} · ${loadedItemTitle} · Afterframe`;
      }
      const aired = episodes.filter(isAired);
      const idx = aired.findIndex(ep => ep.episode_number === loadedEpisodeNumber);
      if (idx < 0) {
        setAdjacent({ ready: true });
        return;
      }
      let prev: (EpisodePosition & { key?: string }) | undefined = idx > 0 ? episodePosition(aired[idx - 1]) : undefined;
      let nextEpObj: Episode | undefined = idx + 1 < aired.length ? aired[idx + 1] : undefined;
      let next: (EpisodePosition & { key?: string }) | undefined = nextEpObj ? episodePosition(nextEpObj) : undefined;
      if (nextEpObj?.still_path) setNextEpisodeStill(nextEpObj.still_path);
      setAdjacent({ previous: prev, next, ready: false });

      if (loadedEpisodeSeason! > 0 && (!prev || !next) && details?.seasons?.length) {
        const regularSeasons = details.seasons
          .filter(s => s.season_number > 0 && s.episode_count > 0)
          .sort((a, b) => a.season_number - b.season_number);
        const seasonIdx = regularSeasons.findIndex(s => s.season_number === loadedEpisodeSeason);
        if (seasonIdx >= 0) {
          const findEdge = async (step: number, edge: number): Promise<Episode | undefined> => {
            for (let cursor = seasonIdx + step; regularSeasons[cursor]; cursor += step) {
              const eps = (await readSeason(loadedItemId!, regularSeasons[cursor].season_number)).filter(isAired);
              const candidate = eps.at(edge);
              if (candidate) return candidate;
            }
            return undefined;
          };
          const [crossPrevEp, crossNextEp] = await Promise.all([
            prev ? Promise.resolve(undefined) : findEdge(-1, -1).catch(() => undefined),
            next ? Promise.resolve(undefined) : findEdge(1, 0).catch(() => undefined),
          ]);
          if (!active) return;
          if (!prev && crossPrevEp) prev = episodePosition(crossPrevEp);
          if (!next && crossNextEp) {
            nextEpObj = crossNextEp;
            next = episodePosition(crossNextEp);
            if (crossNextEp.still_path) setNextEpisodeStill(crossNextEp.still_path);
          }
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
    setEpisodesOpen(false);
    const nextHref = target.key
      ? playerHref(`edition/${encodeURIComponent(current.item.key)}/watch/${encodeURIComponent(target.key)}`, originBack)
      : playerHref(`${current.item.type}/${current.item.id}/s${target.season}e${target.number}`, originBack);
    navigate(nextHref);
  }, [originBack]);

  useEffect(() => {
    if (!episodesOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setEpisodesOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [episodesOpen]);

  if (error) {
    const alternate = route.kind === 'catalog' && route.type === 'movie'
      ? archiveCatalog.find(entry => entry.type === 'movie' && entry.id === route.id && entry.media)
      : undefined;
    return <section className="af-wrap af-directory">
      <h1 tabIndex={-1}>Title unavailable</h1>
      <p className="af-state" role="alert">{error}</p>
      <div className="af-actions">
        <button type="button" className="af-button af-secondary" onClick={() => setAttempt(v => v + 1)}>Retry</button>
        <ActionLink href={originBack}>Back</ActionLink>
        {alternate && <ActionLink primary href={playerHref(`edition/${encodeURIComponent(alternate.key)}/watch`, originBack)}>Play licensed Archive edition</ActionLink>}
      </div>
    </section>;
  }

  if (editionDetails) {
    return <ArchiveEditionView entry={editionDetails} backHref={originBack} controls={controls} />;
  }

  if (!loaded) {
    return <section className="af-wrap af-directory">
      <a className="af-text-link" href={originBack}><Icon name="left" /> Back</a>
      <Loading label="Loading playback…" shape="hero" />
    </section>;
  }

  const hydratedItem: Title = details && loaded.embed
    ? { ...loaded.item, ...normalizeTitle(details, loaded.item.type), totalEpisodes: details.number_of_episodes }
    : loaded.item;
  const hydratedEpisode = loaded.episode
    ? { ...loaded.episode, title: episodeTitle || loaded.episode.title }
    : undefined;

  const orderedSeasons = orderSeasons(details?.seasons);
  const watchTitle = hydratedEpisode?.title || hydratedItem.title;
  const sourcePage = loaded.nativeMedia?.page || (loaded.nativeMedia?.archive ? `https://archive.org/details/${encodeURIComponent(loaded.nativeMedia.archive)}` : '');
  const airedInSeason = seasonEpisodes.filter(isAired);
  const watchedInSeason = airedInSeason.filter(ep => controls.library.watched[episodeKey(hydratedItem, ep)]).length;
  const rangeCount = Math.ceil(seasonEpisodes.length / playerEpisodeRangeSize);
  const clampedRange = Math.min(seasonRange, Math.max(0, rangeCount - 1));
  const rangeStart = clampedRange * playerEpisodeRangeSize;
  const currentSeasonObj = orderedSeasons.find(s => s.season_number === seasonNumber);

  const hasSeriesEpisodes = Boolean((!loaded.archive && hydratedItem.type === 'tv' && orderedSeasons.length > 0) || loaded.archive?.episodes?.length);
  const watchedKey = hydratedEpisode ? loaded.progressKey : hydratedItem.key;
  const isCurrentWatched = Boolean(controls.library.watched[watchedKey]);
  const saved = controls.library.saved[hydratedItem.key];
  const currentSynopsis = hydratedEpisode ? currentEpisodeData?.overview : hydratedItem.description;
  const protectSynopsis = Boolean(hydratedEpisode && !isCurrentWatched && controls.library.preferences.hideSynopsis !== false);
  const currentMeta = hydratedEpisode
    ? [
      `S${hydratedEpisode.season} E${hydratedEpisode.number}`,
      currentEpisodeData?.runtime ? `${currentEpisodeData.runtime} min` : hydratedEpisode.duration ? `${hydratedEpisode.duration} min` : '',
      currentEpisodeData?.air_date ? formatDate(currentEpisodeData.air_date) : '',
    ].filter(Boolean).join(' · ')
    : [hydratedItem.year, hydratedItem.duration ? `${hydratedItem.duration} min` : '', hydratedItem.genre].filter(Boolean).join(' · ');

  const episodesDrawerNode = hasSeriesEpisodes && episodesOpen ? (
    <aside className="af-player-drawer" aria-label="Episodes drawer">
      <header className="af-player-drawer-head">
        <div>
          <strong>Episodes</strong>
          <p className="af-meta af-tabular">{currentSeasonObj?.name || (loaded.archive ? hydratedItem.title : `Season ${seasonNumber}`)}</p>
        </div>
        <button type="button" className="af-icon-button" aria-label="Close episodes drawer" onClick={() => setEpisodesOpen(false)}>
          <Icon name="close" />
        </button>
      </header>
      {!loaded.archive && orderedSeasons.length > 1 && (
        <div className="af-season-tabs af-drawer-tabs" role="tablist" aria-label="Drawer seasons">
          {orderedSeasons.map(s => (
            <button key={s.season_number} type="button" role="tab" aria-selected={seasonNumber === s.season_number}
              className="af-season-tab" onClick={() => { setSeasonNumber(s.season_number); setSeasonRange(0); }}>
              {s.season_number === 0 ? 'Specials' : `S${s.season_number}`}
            </button>
          ))}
        </div>
      )}
      <div className="af-drawer-list">
        {loaded.archive?.episodes ? loaded.archive.episodes.map(ep => {
          const active = loaded.episode?.key === ep.key;
          return <button key={ep.key} type="button" className={`af-drawer-ep ${active ? 'is-current' : ''}`}
            onClick={() => navigateEpisode({ key: ep.key, season: ep.season ?? 1, number: ep.number ?? 1, title: ep.title })}>
            <span className="af-drawer-ep-num af-tabular">{ep.number ?? '•'}</span>
            <span className="af-drawer-ep-copy">
              <strong>{ep.title}</strong>
              {ep.duration && <small className="af-meta af-tabular">{ep.duration} min</small>}
            </span>
            {active && <span className="af-ep-state-tag">Playing</span>}
          </button>;
        }) : seasonEpisodes.map(ep => {
          const active = loaded.episode?.season === ep.season_number && loaded.episode?.number === ep.episode_number;
          const aired = isAired(ep);
          const epKey = episodeKey(hydratedItem, ep);
          const marked = Boolean(controls.library.watched[epKey]);
          const still = imagePath(ep.still_path, 'w300');
          const blur = !marked && controls.library.preferences.blur !== false;
          return <button key={epKey} type="button" className={`af-drawer-ep ${active ? 'is-current' : ''}`} disabled={!aired}
            onClick={() => navigateEpisode(episodePosition(ep))}>
            <span className="af-drawer-ep-thumb">
              <Artwork src={still} className={blur ? 'af-blurred' : undefined} loading="lazy" fallback={<Icon name="film" />} />
              <span className="af-ep-code af-tabular">E{ep.episode_number}</span>
            </span>
            <span className="af-drawer-ep-copy">
              <strong>{ep.name}</strong>
              <small className="af-meta af-tabular">{[ep.runtime ? `${ep.runtime} min` : '', active ? 'Now playing' : marked ? 'Watched' : !aired ? 'Upcoming' : ''].filter(Boolean).join(' · ')}</small>
            </span>
          </button>;
        })}
      </div>
    </aside>
  ) : null;

  return <div className={`af-wrap af-player-page ${theatreMode ? 'is-theatre' : ''}`}>
    <h1 className="sr-only" tabIndex={-1}>{watchTitle}</h1>

    <div className="af-player-topbar">
      <div className="af-player-topbar-left">
        <a className="af-player-topbar-back" href={detailsHref}>
          <Icon name="left" />
          <span>{hydratedItem.title}</span>
        </a>
        {hydratedEpisode && <>
          <span className="af-player-topbar-sep" aria-hidden="true">/</span>
          <span className="af-player-topbar-code af-tabular">{episodeLabel({ season_number: hydratedEpisode.season, episode_number: hydratedEpisode.number, name: '' })}</span>
          <span className="af-player-topbar-ep">{hydratedEpisode.title}</span>
        </>}
      </div>
      <div className="af-player-topbar-actions">
        {hasSeriesEpisodes && (
          <button type="button" className="af-button af-secondary af-topbar-btn" aria-pressed={episodesOpen} onClick={() => setEpisodesOpen(v => !v)}>
            <PlayerGlyph name="episodes" />
            <span>Episodes</span>
            <kbd className="af-kbd af-topbar-kbd">E</kbd>
          </button>
        )}
        {adjacent.previous && (
          <button type="button" className="af-button af-secondary af-topbar-btn" aria-label="Previous episode" onClick={() => navigateEpisode(adjacent.previous!)}>
            <PlayerGlyph name="prev" />
            <span className="af-topbar-btn-label">Prev</span>
          </button>
        )}
        {adjacent.next && (
          <button type="button" className="af-button af-secondary af-topbar-btn" aria-label="Next episode" onClick={() => navigateEpisode(adjacent.next!)}>
            <span className="af-topbar-btn-label">Next</span>
            <PlayerGlyph name="next" />
          </button>
        )}
        <button type="button" className="af-button af-secondary af-topbar-btn af-topbar-theatre" aria-pressed={theatreMode} onClick={() => setTheatreMode(v => !v)}>
          <PlayerGlyph name="theatre" />
          <span>{theatreMode ? 'Default' : 'Theatre'}</span>
          <kbd className="af-kbd af-topbar-kbd">T</kbd>
        </button>
      </div>
    </div>

    <div className="af-watch-stage" ref={stageRef}>
      <VideoStage
        key={loaded.progressKey}
        stageRef={stageRef}
        media={loaded}
        displayItem={hydratedItem}
        displayEpisode={hydratedEpisode}
        backHref={detailsHref}
        adjacent={adjacent}
        nextStillPath={nextEpisodeStill}
        controls={controls}
        initialProvider={activeProvider}
        onProviderChange={setActiveProvider}
        providerControls={providerControls}
        onProviderControlsChange={setProviderControls}
        preferredQuality={preferredQuality}
        onPreferredQualityChange={setPreferredQuality}
        onNavigateEpisode={navigateEpisode}
        theatreMode={theatreMode}
        onToggleTheatre={() => setTheatreMode(v => !v)}
        hasEpisodesDrawer={hasSeriesEpisodes}
        episodesOpen={episodesOpen}
        onToggleEpisodes={() => setEpisodesOpen(v => !v)}
        episodesDrawer={episodesDrawerNode}
      />
    </div>

    <div className="af-watch-body">
      <section className="af-now-playing-card" aria-label="Now playing details">
        <div className="af-now-playing-copy">
          <div className="af-now-playing-head">
            <h2>{watchTitle}</h2>
            {currentMeta && <p className="af-meta af-tabular">{currentMeta}</p>}
          </div>
          {currentSynopsis && (
            protectSynopsis && !synopsisExpanded ? (
              <button type="button" className="af-text-link af-synopsis-reveal" onClick={() => setSynopsisExpanded(true)}>
                Show episode description
              </button>
            ) : (
              <p className="af-overview af-now-playing-synopsis">{currentSynopsis}</p>
            )
          )}
        </div>
        <div className="af-now-playing-actions">
          <button type="button" className="af-button af-secondary" aria-pressed={isCurrentWatched}
            disabled={!controls.ready || controls.isPending(watchedKey)}
            onClick={() => void controls.toggleWatched(hydratedItem, hydratedEpisode ? watchedKey : undefined)}>
            {isCurrentWatched ? <><Icon name="check" />Watched</> : 'Mark watched'}
          </button>
          <SaveButton item={hydratedItem} controls={controls} />
          {saved && details && <AfSelect
            ariaLabel="Watch status"
            value={effectiveWatchStatus(saved, controls.library)}
            disabled={!controls.ready || controls.isPending(hydratedItem.key)}
            options={watchStatusOptions}
            onChange={value => void controls.setStatus(hydratedItem, value as WatchStatus, details)}
          />}
          <FolderPickerPopover itemKey={hydratedItem.key} itemTitle={hydratedItem.title} controls={controls} />
          <div className="af-rating af-rating-inline">
            <span>Your rating</span>
            <AfSelect
              ariaLabel="Your rating"
              value={String(savedRating(controls.library.ratings[hydratedItem.key]))}
              disabled={!controls.ready || controls.isPending(hydratedItem.key)}
              options={playerRatingOptions}
              onChange={value => void controls.rate(hydratedItem, Number(value))}
            />
          </div>
        </div>
      </section>

      {loaded.archive?.episodes && <section className="af-section" aria-label="Episodes">
        <header className="af-section-head"><h2>Episodes</h2></header>
        <div className={`af-episode-grid ${controls.library.preferences.compact ? 'af-compact' : ''}`}>
          {loaded.archive.episodes.map(ep => {
            const epKey = `${loaded.item.key}/${ep.key}`;
            const current = loaded.episode?.key === ep.key;
            const marked = Boolean(controls.library.watched[epKey]);
            const epProgress = !marked ? controls.library.progress[epKey] : undefined;
            return <article className={`af-episode af-episode-archive ${current ? 'is-current' : ''}`} key={ep.key} aria-current={current ? 'true' : undefined}>
              <div className="af-episode-copy">
                <div className="af-episode-meta-row">
                  {current && <span className="af-ep-state-tag">Now playing</span>}
                  {ep.duration && <span className="af-meta af-tabular">{ep.duration} min</span>}
                </div>
                <a className="af-episode-title" href={playerHref(`edition/${encodeURIComponent(loaded.item.key)}/watch/${encodeURIComponent(ep.key)}`, originBack)}>
                  {ep.title}
                </a>
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

      {!loaded.archive && hydratedItem.type === 'tv' && orderedSeasons.length > 0 && <section className="af-section" aria-label="Episodes">
        <header className="af-section-head">
          <div>
            <h2>Episodes</h2>
            {airedInSeason.length > 0 && <p className="af-meta af-tabular">{currentSeasonObj?.name ? `${currentSeasonObj.name} · ` : ''}{watchedInSeason} of {airedInSeason.length} watched</p>}
          </div>
          {rangeCount > 1 && <div className="af-episode-pickers">
            <AfSelect
              ariaLabel="Episode range"
              value={String(clampedRange)}
              options={Array.from({ length: rangeCount }, (_, index) => {
                const first = seasonEpisodes[index * playerEpisodeRangeSize].episode_number;
                const last = seasonEpisodes[Math.min(seasonEpisodes.length, (index + 1) * playerEpisodeRangeSize) - 1].episode_number;
                return { value: String(index), label: `Episodes ${first}${first === last ? '' : `–${last}`}` };
              })}
              onChange={value => setSeasonRange(Number(value))}
            />
          </div>}
        </header>
        {orderedSeasons.length > 1 && <div className="af-season-tabs" role="tablist" aria-label="Seasons">
          {orderedSeasons.map(season => (
            <button
              key={season.season_number}
              type="button"
              role="tab"
              aria-selected={seasonNumber === season.season_number}
              className="af-season-tab"
              onClick={() => { setSeasonNumber(season.season_number); setSeasonRange(0); }}
            >
              {season.name}
            </button>
          ))}
        </div>}
        {seasonError
          ? <p className="af-state" role="alert">{seasonError} <button type="button" className="af-text-link" onClick={() => setSeasonAttempt(v => v + 1)}>Retry</button></p>
          : <div className={`af-episode-grid ${controls.library.preferences.compact ? 'af-compact' : ''}`}>
            {seasonEpisodes.slice(rangeStart, rangeStart + playerEpisodeRangeSize).map(ep => (
              <PlayerEpisodeRow
                key={episodeKey(hydratedItem, ep)}
                item={hydratedItem}
                episode={ep}
                current={loaded.episode?.season === ep.season_number && loaded.episode?.number === ep.episode_number}
                backHref={originBack}
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
