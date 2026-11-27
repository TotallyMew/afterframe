import { Dialog } from '@base-ui/react/dialog';
import { isAnime } from '@afterframe/shared/discover';
import { samePlaybackLanguage } from '@afterframe/shared/subtitles';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  episodeKey, episodeLabel, episodePosition, formatDate, imagePath, isAired, normalizeTitle,
  normalizeTitles, playHref, previousBrowse, request, timeCode, today,
  type CatalogRating, type Details as TitleDetails, type DetailsImage, type DetailsVideo,
  type Episode, type MediaType, type Season, type Title, type TitleResults,
} from './catalog';
import { Artwork, HeroBackdrop, Icon, Loading, MediaCard, MutationStatus, RatingProblem, SaveButton, Score, Shelf, useOptionalRating } from './components';
import { effectiveWatchStatus, getSeason, progressPercent, resumeFor, savedRating, watchStatuses, type Library, type LibraryControls, type WatchStatus } from './library';
import { FolderPickerPopover } from './library/FolderPickerPopover';
import { readAnimeAudioPreference, writeAnimeAudioPreference } from './player/types';
import { currentSearchParams } from './router';
import { AfSelect } from './UiControls';

function personInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const lastPart = parts.at(-1)!;
  return (parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${lastPart[0]}`).toUpperCase();
}

const episodeRangeSize = 24;
const mobileInitialEpisodes = 6;
const ratingOptions = [
  { value: '0', label: 'Choose 1–10' },
  ...Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1), label: `${index + 1} / 10` })),
];
const watchStatusOptions = Object.entries(watchStatuses).map(([value, label]) => ({ value, label }));

export function episodeDurationText(key: string, catalogMinutes: number | undefined, library: Library): string {
  const knownSec = library.progress[key]?.duration
    || Object.values(library.history).find(entry => entry.mediaKey === key && entry.duration > 0)?.duration;
  if (knownSec && knownSec > 0) return `${Math.max(1, Math.round(knownSec / 60))} min`;
  return catalogMinutes ? `~${catalogMinutes} min` : '';
}

export function orderSeasons(seasons: readonly Season[] | undefined): Season[] {
  const valid = (seasons ?? []).filter(entry => entry.episode_count > 0 && entry.season_number >= 0);
  const regular = valid.filter(entry => entry.season_number > 0).sort((a, b) => a.season_number - b.season_number);
  const specials = valid.filter(entry => entry.season_number === 0);
  return [...regular, ...specials];
}

function pickTitleLogo(logos?: DetailsImage[]): { url: string; width?: number; height?: number } | undefined {
  if (!logos?.length) return undefined;
  const preferred = logos.filter(entry => entry.iso_639_1 === 'en' && entry.file_path && !entry.file_path.endsWith('.svg'));
  const pool = preferred.length
    ? preferred
    : logos.filter(entry => (!entry.iso_639_1 || entry.iso_639_1 === 'en') && entry.file_path && !entry.file_path.endsWith('.svg'));
  const best = [...pool].sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))[0];
  const url = best ? imagePath(best.file_path, 'w500') : undefined;
  if (!url || !best) return undefined;
  const width = best.width && best.width > 0 ? best.width : undefined;
  const height = best.height && best.height > 0 ? best.height : undefined;
  return { url, width, height };
}

function trailerKindScore(kind: string): number {
  if (kind === 'Trailer') return 4;
  if (kind === 'Teaser') return 2;
  return 0;
}

function pickTrailer(videos?: DetailsVideo[]): DetailsVideo | undefined {
  const yt = (videos ?? []).filter(v => v.site === 'YouTube' && /^[\w-]{6,20}$/.test(v.key));
  if (!yt.length) return undefined;
  const score = (v: DetailsVideo) => trailerKindScore(v.type) + (v.official ? 2 : 0);
  return [...yt].sort((a, b) => score(b) - score(a))[0];
}

function upcoming(details: TitleDetails) {
  const next = details.next_episode_to_air;
  const nextDub = details.anime_dub?.next_episode_to_air;
  const hasSubNext = Boolean(next?.air_date && next.air_date >= today());
  const hasDubNext = Boolean(nextDub?.air_date && nextDub.air_date >= today());
  const subPrefix = hasDubNext ? 'Sub ' : '';
  const episode = hasSubNext && next
    ? `${subPrefix}${episodeLabel(next)} airs ${formatDate(next.air_date)}`
    : '';
  const dubEpisode = hasDubNext && nextDub
    ? `Dub S${nextDub.season_number} E${nextDub.episode_number} airs ${formatDate(nextDub.air_date)}`
    : '';
  const season = (details.seasons ?? []).filter(item => item.season_number > 0 && item.air_date && item.air_date > today())
    .sort((a, b) => (a.air_date ?? '').localeCompare(b.air_date ?? ''))[0];
  const seasonNote = season && (!episode || season.season_number !== next?.season_number)
    ? `Season ${season.season_number} premieres ${formatDate(season.air_date)}` : '';
  return [episode, dubEpisode, seasonNote].filter(Boolean).join(' · ');
}

function TrailerModal({ video, title, open, onOpenChange }: Readonly<{
  video: DetailsVideo;
  title: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}>) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Backdrop className="af-scrim" />
      <Dialog.Popup className="af-modal af-trailer-modal">
        <header className="af-section-head">
          <Dialog.Title>{title} · {video.type || 'Trailer'}</Dialog.Title>
          <Dialog.Close className="af-icon-button" aria-label="Close trailer">
            <Icon name="close" />
          </Dialog.Close>
        </header>
        {open && <div className="af-trailer-frame">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.key)}?autoplay=1&rel=0`}
            title={`${title} ${video.name || 'Trailer'}`}
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-presentation"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>}
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}

