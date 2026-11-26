import { useState } from 'react';
import {
  episodeKey, episodePosition, formatDate, imagePath, isAired, playerHref, timeCode,
  type Episode, type Title,
} from '../catalog';
import { Artwork, Icon, MutationStatus } from '../components';
import { progressPercent, type LibraryControls } from '../library';

export function PlayerEpisodeRow({
  item, episode, current, backHref, controls,
}: {
  item: Title;
  episode: Episode;
  current: boolean;
  backHref?: string;
  controls: LibraryControls;
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
  const knownSec = controls.library.progress[key]?.duration
    || Object.values(controls.library.history).find(entry => entry.mediaKey === key && entry.duration > 0)?.duration;
  const runtimeLabel = knownSec && knownSec > 0 ? `${Math.max(1, Math.round(knownSec / 60))} min` : episode.runtime ? `~${episode.runtime} min` : '';
  const status = [`Episode ${episode.episode_number}`, runtimeLabel, !available && episode.air_date ? `Airs ${formatDate(episode.air_date)}` : ''].filter(Boolean).join(' · ');
  const showPreview = marked || controls.library.preferences.hideSynopsis === false;
  const pos = episodePosition(episode);
  const href = playerHref(`${item.type}/${item.id}/s${pos.season}e${pos.number}`, backHref);

  return <article className={`af-episode af-episode-card ${current ? 'is-current' : ''} ${marked ? 'is-watched' : ''}`} aria-current={current ? 'true' : undefined}>
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
          {current && <span className="af-ep-state-tag">Now playing</span>}
          <span className="af-meta af-tabular">{status}</span>
        </div>
        <button type="button" className="af-icon-button af-watched af-watched-inline" aria-pressed={marked}
          aria-label={`${marked ? 'Watched' : 'Mark watched'}: ${episode.name}`}
          disabled={!controls.ready || controls.isPending(key)}
          onClick={() => { if (marked) setRevealed(false); void controls.toggleWatched(item, key); }}>
          <span>{marked && <Icon name="check" />}</span>
        </button>
      </div>
      {available
        ? <a className="af-episode-title" href={href}>{episode.name}</a>
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
