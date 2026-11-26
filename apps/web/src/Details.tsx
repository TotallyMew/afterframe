import { Dialog } from '@base-ui/react/dialog';
import { isAnime } from '@afterframe/shared/discover';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  episodeKey, episodeLabel, episodePosition, formatDate, imagePath, isAired, navigate, normalizeTitle,
  normalizeTitles, playHref, previousBrowse, request, timeCode, today,
  type CatalogRating, type Details as TitleDetails, type DetailsImage, type DetailsVideo,
  type Episode, type MediaType, type Season, type Title, type TitleResults, type WatchProviderRegion,
} from './catalog';
import { Artwork, HeroBackdrop, Icon, Loading, MediaCard, MutationStatus, RatingProblem, SaveButton, Score, Shelf, useOptionalRating } from './components';
import { effectiveWatchStatus, getSeason, progressPercent, resumeFor, savedRating, watchStatuses, type Library, type LibraryControls, type WatchStatus } from './library';
import { FolderPickerPopover } from './library/FolderPickerPopover';
import { currentSearchParams } from './router';
import { AfSelect } from './UiControls';

function personInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts[parts.length - 1][0]}`).toUpperCase();
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

function pickTitleLogo(logos?: DetailsImage[]): string | undefined {
  if (!logos?.length) return undefined;
  const preferred = logos.filter(entry => entry.iso_639_1 === 'en' && entry.file_path && !entry.file_path.endsWith('.svg'));
  const pool = preferred.length
    ? preferred
    : logos.filter(entry => (!entry.iso_639_1 || entry.iso_639_1 === 'en') && entry.file_path && !entry.file_path.endsWith('.svg'));
  const best = [...pool].sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))[0];
  return best ? imagePath(best.file_path, 'w500') : undefined;
}

function pickTrailer(videos?: DetailsVideo[]): DetailsVideo | undefined {
  const yt = (videos ?? []).filter(v => v.site === 'YouTube' && /^[\w-]{6,20}$/.test(v.key));
  if (!yt.length) return undefined;
  const score = (v: DetailsVideo) =>
    (v.type === 'Trailer' ? 4 : v.type === 'Teaser' ? 2 : 0) + (v.official ? 2 : 0);
  return [...yt].sort((a, b) => score(b) - score(a))[0];
}

function configuredRegion(): string {
  try {
    const saved = JSON.parse(localStorage.getItem('afterframe.region') || 'null');
    if (typeof saved === 'string' && /^[A-Z]{2}$/.test(saved)) return saved;
  } catch { /* ignore */ }
  return 'LT';
}

function upcoming(details: TitleDetails) {
  const next = details.next_episode_to_air;
  const episode = next?.air_date && next.air_date >= today() ? `${episodeLabel(next)} airs ${formatDate(next.air_date)}` : '';
  const season = (details.seasons ?? []).filter(item => item.season_number > 0 && item.air_date && item.air_date > today())
    .sort((a, b) => (a.air_date ?? '').localeCompare(b.air_date ?? ''))[0];
  const seasonNote = season && (!episode || season.season_number !== next?.season_number)
    ? `Season ${season.season_number} premieres ${formatDate(season.air_date)}` : '';
  return [episode, seasonNote].filter(Boolean).join(' · ');
}

function TrailerModal({ video, title, open, onOpenChange }: {
  video: DetailsVideo;
  title: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
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
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>}
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}

function WhereToWatch({ providers }: { providers: Record<string, WatchProviderRegion> | undefined }) {
  const region = configuredRegion();
  const entry = providers?.[region];
  if (!entry) return null;
  const groups = [
    { label: 'Stream', items: [...(entry.flatrate ?? []), ...(entry.free ?? []), ...(entry.ads ?? [])] },
    { label: 'Rent', items: entry.rent ?? [] },
    { label: 'Buy', items: entry.buy ?? [] },
  ].map(group => ({
    label: group.label,
    items: [...new Map(group.items.map(item => [item.provider_id, item])).values()].slice(0, 8),
  })).filter(group => group.items.length > 0);
  if (!groups.length) return null;
  const regionLabel = (() => {
    try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(region) ?? region; }
    catch { return region; }
  })();

  return <section className="af-section af-watch-providers" id="availability" aria-labelledby="availability-heading">
    <header className="af-section-head">
      <div>
        <h2 id="availability-heading">Where to watch</h2>
        <p className="af-meta">Availability in {regionLabel} via JustWatch</p>
      </div>
      {entry.link && <a className="af-text-link" href={entry.link} target="_blank" rel="noopener noreferrer">View listings</a>}
    </header>
    <div className="af-provider-groups">
      {groups.map(group => (
        <div className="af-provider-group" key={group.label}>
          <span className="af-provider-group-label">{group.label}</span>
          <div className="af-provider-list">
            {group.items.map(provider => {
              const logo = imagePath(provider.logo_path, 'w92');
              return <span className="af-provider-chip" key={provider.provider_id}>
                {logo && <img src={logo} alt="" width="20" height="20" loading="lazy" />}
                <span>{provider.provider_name}</span>
              </span>;
            })}
          </div>
        </div>
      ))}
    </div>
  </section>;
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

function EpisodeRatingsHeatmap({ item }: { item: Title }) {
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
                  if (!ep) return <td key={s.season_number} className="af-heatmap-empty" aria-hidden="true" />;
                  const score = ep.vote_average;
                  const playable = isAired(ep);
                  if (score == null) {
                    return <td key={s.season_number} className="af-heatmap-empty">
                      <span className="af-heatmap-unrated" title={`S${s.season_number} E${ep.episode_number}: ${ep.name}`}>–</span>
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

function EpisodeRow({
  item, episode, controls, isResumeTarget,
}: {
  item: Title;
  episode: Episode;
  controls: LibraryControls;
  isResumeTarget: boolean;
}) {
  const key = episodeKey(item, episode);
  const marked = Boolean(controls.library.watched[key]);
  const protect = !marked && controls.library.preferences.blur !== false;
  const [revealed, setRevealed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const image = imagePath(episode.still_path, 'w300');
  const available = isAired(episode);
  const progress = !marked ? controls.library.progress[key] : undefined;
  const hasProgress = Boolean(progress && progress.time > 5 && progress.time < progress.duration);
  const runtimeLabel = episodeDurationText(key, episode.runtime, controls.library);
  const status = [`Episode ${episode.episode_number}`, runtimeLabel, !available && episode.air_date ? `Airs ${formatDate(episode.air_date)}` : ''].filter(Boolean).join(' · ');
  const showPreview = marked || controls.library.preferences.hideSynopsis === false;
  const href = playHref(item, episodePosition(episode));

  return <article className={`af-episode af-episode-card ${isResumeTarget ? 'is-resume' : ''} ${marked ? 'is-watched' : ''}`}>
    <div className="af-episode-media">
      {image && protect ? <button type="button" className="af-still" aria-label={`${revealed ? 'Hide' : 'Reveal'} thumbnail for ${episode.name}`}
        aria-pressed={revealed} onClick={() => setRevealed(value => !value)}>
        <Artwork src={image} className={revealed ? undefined : 'af-blurred'} loading="lazy" fallback={<span className="af-still-fallback" aria-hidden="true"><Icon name="film" /></span>} />
        <span className="af-eye"><Icon name="eye" /><span>{revealed ? 'Hide' : 'Reveal'}</span></span>
      </button> : available ? <a className="af-still af-still-link" href={href} tabIndex={-1} aria-hidden="true">
        <Artwork src={image} loading="lazy" fallback={<span className="af-still-fallback" aria-hidden="true"><Icon name="film" /></span>} />
        <span className="af-still-play"><Icon name="play" /></span>
      </a> : <span className="af-still"><Artwork src={image} loading="lazy" fallback={<span className="af-still-fallback" aria-hidden="true"><Icon name="film" /></span>} /></span>}
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
        <button type="button" className="af-icon-button af-watched af-watched-inline" aria-label={`${marked ? 'Watched' : 'Mark watched'}: ${episode.name}`} aria-pressed={marked}
          disabled={!controls.ready || controls.isPending(key)} onClick={() => { if (marked) setRevealed(false); void controls.toggleWatched(item, key); }}>
          <span>{marked && <Icon name="check" />}</span>
        </button>
      </div>
      {available ? <a className="af-episode-title" href={href}>{episode.name}</a>
        : <span className="af-episode-title af-upcoming">{episode.name}</span>}
      {episode.overview && <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
        <summary>{expanded ? 'Hide description' : showPreview ? <span className="af-synopsis-preview">{episode.overview}</span> : 'Show description'}</summary>
        <p>{episode.overview}</p>
      </details>}
      {hasProgress && progress && <p className="af-meta af-tabular af-episode-resume-note">
        {controls.library.preferences.resume !== false ? 'Resume at' : 'Last position'} {timeCode(progress.time)}
      </p>}
      <MutationStatus itemKey={key} controls={controls} />
    </div>
  </article>;
}

function Episodes({ item, seasons, initialSeason, resumeEpisode, controls, readSeason }: {
  item: Title;
  seasons: Season[];
  initialSeason: number | undefined;
  resumeEpisode?: { season: number; number: number };
  controls: LibraryControls;
  readSeason: (season: number) => Promise<Episode[]>;
}) {
  const [selected, setSelected] = useState<number>();
  const season = selected ?? initialSeason ?? seasons[0]?.season_number;
  const [results, setResults] = useState<{ season: number; episodes: Episode[] }>();
  const [error, setError] = useState('');
  const [range, setRange] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [shuffling, setShuffling] = useState(false);
  const [markingSeason, setMarkingSeason] = useState(false);
  const [showAllMobile, setShowAllMobile] = useState(false);

  useEffect(() => {
    if (season == null) return;
    let active = true;
    readSeason(season).then(episodes => {
      if (active) setResults({ season, episodes });
    }).catch(problem => { if (active) setError(problem.message); });
    return () => { active = false; };
  }, [season, readSeason, attempt]);

  const currentSeasonObj = seasons.find(entry => entry.season_number === season);
  const episodes = results?.season === season ? (results?.episodes ?? []) : [];
  const aired = episodes.filter(isAired);
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
    aired.length > 0 ? `${watched} of ${aired.length} watched` : episodes.length > 0 ? `${episodes.length} episodes` : '',
  ].filter(Boolean).join(' · ');

  const regularSeasons = useMemo(() => seasons.filter(s => s.season_number > 0), [seasons]);

  async function handleShuffle() {
    const poolSeasons = regularSeasons.length ? regularSeasons : seasons;
    if (!poolSeasons.length || shuffling) return;
    setShuffling(true);
    try {
      const pickSeason = poolSeasons[Math.floor(Math.random() * poolSeasons.length)];
      const eps = (await readSeason(pickSeason.season_number)).filter(isAired);
      if (eps.length) {
        const chosen = eps[Math.floor(Math.random() * eps.length)];
        navigate(playHref(item, episodePosition(chosen)));
      }
    } catch { /* ignore */ }
    finally { setShuffling(false); }
  }

  async function handleMarkSeasonWatched() {
    if (!unwatchedAired.length || markingSeason || !controls.ready) return;
    setMarkingSeason(true);
    try {
      for (const ep of unwatchedAired) {
        await controls.toggleWatched(item, episodeKey(item, ep), { force: true, skipConfirm: true });
      }
    } finally {
      setMarkingSeason(false);
    }
  }

  return <section id="episodes" className="af-section" tabIndex={-1} aria-labelledby="episodes-heading">
    <header className="af-section-head af-episodes-head">
      <div>
        <h2 id="episodes-heading">Episodes</h2>
        {seasonFacts && <p className="af-meta af-tabular">{seasonFacts}</p>}
      </div>
      <div className="af-episode-tools">
        {seasons.length > 0 && <button type="button" className="af-button af-secondary af-tool-btn" disabled={shuffling} onClick={() => void handleShuffle()}>
          <Icon name="shuffle" /><span>{shuffling ? 'Picking…' : 'Shuffle'}</span>
        </button>}
        {unwatchedAired.length > 0 && <button type="button" className="af-button af-secondary af-tool-btn" disabled={!controls.ready || markingSeason} onClick={() => void handleMarkSeasonWatched()}>
          <Icon name="check" /><span>{markingSeason ? 'Marking…' : 'Mark season watched'}</span>
        </button>}
        {count > 1 && <AfSelect
          ariaLabel="Episode range"
          value={String(currentRange)}
          options={Array.from({ length: count }, (_, index) => {
            const first = episodes[index * episodeRangeSize].episode_number;
            const last = episodes[Math.min(episodes.length, (index + 1) * episodeRangeSize) - 1].episode_number;
            return { value: String(index), label: `Episodes ${first}${first === last ? '' : `–${last}`}` };
          })}
          onChange={value => { setRange(Number(value)); setShowAllMobile(false); }}
        />}
      </div>
    </header>

    {seasons.length > 1 && <div className="af-season-tabs" role="tablist" aria-label="Seasons">
      {seasons.map(option => (
        <button
          key={option.season_number}
          type="button"
          role="tab"
          aria-selected={season === option.season_number}
          className="af-season-tab"
          onClick={() => {
            setSelected(option.season_number);
            setRange(0);
            setShowAllMobile(false);
            setError('');
          }}
        >
          {option.name}
        </button>
      ))}
    </div>}

    {currentSeasonObj?.overview && <p className="af-season-overview">{currentSeasonObj.overview}</p>}

    {season == null ? <p className="af-state">No seasons are listed.</p> : error ? <p className="af-state" role="alert">{error} <button className="af-text-link" type="button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry</button></p>
      : results?.season !== season ? <Loading label="Loading episodes…" shape="rows" />
      : episodes.length === 0 ? <p className="af-state">No episodes are listed for this season.</p>
      : <>
        <div className={`af-episode-grid ${controls.library.preferences.compact ? 'af-compact' : ''} ${showAllMobile ? 'is-mobile-expanded' : ''}`}>
          {pageEpisodes.map((episode, index) => (
            <div className={index >= mobileInitialEpisodes && !showAllMobile ? 'af-episode-mobile-extra' : undefined} key={episodeKey(item, episode)}>
              <EpisodeRow
                item={item}
                episode={episode}
                controls={controls}
                isResumeTarget={Boolean(resumeEpisode && resumeEpisode.season === episode.season_number && resumeEpisode.number === episode.episode_number)}
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
      </>}
  </section>;
}

export function DetailsPage({ type, id, controls }: { type: MediaType; id: number; controls: LibraryControls }) {
  const [details, setDetails] = useState<TitleDetails>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [related, setRelated] = useState<Title[]>([]);
  const [relatedError, setRelatedError] = useState(false);
  const [relatedAttempt, setRelatedAttempt] = useState(0);
  const [selection, setSelection] = useState<{ episode: Episode; replay: boolean }>();
  const [logoFailed, setLogoFailed] = useState(false);
  const [trailerOpen, setTrailerOpen] = useState(false);
  const seasonCache = useRef(new Map<number, Promise<Episode[]>>());

  useEffect(() => {
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
    }).catch(problem => { if (!signal.aborted) setError(problem.message); });
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
      response = getSeason(id, season).catch(problem => { seasonCache.current.delete(season); throw problem; });
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
    async function chooseEpisode() {
      let first: Episode | undefined;
      for (const season of regular) {
        const episodes = (await readSeason(season.season_number)).filter(isAired);
        if (!active) return;
        first ??= episodes[0];
        const next = episodes.find(episode => !watched[episodeKey(title, episode)]);
        if (next) { setSelection({ episode: next, replay: false }); return; }
      }
      if (active) setSelection(first ? { episode: first, replay: true } : undefined);
    }
    void chooseEpisode().catch(() => { if (active) setSelection(undefined); });
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
  const creditRole = directors.length ? 'Directed by' : creators.length ? 'Created by' : '';
  const creditNames = directors.length ? directors : creators;
  const genres = details.genres?.slice(0, 3).map(genre => genre.name).join(', ') || item.genre;
  const scheduling = type === 'tv' ? upcoming(details) : '';
  const status = ({ 'Returning Series': 'Ongoing', Ended: 'Ended', Canceled: 'Canceled', 'In Production': 'In production', Planned: 'Planned', Pilot: 'Pilot' } as Record<string, string>)[details.status ?? ''];
  const yearRange = (() => {
    const start = item.year;
    const end = details.last_episode_to_air?.air_date?.slice(0, 4);
    if (type === 'tv' && start && end && end !== start && (details.status === 'Ended' || details.status === 'Canceled')) {
      return `${start}–${end}`;
    }
    return formatDate(item.date) || start || '';
  })();
  const facts = [
    genres,
    yearRange,
    type === 'tv' ? details.number_of_seasons ? `${details.number_of_seasons} ${details.number_of_seasons === 1 ? 'season' : 'seasons'}` : '' : item.duration ? `${item.duration} min` : '',
    type === 'tv' ? status : '',
  ].filter(Boolean);

  const count = Object.keys(watched).filter(key => key.startsWith(`${item.key}/cinesrc-s`) && !key.startsWith(`${item.key}/cinesrc-s0e`)).length;
  const resumeEpisode = resume?.episode;
  const optimisticEpisode = regular.length > 0
    ? { season: regular[0].season_number, number: 1, title: 'Episode 1' }
    : undefined;
  const startingEpisode = resumeEpisode ?? (selection ? episodePosition(selection.episode) : optimisticEpisode);
  const playLabel = resumeEpisode ? `Resume S${resumeEpisode.season} E${resumeEpisode.number}`
    : selection ? selection.replay ? 'Watch again' : `Play ${episodeLabel(selection.episode)}`
    : regular.length > 0 ? `Play S${regular[0].season_number} E1` : 'Play';

  // Parse ?season= strictly so missing param never coerces to 0 (Specials)
  const rawSeasonParam = currentSearchParams().get('season');
  const parsedSeason = rawSeasonParam !== null && rawSeasonParam.trim() !== '' ? Number(rawSeasonParam) : NaN;
  const initialSeason = Number.isInteger(parsedSeason) && orderedSeasons.some(entry => entry.season_number === parsedSeason)
    ? parsedSeason
    : resumeEpisode && orderedSeasons.some(entry => entry.season_number === resumeEpisode.season)
      ? resumeEpisode.season
      : regular[0]?.season_number;

  const saved = controls.library.saved[item.key];
  const marked = Boolean(watched[item.key]);
  const logoUrl = !logoFailed ? pickTitleLogo(details.images?.logos) : undefined;
  const trailer = pickTrailer(details.videos?.results);
  const resumePct = resume && resume.duration > 0 ? progressPercent(resume) : 0;

  return <>
    <section className={`af-hero af-details-hero af-cinema-hero ${item.backdrop ? '' : 'af-no-backdrop'}`}>
      {item.backdrop && <HeroBackdrop src={item.backdrop} sizes="100vw" />}
      <div className="af-wrap af-hero-inner">
        <a className="af-text-link af-back" href={previousBrowse(type === 'movie' ? 'movies' : 'tv')}><Icon name="left" /> Back to browse</a>
        <div className="af-details-main af-hero-split">
          {!item.backdrop && item.poster && <Artwork className="af-fallback-poster" src={item.poster} fallback={<span className="af-fallback-poster af-art-fallback"><Icon name="film" /></span>} />}
          <div className="af-copy">
            {logoUrl ? <>
              <h1 className="sr-only">{item.title}</h1>
              <img className="af-title-logo" src={logoUrl} alt="" decoding="async" fetchPriority="high" onError={() => setLogoFailed(true)} />
            </> : <h1>{item.title}</h1>}
            <div className="af-meta af-details-meta af-title-facts af-tabular">
              <span>{type === 'tv' ? 'TV series' : 'Movie'}</span>
              {facts.map(fact => <span key={fact}>{fact}</span>)}
              <Score rating={imdb.value ?? item.rating} mal={mal.value} />
            </div>
            <RatingProblem name="IMDb" rating={imdb} /><RatingProblem name="MyAnimeList" rating={mal} />
            {item.description && <p className="af-overview">{item.description}</p>}

            <div className="af-hero-cta-row">
              {type === 'tv' ? startingEpisode && (
                <a className={`af-button af-primary af-hero-play ${resumePct > 0 ? 'has-progress' : ''}`} href={playHref(item, startingEpisode)}>
                  <Icon name="play" />
                  <span>{playLabel}</span>
                  {resumePct > 0 && <span className="af-hero-play-bar" style={{ width: `${resumePct}%` }} aria-hidden="true" />}
                </a>
              ) : (!item.date || item.date <= today() || resume) && (
                <a className={`af-button af-primary af-hero-play ${resumePct > 0 ? 'has-progress' : ''}`} href={playHref(item)}>
                  <Icon name="play" />
                  <span>{resume ? 'Resume' : 'Play'}</span>
                  {resumePct > 0 && <span className="af-hero-play-bar" style={{ width: `${resumePct}%` }} aria-hidden="true" />}
                </a>
              )}
              {trailer && <button type="button" className="af-button af-secondary af-trailer-btn" onClick={() => setTrailerOpen(true)}>
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
              {count} of {item.totalEpisodes} episodes watched{resume ? ` · Resume at ${timeCode(resume.time)}` : ''}
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

    {trailer && <TrailerModal video={trailer} title={item.title} open={trailerOpen} onOpenChange={setTrailerOpen} />}

    <div className="af-wrap af-content">
      {type === 'tv' && <Episodes
        item={item}
        seasons={orderedSeasons}
        initialSeason={initialSeason}
        resumeEpisode={resumeEpisode}
        controls={controls}
        readSeason={readSeason}
      />}

      {type === 'tv' && orderedSeasons.some(s => s.season_number > 0) && <EpisodeRatingsHeatmap item={item} />}

      <WhereToWatch providers={details['watch/providers']?.results} />

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

      {relatedError && <p className="af-state" role="status">Related titles could not load. <button className="af-text-link" type="button" onClick={() => setRelatedAttempt(value => value + 1)}>Retry related titles</button></p>}
      {related.length > 0 && <div id="related" tabIndex={-1}><Shelf title={type === 'tv' ? 'Related series' : 'Related films'}>
        {related.map(other => <MediaCard item={other} controls={controls} key={other.key} />)}
      </Shelf></div>}
    </div>
  </>;
}
