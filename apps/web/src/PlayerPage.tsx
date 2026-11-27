import { Dialog } from '@base-ui/react/dialog';
import { archiveCatalog, type ArchiveEpisode, type ArchiveTitle } from '@afterframe/shared/catalog';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import {
  episodeKey, episodeLabel, episodePosition, formatDate, imagePath, isAired, navigate, normalizeTitle,
  playerHref, previousBrowse, request, timeCode, titleHref, webHref,
  type Details, type Episode, type EpisodePosition, type Season, type Title,
} from './catalog';
import { ActionLink, Artwork, Icon, Loading, SaveButton } from './components';
import { effectiveWatchStatus, getSeason, progressPercent, resumeFor, savedRating, watchStatuses, type LibraryControls, type WatchStatus } from './library';
import { FolderPickerPopover } from './library/FolderPickerPopover';
import { ArchiveEditionView } from './player/ArchiveEditionView';
import { PlayerEpisodeRow } from './player/PlayerEpisodeRow';
import { PlayerGlyph } from './player/PlayerGlyph';
import { archiveMap, archiveToTitle } from './player/route';
import { animePlayers, cineSrcOrigin, type ActiveMedia, type AnimeProvider, type PlayerRoute } from './player/types';
import { VideoStage } from './player/VideoStage';
import { AfSelect, useMediaQuery } from './UiControls';
import './player.css';

const playerEpisodeRangeSize = 24;
const playerRatingOptions = [
  { value: '0', label: 'Choose 1–10' },
  ...Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1), label: `${index + 1} / 10` })),
];
const watchStatusOptions = Object.entries(watchStatuses).map(([value, label]) => ({ value, label }));

function orderSeasons(seasons: readonly Season[] | undefined): Season[] {
  const valid = (seasons ?? []).filter(entry => entry.episode_count > 0 && entry.season_number >= 0);
  const regular = valid.filter(entry => entry.season_number > 0).sort((a, b) => a.season_number - b.season_number);
  const specials = valid.filter(entry => entry.season_number === 0);
  return [...regular, ...specials];
}

function isPlayerUrl(href: string): boolean {
  return /^\/(?:movie\/\d+\/watch|tv\/\d+\/s\d+e\d+|edition\/[^/]+\/watch)(?:$|\?)/.test(href);
}

function buildCatalogProgressKey(itemKey: string, episode?: { season: number; number: number }): string {
  const suffix = episode ? `-s${episode.season}e${episode.number}` : '';
  return `${itemKey}/cinesrc${suffix}`;
}

function formatWatchDocTitle(title: string, episode?: { season: number; number: number }): string {
  const label = episode ? `${title} · S${episode.season} E${episode.number}` : title;
  return `${label} · Afterframe`;
}

function formatCurrentMeta(
  hydratedItem: Title,
  hydratedEpisode: (EpisodePosition & { key?: string; duration?: number }) | undefined,
  currentEpisodeData: Episode | null,
): string {
  if (!hydratedEpisode) {
    return [hydratedItem.year, hydratedItem.duration ? `${hydratedItem.duration} min` : '', hydratedItem.genre].filter(Boolean).join(' · ');
  }
  const runtimeMinutes = currentEpisodeData?.runtime ?? hydratedEpisode.duration;
  const runtimeText = runtimeMinutes ? `${runtimeMinutes} min` : '';
  const airDateText = currentEpisodeData?.air_date ? formatDate(currentEpisodeData.air_date) : '';
  return [`S${hydratedEpisode.season} E${hydratedEpisode.number}`, runtimeText, airDateText].filter(Boolean).join(' · ');
}

function nextSeasonTabIndex(key: string, currentIdx: number, count: number): number {
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const delta = key === 'ArrowRight' ? 1 : -1;
  return (currentIdx + delta + count) % count;
}

function drawerEpisodeStateLabel(active: boolean, marked: boolean, aired: boolean): string {
  if (active) return 'Now playing';
  if (marked) return 'Watched';
  return aired ? '' : 'Upcoming';
}

function buildEpisodeRangeOptions(seasonEpisodes: Episode[], rangeCount: number) {
  return Array.from({ length: rangeCount }, (_, index) => {
    const first = seasonEpisodes[index * playerEpisodeRangeSize].episode_number;
    const last = seasonEpisodes[Math.min(seasonEpisodes.length, (index + 1) * playerEpisodeRangeSize) - 1].episode_number;
    const suffix = first === last ? '' : `–${last}`;
    return { value: String(index), label: `Episodes ${first}${suffix}` };
  });
}

async function findCrossSeasonEdge(
  showId: number,
  regularSeasons: Season[],
  cursor: number,
  step: number,
  edge: number,
  readSeason: (id: number, season: number) => Promise<Episode[]>,
): Promise<Episode | undefined> {
  const season = regularSeasons[cursor];
  if (!season) return undefined;
  const eps = (await readSeason(showId, season.season_number)).filter(isAired);
  const candidate = eps.at(edge);
  if (candidate) return candidate;
  return findCrossSeasonEdge(showId, regularSeasons, cursor + step, step, edge, readSeason);
}

interface AdjacentResult {
  previous?: EpisodePosition & { key?: string };
  next?: EpisodePosition & { key?: string };
  nextStill?: string;
}

