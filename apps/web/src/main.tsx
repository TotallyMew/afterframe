import { Component, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { comicChapterIdSource, comicIdSource } from '../../../afterframe/public/comic-ids.js';
import { AccountButton, AccountProvider, useAccountDialog } from './Account';
import { playerHref, rememberRoute, type MediaType } from './catalog';
import { Catalogue } from './Catalogue';
import { ComicDetailsPage, ComicsPage } from './Comics';
import { ComicReader } from './ComicReader';
import { Header } from './components';
import { DetailsPage } from './Details';
import { AnimePage, RecommendationsPage } from './Discovery';
import { Home } from './Home';
import { LibraryPage } from './LibraryPage';
import { SettingsProvider } from './Settings';
import { useSettings } from './settings-context';
import { useLibrary } from './library';
import './styles.css';

const comicPath = new RegExp(`^comic/(${comicIdSource})$`, 'i');
const readerPath = new RegExp(`^comic/(${comicIdSource})/read/(${comicChapterIdSource})$`, 'i');
const mediaPath = /^(?:(?:movie|tv)\/[1-9]\d{0,9}\/(?:watch|s\d{1,4}e[1-9]\d{0,3})|edition\/[\w.-]+(?:\/watch(?:\/[\w.-]+)?)?)$/;
const { panel: entryPanel, returnTo: entryReturn } = normalizeEntry();

function normalizeEntry() {
  const url = new URL(window.location.href);
  const wasLegacy = /^\/legacy\/?$/.test(url.pathname);
  const panel = url.searchParams.get('panel');
  const hasPanel = panel === 'settings' || panel === 'integrations' || panel === 'account';
  const requested = url.searchParams.get('return');
  const returnTo = requested && /^\/#(?:home|movies|tv|new|anime|comics|search|watchlist|watched|ratings|reading|history|notifications|recommendations|movie\/|comic\/)(?:[\w/?&=%.#-]*)$/i.test(requested)
    ? requested.slice(1) : '';
  if (hasPanel || wasLegacy || returnTo) {
    url.pathname = '/';
    if (hasPanel) {
      url.searchParams.delete('panel');
      url.searchParams.delete('return');
      if (returnTo) url.hash = returnTo;
    } else if (returnTo) {
      const [path, query = ''] = url.hash.slice(1).split('?', 2);
      if (readerPath.test(path)) {
        const params = new URLSearchParams(query);
        const [prior, priorQuery = ''] = returnTo.split('?', 2);
        const back = comicPath.test(prior.slice(1)) ? new URLSearchParams(priorQuery).get('back') : returnTo;
        if (back && !params.has('back')) params.set('back', back);
        url.hash = `${path}?${params}`;
      }
      url.searchParams.delete('return');
    }
    window.history.replaceState(null, '', url);
  }
  return { panel: hasPanel ? panel : null, returnTo };
}

function OpenEntryPanel() {
  const openAccount = useAccountDialog();
  const openSettings = useSettings();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (entryPanel === 'account') openAccount(null);
    else if (entryPanel) openSettings(entryPanel === 'integrations' ? 'integrations' : 'general', null);
  }, [openAccount, openSettings]);
  return null;
}

const routeSnapshot = () => window.location.hash.replace(/^#\/?/, '') || 'home';
function subscribeRoute(notify: () => void) {
  window.addEventListener('hashchange', notify);
  return () => window.removeEventListener('hashchange', notify);
}

class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="af-wrap af-directory"><h1 tabIndex={-1}>This page could not load</h1>
      <p role="alert">Afterframe could not display this page.</p>
      <button className="af-button af-secondary" type="button" onClick={() => this.setState({ failed: false })}>Retry</button>
    </section>;
  }
}

function restoreRoute(path: string, focusOnEntry: boolean) {
  let view: { y: number; focus?: string } | undefined;
  try {
    const key = `afterframe.view:#${path}`;
    view = JSON.parse(sessionStorage.getItem(key) ?? 'null') ?? undefined;
    sessionStorage.removeItem(key);
  } catch { /* Restore the page heading when storage is unavailable. */ }

  if (!view && !focusOnEntry) return;
  const main = document.getElementById('main');
  if (!main) return;
  const controller = new AbortController();
  const focusHeading = () => {
    const heading = main.querySelector<HTMLElement>('h1') ?? main;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  };
  const restore = () => {
    if (view) {
      const wanted = view.focus;
      const target = wanted && Array.from(document.querySelectorAll<HTMLElement>('a[href], button[aria-label]'))
        .find(node => node.getClientRects().length && (node.getAttribute('href') === wanted || node.getAttribute('aria-label') === wanted));
      if (target && (view.y === 0 || document.documentElement.scrollHeight >= view.y + innerHeight - 1)) {
        target.focus({ preventScroll: true });
        window.scrollTo(0, view.y);
        return true;
      }
      if (!wanted && (view.y === 0 || document.documentElement.scrollHeight >= view.y + innerHeight - 1)) {
        window.scrollTo(0, view.y);
        focusHeading();
        return true;
      }
      return false;
    }
    if (main.querySelector('[data-route-loading]')) return false;
    focusHeading();
    return true;
  };
  window.scrollTo(0, 0);
  if (restore()) return;
  const observer = new MutationObserver(() => { if (restore()) controller.abort(); });
  observer.observe(main, { childList: true, subtree: true });
  const timeout = window.setTimeout(() => {
    if (view) window.scrollTo(0, view.y);
    focusHeading();
    controller.abort();
  }, 31_000);
  controller.signal.addEventListener('abort', () => { observer.disconnect(); clearTimeout(timeout); }, { once: true });
  // A user who starts navigating the new page takes ownership of focus.
  for (const event of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(event, () => controller.abort(), { once: true, passive: true, signal: controller.signal });
  }
  return () => controller.abort();
}