type RatingsMapSeason = {
  season_number: number;
  name: string;
  episodes: { episode_number: number; name: string; vote_average: number | null; vote_count: number; air_date?: string }[];
};

function ratingTier(score: number): 'great' | 'good' | 'mixed' | 'low' {
  if (score >= 9.0) return 'great';
  if (score >= 8.0) return 'good';
  if (score >= 7.0) return 'mixed';
  return 'low';
}

function EpisodeRatingsHeatmap({ item }: Readonly<{ item: Title }>) {
  const hostRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [seasons, setSeasons] = useState<RatingsMapSeason[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const node = hostRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '240px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const task = new AbortController();
    request<{ seasons: RatingsMapSeason[] }>(`/api/tv/${item.id}/ratings-map`, { signal: task.signal })
      .then(data => {
        if (!task.signal.aborted && Array.isArray(data.seasons)) setSeasons(data.seasons);
      })
      .catch(() => { if (!task.signal.aborted) setFailed(true); });
    return () => task.abort();
  }, [visible, item.id]);

  const populated = useMemo(
    () => (seasons ?? []).filter(s => s.episodes.some(ep => ep.vote_average != null && ep.vote_average > 0)),
    [seasons],
  );
  const maxEp = useMemo(
    () => populated.reduce((max, s) => Math.max(max, s.episodes.reduce((m, e) => Math.max(m, e.episode_number), 0)), 0),
    [populated],
  );
  const episodeRows = useMemo(() => Array.from({ length: Math.min(maxEp, 40) }, (_, i) => i + 1), [maxEp]);

  if (failed || (seasons !== null && populated.length === 0)) return null;

  return <section ref={hostRef} className="af-section af-heatmap-section" id="ratings-map" aria-labelledby="ratings-map-heading">
    <header className="af-section-head">
      <div>
        <h2 id="ratings-map-heading">Ratings by episode</h2>
        <p className="af-meta">Select any episode score to start watching</p>
      </div>
      <div className="af-heatmap-legend" aria-hidden="true">
        <span data-tier="great">9.0+</span>
        <span data-tier="good">8.0+</span>
        <span data-tier="mixed">7.0+</span>
        <span data-tier="low">&lt;7.0</span>
      </div>
    </header>
    {!seasons ? <Loading label="Loading episode ratings…" shape="rows" /> : (
      <div className="af-heatmap-scroll">
        <table className="af-heatmap-table">
          <thead>
            <tr>
              <th scope="col" className="af-heatmap-corner"><span className="sr-only">Episode</span></th>
              {populated.map(s => (
                <th scope="col" key={s.season_number} className="af-heatmap-col">S{s.season_number}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {episodeRows.map(epNum => (
              <tr key={epNum}>
                <th scope="row" className="af-heatmap-row">E{epNum}</th>
                {populated.map(s => {
                  const ep = s.episodes.find(e => e.episode_number === epNum);
                  if (!ep) return <td key={s.season_number} className="af-heatmap-empty"><span className="sr-only">No episode</span></td>;
                  const score = ep.vote_average;
                  const playable = isAired(ep);
                  if (score == null) {
                    return <td key={s.season_number} className="af-heatmap-empty">
                      <span className="af-heatmap-unrated" title={`S${s.season_number} E${ep.episode_number}: ${ep.name}`}>
                        <span aria-hidden="true">–</span>
                        <span className="sr-only">Not rated</span>
                      </span>
                    </td>;
                  }
                  const tier = ratingTier(score);
                  const label = `Play S${s.season_number} E${ep.episode_number}: ${ep.name}, rated ${score.toFixed(1)}`;
                  return <td key={s.season_number}>
                    {playable ? (
                      <a
                        className="af-heatmap-cell"
                        data-tier={tier}
                        href={playHref(item, { season: s.season_number, number: ep.episode_number, title: ep.name })}
                        aria-label={label}
                        title={`S${s.season_number} E${ep.episode_number} · ${ep.name} (${score.toFixed(1)})`}
                      >
                        {score.toFixed(1)}
                      </a>
                    ) : (
                      <span className="af-heatmap-cell is-upcoming" data-tier={tier} title={`S${s.season_number} E${ep.episode_number} · ${ep.name}`}>
                        {score.toFixed(1)}
                      </span>
                    )}
                  </td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </section>;
}

function formatEpisodeDateLabel(episode: Episode, animeAudio: 'sub' | 'dub' | undefined, available: boolean): string {
  if (animeAudio === 'dub') {
    if (!episode.dub_air_date) return available ? 'Dub available' : 'Dub TBA';
    if (available) return formatDate(episode.dub_air_date);
    const prefix = episode.dub_estimated ? 'Est.' : 'Airs';
    return `${prefix} ${formatDate(episode.dub_air_date)}`;
  }
  if (animeAudio === 'sub') {
    if (!episode.air_date) return '';
    return available ? formatDate(episode.air_date) : `Airs ${formatDate(episode.air_date)}`;
  }
  return !available && episode.air_date ? `Airs ${formatDate(episode.air_date)}` : '';
}

function EpisodeThumbnail({
  image,
  protect,
  revealed,
  available,
  href,
  episodeName,
  onRevealToggle,
  onSelectPlay,
}: Readonly<{
  image: string | undefined;
  protect: boolean;
  revealed: boolean;
  available: boolean;
  href: string;
  episodeName: string;
  onRevealToggle: () => void;
  onSelectPlay?: () => void;
}>) {
  const fallback = <span className="af-still-fallback" aria-hidden="true"><Icon name="film" /></span>;
  if (image && protect) {
    return (
      <button type="button" className="af-still" aria-label={`Reveal thumbnail for ${episodeName}`} aria-pressed={revealed} onClick={onRevealToggle}>
        <Artwork src={image} className={revealed ? undefined : 'af-blurred'} loading="lazy" fallback={fallback} />
        <span className="af-eye"><Icon name="eye" /><span>{revealed ? 'Hide' : 'Reveal'}</span></span>
      </button>
    );
  }
  if (available) {
    return (
      <a className="af-still af-still-link" href={href} onClick={onSelectPlay} tabIndex={-1} aria-hidden="true">
        <Artwork src={image} loading="lazy" fallback={fallback} />
        <span className="af-still-play"><Icon name="play" /></span>
      </a>
    );
  }
  return <span className="af-still"><Artwork src={image} loading="lazy" fallback={fallback} /></span>;
}

function episodeOverviewSummary(expanded: boolean, showPreview: boolean, overview: string) {
  if (expanded) return 'Hide description';
  if (showPreview) return <span className="af-synopsis-preview">{overview}</span>;
  return 'Show description';
}

function EpisodeRow({
  item, episode, controls, isResumeTarget, animeAudio, onSelectPlay,
}: Readonly<{
  item: Title;
  episode: Episode;
  controls: LibraryControls;
  isResumeTarget: boolean;
  animeAudio?: 'sub' | 'dub';
  onSelectPlay?: () => void;
}>) {
  const key = episodeKey(item, episode);
  const marked = Boolean(controls.library.watched[key]);
  const protect = !marked && controls.library.preferences.blur !== false;
  const [revealed, setRevealed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const image = imagePath(episode.still_path, 'w300');
  const available = animeAudio === 'dub' ? episode.dub_aired === true : isAired(episode);
  const progress = !marked ? controls.library.progress[key] : undefined;
  const hasProgress = Boolean(progress && progress.time > 5 && progress.time < progress.duration);
  const runtimeLabel = episodeDurationText(key, episode.runtime, controls.library);
  const dateLabel = formatEpisodeDateLabel(episode, animeAudio, available);
  const status = [`Episode ${episode.episode_number}`, runtimeLabel, dateLabel].filter(Boolean).join(' · ');
  const showPreview = marked || controls.library.preferences.hideSynopsis === false;
  const href = playHref(item, episodePosition(episode));

  return <article className={`af-episode af-episode-card ${isResumeTarget ? 'is-resume' : ''} ${marked ? 'is-watched' : ''}`}>
    <div className="af-episode-media">
      <EpisodeThumbnail
        image={image}
        protect={protect}
        revealed={revealed}
        available={available}
        href={href}
        episodeName={episode.name}
        onRevealToggle={() => setRevealed(value => !value)}
        onSelectPlay={onSelectPlay}
      />
      <span className="af-ep-code af-tabular" aria-hidden="true">E{episode.episode_number}</span>
      {hasProgress && progress && (
        <progress className="af-progress af-still-progress" value={progressPercent(progress)} max={100} aria-hidden="true" />
      )}
    </div>
    <div className="af-episode-copy">
      <div className="af-episode-top">
        <div className="af-episode-meta-row">
          {isResumeTarget && <span className="af-ep-state-tag">Resume</span>}
          <span className="af-meta af-tabular">{status}</span>
        </div>
        <button
          type="button"
          className="af-icon-button af-watched af-watched-inline"
          aria-label={`Mark ${episode.name} as watched`}
          aria-pressed={marked}
          disabled={!controls.ready || controls.isPending(key)}
          onClick={() => {
            if (marked) {
              setRevealed(false);
            }
            void controls.toggleWatched(item, key);
          }}
        >
          <span>{marked && <Icon name="check" />}</span>
        </button>
      </div>
      {available ? <a className="af-episode-title" href={href} onClick={onSelectPlay}>{episode.name}</a>
        : <span className="af-episode-title af-upcoming">{episode.name}</span>}
      {episode.overview && <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
        <summary>{episodeOverviewSummary(expanded, showPreview, episode.overview)}</summary>
        <p>{episode.overview}</p>
      </details>}
      {hasProgress && progress && <p className="af-meta af-tabular af-episode-resume-note">
        {controls.library.preferences.resume !== false ? 'Resume at' : 'Last position'} {timeCode(progress.time)}
      </p>}
      <MutationStatus itemKey={key} controls={controls} />
    </div>
  </article>;
}

function resolveEffectiveAudio(isAnimeTitle: boolean, dubAvailable: boolean, audioMode: 'sub' | 'dub'): 'sub' | 'dub' | undefined {
  if (!isAnimeTitle) return undefined;
  return dubAvailable ? audioMode : 'sub';
}

function formatSeasonWatchedFact(airedCount: number, watchedCount: number, totalCount: number): string {
  if (airedCount > 0) return `${watchedCount} of ${airedCount} watched`;
  return totalCount > 0 ? `${totalCount} episodes` : '';
}

function buildEpisodeRangeOptions(episodes: Episode[], count: number) {
  return Array.from({ length: count }, (_, index) => {
    const first = episodes[index * episodeRangeSize].episode_number;
    const last = episodes[Math.min(episodes.length, (index + 1) * episodeRangeSize) - 1].episode_number;
    const suffix = first === last ? '' : `–${last}`;
    return { value: String(index), label: `Episodes ${first}${suffix}` };
  });
}

function SeasonTabs({
  seasons,
  season,
  onSelectSeason,
}: Readonly<{
  seasons: Season[];
  season: number | undefined;
  onSelectSeason: (seasonNumber: number) => void;
}>) {
  if (seasons.length <= 1) return null;
  return (
    <div className="af-season-tabs" role="tablist" aria-label="Seasons">
      {seasons.map((option, idx) => (
        <button
          key={option.season_number}
          type="button"
          role="tab"
          aria-selected={season === option.season_number}
          tabIndex={season === option.season_number ? 0 : -1}
          className="af-season-tab"
          onClick={() => onSelectSeason(option.season_number)}
          onKeyDown={event => {
            let nextIdx = -1;
            if (event.key === 'ArrowRight') nextIdx = (idx + 1) % seasons.length;
            else if (event.key === 'ArrowLeft') nextIdx = (idx - 1 + seasons.length) % seasons.length;
            else if (event.key === 'Home') nextIdx = 0;
            else if (event.key === 'End') nextIdx = seasons.length - 1;
            if (nextIdx < 0) return;
            event.preventDefault();
            onSelectSeason(seasons[nextIdx].season_number);
            const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
            tabs?.[nextIdx]?.focus();
          }}
        >
          {option.name}
        </button>
      ))}
    </div>
  );
}

function Episodes({ item, seasons, initialSeason, resumeEpisode, controls, readSeason, isAnimeTitle, showHasDub }: Readonly<{
  item: Title;
  seasons: Season[];
  initialSeason: number | undefined;
  resumeEpisode?: { season: number; number: number };
  controls: LibraryControls;
  readSeason: (season: number) => Promise<Episode[]>;
  isAnimeTitle: boolean;
  showHasDub: boolean;
}>) {
  const [selected, setSelected] = useState<number>();
  const season = selected ?? initialSeason ?? seasons[0]?.season_number;
  const [results, setResults] = useState<{ season: number; episodes: Episode[] }>();
  const [error, setError] = useState('');
  const [range, setRange] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [markingSeason, setMarkingSeason] = useState(false);
  const [showAllMobile, setShowAllMobile] = useState(false);
  const [audioMode, setAudioMode] = useState<'sub' | 'dub'>(() => {
    if (!isAnimeTitle) return 'sub';
    const saved = readAnimeAudioPreference(item.key);
    if (saved) return saved;
    return samePlaybackLanguage(controls.library.preferences.audioLanguage, 'English') ? 'dub' : 'sub';
  });

  useEffect(() => {
    if (season == null) return;
    let active = true;
    readSeason(season).then(episodes => {
      if (active) setResults({ season, episodes });
    }).catch(error_ => { if (active) setError(error_.message); });
    return () => { active = false; };
  }, [season, readSeason, attempt]);

  const currentSeasonObj = seasons.find(entry => entry.season_number === season);
  const episodes = results?.season === season ? (results?.episodes ?? []) : [];
  const seasonHasDub = episodes.some(ep => ep.dub_aired !== undefined || Boolean(ep.dub_air_date));
  const dubAvailable = isAnimeTitle && (showHasDub || seasonHasDub);
  const effectiveAudio = resolveEffectiveAudio(isAnimeTitle, dubAvailable, audioMode);
  const isDubView = effectiveAudio === 'dub';
  const aired = isDubView ? episodes.filter(ep => ep.dub_aired === true) : episodes.filter(isAired);
  const watched = aired.filter(episode => controls.library.watched[episodeKey(item, episode)]).length;
  const unwatchedAired = aired.filter(episode => !controls.library.watched[episodeKey(item, episode)]);
  const count = Math.ceil(episodes.length / episodeRangeSize);
  const currentRange = Math.min(range, Math.max(0, count - 1));
  const rangeStart = currentRange * episodeRangeSize;
  const pageEpisodes = episodes.slice(rangeStart, rangeStart + episodeRangeSize);
  const seasonYear = currentSeasonObj?.air_date?.slice(0, 4);
  const seasonFacts = [
    currentSeasonObj?.name,
    seasonYear,
    isDubView && seasonHasDub ? `${aired.length} of ${episodes.length} dubbed` : '',
    formatSeasonWatchedFact(aired.length, watched, episodes.length),
  ].filter(Boolean).join(' · ');

  function handleAudioMode(next: 'sub' | 'dub') {
    setAudioMode(next);
    writeAnimeAudioPreference(item.key, next);
  }

  function selectSeason(seasonNumber: number) {
    setSelected(seasonNumber);
    setRange(0);
    setShowAllMobile(false);
    setError('');
  }

  async function handleMarkSeasonWatched() {
    if (!unwatchedAired.length || markingSeason || !controls.ready) return;
    setMarkingSeason(true);
    try {
      const episodeIds = unwatchedAired.map(ep => episodeKey(item, ep).slice(item.key.length + 1));
      await controls.markEpisodesWatched(item, episodeIds);
    } finally {
      setMarkingSeason(false);
    }
  }

  let episodesBody;
  if (season == null) {
    episodesBody = <p className="af-state">No seasons are listed.</p>;
  } else if (error) {
    episodesBody = (
      <p className="af-state" role="alert">
        {error} <button className="af-text-link" type="button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry</button>
      </p>
    );
  } else if (results?.season !== season) {
    episodesBody = <Loading label="Loading episodes…" shape="rows" />;
  } else if (episodes.length === 0) {
    episodesBody = <p className="af-state">No episodes are listed for this season.</p>;
  } else if (isDubView && !seasonHasDub) {
    episodesBody = (
      <output className="af-state">
        English dub is not available for {currentSeasonObj?.name || 'this season'} yet.{' '}
        <button type="button" className="af-text-link" onClick={() => handleAudioMode('sub')}>Switch to Sub</button>
      </output>
    );
  } else {
    episodesBody = (
      <>
        <div className={`af-episode-grid ${controls.library.preferences.compact ? 'af-compact' : ''} ${showAllMobile ? 'is-mobile-expanded' : ''}`}>
          {pageEpisodes.map((episode, index) => (
            <div className={index >= mobileInitialEpisodes && !showAllMobile ? 'af-episode-mobile-extra' : undefined} key={episodeKey(item, episode)}>
              <EpisodeRow
                item={item}
                episode={episode}
                controls={controls}
                isResumeTarget={Boolean(resumeEpisode && resumeEpisode.season === episode.season_number && resumeEpisode.number === episode.episode_number)}
                animeAudio={effectiveAudio}
                onSelectPlay={effectiveAudio ? () => writeAnimeAudioPreference(item.key, effectiveAudio) : undefined}
              />
            </div>
          ))}
        </div>
        {pageEpisodes.length > mobileInitialEpisodes && !showAllMobile && (
          <div className="af-mobile-show-all">
            <button type="button" className="af-button af-secondary" onClick={() => setShowAllMobile(true)}>
              Show all {pageEpisodes.length} episodes
            </button>
          </div>
        )}
      </>
    );
  }

  return <section id="episodes" className="af-section" tabIndex={-1} aria-labelledby="episodes-heading">
    <header className="af-section-head af-episodes-head">
      <div>
        <h2 id="episodes-heading">Episodes</h2>
        {seasonFacts && <p className="af-meta af-tabular">{seasonFacts}</p>}
      </div>
      <div className="af-episode-tools">
        {dubAvailable && <fieldset className="af-audio-switch" aria-label="Episode audio">
          <button
            type="button"
            className="af-audio-switch-btn"
            aria-pressed={effectiveAudio === 'sub'}
            onClick={() => handleAudioMode('sub')}
          >Sub</button>
          <button
            type="button"
            className="af-audio-switch-btn"
            aria-pressed={effectiveAudio === 'dub'}
            onClick={() => handleAudioMode('dub')}
          >Dub</button>
        </fieldset>}
        {unwatchedAired.length > 0 && <button type="button" className="af-button af-secondary af-tool-btn" disabled={!controls.ready || markingSeason} onClick={() => void handleMarkSeasonWatched()}>
          <Icon name="check" /><span>{markingSeason ? 'Marking…' : 'Mark season watched'}</span>
        </button>}
        {count > 1 && <AfSelect
          ariaLabel="Episode range"
          value={String(currentRange)}
          options={buildEpisodeRangeOptions(episodes, count)}
          onChange={value => { setRange(Number(value)); setShowAllMobile(false); }}
        />}
      </div>
    </header>

    <SeasonTabs seasons={seasons} season={season} onSelectSeason={selectSeason} />

    {currentSeasonObj?.overview && <p className="af-season-overview">{currentSeasonObj.overview}</p>}

    {episodesBody}
  </section>;
}

function resolveCreditSummary(directors: string[], creators: string[]): { role: string; names: string[] } {
  if (directors.length) return { role: 'Directed by', names: directors };
  if (creators.length) return { role: 'Created by', names: creators };
  return { role: '', names: [] };
}

function formatTitleLengthFact(type: MediaType, details: TitleDetails, item: Title): string {
  if (type === 'tv') {
    const count = details.number_of_seasons;
    if (!count) return '';
    return `${count} ${count === 1 ? 'season' : 'seasons'}`;
  }
  return item.duration ? `${item.duration} min` : '';
}

function formatTvPlayLabel(
  resumeEpisode: { season: number; number: number } | undefined,
  selection: { episode: Episode; replay: boolean } | undefined,
  regular: Season[],
): string {
  if (resumeEpisode) return `Resume S${resumeEpisode.season} E${resumeEpisode.number}`;
  if (selection) return selection.replay ? 'Watch again' : `Play ${episodeLabel(selection.episode)}`;
  return regular.length > 0 ? `Play S${regular[0].season_number} E1` : 'Play';
}

function resolveInitialSeason(
  orderedSeasons: Season[],
  resumeEpisode: { season: number; number: number } | undefined,
  regular: Season[],
): number | undefined {
  // Parse ?season= strictly so missing param never coerces to 0 (Specials)
  const rawSeasonParam = currentSearchParams().get('season');
  const parsedSeason = rawSeasonParam !== null && rawSeasonParam.trim() !== '' ? Number(rawSeasonParam) : Number.NaN;
  if (Number.isInteger(parsedSeason) && orderedSeasons.some(entry => entry.season_number === parsedSeason)) {
    return parsedSeason;
  }
  if (resumeEpisode && orderedSeasons.some(entry => entry.season_number === resumeEpisode.season)) {
    return resumeEpisode.season;
  }
  return regular[0]?.season_number;
}

function formatDetailsYearRange(type: MediaType, item: Title, details: TitleDetails): string {
  const start = item.year;
  const end = details.last_episode_to_air?.air_date?.slice(0, 4);
  if (type === 'tv' && start && end && end !== start && (details.status === 'Ended' || details.status === 'Canceled')) {
    return `${start}–${end}`;
  }
  return formatDate(item.date) || start || '';
}

function DetailsHeroSection({
  type,
  item,
  details,
  controls,
  imdb,
  mal,
  logo,
  trailer,
  startingEpisode,
  playLabel,
  resume,
  resumePct,
  watchedEpisodeCount,
  starring,
  creditRole,
  creditNames,
  facts,
  scheduling,
  onLogoError,
  onOpenTrailer,
}: Readonly<{
  type: MediaType;
  item: Title & { totalEpisodes?: number };
  details: TitleDetails;
  controls: LibraryControls;
  imdb: ReturnType<typeof useOptionalRating<CatalogRating>>;
  mal: ReturnType<typeof useOptionalRating<number>>;
  logo: { url: string; width?: number; height?: number } | undefined;
  trailer: DetailsVideo | undefined;
  startingEpisode: { season: number; number: number; title?: string } | undefined;
  playLabel: string;
  resume: ReturnType<typeof resumeFor>;
  resumePct: number;
  watchedEpisodeCount: number;
  starring: string[];
  creditRole: string;
  creditNames: string[];
  facts: string[];
  scheduling: string;
  onLogoError: () => void;
  onOpenTrailer: () => void;
}>) {
  const saved = controls.library.saved[item.key];
  const marked = Boolean(controls.library.watched[item.key]);
  const showMoviePlay = type === 'movie' && (!item.date || item.date <= today() || Boolean(resume));

  return (
    <section className={`af-hero af-details-hero af-cinema-hero ${item.backdrop ? '' : 'af-no-backdrop'}`}>
      {item.backdrop && <HeroBackdrop src={item.backdrop} sizes="100vw" />}
      <div className="af-wrap af-hero-inner">
        <a className="af-text-link af-back" href={previousBrowse(type === 'movie' ? 'movies' : 'tv')}><Icon name="left" /> Back to browse</a>
        <div className="af-details-main af-hero-split">
          {!item.backdrop && item.poster && <Artwork className="af-fallback-poster" src={item.poster} fallback={<span className="af-fallback-poster af-art-fallback"><Icon name="film" /></span>} />}
          <div className="af-copy">
            {logo ? <>
              <h1 className="sr-only">{item.title}</h1>
              <img className="af-title-logo" src={logo.url} width={logo.width} height={logo.height} alt="" decoding="async" fetchPriority="high" onError={onLogoError} />
            </> : <h1>{item.title}</h1>}
            <div className="af-meta af-details-meta af-title-facts af-tabular">
              <span>{type === 'tv' ? 'TV series' : 'Movie'}</span>
              {facts.map(fact => <span key={fact}>{fact}</span>)}
              <Score rating={imdb.value ?? item.rating} mal={mal.value} />
            </div>
            <RatingProblem name="IMDb" rating={imdb} /><RatingProblem name="MyAnimeList" rating={mal} />
            {item.description && <p className="af-overview">{item.description}</p>}

            <div className="af-hero-cta-row">
              {type === 'tv' && startingEpisode && (
                <a className={`af-button af-primary af-hero-play ${resumePct > 0 ? 'has-progress' : ''}`} href={playHref(item, startingEpisode)}>
                  <Icon name="play" />
                  <span>{playLabel}</span>
                  {resumePct > 0 && <span className="af-hero-play-bar" style={{ width: `${resumePct}%` }} aria-hidden="true" />}
                </a>
              )}
              {showMoviePlay && (
                <a className={`af-button af-primary af-hero-play ${resumePct > 0 ? 'has-progress' : ''}`} href={playHref(item)}>
                  <Icon name="play" />
                  <span>{resume ? 'Resume' : 'Play'}</span>
                  {resumePct > 0 && <span className="af-hero-play-bar" style={{ width: `${resumePct}%` }} aria-hidden="true" />}
                </a>
              )}
              {trailer && <button type="button" className="af-button af-secondary af-trailer-btn" onClick={onOpenTrailer}>
                <Icon name="trailer" /><span>Trailer</span>
              </button>}
            </div>

            <div className="af-hero-utilities">
              <SaveButton item={item} controls={controls} />
              {saved && <AfSelect
                ariaLabel="Watch status"
                value={effectiveWatchStatus(saved, controls.library)}
                disabled={!controls.ready || controls.isPending(item.key)}
                options={watchStatusOptions}
                onChange={value => void controls.setStatus(item, value as WatchStatus, details)}
              />}
              {type === 'movie' && !saved && <button type="button" className="af-button af-secondary" disabled={!controls.ready || controls.isPending(item.key)}
                aria-pressed={marked} onClick={() => void controls.toggleWatched(item)}>{marked ? <><Icon name="check" />Completed</> : 'Mark completed'}</button>}
              <FolderPickerPopover itemKey={item.key} itemTitle={item.title} controls={controls} />
              <div className="af-rating af-rating-inline">
                <span>Your rating</span>
                <AfSelect
                  ariaLabel="Your rating"
                  value={String(savedRating(controls.library.ratings[item.key]))}
                  disabled={!controls.ready || controls.isPending(item.key)}
                  options={ratingOptions}
                  onChange={value => void controls.rate(item, Number(value))}
                />
              </div>
            </div>

            {type === 'tv' && item.totalEpisodes ? <p className="af-meta af-tabular af-hero-progress-note" aria-live="polite">
              {watchedEpisodeCount} of {item.totalEpisodes} episodes watched{resume ? ` · Resume at ${timeCode(resume.time)}` : ''}
            </p> : null}
            {scheduling && <p className="af-schedule">{scheduling}</p>}
          </div>

          {Boolean(starring.length || creditNames.length) && <aside className="af-hero-credits" aria-label="Credits summary">
            {starring.length > 0 && <div className="af-hero-credit-group">
              <span className="af-hero-credit-label">Starring</span>
              <p>{starring.join(', ')}</p>
            </div>}
            {creditRole && creditNames.length > 0 && <div className="af-hero-credit-group">
              <span className="af-hero-credit-label">{creditRole}</span>
              <p>{creditNames.join(', ')}</p>
            </div>}
          </aside>}
        </div>
      </div>
    </section>
  );
}

const showStatusLabels: Record<string, string> = {
  'Returning Series': 'Ongoing',
  Ended: 'Ended',
  Canceled: 'Canceled',
  'In Production': 'In production',
  Planned: 'Planned',
  Pilot: 'Pilot',
};

export function DetailsPage({ type, id, controls }: Readonly<{ type: MediaType; id: number; controls: LibraryControls }>) {
  const [details, setDetails] = useState<TitleDetails>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [related, setRelated] = useState<Title[]>([]);
  const [relatedError, setRelatedError] = useState(false);
  const [relatedAttempt, setRelatedAttempt] = useState(0);
  const [selection, setSelection] = useState<{ episode: Episode; replay: boolean }>();
  const [selectionResolved, setSelectionResolved] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [trailerOpen, setTrailerOpen] = useState(false);
  const seasonCache = useRef(new Map<number, Promise<Episode[]>>());

  useEffect(() => {
    setSelection(undefined);
    setSelectionResolved(false);
    setLogoFailed(false);
    setTrailerOpen(false);
    const controller = new AbortController();
    const { signal } = controller;
    const path = `/api/${type}/${id}`;
    request<TitleDetails>(path, { signal }).then(value => {
      if (signal.aborted) return;
      setDetails(value);
      const item = normalizeTitle(value, type);
      document.title = `${item.title} · Afterframe`;
    }).catch(error_ => { if (!signal.aborted) setError(error_.message); });
    return () => controller.abort();
  }, [type, id, attempt]);

  const item = useMemo(() => details && { ...normalizeTitle(details, type), totalEpisodes: details.number_of_episodes }, [details, type]);
  useEffect(() => {
    if (item && isAnime(item.originalLanguage, item.genreIds)) {
      window.dispatchEvent(new CustomEvent('afterframe-section', { detail: 'anime' }));
    }
  }, [item]);
  const imdb = useOptionalRating<CatalogRating>(item?.imdb ? `/api/imdb?id=${encodeURIComponent(item.imdb)}&status=1` : undefined);
  const mal = useOptionalRating<number>(item?.originalLanguage === 'ja' && item.genreIds?.includes(16)
    ? `/api/mal/catalog/${type}/${id}?season=${details?.seasons?.find(entry => entry.season_number > 0)?.season_number ?? 1}&status=1`
    : undefined);
  useEffect(() => {
    const task = new AbortController();
    request<TitleResults>(`/api/${type}/${id}/related`, { signal: task.signal })
      .then(result => {
        const titles = normalizeTitles(result.results);
        if (!task.signal.aborted) { setRelated(titles); setRelatedError(false); }
      }).catch(() => { if (!task.signal.aborted) setRelatedError(true); });
    return () => task.abort();
  }, [type, id, relatedAttempt]);

  const orderedSeasons = useMemo(() => orderSeasons(details?.seasons), [details]);
  const regular = useMemo(() => {
    const list = orderedSeasons.filter(entry => entry.season_number > 0);
    return list.length ? list : orderedSeasons;
  }, [orderedSeasons]);

  const readSeason = useCallback((season: number) => {
    let response = seasonCache.current.get(season);
    if (!response) {
      response = getSeason(id, season).catch(error_ => { seasonCache.current.delete(season); throw error_; });
      seasonCache.current.set(season, response);
    }
    return response;
  }, [id]);
  const resume = item && controls.ready ? resumeFor(controls.library, item) : undefined;
  const watched = controls.library.watched;

  useEffect(() => {
    if (type !== 'tv' || !item || !controls.ready || resume?.episode) return;
    const title = item;
    let active = true;
    setSelectionResolved(false);
    async function chooseEpisode() {
      let first: Episode | undefined;
      for (const season of regular) {
        const episodes = (await readSeason(season.season_number)).filter(isAired);
        if (!active) return;
        first ??= episodes[0];
        const next = episodes.find(episode => !watched[episodeKey(title, episode)]);
        if (next) { setSelection({ episode: next, replay: false }); setSelectionResolved(true); return; }
      }
      if (active) {
        setSelection(first ? { episode: first, replay: true } : undefined);
        setSelectionResolved(true);
      }
    }
    void chooseEpisode().catch(() => {
      if (active) { setSelection(undefined); setSelectionResolved(true); }
    });
    return () => { active = false; };
  }, [type, item, controls.ready, regular, readSeason, resume, watched]);

  if (!details || !item) return <div className="af-wrap af-title-page">
    <a className="af-text-link af-back" href={previousBrowse(type === 'movie' ? 'movies' : 'tv')}><Icon name="left" /> Back to browse</a>
    {error ? <div className="af-state" role="alert"><h1>Title unavailable</h1><p>{error}</p>
      <button className="af-text-link" type="button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry</button></div>
      : <Loading label="Loading title…" shape="hero" />}
  </div>;

  const cast = details.credits?.cast?.slice(0, 8) ?? [];
  const starring = cast.slice(0, 4).map(person => person.name);
  const crew = details.credits?.crew?.filter(person => ['Director', 'Writer', 'Screenplay', 'Director of Photography', 'Original Music Composer', 'Editor'].includes(person.job)).slice(0, 10) ?? [];
  const directors = [...new Set(crew.filter(person => person.job === 'Director').map(person => person.name))];
  const creators = details.created_by?.map(person => person.name) ?? [];
  const { role: creditRole, names: creditNames } = resolveCreditSummary(directors, creators);
  const genres = details.genres?.slice(0, 3).map(genre => genre.name).join(', ') || item.genre;
  const scheduling = type === 'tv' ? upcoming(details) : '';
  const status = showStatusLabels[details.status ?? ''];
  const yearRange = formatDetailsYearRange(type, item, details);
  const facts = [
    genres,
    yearRange,
    formatTitleLengthFact(type, details, item),
    type === 'tv' ? status : '',
  ].filter((value): value is string => Boolean(value));

  const count = Object.keys(watched).filter(key => key.startsWith(`${item.key}/cinesrc-s`) && !key.startsWith(`${item.key}/cinesrc-s0e`)).length;
  const resumeEpisode = resume?.episode;
  const optimisticEpisode = !selectionResolved && regular.length > 0 && (!item.date || item.date <= today())
    ? { season: regular[0].season_number, number: 1, title: 'Episode 1' }
    : undefined;
  const startingEpisode = resumeEpisode ?? (selection ? episodePosition(selection.episode) : optimisticEpisode);
  const playLabel = formatTvPlayLabel(resumeEpisode, selection, regular);
  const initialSeason = resolveInitialSeason(orderedSeasons, resumeEpisode, regular);
  const logo = logoFailed ? undefined : pickTitleLogo(details.images?.logos);
  const trailer = pickTrailer(details.videos?.results);
  const resumePct = resume && resume.duration > 0 ? progressPercent(resume) : 0;

  return <>
    <DetailsHeroSection
      type={type}
      item={item}
      details={details}
      controls={controls}
      imdb={imdb}
      mal={mal}
      logo={logo}
      trailer={trailer}
      startingEpisode={startingEpisode}
      playLabel={playLabel}
      resume={resume}
      resumePct={resumePct}
      watchedEpisodeCount={count}
      starring={starring}
      creditRole={creditRole}
      creditNames={creditNames}
      facts={facts}
      scheduling={scheduling}
      onLogoError={() => setLogoFailed(true)}
      onOpenTrailer={() => setTrailerOpen(true)}
    />

    {trailer && <TrailerModal video={trailer} title={item.title} open={trailerOpen} onOpenChange={setTrailerOpen} />}

    <div className="af-wrap af-content">
      {type === 'tv' && <Episodes
        item={item}
        seasons={orderedSeasons}
        initialSeason={initialSeason}
        resumeEpisode={resumeEpisode}
        controls={controls}
        readSeason={readSeason}
        isAnimeTitle={isAnime(item.originalLanguage, item.genreIds)}
        showHasDub={Boolean(details.anime_dub?.available)}
      />}

      {type === 'tv' && orderedSeasons.some(s => s.season_number > 0) && <EpisodeRatingsHeatmap item={item} />}

      {Boolean(cast.length || crew.length) && <section className="af-section" id="cast" tabIndex={-1}>
        <header className="af-section-head"><h2>Cast &amp; crew</h2></header>
        <div className="af-cast">{cast.map(person => {
          const art = imagePath(person.profile_path, 'w185');
          return <div className="af-person" key={person.id}>
            <Artwork src={art} loading="lazy" fallback={<span className="af-person-initials" aria-hidden="true">{personInitials(person.name)}</span>} />
            <p><strong>{person.name}</strong>{person.character && <small>{person.character}</small>}</p>
          </div>;
        })}</div>
        {crew.length > 0 && <dl className="af-crew">{crew.map((person, index) => <div key={`${person.id}-${index}`}><dt>{person.job}</dt><dd>{person.name}</dd></div>)}</dl>}
      </section>}

      {relatedError && <output className="af-state">Related titles could not load. <button className="af-text-link" type="button" onClick={() => setRelatedAttempt(value => value + 1)}>Retry related titles</button></output>}
      {related.length > 0 && <div id="related" tabIndex={-1}><Shelf title={type === 'tv' ? 'Related series' : 'Related films'}>
        {related.map(other => <MediaCard item={other} controls={controls} key={other.key} />)}
      </Shelf></div>}
    </div>
  </>;
}