async function resolveCrossSeasonEdges(
  showId: number,
  loadedEpisodeSeason: number,
  seasons: readonly Season[] | undefined,
  prev: (EpisodePosition & { key?: string }) | undefined,
  next: (EpisodePosition & { key?: string }) | undefined,
  readSeason: (id: number, season: number) => Promise<Episode[]>,
): Promise<AdjacentResult> {
  if (loadedEpisodeSeason <= 0 || (prev && next) || !seasons?.length) {
    return { previous: prev, next };
  }
  const regularSeasons = seasons
    .filter(s => s.season_number > 0 && s.episode_count > 0)
    .sort((a, b) => a.season_number - b.season_number);
  const seasonIdx = regularSeasons.findIndex(s => s.season_number === loadedEpisodeSeason);
  if (seasonIdx < 0) return { previous: prev, next };

  const [crossPrevEp, crossNextEp] = await Promise.all([
    prev ? Promise.resolve(undefined) : findCrossSeasonEdge(showId, regularSeasons, seasonIdx - 1, -1, -1, readSeason).catch(() => undefined),
    next ? Promise.resolve(undefined) : findCrossSeasonEdge(showId, regularSeasons, seasonIdx + 1, 1, 0, readSeason).catch(() => undefined),
  ]);

  return {
    previous: prev ?? (crossPrevEp ? episodePosition(crossPrevEp) : undefined),
    next: next ?? (crossNextEp ? episodePosition(crossNextEp) : undefined),
    nextStill: !next && crossNextEp?.still_path ? crossNextEp.still_path : undefined,
  };
}

function resolveArchiveAdjacent(episodes: ArchiveEpisode[], loadedEpisodeKey: string | undefined) {
  const idx = episodes.findIndex(ep => ep.key === loadedEpisodeKey);
  const toPos = (ep?: ArchiveEpisode) => ep ? { key: ep.key, season: ep.season ?? 1, number: ep.number ?? 1, title: ep.title } : undefined;
  return {
    previous: idx > 0 ? toPos(episodes[idx - 1]) : undefined,
    next: idx >= 0 && idx + 1 < episodes.length ? toPos(episodes[idx + 1]) : undefined,
    ready: true,
  };
}

async function resolveEditionEntry(
  routeEditionKey: string,
  routeWatch: boolean,
  routeEditionEp: string | undefined,
  lib: LibraryControls['library'],
  signal: AbortSignal,
): Promise<{ loaded: ActiveMedia | null; editionDetails: ArchiveTitle | null; title: string } | null> {
  let entry = archiveMap.get(routeEditionKey);
  if (!entry && routeEditionKey.startsWith('archive-')) {
    entry = await request<ArchiveTitle>(`/api/archive/${encodeURIComponent(routeEditionKey.slice('archive-'.length))}`, { signal });
  }
  if (signal.aborted) return null;
  if (!entry) throw new Error('This edition could not be found.');
  const item = archiveToTitle(entry);
  if (!routeWatch) {
    return { loaded: null, editionDetails: entry, title: `${entry.title} · Afterframe` };
  }
  const resumed = lib.preferences.resume !== false ? resumeFor(lib, item) : undefined;
  const resumedKey = resumed ? Object.keys(lib.progress).find(k => lib.progress[k] === resumed)?.split('/')[1] : undefined;
  const archiveEp: ArchiveEpisode | undefined = entry.episodes
    ? entry.episodes.find(ep => ep.key === (routeEditionEp || resumedKey)) ?? entry.episodes[0]
    : undefined;
  const nativeMedia = archiveEp?.media ?? entry.media ?? undefined;
  if (!nativeMedia) throw new Error('A playable stream is unavailable for this edition.');
  const episode = archiveEp
    ? { key: archiveEp.key, season: archiveEp.season ?? 1, number: archiveEp.number ?? 1, title: archiveEp.title, duration: archiveEp.duration }
    : undefined;
  const progressKey = archiveEp ? `${entry.key}/${archiveEp.key}` : entry.key;
  return {
    loaded: { item, archive: entry, episode, nativeMedia, embed: false, progressKey },
    editionDetails: null,
    title: `${archiveEp?.title || entry.title} · Afterframe`,
  };
}

function PlayerErrorView({
  route,
  error,
  originBack,
  onRetry,
}: Readonly<{
  route: PlayerRoute;
  error: string;
  originBack: string;
  onRetry: () => void;
}>) {
  const alternate = route.kind === 'catalog' && route.type === 'movie'
    ? archiveCatalog.find(entry => entry.type === 'movie' && entry.id === route.id && entry.media)
    : undefined;
  return <section className="af-wrap af-directory">
    <h1 tabIndex={-1}>Title unavailable</h1>
    <p className="af-state" role="alert">{error}</p>
    <div className="af-actions">
      <button type="button" className="af-button af-secondary" onClick={onRetry}>Retry</button>
      <ActionLink href={originBack}>Back</ActionLink>
      {alternate && <ActionLink primary href={playerHref(`edition/${encodeURIComponent(alternate.key)}/watch`, originBack)}>Play licensed Archive edition</ActionLink>}
    </div>
  </section>;
}

function PlayerTopbar({
  hydratedItem,
  hydratedEpisode,
  detailsHref,
  hasSeriesEpisodes,
  episodesOpen,
  adjacent,
  theatreMode,
  onToggleEpisodes,
  onNavigateEpisode,
  onToggleTheatre,
}: Readonly<{
  hydratedItem: Title;
  hydratedEpisode?: EpisodePosition & { key?: string; duration?: number };
  detailsHref: string;
  hasSeriesEpisodes: boolean;
  episodesOpen: boolean;
  adjacent: { previous?: EpisodePosition & { key?: string }; next?: EpisodePosition & { key?: string }; ready: boolean };
  theatreMode: boolean;
  onToggleEpisodes: () => void;
  onNavigateEpisode: (target: EpisodePosition & { key?: string }) => void;
  onToggleTheatre: () => void;
}>) {
  return <div className="af-player-topbar">
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
        <button type="button" className="af-button af-secondary af-topbar-btn" aria-pressed={episodesOpen} onClick={onToggleEpisodes}>
          <PlayerGlyph name="episodes" />
          <span>Episodes</span>
          <kbd className="af-kbd af-topbar-kbd">E</kbd>
        </button>
      )}
      {adjacent.previous && (
        <button type="button" className="af-button af-secondary af-topbar-btn" aria-label="Previous episode" onClick={() => onNavigateEpisode(adjacent.previous!)}>
          <PlayerGlyph name="prev" />
          <span className="af-topbar-btn-label">Prev</span>
        </button>
      )}
      {adjacent.next && (
        <button type="button" className="af-button af-secondary af-topbar-btn" aria-label="Next episode" onClick={() => onNavigateEpisode(adjacent.next!)}>
          <span className="af-topbar-btn-label">Next</span>
          <PlayerGlyph name="next" />
        </button>
      )}
      <button type="button" className="af-button af-secondary af-topbar-btn af-topbar-theatre" aria-pressed={theatreMode} onClick={onToggleTheatre}>
        <PlayerGlyph name="theatre" />
        <span>{theatreMode ? 'Default' : 'Theatre'}</span>
        <kbd className="af-kbd af-topbar-kbd">T</kbd>
      </button>
    </div>
  </div>;
}