function App() {
  const route = useSyncExternalStore(subscribeRoute, routeSnapshot);
  const [path, query = ''] = route.split('?', 2);
  const title = path.match(/^(movie|tv)\/([1-9]\d{0,9})$/);
  const comic = path.match(comicPath);
  const reader = path.match(readerPath);
  const playback = mediaPath.test(path);
  const home = path === 'home' || path === 'main';
  const catalogue = ['movies', 'tv', 'new'].includes(path) || path.startsWith('search=');
  const library = ['watchlist', 'watched', 'ratings', 'reading', 'history', 'notifications'].includes(path);
  const controls = useLibrary();
  const comicRoute = Boolean(comic || reader);
  const oldPath = useRef('');
  useEffect(() => {
    if (playback) {
      const back = entryReturn || (path.startsWith('edition/') ? '#home' : `#${path.split('/', 2).join('/')}`);
      window.location.replace(playerHref(path, back));
      return;
    }
    const localChapterChange = comicRoute && oldPath.current === path;
    const focusOnEntry = path !== 'home' || Boolean(oldPath.current && oldPath.current !== path);
    oldPath.current = path;
    if (path !== 'main' && !localChapterChange) return restoreRoute(route, focusOnEntry);
  }, [route, path, playback, comicRoute]);
  useEffect(() => { document.documentElement.classList.toggle('reduce-motion', controls.library.preferences.reducedMotion === true); }, [controls.library.preferences.reducedMotion]);

  let page = playback ? <p className="af-wrap af-state" role="status">Opening the player…</p>
    : <section className="af-wrap af-directory"><h1>Page unavailable</h1><a className="af-text-link" href="/#home">Go to Home</a></section>;
  if (home) page = <Home controls={controls} />;
  else if (title) page = <DetailsPage key={path} type={title[1] as MediaType} id={Number(title[2])} controls={controls} />;
  else if (catalogue) page = <Catalogue key={route} route={route} controls={controls} />;
  else if (path === 'anime') page = <AnimePage key={route} query={query} />;
  else if (path === 'comics') page = <ComicsPage key={route} query={query} controls={controls} />;
  else if (comic) page = <ComicDetailsPage key={path} id={comic[1]} query={query} controls={controls} />;
  else if (reader) page = <ComicReader key={path} id={reader[1]} chapterId={reader[2]} query={query} controls={controls} />;
  else if (path === 'recommendations') page = <RecommendationsPage controls={controls} />;
  else if (library) page = <LibraryPage key={path} path={path} query={query} controls={controls} />;

  return <SettingsProvider controls={controls}><AccountProvider controls={controls}><OpenEntryPanel /><div onClickCapture={event => { if (event.target instanceof Element && event.target.closest('a[href]')) rememberRoute(event.target.closest('a[href]')); }} className="af-app" data-page={home ? 'home' : title ? 'title' : 'directory'}>
    <a href="#main" className="af-skip" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
    <Header controls={controls} route={route} />
    {controls.error && <div className="af-notice" role="alert">{controls.error} {controls.state === 'expired' ? <AccountButton className="af-text-link">Sign in</AccountButton> : <button className="af-text-link" type="button" onClick={() => void controls.refresh()}>Retry connection</button>}</div>}
    {(controls.recoverable.length > 0 || controls.recoveryStatus || controls.recoveryError) &&
      <section className="af-wrap af-recovery" aria-label="Library changes to recover">
        {controls.recoverable.map(edit => <div className="af-recovery-row" key={`${edit.kind}/${edit.key}`}>
          <span>{edit.label}</span>
          <button type="button" className="af-button af-secondary" disabled={!controls.ready || controls.replaying} onClick={() => void controls.recover(edit)}>
            Retry change
          </button>
          <button type="button" className="af-text-link" disabled={controls.replaying} onClick={() => controls.removeDeferred(edit)}>Dismiss</button>
        </div>)}
        {controls.replaying && <p role="status">Saving your recovered change…</p>}
        {controls.recoveryStatus && <p role="status">{controls.recoveryStatus}</p>}
        {controls.recoveryError && <p role="alert">{controls.recoveryError}</p>}
      </section>}
    {controls.hasDeferredForOtherAccount && <div className="af-wrap af-recovery" role="status">
      A pending change belongs to another account. <AccountButton className="af-text-link">Switch accounts</AccountButton> to recover it.
    </div>}
    <div className="af-wrap af-library-feedback" aria-live="polite">
      {controls.mutationMessage && <span>{controls.mutationMessage}</span>}
      {controls.undoable && controls.ready && <button type="button" className="af-text-link"
        onClick={() => { if (controls.undoable) void controls.undo(controls.undoable); }}>Undo</button>}
    </div>
    <main id="main" tabIndex={-1}>
      <PageBoundary key={comicRoute ? path : route}>{page}</PageBoundary>
    </main>
  </div></AccountProvider></SettingsProvider>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Afterframe could not find its root element.');
createRoot(root).render(<App />);
