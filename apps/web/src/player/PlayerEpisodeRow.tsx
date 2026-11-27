import { useState } from 'react';
import {
  episodeKey, episodePosition, formatDate, imagePath, isAired, playerHref, timeCode,
  type Episode, type Title,
} from '../catalog';
import { Artwork, Icon, MutationStatus } from '../components';
import { progressPercent, type LibraryControls } from '../library';

function formatEpisodeRuntime(knownSec: number | undefined, runtime: number | undefined): string {
  if (knownSec && knownSec > 0) return `${Math.max(1, Math.round(knownSec / 60))} min`;
  if (runtime) return `~${runtime} min`;
  return '';
}

function resolveEpisodeDurationSec(library: LibraryControls['library'], key: string, historyDurationSec?: number): number | undefined {
  const progressDur = library.progress[key]?.duration;
  if (progressDur) return progressDur;
  if (historyDurationSec) return historyDurationSec;
  return Object.values(library.history).find(entry => entry.mediaKey === key && entry.duration > 0)?.duration;
}

function formatEpisodeStatus(episode: Episode, runtimeLabel: string, available: boolean): string {
  const airNote = !available && episode.air_date ? `Airs ${formatDate(episode.air_date)}` : '';
  return [`Episode ${episode.episode_number}`, runtimeLabel, airNote].filter(Boolean).join(' · ');
}

function synopsisSummaryContent(expanded: boolean, showPreview: boolean, overview: string) {
  if (expanded) return 'Hide description';
  if (showPreview) return <span className="af-synopsis-preview">{overview}</span>;
  return 'Show description';
}

function EpisodeThumbnail({
  image, protect, revealed, available, href, episodeName, onToggleReveal,
}: Readonly<{
  image?: string;
  protect: boolean;
  revealed: boolean;
  available: boolean;
  href: string;
  episodeName: string;
  onToggleReveal: () => void;
}>) {
  const fallback = <span className="af-still-fallback" aria-hidden="true"><Icon name="film" /></span>;
  if (image && protect) {
    return (
      <button type="button" className="af-still" aria-label={`Reveal thumbnail for ${episodeName}`}
        aria-pressed={revealed} onClick={onToggleReveal}>
        <Artwork src={image} className={revealed ? undefined : 'af-blurred'} loading="lazy" fallback={fallback} />
        <span className="af-eye"><Icon name="eye" /><span>{revealed ? 'Hide' : 'Reveal'}</span></span>
      </button>
    );
  }
  if (available) {
    return (
      <a className="af-still af-still-link" href={href} tabIndex={-1} aria-hidden="true">
        <Artwork src={image} loading="lazy" fallback={fallback} />
        <span className="af-still-play"><Icon name="play" /></span>
      </a>
    );
  }
  return <span className="af-still"><Artwork src={image} loading="lazy" fallback={fallback} /></span>;
}

export function PlayerEpisodeRow({
  item, episode, current, backHref, controls, historyDurationSec,
}: Readonly<{
  item: Title;
  episode: Episode;
  current: boolean;
  backHref?: string;
  controls: LibraryControls;
  historyDurationSec?: number;
}>) {
  const key = episodeKey(item, episode);
  const marked = Boolean(controls.library.watched[key]);
  const protect = !marked && controls.library.preferences.blur !== false;
  const [revealed, setRevealed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const image = imagePath(episode.still_path, 'w300');
  const available = isAired(episode);
  const progress = marked ? undefined : controls.library.progress[key];
  const activeProgress = progress && progress.time > 5 && progress.time < progress.duration ? progress : undefined;
  const knownSec = resolveEpisodeDurationSec(controls.library, key, historyDurationSec);
  const status = formatEpisodeStatus(episode, formatEpisodeRuntime(knownSec, episode.runtime), available);
  const showPreview = marked || controls.library.preferences.hideSynopsis === false;
  const pos = episodePosition(episode);
  const href = playerHref(`${item.type}/${item.id}/s${pos.season}e${pos.number}`, backHref);
  const resumePrefix = controls.library.preferences.resume !== false ? 'Resume at' : 'Last position';

  const handleToggleWatched = () => {
    if (marked) {
      setRevealed(false);
    }
    void controls.toggleWatched(item, key);
  };

  return <article className={`af-episode af-episode-card ${current ? 'is-current' : ''} ${marked ? 'is-watched' : ''}`} aria-current={current ? 'true' : undefined}>
    <div className="af-episode-media">
      <EpisodeThumbnail
        image={image}
        protect={protect}
        revealed={revealed}
        available={available}
        href={href}
        episodeName={episode.name}
        onToggleReveal={() => setRevealed(value => !value)}
      />
      <span className="af-ep-code af-tabular" aria-hidden="true">E{episode.episode_number}</span>
      {activeProgress && (
        <progress className="af-progress af-still-progress" value={progressPercent(activeProgress)} max={100} aria-hidden="true" />
      )}
    </div>
    <div className="af-episode-copy">
      <div className="af-episode-top">
        <div className="af-episode-meta-row">
          {current && <span className="af-ep-state-tag">Now playing</span>}
          <span className="af-meta af-tabular">{status}</span>
        </div>
        <button type="button" className="af-icon-button af-watched af-watched-inline" aria-pressed={marked}
          aria-label={`Mark ${episode.name} watched`}
          disabled={!controls.ready || controls.isPending(key)}
          onClick={handleToggleWatched}>
          <span>{marked && <Icon name="check" />}</span>
        </button>
      </div>
      {available
        ? <a className="af-episode-title" href={href}>{episode.name}</a>
        : <span className="af-episode-title af-upcoming">{episode.name}</span>}
      {episode.overview && <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
        <summary>{synopsisSummaryContent(expanded, showPreview, episode.overview)}</summary>
        <p>{episode.overview}</p>
      </details>}
      {activeProgress && <p className="af-meta af-tabular af-episode-resume-note">
        {resumePrefix} {timeCode(activeProgress.time)}
      </p>}
      <MutationStatus itemKey={key} controls={controls} />
    </div>
  </article>;
}