interface ExtractedRoute {
  kind: PlayerRoute['kind'];
  catalogType?: 'movie' | 'tv';
  catalogId?: number;
  season?: number;
  episode?: number;
  editionKey?: string;
  watch: boolean;
  editionEp?: string;
}

function extractRoute(route: PlayerRoute): ExtractedRoute {
  if (route.kind === 'catalog') {
    return {
      kind: 'catalog',
      catalogType: route.type,
      catalogId: route.id,
      season: route.season,
      episode: route.episode,
      watch: true,
    };
  }
  return {
    kind: 'edition',
    editionKey: route.key,
    watch: route.watch,
    editionEp: route.episodeKey,
  };
}

function computeHistoryDurations(history: LibraryControls['library']['history']): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of Object.values(history)) {
    if (entry.duration > 0 && !map.has(entry.mediaKey)) map.set(entry.mediaKey, entry.duration);
  }
  return map;
}

function hydrateMediaItem(loaded: ActiveMedia, details: Details | undefined): Title {
  if (!details || !loaded.embed) return loaded.item;
  return { ...loaded.item, ...normalizeTitle(details, loaded.item.type), totalEpisodes: details.number_of_episodes };
}

function resolveArchiveSourcePage(nativeMedia: ActiveMedia['nativeMedia']): string {
  if (!nativeMedia) return '';
  if (nativeMedia.page) return nativeMedia.page;
  return nativeMedia.archive ? `https://archive.org/details/${encodeURIComponent(nativeMedia.archive)}` : '';
}

function computeHasSeriesEpisodes(loaded: ActiveMedia, hydratedItem: Title, orderedSeasons: Season[]): boolean {
  if (loaded.archive?.episodes?.length) return true;
  return !loaded.archive && hydratedItem.type === 'tv' && orderedSeasons.length > 0;
}

function computeDrawerSubtitle(currentSeason: Season | undefined, loaded: ActiveMedia, title: string, seasonNumber: number): string {
  if (currentSeason?.name) return currentSeason.name;
  return loaded.archive ? title : `Season ${seasonNumber}`;
}

function DrawerArchiveEpisodeButton({
  ep,
  active,
  onNavigateEpisode,
}: Readonly<{
  ep: ArchiveEpisode;
  active: boolean;
  onNavigateEpisode: (target: EpisodePosition & { key?: string }) => void;
}>) {
  return (
    <button type="button" className={`af-drawer-ep ${active ? 'is-current' : ''}`}
      onClick={() => onNavigateEpisode({ key: ep.key, season: ep.season ?? 1, number: ep.number ?? 1, title: ep.title })}>
      <span className="af-drawer-ep-num af-tabular">{ep.number ?? '•'}</span>
      <span className="af-drawer-ep-copy">
        <strong>{ep.title}</strong>
        {ep.duration && <small className="af-meta af-tabular">{ep.duration} min</small>}
      </span>
      {active && <span className="af-ep-state-tag">Playing</span>}
    </button>
  );
}

function DrawerCatalogEpisodeButton({
  ep,
  hydratedItem,
  loadedEpisode,
  controls,
  onNavigateEpisode,
}: Readonly<{
  ep: Episode;
  hydratedItem: Title;
  loadedEpisode?: EpisodePosition & { key?: string };
  controls: LibraryControls;
  onNavigateEpisode: (target: EpisodePosition & { key?: string }) => void;
}>) {
  const active = loadedEpisode?.season === ep.season_number && loadedEpisode?.number === ep.episode_number;
  const aired = isAired(ep);
  const epKey = episodeKey(hydratedItem, ep);
  const marked = Boolean(controls.library.watched[epKey]);
  const still = imagePath(ep.still_path, 'w300');
  const blur = !marked && controls.library.preferences.blur !== false;
  const stateLabel = drawerEpisodeStateLabel(active, marked, aired);
  const metaText = [ep.runtime ? `${ep.runtime} min` : '', stateLabel].filter(Boolean).join(' · ');

  return (
    <button type="button" className={`af-drawer-ep ${active ? 'is-current' : ''}`} disabled={!aired}
      onClick={() => onNavigateEpisode(episodePosition(ep))}>
      <span className="af-drawer-ep-thumb">
        <Artwork src={still} className={blur ? 'af-blurred' : undefined} loading="lazy" fallback={<Icon name="film" />} />
        <span className="af-ep-code af-tabular">E{ep.episode_number}</span>
      </span>
      <span className="af-drawer-ep-copy">
        <strong>{ep.name}</strong>
        <small className="af-meta af-tabular">{metaText}</small>
      </span>
    </button>
  );
}

