import { isAnime } from '@afterframe/shared/discover';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  episodeKey, episodeLabel, episodePosition, formatDate, imagePath, isAired, normalizeTitle,
  normalizeTitles, playHref, previousBrowse, request, timeCode, today, type CatalogRating, type Details as TitleDetails,
  type Episode, type MediaType, type Title, type TitleResults,
} from './catalog';
import { ActionLink, Artwork, HeroBackdrop, Icon, Loading, MediaCard, MutationStatus, RatingProblem, SaveButton, Score, Shelf, useOptionalRating } from './components';
import { effectiveWatchStatus, getSeason, progressPercent, resumeFor, savedRating, watchStatuses, type Library, type LibraryControls, type WatchStatus } from './library';
import { FolderPickerPopover } from './library/FolderPickerPopover';
import { currentSearchParams } from './router';
import { AfSelect } from './UiControls';

function personInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts[parts.length - 1][0]}`).toUpperCase();
}

const episodeRangeSize = 15;
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

function goToSection(id: string) {
  const section = document.getElementById(id);
  section?.focus({ preventScroll: true });
  section?.scrollIntoView({ block: 'start' });
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

function EpisodeRow({ item, episode, controls }: { item: Title; episode: Episode; controls: LibraryControls }) {
  const key = episodeKey(item, episode);
  const marked = Boolean(controls.library.watched[key]);
  const protect = !marked && controls.library.preferences.blur !== false;
  const [revealed, setRevealed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const image = imagePath(episode.still_path, 'w300');
  const available = isAired(episode);
  const progress = !marked ? controls.library.progress[key] : undefined;
  const runtimeLabel = episodeDurationText(key, episode.runtime, controls.library);
  const status = [episodeLabel(episode), runtimeLabel, !available && episode.air_date ? `Airs ${formatDate(episode.air_date)}` : ''].filter(Boolean).join(' · ');
  const showPreview = marked || controls.library.preferences.hideSynopsis === false;
  return <article className="af-episode">
    {image && protect ? <button type="button" className="af-still" aria-label={`${revealed ? 'Hide' : 'Reveal'} thumbnail for ${episode.name}`}
      aria-pressed={revealed} onClick={() => setRevealed(value => !value)}>
      <Artwork src={image} className={revealed ? undefined : 'af-blurred'} loading="lazy" fallback={<Icon name="film" />} /><span className="af-eye"><Icon name="eye" /><span>{revealed ? 'Hide' : 'Reveal'}</span></span>
    </button> : <span className="af-still"><Artwork src={image} loading="lazy" fallback={<Icon name="film" />} /></span>}
    <div className="af-episode-copy">
      {available ? <a className="af-episode-title" href={playHref(item, episodePosition(episode))}>{episode.name}</a>
        : <span className="af-episode-title af-upcoming">{episode.name}</span>}
      <p className="af-meta">{status}</p>
      {episode.overview && <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
        <summary>{expanded ? 'Hide description' : showPreview ? <span className="af-synopsis-preview">{episode.overview}</span> : 'Show description'}</summary>
        <p>{episode.overview}</p>
      </details>}
      {progress && progress.time > 5 && progress.time < progress.duration && <div className="af-episode-progress">
        <span>{controls.library.preferences.resume !== false ? 'Resume at' : 'Last position'} {timeCode(progress.time)}</span>
        <progress className="af-progress" value={progressPercent(progress)} max={100} aria-label={`${episode.name} watched progress`} />
      </div>}
    </div>
    <button type="button" className="af-icon-button af-watched" aria-label={`${marked ? 'Watched' : 'Mark watched'}: ${episode.name}`} aria-pressed={marked}
      disabled={!controls.ready || controls.isPending(key)} onClick={() => { if (marked) setRevealed(false); void controls.toggleWatched(item, key); }}>
      <span>{marked && <Icon name="check" />}</span><small>{marked ? 'Watched' : 'Mark watched'}</small>
    </button>
    <MutationStatus itemKey={key} controls={controls} />
  </article>;
}

function Episodes({ item, seasons, initialSeason, controls, readSeason }: {
  item: Title; seasons: NonNullable<TitleDetails['seasons']>; initialSeason: number | undefined;
  controls: LibraryControls; readSeason: (season: number) => Promise<Episode[]>;
}) {
  const [selected, setSelected] = useState<number>();
  const season = selected ?? initialSeason ?? seasons[0]?.season_number;
  const [results, setResults] = useState<{ season: number; episodes: Episode[] }>();
  const [error, setError] = useState('');
  const [range, setRange] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (season == null) return;
    let active = true;
    readSeason(season).then(episodes => {
      if (active) setResults({ season, episodes });
    }).catch(problem => { if (active) setError(problem.message); });
    return () => { active = false; };
  }, [season, readSeason, attempt]);

  const episodes = results?.season === season ? (results?.episodes ?? []) : [];
  const aired = episodes.filter(isAired);
  const watched = aired.filter(episode => controls.library.watched[episodeKey(item, episode)]).length;
  const count = Math.ceil(episodes.length / episodeRangeSize);
  const currentRange = Math.min(range, Math.max(0, count - 1));
  const rangeStart = currentRange * episodeRangeSize;
  return <section id="episodes" className="af-section" tabIndex={-1} aria-labelledby="episodes-heading">
    <header className="af-section-head">
      <div><h2 id="episodes-heading">Episodes</h2>{aired.length > 0 && <p className="af-meta">{watched} of {aired.length} aired episodes watched</p>}</div>
      <div className="af-episode-pickers">
        {season != null && <AfSelect
          ariaLabel="Select season"
          value={String(season)}
          options={seasons.map(option => ({ value: String(option.season_number), label: option.name }))}
          onChange={value => { setSelected(Number(value)); setRange(0); setError(''); }}
        />}
        {count > 1 && <AfSelect
          ariaLabel="Episode range"
          value={String(currentRange)}
          options={Array.from({ length: count }, (_, index) => {
            const first = episodes[index * episodeRangeSize].episode_number;
            const last = episodes[Math.min(episodes.length, (index + 1) * episodeRangeSize) - 1].episode_number;
            return { value: String(index), label: `Episodes ${first}${first === last ? '' : `–${last}`}` };
          })}
          onChange={value => setRange(Number(value))}
        />}
      </div>
    </header>
    {season == null ? <p className="af-state">No seasons are listed.</p> : error ? <p className="af-state" role="alert">{error} <button className="af-text-link" type="button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry</button></p>
      : results?.season !== season ? <Loading label="Loading episodes…" shape="rows" />
      : episodes.length === 0 ? <p className="af-state">No episodes are listed for this season.</p>
      : <div className={`af-episode-grid ${controls.library.preferences.compact ? 'af-compact' : ''}`}>
        {episodes.slice(rangeStart, rangeStart + episodeRangeSize).map(episode => <EpisodeRow key={episodeKey(item, episode)} item={item} episode={episode} controls={controls} />)}
      </div>}
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
  const seasonCache = useRef(new Map<number, Promise<Episode[]>>());

  useEffect(() => {
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

  const seasons = useMemo(() => (details?.seasons ?? []).filter(entry => entry.episode_count > 0 && entry.season_number >= 0), [details]);
  const regular = useMemo(() => {
    const list = seasons.filter(entry => entry.season_number > 0);
    return list.length ? list : seasons;
  }, [seasons]);
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
    <a className="af-text-link" href={previousBrowse(type === 'movie' ? 'movies' : 'tv')}><Icon name="left" /> Back to browse</a>
    {error ? <div className="af-state" role="alert"><h1>Title unavailable</h1><p>{error}</p>
      <button className="af-text-link" type="button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry</button></div>
      : <Loading label="Loading title…" shape="hero" />}
  </div>;

  const cast = details.credits?.cast?.slice(0, 8) ?? [];
  const crew = details.credits?.crew?.filter(person => ['Director', 'Writer', 'Screenplay', 'Director of Photography', 'Original Music Composer', 'Editor'].includes(person.job)).slice(0, 10) ?? [];
  const directors = [...new Set(crew.filter(person => person.job === 'Director').map(person => person.name))];
  const creators = details.created_by?.map(person => person.name) ?? [];
  const credit = directors.length ? `Directed by ${directors.join(', ')}` : creators.length ? `Created by ${creators.join(', ')}` : '';
  const genres = details.genres?.slice(0, 3).map(genre => genre.name).join(' · ') || item.genre;
  const scheduling = type === 'tv' ? upcoming(details) : '';
  const status = ({ 'Returning Series': 'Ongoing', Ended: 'Ended', Canceled: 'Canceled', 'In Production': 'In production', Planned: 'Planned', Pilot: 'Pilot' } as Record<string, string>)[details.status ?? ''];
  const facts = [formatDate(item.date) || item.year,
    type === 'tv' ? details.number_of_seasons ? `${details.number_of_seasons} ${details.number_of_seasons === 1 ? 'season' : 'seasons'}` : '' : item.duration ? `${item.duration} min` : '',
    type === 'tv' ? status : '', genres].filter(Boolean);
  const count = Object.keys(watched).filter(key => key.startsWith(`${item.key}/cinesrc-s`) && !key.startsWith(`${item.key}/cinesrc-s0e`)).length;
  const resumeEpisode = resume?.episode;
  const startingEpisode = resumeEpisode ?? (selection ? episodePosition(selection.episode) : undefined);
  const playLabel = resumeEpisode ? `Resume S${resumeEpisode.season} E${resumeEpisode.number}`
    : selection ? selection.replay ? 'Watch again' : `Play ${episodeLabel(selection.episode)}`
    : regular.length > 0 ? 'Play S1 E1' : 'Choose an episode';
  const requestedSeason = Number(currentSearchParams().get('season'));
  const initialSeason = Number.isInteger(requestedSeason) && seasons.some(entry => entry.season_number === requestedSeason)
    ? requestedSeason
    : resumeEpisode && seasons.some(entry => entry.season_number === resumeEpisode.season)
      ? resumeEpisode.season : regular[0]?.season_number;
  const saved = controls.library.saved[item.key];
  const marked = Boolean(watched[item.key]);
  const nextEpisodeData = !resumeEpisode ? selection?.episode : undefined;
  const nextStill = nextEpisodeData?.still_path ? imagePath(nextEpisodeData.still_path, 'w300') : undefined;
  const nextBlurred = Boolean(nextStill && controls.library.preferences.blur !== false && !(nextEpisodeData && watched[episodeKey(item, nextEpisodeData)]));
  const resumeRemaining = resume && resume.duration > resume.time
    ? Math.max(1, Math.ceil((resume.duration - resume.time) / 60))
    : 0;
  return <>
    <section className={`af-hero af-details-hero ${item.backdrop ? '' : 'af-no-backdrop'}`}>
      {item.backdrop && <HeroBackdrop src={item.backdrop} sizes="(max-width: 680px) 100vw, 86vw" />}
      <div className="af-wrap af-hero-inner">
        <a className="af-text-link af-back" href={previousBrowse(type === 'movie' ? 'movies' : 'tv')}><Icon name="left" /> Back to browse</a>
        <div className="af-details-main">
          {!item.backdrop && item.poster && <Artwork className="af-fallback-poster" src={item.poster} fallback={<span className="af-fallback-poster af-art-fallback"><Icon name="film" /></span>} />}
          <div className="af-copy">
            <h1>{item.title}</h1>
            <div className="af-meta af-details-meta af-title-facts">
              <span>{type === 'tv' ? 'TV series' : 'Movie'}</span>
              {facts.map(fact => <span key={fact}>{fact}</span>)}
              <Score rating={imdb.value ?? item.rating} mal={mal.value} />
            </div>
            <RatingProblem name="IMDb" rating={imdb} /><RatingProblem name="MyAnimeList" rating={mal} />
            {item.description && <p className="af-overview">{item.description}</p>}
            {credit && <p className="af-meta">{credit}</p>}
            <div className="af-actions">
              {type === 'tv' ? startingEpisode ? <ActionLink primary href={playHref(item, startingEpisode)}><Icon name="play" />{playLabel}</ActionLink>
                : <button type="button" className="af-button af-primary" onClick={() => goToSection('episodes')}><Icon name="play" />{playLabel}</button>
                : (!item.date || item.date <= today() || resume) && <ActionLink primary href={playHref(item)}><Icon name="play" />{resume ? 'Resume' : 'Play'}</ActionLink>}
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
            </div>
            {type === 'tv' && item.totalEpisodes ? <p className="af-meta" aria-live="polite">{count} of {item.totalEpisodes} episodes watched{resume ? ` · Resume at ${timeCode(resume.time)}` : ''}</p> : null}
            {scheduling && <p className="af-schedule">{scheduling}</p>}
          </div>
        </div>
        <div className="af-details-footer">
          <div className="af-rating">
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
      </div>
    </section>
    <div className="af-wrap af-content">
      {type === 'tv' && startingEpisode && <section className="af-next-up" aria-label={resumeEpisode ? 'Continue watching' : 'Up next'}>
        {(nextStill || item.backdrop) && <a className="af-next-up-art" href={playHref(item, startingEpisode)} tabIndex={-1} aria-hidden="true">
          <Artwork src={nextStill || item.backdrop} className={nextBlurred ? 'af-blurred' : undefined} loading="lazy" fallback={<Icon name="film" />} />
          <span className="af-resume-icon"><Icon name="play" /></span>
          {resume && <progress className="af-progress af-card-progress" value={progressPercent(resume)} max={100} aria-hidden="true" />}
        </a>}
        <div className="af-next-up-copy">
          <h2>{resumeEpisode ? `Continue · S${resumeEpisode.season} E${resumeEpisode.number}` : selection?.replay ? 'Watch again from S1 E1' : `Next up · S${startingEpisode.season} E${startingEpisode.number}`}</h2>
          <p className="af-next-up-title">{startingEpisode.title || `Episode ${startingEpisode.number}`}</p>
          <p className="af-meta">
            {resume && resumeRemaining > 0
              ? `Resume at ${timeCode(resume.time)} · ${resumeRemaining} min left`
              : nextEpisodeData?.runtime
                ? `${nextEpisodeData.runtime} min`
                : item.totalEpisodes ? `${count} of ${item.totalEpisodes} episodes watched` : 'Ready to play'}
          </p>
        </div>
        <div className="af-actions">
          <ActionLink primary href={playHref(item, startingEpisode)}><Icon name="play" />{playLabel}</ActionLink>
        </div>
      </section>}
      {type === 'tv' && <Episodes item={item} seasons={seasons} initialSeason={initialSeason} controls={controls} readSeason={readSeason} />}
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
      {related.length > 0 && <div id="related"  tabIndex={-1}><Shelf title={type === 'tv' ? 'Related series' : 'Related films'}>
        {related.map(other => <MediaCard item={other} controls={controls} key={other.key} />)}
      </Shelf></div>}
    </div>
  </>;
}
