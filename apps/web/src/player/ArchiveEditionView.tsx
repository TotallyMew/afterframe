import type { ArchiveTitle } from '@afterframe/shared/catalog';
import { useMemo } from 'react';
import { playerHref, timeCode } from '../catalog';
import { ActionLink, Artwork, HeroBackdrop, Icon, SaveButton } from '../components';
import { progressPercent, resumeFor, savedRating, watchStatuses, type LibraryControls, type WatchStatus } from '../library';
import { archiveToTitle } from './route';

export function ArchiveEditionView({ entry, backHref, controls }: { entry: ArchiveTitle; backHref: string; controls: LibraryControls }) {
  const item = useMemo(() => archiveToTitle(entry), [entry]);
  const saved = controls.library.saved[item.key];
  const marked = Boolean(controls.library.watched[item.key]);
  const resumed = controls.library.preferences.resume !== false ? resumeFor(controls.library, item) : undefined;
  const source = entry.media || entry.episodes?.[0]?.media;
  const sourcePage = source?.page || (source?.archive ? `https://archive.org/details/${encodeURIComponent(source.archive)}` : '');

  return <>
    <section className={`af-hero af-details-hero ${item.backdrop ? '' : 'af-no-backdrop'}`}>
      {item.backdrop && <HeroBackdrop src={item.backdrop} sizes="(max-width: 680px) 100vw, 86vw" />}
      <div className="af-wrap af-hero-inner">
        <a className="af-text-link af-back" href={backHref}><Icon name="left" /> Back to browse</a>
        <div className="af-details-main">
          {!item.backdrop && item.poster && <Artwork className="af-fallback-poster" src={item.poster} fallback={<span className="af-fallback-poster af-art-fallback"><Icon name="film" /></span>} />}
          <div className="af-copy">
            <h1>{item.title}</h1>
            <div className="af-meta af-details-meta af-title-facts">
              <span>{item.type === 'tv' ? 'TV series' : 'Movie'}</span>
              {item.year && <span>{item.year}</span>}
              {item.duration && <span>{item.duration} min</span>}
              {item.genre && <span>{item.genre}</span>}
            </div>
            {item.description && <p className="af-overview">{item.description}</p>}
            {entry.credit && <p className="af-meta">{entry.credit}</p>}
            <div className="af-actions">
              <ActionLink primary href={playerHref(`edition/${encodeURIComponent(entry.key)}/watch`, backHref)}>
                <Icon name="play" />{resumed ? 'Resume' : 'Play'}
              </ActionLink>
              <SaveButton item={item} controls={controls} />
              {saved && <select className="af-select" aria-label="Watch plan" value={saved.watchStatus ?? 'planned'} disabled={!controls.ready || controls.isPending(item.key)}
                onChange={event => void controls.setStatus(item, event.target.value as WatchStatus, { id: item.id }, entry.episodes?.map(ep => ep.key))}>
                {Object.entries(watchStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>}
              {item.type === 'movie' && <button type="button" className="af-button af-secondary" disabled={!controls.ready || controls.isPending(item.key)}
                aria-pressed={marked} onClick={() => void controls.toggleWatched(item)}>{marked ? <><Icon name="check" />Watched</> : 'Mark watched'}</button>}
            </div>
          </div>
        </div>
        <div className="af-details-footer">
          <div className="af-watch-source">
            {sourcePage && <a href={sourcePage} target="_blank" rel="noopener noreferrer">{source?.source || 'Internet Archive'}</a>}
            {entry.license && <a href={entry.license[1]} target="_blank" rel="noopener noreferrer">{entry.license[0]}</a>}
          </div>
          <label className="af-rating">Your rating
            <select className="af-select" value={savedRating(controls.library.ratings[item.key])} disabled={!controls.ready || controls.isPending(item.key)}
              onChange={event => void controls.rate(item, Number(event.target.value))}>
              <option value={0}>Choose 1–10</option>
              {Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
            </select>
          </label>
        </div>
      </div>
    </section>
    {entry.episodes && <div className="af-wrap af-content">
      <section className="af-section" aria-label="Episodes">
        <header className="af-section-head"><h2>Episodes</h2></header>
        <div className={`af-episode-grid ${controls.library.preferences.compact ? 'af-compact' : ''}`}>
          {entry.episodes.map(ep => {
            const epKey = `${entry.key}/${ep.key}`;
            const epMarked = Boolean(controls.library.watched[epKey]);
            const epProgress = !epMarked ? controls.library.progress[epKey] : undefined;
            return <article className="af-episode af-episode-archive" key={ep.key}>
              <div className="af-episode-copy">
                <a className="af-episode-title" href={playerHref(`edition/${encodeURIComponent(entry.key)}/watch/${encodeURIComponent(ep.key)}`, backHref)}>{ep.title}</a>
                <p className="af-meta">{[ep.number ? `Episode ${ep.number}` : '', ep.duration ? `${ep.duration} min` : ''].filter(Boolean).join(' · ')}</p>
                {epProgress && epProgress.time > 5 && epProgress.time < epProgress.duration && <div className="af-episode-progress">
                  <span>{controls.library.preferences.resume !== false ? 'Resume at' : 'Last position'} {timeCode(epProgress.time)}</span>
                  <progress className="af-progress" value={progressPercent(epProgress)} max={100} aria-label={`${ep.title} watched progress`} />
                </div>}
              </div>
              <button type="button" className="af-icon-button af-watched" aria-pressed={epMarked}
                aria-label={`${epMarked ? 'Watched' : 'Mark watched'}: ${ep.title}`}
                disabled={!controls.ready || controls.isPending(epKey)}
                onClick={() => void controls.toggleWatched(item, epKey)}>
                <span>{epMarked && <Icon name="check" />}</span><small>{epMarked ? 'Watched' : 'Mark watched'}</small>
              </button>
            </article>;
          })}
        </div>
      </section>
    </div>}
  </>;
}