function PlayerDrawerEpisodes({
  loaded,
  hydratedItem,
  orderedSeasons,
  seasonNumber,
  seasonEpisodes,
  controls,
  onSelectSeason,
  onSeasonTabKey,
  onNavigateEpisode,
}: Readonly<{
  loaded: ActiveMedia;
  hydratedItem: Title;
  orderedSeasons: Season[];
  seasonNumber: number;
  seasonEpisodes: Episode[];
  controls: LibraryControls;
  onSelectSeason: (season: number) => void;
  onSeasonTabKey: (event: ReactKeyboardEvent<HTMLDivElement>, prefix: string) => void;
  onNavigateEpisode: (target: EpisodePosition & { key?: string }) => void;
}>) {
  const showSeasonTabs = !loaded.archive && orderedSeasons.length > 1;
  return <>
    {showSeasonTabs && (
      <div className="af-season-tabs af-drawer-tabs" role="tablist" tabIndex={0} aria-label="Drawer seasons" onKeyDown={event => onSeasonTabKey(event, 'af-drawer-season')}>
        {orderedSeasons.map(s => (
          <button key={s.season_number} id={`af-drawer-season-${s.season_number}`} type="button" role="tab" aria-selected={seasonNumber === s.season_number}
            tabIndex={seasonNumber === s.season_number ? 0 : -1}
            className="af-season-tab" onClick={() => onSelectSeason(s.season_number)}>
            {s.season_number === 0 ? 'Specials' : `S${s.season_number}`}
          </button>
        ))}
      </div>
    )}
    <div className="af-drawer-list">
      {loaded.archive?.episodes
        ? loaded.archive.episodes.map(ep => (
          <DrawerArchiveEpisodeButton
            key={ep.key}
            ep={ep}
            active={loaded.episode?.key === ep.key}
            onNavigateEpisode={onNavigateEpisode}
          />
        ))
        : seasonEpisodes.map(ep => (
          <DrawerCatalogEpisodeButton
            key={episodeKey(hydratedItem, ep)}
            ep={ep}
            hydratedItem={hydratedItem}
            loadedEpisode={loaded.episode}
            controls={controls}
            onNavigateEpisode={onNavigateEpisode}
          />
        ))}
    </div>
  </>;
}

