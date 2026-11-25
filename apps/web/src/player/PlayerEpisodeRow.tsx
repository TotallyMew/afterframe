import { useState } from 'react';
import {
  episodeKey, episodeLabel, episodePosition, formatDate, imagePath, isAired, playHref, timeCode,
  type Episode, type Title,
} from '../catalog';
import { Artwork, Icon, MutationStatus } from '../components';
import { progressPercent, type LibraryControls } from '../library';

export function PlayerEpisodeRow({
  item, episode, current, controls,
}: {
  item: Title;
  episode: Episode;
  current: boolean;
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
  const status = [episodeLabel(episode), episode.runtime ? `${episode.runtime} min` : '', !available && episode.air_date ? `Airs ${formatDate(episode.air_date)}` : ''].filter(Boolean).join(' · ');
  const showPreview = marked || controls.library.preferences.hideSynopsis === false;

  return <article className="af-episode" aria-current={current ? 'true' : undefined}>
    {image && protect ? <button type="button" className="af-still" aria-label={`${revealed ? 'Hide' : 'Reveal'} thumbnail for ${episode.name}`}
      aria-pressed={revealed} onClick={() => setRevealed(value => !value)}>
      <Artwork src={image} className={revealed ? undefined : 'af-blurred'} loading="lazy" fallback={<Icon name="film" />} />
      <span className="af-eye"><Icon name="eye" /><span>{revealed ? 'Hide' : 'Reveal'}</span></span>
    </button> : <span className="af-still"><Artwork src={image} loading="lazy" fallback={<Icon name="film" />} /></span>}
    <div className="af-episode-copy">
      {available
        ? <a className="af-episode-title" href={playHref(item, episodePosition(episode))}>{episode.name}{current && <span className="af-meta"> (Playing)</span>}</a>
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
    <button type="button" className="af-icon-button af-watched" aria-pressed={marked}
      aria-label={`${marked ? 'Watched' : 'Mark watched'}: ${episode.name}`}
      disabled={!controls.ready || controls.isPending(key)}
      onClick={() => { if (marked) setRevealed(false); void controls.toggleWatched(item, key); }}>
      <span>{marked && <Icon name="check" />}</span><small>{marked ? 'Watched' : 'Mark watched'}</small>
    </button>
    <MutationStatus itemKey={key} controls={controls} />
  </article>;
}
