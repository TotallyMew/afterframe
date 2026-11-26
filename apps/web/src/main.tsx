import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { comicChapterIdSource, comicIdSource } from '@afterframe/shared/comic-ids';
import { AccountButton, AccountProvider, useAccountDialog } from './Account';
import { rememberRoute, webHref, type MediaType } from './catalog';
import { ConfirmProvider, useConfirm } from './ConfirmDialog';
import { Header, Loading, MobileNav } from './components';
import { Footer } from './Footer';
import { useLibrary } from './library';
import { parsePlayerRoute, playerTitleKey } from './player/route';
import {
  currentLocationHref, handleSpaClick, normalizeBackParam, normalizeRouteString, routeSnapshot, subscribeRoute,
} from './router';
import { SettingsProvider } from './Settings';
import { useSettings } from './settings-context';
import { ShortcutsDialog } from './ShortcutsDialog';
import { ToastProvider } from './Toast';
import './styles.css';

const Home = lazy(() => import('./Home').then(m => ({ default: m.Home })));
const DetailsPage = lazy(() => import('./Details').then(m => ({ default: m.DetailsPage })));
const PlayerPage = lazy(() => import('./PlayerPage').then(m => ({ default: m.PlayerPage })));
const Catalogue = lazy(() => import('./Catalogue').then(m => ({ default: m.Catalogue })));
const AnimePage = lazy(() => import('./Discovery').then(m => ({ default: m.AnimePage })));
const RecommendationsPage = lazy(() => import('./Discovery').then(m => ({ default: m.RecommendationsPage })));
const ComicsPage = lazy(() => import('./Comics').then(m => ({ default: m.ComicsPage })));
const ComicDetailsPage = lazy(() => import('./Comics').then(m => ({ default: m.ComicDetailsPage })));
const ComicReader = lazy(() => import('./ComicReader').then(m => ({ default: m.ComicReader })));
const LibraryPage = lazy(() => import('./LibraryPage').then(m => ({ default: m.LibraryPage })));

const comicPath = new RegExp(`^comic/(${comicIdSource})$`, 'i');
const readerPath = new RegExp(`^comic/(${comicIdSource})/read/(${comicChapterIdSource})$`, 'i');
const { panel: entryPanel } = normalizeEntry();