function PlayerNowPlayingCard({
  watchTitle,
  currentMeta,
  currentSynopsis,
  protectSynopsis,
  synopsisExpanded,
  hydratedItem,
  hydratedEpisode,
  watchedKey,
  isCurrentWatched,
  details,
  controls,
  onExpandSynopsis,
}: Readonly<{
  watchTitle: string;
  currentMeta: string;
  currentSynopsis?: string;
  protectSynopsis: boolean;
  synopsisExpanded: boolean;
  hydratedItem: Title;
  hydratedEpisode?: EpisodePosition & { key?: string; duration?: number };
  watchedKey: string;
  isCurrentWatched: boolean;
  details?: Details;
  controls: LibraryControls;
  onExpandSynopsis: () => void;
}>) {
  const saved = controls.library.saved[hydratedItem.key];
  const hideSynopsis = protectSynopsis && !synopsisExpanded;

  return <section className="af-now-playing-card" aria-label="Now playing details">
    <div className="af-now-playing-copy">
      <div className="af-now-playing-head">
        <h2>{watchTitle}</h2>
        {currentMeta && <p className="af-meta af-tabular">{currentMeta}</p>}
      </div>
      {currentSynopsis && (
        hideSynopsis ? (
          <button type="button" className="af-text-link af-synopsis-reveal" onClick={onExpandSynopsis}>
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
  </section>;
}

function ArchiveEpisodeCard({
  ep,
  itemKey,
  current,
  hydratedItem,
  originBack,
  resumeLabel,
  controls,
}: Readonly<{
  ep: ArchiveEpisode;
  itemKey: string;
  current: boolean;
  hydratedItem: Title;
  originBack: string;
  resumeLabel: string;
  controls: LibraryControls;
}>) {
  const epKey = `${itemKey}/${ep.key}`;
  const marked = Boolean(controls.library.watched[epKey]);
  const epProgress = marked ? undefined : controls.library.progress[epKey];
  const activeProgress = epProgress && epProgress.time > 5 && epProgress.time < epProgress.duration ? epProgress : undefined;
  const watchActionLabel = marked ? 'Watched' : 'Mark watched';

  return <article className={`af-episode af-episode-archive ${current ? 'is-current' : ''}`} aria-current={current ? 'true' : undefined}>
    <div className="af-episode-copy">
      <div className="af-episode-meta-row">
        {current && <span className="af-ep-state-tag">Now playing</span>}
        {ep.duration && <span className="af-meta af-tabular">{ep.duration} min</span>}
      </div>
      <a className="af-episode-title" href={playerHref(`edition/${encodeURIComponent(itemKey)}/watch/${encodeURIComponent(ep.key)}`, originBack)}>
        {ep.title}
      </a>
      {activeProgress && <div className="af-episode-progress">
        <span>{resumeLabel} {timeCode(activeProgress.time)}</span>
        <progress className="af-progress" value={progressPercent(activeProgress)} max={100} aria-label={`${ep.title} watched progress`} />
      </div>}
    </div>
    <button type="button" className="af-icon-button af-watched" aria-pressed={marked}
      aria-label={`${watchActionLabel}: ${ep.title}`}
      disabled={!controls.ready || controls.isPending(epKey)}
      onClick={() => void controls.toggleWatched(hydratedItem, epKey)}>
      <span>{marked && <Icon name="check" />}</span><small>{watchActionLabel}</small>
    </button>
  </article>;
}

function ArchiveEpisodesSection({
  loaded,
  hydratedItem,
  originBack,
  controls,
}: Readonly<{
  loaded: ActiveMedia;
  hydratedItem: Title;
  originBack: string;
  controls: LibraryControls;
}>) {
  const episodes = loaded.archive?.episodes;
  if (!episodes) return null;
  const resumeLabel = controls.library.preferences.resume !== false ? 'Resume at' : 'Last position';

  return <section className="af-section" aria-label="Episodes">
    <header className="af-section-head"><h2>Episodes</h2></header>
    <div className={`af-episode-grid ${controls.library.preferences.compact ? 'af-compact' : ''}`}>
      {episodes.map(ep => (
        <ArchiveEpisodeCard
          key={ep.key}
          ep={ep}
          itemKey={loaded.item.key}
          current={loaded.episode?.key === ep.key}
          hydratedItem={hydratedItem}
          originBack={originBack}
          resumeLabel={resumeLabel}
          controls={controls}
        />
      ))}
    </div>
  </section>;
}

function WatchSourceFooter({
  loaded,
  sourcePage,
  activeProvider,
}: Readonly<{
  loaded: ActiveMedia;
  sourcePage: string;
  activeProvider: AnimeProvider | null;
}>) {
  return <>
    {sourcePage && loaded.archive && <div className="af-watch-source">
      {loaded.archive.credit && <span>{loaded.archive.credit}</span>}
      <a href={sourcePage} target="_blank" rel="noopener noreferrer">{loaded.nativeMedia?.source || 'Internet Archive'}<span className="sr-only"> (opens in new tab)</span></a>
      {loaded.archive.license && <a href={loaded.archive.license[1]} target="_blank" rel="noopener noreferrer">{loaded.archive.license[0]}<span className="sr-only"> (opens in new tab)</span></a>}
    </div>}
    {loaded.embed && <div className="af-watch-source">
      <span>Playback by {animePlayers[activeProvider ?? 'cinesrc'].label}</span>
    </div>}
  </>;
}

function CatalogEpisodesSection({
  loaded,
  hydratedItem,
  orderedSeasons,
  seasonNumber,
  seasonEpisodes,
  seasonRange,
  seasonError,
  originBack,
  controls,
  historyDurations,
  onSelectSeason,
  onSelectRange,
  onSeasonTabKey,
  onRetrySeason,
}: Readonly<{
  loaded: ActiveMedia;
  hydratedItem: Title;
  orderedSeasons: Season[];
  seasonNumber: number;
  seasonEpisodes: Episode[];
  seasonRange: number;
  seasonError: string;
  originBack: string;
  controls: LibraryControls;
  historyDurations: Map<string, number>;
  onSelectSeason: (season: number) => void;
  onSelectRange: (range: number) => void;
  onSeasonTabKey: (event: ReactKeyboardEvent<HTMLDivElement>, prefix: string) => void;
  onRetrySeason: () => void;
}>) {
  if (loaded.archive || hydratedItem.type !== 'tv' || orderedSeasons.length === 0) return null;

  const airedInSeason = seasonEpisodes.filter(isAired);
  const watchedInSeason = airedInSeason.filter(ep => controls.library.watched[episodeKey(hydratedItem, ep)]).length;
  const rangeCount = Math.ceil(seasonEpisodes.length / playerEpisodeRangeSize);
  const clampedRange = Math.min(seasonRange, Math.max(0, rangeCount - 1));
  const rangeStart = clampedRange * playerEpisodeRangeSize;
  const currentSeasonObj = orderedSeasons.find(s => s.season_number === seasonNumber);
  const seasonNamePrefix = currentSeasonObj?.name ? `${currentSeasonObj.name} · ` : '';

  return <section className="af-section" aria-label="Episodes">
    <header className="af-section-head">
      <div>
        <h2>Episodes</h2>
        {airedInSeason.length > 0 && <p className="af-meta af-tabular">{seasonNamePrefix}{watchedInSeason} of {airedInSeason.length} watched</p>}
      </div>
      {rangeCount > 1 && <div className="af-episode-pickers">
        <AfSelect
          ariaLabel="Episode range"
          value={String(clampedRange)}
          options={buildEpisodeRangeOptions(seasonEpisodes, rangeCount)}
          onChange={value => onSelectRange(Number(value))}
        />
      </div>}
    </header>
    {orderedSeasons.length > 1 && <div className="af-season-tabs" role="tablist" tabIndex={0} aria-label="Seasons" onKeyDown={event => onSeasonTabKey(event, 'af-player-season')}>
      {orderedSeasons.map(season => (
        <button
          key={season.season_number}
          id={`af-player-season-${season.season_number}`}
          type="button"
          role="tab"
          aria-selected={seasonNumber === season.season_number}
          tabIndex={seasonNumber === season.season_number ? 0 : -1}
          className="af-season-tab"
          onClick={() => onSelectSeason(season.season_number)}
        >
          {season.name}
        </button>
      ))}
    </div>}
    {seasonError
      ? <p className="af-state" role="alert">{seasonError} <button type="button" className="af-text-link" onClick={onRetrySeason}>Retry</button></p>
      : <div className={`af-episode-grid ${controls.library.preferences.compact ? 'af-compact' : ''}`}>
        {seasonEpisodes.slice(rangeStart, rangeStart + playerEpisodeRangeSize).map(ep => {
          const epKey = episodeKey(hydratedItem, ep);
          return <PlayerEpisodeRow
            key={epKey}
            item={hydratedItem}
            episode={ep}
            current={loaded.episode?.season === ep.season_number && loaded.episode?.number === ep.episode_number}
            backHref={originBack}
            controls={controls}
            historyDurationSec={historyDurations.get(epKey)}
          />;
        })}
      </div>}
  </section>;
}

export { parsePlayerRoute, playerTitleKey } from './player/route';
export type { PlayerRoute } from './player/types';

function useDrawerAccessibility(
  episodesOpen: boolean,
  drawerCloseRef: RefObject<HTMLButtonElement | null>,
  drawerReturnFocusRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const prevDrawerOpenRef = useRef(false);

  useEffect(() => {
    if (episodesOpen && !prevDrawerOpenRef.current) {
      requestAnimationFrame(() => drawerCloseRef.current?.focus({ preventScroll: true }));
    } else if (!episodesOpen && prevDrawerOpenRef.current) {
      const target = drawerReturnFocusRef.current;
      if (target?.isConnected) target.focus({ preventScroll: true });
      drawerReturnFocusRef.current = null;
    }
    prevDrawerOpenRef.current = episodesOpen;
  }, [episodesOpen, drawerCloseRef, drawerReturnFocusRef]);

  useEffect(() => {
    if (!episodesOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [episodesOpen, onClose]);
}

function usePlayerPreconnect(routeKind: PlayerRoute['kind']) {
  useEffect(() => {
    if (routeKind !== 'catalog' || document.querySelector('link[data-video-preconnect]')) return;
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = cineSrcOrigin;
    link.dataset.videoPreconnect = '';
    document.head.append(link);
  }, [routeKind]);
}

function isSameCatalogEpisodeLoaded(loaded: ActiveMedia | null, extracted: ExtractedRoute): boolean {
  if (extracted.kind !== 'catalog' || !loaded?.embed) return false;
  return loaded.item.key === `${extracted.catalogType}-${extracted.catalogId}`
    && loaded.episode?.season === extracted.season
    && loaded.episode?.number === extracted.episode;
}

function derivePlayerViewState(
  loaded: ActiveMedia,
  details: Details | undefined,
  episodeTitle: string,
  currentEpisodeData: Episode | null,
  seasonNumber: number,
  controls: LibraryControls,
) {
  const hydratedItem = hydrateMediaItem(loaded, details);
  const hydratedEpisode = loaded.episode
    ? { ...loaded.episode, title: episodeTitle || loaded.episode.title }
    : undefined;
  const orderedSeasons = orderSeasons(details?.seasons);
  const watchTitle = hydratedEpisode?.title || hydratedItem.title;
  const sourcePage = resolveArchiveSourcePage(loaded.nativeMedia);
  const currentSeasonObj = orderedSeasons.find(s => s.season_number === seasonNumber);
  const drawerSubtitle = computeDrawerSubtitle(currentSeasonObj, loaded, hydratedItem.title, seasonNumber);
  const hasSeriesEpisodes = computeHasSeriesEpisodes(loaded, hydratedItem, orderedSeasons);
  const watchedKey = hydratedEpisode ? loaded.progressKey : hydratedItem.key;
  const isCurrentWatched = Boolean(controls.library.watched[watchedKey]);
  const currentSynopsis = hydratedEpisode ? currentEpisodeData?.overview : hydratedItem.description;
  const protectSynopsis = Boolean(hydratedEpisode && !isCurrentWatched && controls.library.preferences.hideSynopsis !== false);
  const currentMeta = formatCurrentMeta(hydratedItem, hydratedEpisode, currentEpisodeData);

  return {
    hydratedItem,
    hydratedEpisode,
    orderedSeasons,
    watchTitle,
    sourcePage,
    drawerSubtitle,
    hasSeriesEpisodes,
    watchedKey,
    isCurrentWatched,
    currentSynopsis,
    protectSynopsis,
    currentMeta,
  };
}

function MobileEpisodesSheet({
  open,
  subtitle,
  onOpenChange,
  children,
}: Readonly<{
  open: boolean;
  subtitle: string;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}>) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="af-scrim af-sheet-scrim" />
        <Dialog.Popup className="af-mobile-sheet af-player-sheet af-episodes-sheet" aria-label="Episodes">
          <div className="af-sheet-handle" aria-hidden="true" />
          <header className="af-player-drawer-head">
            <div>
              <Dialog.Title>Episodes</Dialog.Title>
              <p className="af-meta af-tabular">{subtitle}</p>
            </div>
            <Dialog.Close className="af-icon-button" aria-label="Close episodes">
              <Icon name="close" />
            </Dialog.Close>
          </header>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DesktopEpisodesDrawer({
  subtitle,
  closeRef,
  onClose,
  children,
}: Readonly<{
  subtitle: string;
  closeRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: ReactNode;
}>) {
  return (
    <aside className="af-player-drawer" aria-label="Episodes drawer">
      <header className="af-player-drawer-head">
        <div>
          <strong>Episodes</strong>
          <p className="af-meta af-tabular">{subtitle}</p>
        </div>
        <button ref={closeRef} type="button" className="af-icon-button" aria-label="Close episodes drawer" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      {children}
    </aside>
  );
}

export function PlayerPage({ route, controls }: Readonly<{ route: PlayerRoute; controls: LibraryControls }>) {
  const extracted = extractRoute(route);
  const [loaded, setLoaded] = useState<ActiveMedia | null>(null);
  const [editionDetails, setEditionDetails] = useState<ArchiveTitle | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [details, setDetails] = useState<Details>();
  const [episodeTitle, setEpisodeTitle] = useState<string>('');
  const [currentEpisodeData, setCurrentEpisodeData] = useState<Episode | null>(null);
  const [nextEpisodeStill, setNextEpisodeStill] = useState<string | null>(null);
  const [seasonNumber, setSeasonNumber] = useState<number>(extracted.season ?? 1);
  const [seasonEpisodes, setSeasonEpisodes] = useState<Episode[]>([]);
  const [seasonRange, setSeasonRange] = useState(0);
  const [seasonError, setSeasonError] = useState('');
  const [seasonAttempt, setSeasonAttempt] = useState(0);
  const [adjacent, setAdjacent] = useState<{ previous?: EpisodePosition & { key?: string }; next?: EpisodePosition & { key?: string }; ready: boolean }>({ ready: false });
  const [activeProvider, setActiveProvider] = useState<AnimeProvider | null>(null);
  const [preferredAnimeAudio, setPreferredAnimeAudio] = useState<'sub' | 'dub' | null>(null);
  const [autoPlayEpisode, setAutoPlayEpisode] = useState(false);
  const [providerControls, setProviderControls] = useState(false);
  const [preferredQuality, setPreferredQuality] = useState<string | undefined>(undefined);
  const [theatreMode, setTheatreMode] = useState(false);
  const [episodesOpen, setEpisodesOpen] = useState(false);
  const [synopsisExpanded, setSynopsisExpanded] = useState(false);
  const isMobileViewport = useMediaQuery('(max-width: 720px)');

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
    return isPlayerUrl(candidate) ? webHref(fallback) : candidate;
  }, [route]);

  const detailsHref = useMemo(() => (
    route.kind === 'catalog'
      ? titleHref({ type: route.type, id: route.id })
      : webHref(`edition/${encodeURIComponent(route.key)}`)
  ), [route]);

  const {
    kind: routeKind,
    catalogType: routeCatalogType,
    catalogId: routeCatalogId,
    season: routeSeason,
    episode: routeEpisode,
    editionKey: routeEditionKey,
    watch: routeWatch,
    editionEp: routeEditionEp,
  } = extracted;

  usePlayerPreconnect(routeKind);

  useEffect(() => {
    if (!libraryResolved && routeKind === 'edition' && routeWatch) return;
    if (isSameCatalogEpisodeLoaded(loadedRef.current, { kind: routeKind, catalogType: routeCatalogType, catalogId: routeCatalogId, season: routeSeason, episode: routeEpisode, watch: routeWatch })) return;

    const controller = new AbortController();
    const { signal } = controller;
    setError('');
    setEpisodeTitle('');
    setCurrentEpisodeData(null);
    setNextEpisodeStill(null);
    setSynopsisExpanded(false);

    async function resolveCatalog(type: 'movie' | 'tv', id: number) {
      const episode = type === 'tv' && routeSeason !== undefined && routeEpisode !== undefined
        ? { season: routeSeason, number: routeEpisode, title: `Episode ${routeEpisode}` }
        : undefined;
      const itemKey = `${type}-${id}`;
      const progressKey = buildCatalogProgressKey(itemKey, episode);
      const existing = loadedRef.current;

      if (existing?.embed && existing.item.key === itemKey) {
        document.title = formatWatchDocTitle(existing.item.title, episode);
        setLoaded({ ...existing, episode, progressKey });
        if (episode) setSeasonNumber(episode.season);
        return;
      }

      setLoaded(null);
      setEditionDetails(null);
      const raw = await request<Details>(`/api/${type}/${id}/playback`, { signal });
      if (signal.aborted) return;
      const item = normalizeTitle(raw, type);
      document.title = formatWatchDocTitle(item.title, episode);
      setLoaded({ item, episode, embed: true, progressKey });
      if (episode) setSeasonNumber(episode.season);
      request<Details>(`/api/${type}/${id}`, { signal })
        .then(full => {
          if (!signal.aborted) setDetails(full);
        }).catch(() => {});
    }

    async function resolve() {
      if (routeKind === 'catalog' && routeCatalogType && routeCatalogId !== undefined) {
        await resolveCatalog(routeCatalogType, routeCatalogId);
        return;
      }
      if (routeKind === 'edition' && routeEditionKey) {
        const resolved = await resolveEditionEntry(routeEditionKey, routeWatch, routeEditionEp, libraryRef.current, signal);
        if (!resolved) return;
        document.title = resolved.title;
        setEditionDetails(resolved.editionDetails);
        setLoaded(resolved.loaded);
      }
    }

    void resolve().catch(error_ => {
      if (!signal.aborted) setError(error_ instanceof Error ? error_.message : 'Title unavailable.');
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
      pending = getSeason(showId, season).catch(error_ => {
        seasonCacheRef.current.delete(season);
        throw error_;
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
        if (loadedEpisodeSeason !== seasonNumber || loadedEpisodeNumber === undefined) {
          setSeasonRange(0);
          return;
        }
        const idx = episodes.findIndex(ep => ep.episode_number === loadedEpisodeNumber);
        setSeasonRange(idx >= 0 ? Math.floor(idx / playerEpisodeRangeSize) : 0);
        const currentEp = idx >= 0 ? episodes[idx] : undefined;
        if (currentEp) {
          setEpisodeTitle(currentEp.name);
          setCurrentEpisodeData(currentEp);
          document.title = `${currentEp.name} · ${loadedItemTitle} · Afterframe`;
        }
      })
      .catch(error_ => {
        if (active) setSeasonError(error_ instanceof Error ? error_.message : 'Episodes unavailable.');
      });
    return () => { active = false; };
  }, [loadedItemKey, loadedItemId, loadedItemType, loadedItemTitle, loadedArchive, loadedEpisodeSeason, loadedEpisodeNumber, seasonNumber, seasonAttempt, readSeason]);

  useEffect(() => {
    if (!loadedItemKey || loadedItemType !== 'tv') {
      setAdjacent({ ready: true });
      return;
    }
    if (loadedArchive?.episodes) {
      setAdjacent(resolveArchiveAdjacent(loadedArchive.episodes, loadedEpisodeKey));
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
      const prev = idx > 0 ? episodePosition(aired[idx - 1]) : undefined;
      const nextEpObj = idx + 1 < aired.length ? aired[idx + 1] : undefined;
      const next = nextEpObj ? episodePosition(nextEpObj) : undefined;
      if (nextEpObj?.still_path) setNextEpisodeStill(nextEpObj.still_path);
      setAdjacent({ previous: prev, next, ready: false });

      const resolved = await resolveCrossSeasonEdges(loadedItemId!, loadedEpisodeSeason!, details?.seasons, prev, next, readSeason);
      if (!active) return;
      if (resolved.nextStill) setNextEpisodeStill(resolved.nextStill);
      setAdjacent({ previous: resolved.previous, next: resolved.next, ready: true });
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
    setAutoPlayEpisode(true);
    const nextHref = target.key
      ? playerHref(`edition/${encodeURIComponent(current.item.key)}/watch/${encodeURIComponent(target.key)}`, originBack)
      : playerHref(`${current.item.type}/${current.item.id}/s${target.season}e${target.number}`, originBack);
    navigate(nextHref);
  }, [originBack]);

  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const drawerReturnFocusRef = useRef<HTMLElement | null>(null);

  const toggleEpisodesDrawer = useCallback(() => {
    setEpisodesOpen(current => {
      if (!current) {
        const active = document.activeElement;
        drawerReturnFocusRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
      }
      return !current;
    });
  }, []);

  const closeEpisodesDrawer = useCallback(() => setEpisodesOpen(false), []);
  useDrawerAccessibility(episodesOpen, drawerCloseRef, drawerReturnFocusRef, closeEpisodesDrawer);

  const historyDurations = useMemo(() => computeHistoryDurations(controls.library.history), [controls.library.history]);

  if (error) {
    return <PlayerErrorView route={route} error={error} originBack={originBack} onRetry={() => setAttempt(v => v + 1)} />;
  }

  if (editionDetails) {
    return <ArchiveEditionView entry={editionDetails} backHref={originBack} controls={controls} />;
  }

  if (!loaded || !libraryResolved) {
    return <section className="af-wrap af-directory">
      <a className="af-text-link" href={originBack}><Icon name="left" /> Back</a>
      <Loading label="Loading playback…" shape="hero" />
    </section>;
  }

  const {
    hydratedItem,
    hydratedEpisode,
    orderedSeasons,
    watchTitle,
    sourcePage,
    drawerSubtitle,
    hasSeriesEpisodes,
    watchedKey,
    isCurrentWatched,
    currentSynopsis,
    protectSynopsis,
    currentMeta,
  } = derivePlayerViewState(loaded, details, episodeTitle, currentEpisodeData, seasonNumber, controls);

  const selectSeason = (nextSeason: number) => {
    setSeasonNumber(nextSeason);
    setSeasonRange(0);
  };

  const handleSeasonTabKey = (event: ReactKeyboardEvent<HTMLDivElement>, prefix: string) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || orderedSeasons.length < 2) return;
    event.preventDefault();
    const idx = orderedSeasons.findIndex(s => s.season_number === seasonNumber);
    const nextSeason = orderedSeasons[nextSeasonTabIndex(event.key, idx, orderedSeasons.length)].season_number;
    selectSeason(nextSeason);
    document.getElementById(`${prefix}-${nextSeason}`)?.focus();
  };

  const episodesDrawerBody = (
    <PlayerDrawerEpisodes
      loaded={loaded}
      hydratedItem={hydratedItem}
      orderedSeasons={orderedSeasons}
      seasonNumber={seasonNumber}
      seasonEpisodes={seasonEpisodes}
      controls={controls}
      onSelectSeason={selectSeason}
      onSeasonTabKey={handleSeasonTabKey}
      onNavigateEpisode={navigateEpisode}
    />
  );

  const useMobileEpisodesSheet = isMobileViewport && !document.fullscreenElement;
  const episodesDrawerNode = hasSeriesEpisodes && episodesOpen && !useMobileEpisodesSheet ? (
    <DesktopEpisodesDrawer subtitle={drawerSubtitle} closeRef={drawerCloseRef} onClose={closeEpisodesDrawer}>
      {episodesDrawerBody}
    </DesktopEpisodesDrawer>
  ) : null;

  return <div className={`af-wrap af-player-page ${theatreMode ? 'is-theatre' : ''}`}>
    <h1 className="sr-only" tabIndex={-1}>{watchTitle}</h1>

    <PlayerTopbar
      hydratedItem={hydratedItem}
      hydratedEpisode={hydratedEpisode}
      detailsHref={detailsHref}
      hasSeriesEpisodes={hasSeriesEpisodes}
      episodesOpen={episodesOpen}
      adjacent={adjacent}
      theatreMode={theatreMode}
      onToggleEpisodes={toggleEpisodesDrawer}
      onNavigateEpisode={navigateEpisode}
      onToggleTheatre={() => setTheatreMode(v => !v)}
    />

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
        initialAnimeAudio={preferredAnimeAudio}
        onAnimeAudioChange={setPreferredAnimeAudio}
        autoPlayEpisode={autoPlayEpisode}
        providerControls={providerControls}
        onProviderControlsChange={setProviderControls}
        preferredQuality={preferredQuality}
        onPreferredQualityChange={setPreferredQuality}
        onNavigateEpisode={navigateEpisode}
        theatreMode={theatreMode}
        onToggleTheatre={() => setTheatreMode(v => !v)}
        hasEpisodesDrawer={hasSeriesEpisodes}
        episodesOpen={episodesOpen}
        onToggleEpisodes={toggleEpisodesDrawer}
        episodesDrawer={episodesDrawerNode}
      />
    </div>

    <div className="af-watch-body">
      <PlayerNowPlayingCard
        watchTitle={watchTitle}
        currentMeta={currentMeta}
        currentSynopsis={currentSynopsis}
        protectSynopsis={protectSynopsis}
        synopsisExpanded={synopsisExpanded}
        hydratedItem={hydratedItem}
        hydratedEpisode={hydratedEpisode}
        watchedKey={watchedKey}
        isCurrentWatched={isCurrentWatched}
        details={details}
        controls={controls}
        onExpandSynopsis={() => setSynopsisExpanded(true)}
      />

      <ArchiveEpisodesSection loaded={loaded} hydratedItem={hydratedItem} originBack={originBack} controls={controls} />

      <CatalogEpisodesSection
        loaded={loaded}
        hydratedItem={hydratedItem}
        orderedSeasons={orderedSeasons}
        seasonNumber={seasonNumber}
        seasonEpisodes={seasonEpisodes}
        seasonRange={seasonRange}
        seasonError={seasonError}
        originBack={originBack}
        controls={controls}
        historyDurations={historyDurations}
        onSelectSeason={selectSeason}
        onSelectRange={setSeasonRange}
        onSeasonTabKey={handleSeasonTabKey}
        onRetrySeason={() => setSeasonAttempt(v => v + 1)}
      />

      <WatchSourceFooter loaded={loaded} sourcePage={sourcePage} activeProvider={activeProvider} />
    </div>

    {hasSeriesEpisodes && useMobileEpisodesSheet && (
      <MobileEpisodesSheet open={episodesOpen} subtitle={drawerSubtitle} onOpenChange={setEpisodesOpen}>
        {episodesDrawerBody}
      </MobileEpisodesSheet>
    )}
  </div>;
}
