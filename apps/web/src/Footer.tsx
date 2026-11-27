import { webHref } from './catalog';
import { useSettings } from './settings-context';

export function Footer({ onOpenShortcuts }: Readonly<{ onOpenShortcuts: () => void }>) {
  const openSettings = useSettings();
  return <footer className="af-footer">
    <div className="af-wrap af-footer-inner">
      <div className="af-footer-brand">
        <a className="af-brand af-footer-wordmark" href={webHref('home')}>
          <img src="/art/favicon.svg" alt="" width={20} height={20} />afterframe
        </a>
        <p className="af-meta">
          Catalog powered by <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">TMDB</a>,{' '}
          <a href="https://mangadex.org/" target="_blank" rel="noopener noreferrer">MangaDex</a>,{' '}
          <a href="https://archive.org/" target="_blank" rel="noopener noreferrer">Internet Archive</a>,{' '}
          <a href="https://skipdb.tv/" target="_blank" rel="noopener noreferrer">SkipDB</a>,{' '}
          <a href="https://introdb.app/" target="_blank" rel="noopener noreferrer">IntroDB</a>,{' '}
          <a href="https://theintrodb.org/" target="_blank" rel="noopener noreferrer">TheIntroDB</a>, and{' '}
          <a href="https://aniskip.com/" target="_blank" rel="noopener noreferrer">AniSkip</a>.
        </p>
      </div>
      <nav className="af-footer-links" aria-label="Footer">
        <a className="af-text-link" href={webHref('movies')}>Movies</a>
        <a className="af-text-link" href={webHref('tv')}>TV Shows</a>
        <a className="af-text-link" href={webHref('comics')}>Manga</a>
        <a className="af-text-link" href={webHref('watchlist')}>Library</a>
        <button type="button" className="af-text-link" onClick={event => openSettings('general', event.currentTarget)}>Settings</button>
        <button type="button" className="af-text-link" onClick={onOpenShortcuts}>
          Shortcuts <kbd className="af-kbd">?</kbd>
        </button>
      </nav>
    </div>
  </footer>;
}