function normalizeEntry() {
  const url = new URL(window.location.href);
  const wasLegacy = /^\/(?:legacy|player)\/?$/.test(url.pathname);
  const panel = url.searchParams.get('panel');
  const hasPanel = panel === 'settings' || panel === 'integrations' || panel === 'account';
  const requested = url.searchParams.get('return');
  const returnTo = normalizeBackParam(requested);
  const hasLegacyHash = (url.pathname === '/' || wasLegacy) && Boolean(url.hash) && url.hash !== '#main' && url.hash.startsWith('#');

  let targetHref: string | null = null;
  if (hasLegacyHash) {
    targetHref = webHref(normalizeRouteString(url.hash));
  } else if (wasLegacy) {
    targetHref = '/';
  }

  if (hasPanel || wasLegacy || returnTo || hasLegacyHash) {
    const nextUrl = new URL(targetHref || `${url.pathname}${url.search}`, url.origin);
    if (hasPanel) {
      nextUrl.searchParams.delete('panel');
      nextUrl.searchParams.delete('return');
      if (returnTo) {
        const dest = new URL(returnTo, url.origin);
        nextUrl.pathname = dest.pathname;
        nextUrl.search = dest.search;
      }
    } else if (returnTo) {
      const targetRoute = normalizeRouteString(`${nextUrl.pathname}${nextUrl.search}`);
      const [path] = targetRoute.split('?', 2);
      if (readerPath.test(path) || parsePlayerRoute(path)) {
        const priorUrl = new URL(returnTo, url.origin);
        const priorRoute = normalizeRouteString(`${priorUrl.pathname}${priorUrl.search}`).split('?', 2)[0];
        const back = comicPath.test(priorRoute) ? priorUrl.searchParams.get('back') : returnTo;
        if (back && !nextUrl.searchParams.has('back')) nextUrl.searchParams.set('back', back);
      }
      nextUrl.searchParams.delete('return');
    }
    nextUrl.hash = '';
    window.history.replaceState(null, '', `${nextUrl.pathname}${nextUrl.search}`);
  }
  return { panel: hasPanel ? panel : null };
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

function RouteFallback({ shape = 'posters' }: { shape?: 'posters' | 'hero' | 'rows' }) {
  return <div className="af-wrap af-directory" data-route-loading>
    <Loading label="" shape={shape} />
  </div>;
}

function restoreRoute(locationKey: string, focusOnEntry: boolean) {
  let view: { y: number; focus?: string } | undefined;
  try {
    const key = `afterframe.view:${locationKey}`;
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
  for (const event of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(event, () => controller.abort(), { once: true, passive: true, signal: controller.signal });
  }
  return () => controller.abort();
}

function AppShell() {
  const confirmAction = useConfirm();
  const route = useSyncExternalStore(subscribeRoute, routeSnapshot);
  const [path, query = ''] = route.split('?', 2);
  const title = path.match(/^(movie|tv)\/([1-9]\d{0,9})$/);
  const comic = path.match(comicPath);
  const reader = path.match(readerPath);
  const playerRoute = parsePlayerRoute(path);
  const playerKey = playerRoute ? playerTitleKey(playerRoute) : null;
  const home = path === 'home' || path === 'main';
  const catalogue = ['movies', 'tv', 'new', 'search'].includes(path) || path.startsWith('search=');
  const library = ['watchlist', 'watched', 'ratings', 'reading', 'history', 'notifications'].includes(path);
  const controls = useLibrary(confirmAction);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const comicRoute = Boolean(comic || reader);
  const oldPath = useRef('');
  const oldPlayerKey = useRef<string | null>(null);

  useEffect(() => {
    const openShortcuts = () => setShortcutsOpen(true);
    window.addEventListener('afterframe-shortcuts', openShortcuts);
    return () => window.removeEventListener('afterframe-shortcuts', openShortcuts);
  }, []);

  const handleUndo = useCallback(() => {
    if (controls.undoable) void controls.undo(controls.undoable);
  }, [controls]);

  const libraryFeedback = useMemo(() => ({
    message: controls.mutationMessage,
    onUndo: controls.undoable && controls.ready ? handleUndo : undefined,
  }), [controls.mutationMessage, controls.undoable, controls.ready, handleUndo]);

  // Convert legacy hash changes (e.g., manual hash edits or external bookmarks) into clean paths
  useEffect(() => {
    const syncLegacyHash = () => {
      if ((window.location.pathname === '/' || window.location.pathname === '') && window.location.hash && window.location.hash !== '#main') {
        const href = webHref(normalizeRouteString(window.location.hash));
        window.history.replaceState(null, '', href);
        window.dispatchEvent(new Event('afterframe-navigate'));
      }
    };
    window.addEventListener('hashchange', syncLegacyHash);
    return () => window.removeEventListener('hashchange', syncLegacyHash);
  }, []);

  useEffect(() => {
    const localChapterChange = comicRoute && oldPath.current === path;
    const samePlayerFullscreen = Boolean(playerKey && oldPlayerKey.current === playerKey && document.fullscreenElement);
    const focusOnEntry = path !== 'home' || Boolean(oldPath.current && oldPath.current !== path);
    oldPath.current = path;
    oldPlayerKey.current = playerKey;
    if (path !== 'main' && !localChapterChange && !samePlayerFullscreen) return restoreRoute(currentLocationHref(), focusOnEntry);
  }, [route, path, comicRoute, playerKey]);
  useEffect(() => { document.documentElement.classList.toggle('reduce-motion', controls.library.preferences.reducedMotion === true); }, [controls.library.preferences.reducedMotion]);

  let page = <section className="af-wrap af-directory"><h1>Page unavailable</h1><p className="af-meta">This page does not exist in Afterframe.</p><a className="af-text-link" href={webHref('home')}>Go to Home</a></section>;
  let fallbackShape: 'posters' | 'hero' | 'rows' = 'posters';
  if (home) { page = <Home controls={controls} />; fallbackShape = 'hero'; }
  else if (title) { page = <DetailsPage key={path} type={title[1] as MediaType} id={Number(title[2])} controls={controls} />; fallbackShape = 'hero'; }
  else if (playerRoute && playerKey) { page = <PlayerPage key={playerKey} route={playerRoute} controls={controls} />; fallbackShape = 'hero'; }
  else if (catalogue) page = <Catalogue key={route} route={route} controls={controls} />;
  else if (path === 'anime') page = <AnimePage key={route} query={query} controls={controls} />;
  else if (path === 'comics' || path === 'manga') page = <ComicsPage key={route} query={query} controls={controls} />;
  else if (comic) { page = <ComicDetailsPage key={path} id={comic[1]} query={query} controls={controls} />; fallbackShape = 'hero'; }
  else if (reader) { page = <ComicReader key={path} id={reader[1]} chapterId={reader[2]} query={query} controls={controls} />; fallbackShape = 'hero'; }
  else if (path === 'recommendations') page = <RecommendationsPage controls={controls} />;
  else if (library) { page = <LibraryPage key={path} path={path} query={query} controls={controls} />; fallbackShape = 'rows'; }

  return <ToastProvider libraryFeedback={libraryFeedback}><SettingsProvider controls={controls}><AccountProvider controls={controls}><OpenEntryPanel /><div
    onClick={event => handleSpaClick(event, anchor => rememberRoute(anchor))}
    className="af-app"
    data-page={home ? 'home' : title || comic ? 'title' : reader ? 'reader' : playerRoute ? 'player' : 'directory'}
  >
    <a href="#main" className="af-skip" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
    {!reader && <Header controls={controls} route={route} />}
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
    <main id="main" tabIndex={-1}>
      <PageBoundary key={playerKey ?? (comicRoute ? path : route)}>
        <Suspense fallback={<RouteFallback shape={fallbackShape} />}>{page}</Suspense>
      </PageBoundary>
    </main>
    {!reader && <Footer onOpenShortcuts={() => setShortcutsOpen(true)} />}
    {!reader && !playerRoute && <MobileNav route={route} />}
    <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
  </div></AccountProvider></SettingsProvider></ToastProvider>;
}

function App() {
  return <ConfirmProvider><AppShell /></ConfirmProvider>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Afterframe could not find its root element.');
createRoot(root).render(<App />);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
