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
const AiringSchedulePage = lazy(() => import('./AiringSchedule').then(m => ({ default: m.AiringSchedulePage })));
const RecommendationsPage = lazy(() => import('./Discovery').then(m => ({ default: m.RecommendationsPage })));
const ComicsPage = lazy(() => import('./Comics').then(m => ({ default: m.ComicsPage })));
const ComicDetailsPage = lazy(() => import('./Comics').then(m => ({ default: m.ComicDetailsPage })));
const ComicReader = lazy(() => import('./ComicReader').then(m => ({ default: m.ComicReader })));
const LibraryPage = lazy(() => import('./LibraryPage').then(m => ({ default: m.LibraryPage })));

const comicPath = new RegExp(`^comic/(${comicIdSource})$`, 'i');
const readerPath = new RegExp(`^comic/(${comicIdSource})/read/(${comicChapterIdSource})$`, 'i');
const { panel: entryPanel } = normalizeEntry();

function applyEntryReturn(nextUrl: URL, returnTo: string, hasPanel: boolean, origin: string) {
  if (hasPanel) {
    const dest = new URL(returnTo, origin);
    nextUrl.pathname = dest.pathname;
    nextUrl.search = dest.search;
    return;
  }
  const targetRoute = normalizeRouteString(`${nextUrl.pathname}${nextUrl.search}`);
  const [path] = targetRoute.split('?', 2);
  if (readerPath.test(path) || parsePlayerRoute(path)) {
    const priorUrl = new URL(returnTo, origin);
    const priorRoute = normalizeRouteString(`${priorUrl.pathname}${priorUrl.search}`).split('?', 2)[0];
    const back = comicPath.test(priorRoute) ? priorUrl.searchParams.get('back') : returnTo;
    if (back && !nextUrl.searchParams.has('back')) nextUrl.searchParams.set('back', back);
  }
  nextUrl.searchParams.delete('return');
}

function normalizeEntry() {
  const url = new URL(window.location.href);
  const wasLegacy = /^\/(?:legacy|player)\/?$/.test(url.pathname);
  const panel = url.searchParams.get('panel');
  const hasPanel = panel === 'settings' || panel === 'integrations' || panel === 'account';
  const returnTo = normalizeBackParam(url.searchParams.get('return'));
  const hasLegacyHash = (url.pathname === '/' || wasLegacy) && Boolean(url.hash) && url.hash !== '#main' && url.hash.startsWith('#');

  let targetHref: string | null = null;
  if (hasLegacyHash) targetHref = webHref(normalizeRouteString(url.hash));
  else if (wasLegacy) targetHref = '/';

  if (hasPanel || wasLegacy || returnTo || hasLegacyHash) {
    const nextUrl = new URL(targetHref || `${url.pathname}${url.search}`, url.origin);
    if (hasPanel) {
      nextUrl.searchParams.delete('panel');
      nextUrl.searchParams.delete('return');
    }
    if (returnTo) applyEntryReturn(nextUrl, returnTo, hasPanel, url.origin);
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

function RouteFallback({ shape = 'posters' }: Readonly<{ shape?: 'posters' | 'hero' | 'rows' }>) {
  return <div className="af-wrap af-directory" data-route-loading>
    <Loading label="" shape={shape} />
  </div>;
}

function findRestoreFocusTarget(wanted: string): HTMLElement | null {
  const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(wanted)
    : wanted.replace(/["\\]/g, String.raw`\$&`);
  const candidates = document.querySelectorAll<HTMLElement>(`a[href="${escaped}"], button[aria-label="${escaped}"]`);
  for (const node of candidates) {
    if (node.getClientRects().length) return node;
  }
  return null;
}

function tryRestoreView(view: { y: number; focus?: string }, focusHeading: () => void): boolean {
  const canScroll = view.y === 0 || document.documentElement.scrollHeight >= view.y + innerHeight - 1;
  if (!canScroll) return false;
  if (view.focus) {
    const target = findRestoreFocusTarget(view.focus);
    if (!target) return false;
    target.focus({ preventScroll: true });
    window.scrollTo(0, view.y);
    return true;
  }
  window.scrollTo(0, view.y);
  focusHeading();
  return true;
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
    if (view) return tryRestoreView(view, focusHeading);
    if (main.querySelector('[data-route-loading]')) return false;
    focusHeading();
    return true;
  };
  window.scrollTo(0, 0);
  if (restore()) return;
  let rafId = 0;
  const observer = new MutationObserver(() => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (restore()) controller.abort();
    });
  });
  observer.observe(main, { childList: true, subtree: true });
  const timeout = window.setTimeout(() => {
    if (view) window.scrollTo(0, view.y);
    focusHeading();
    controller.abort();
  }, 6_000);
  controller.signal.addEventListener('abort', () => {
    observer.disconnect();
    if (rafId) cancelAnimationFrame(rafId);
    clearTimeout(timeout);
  }, { once: true });
  for (const event of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(event, () => controller.abort(), { once: true, passive: true, signal: controller.signal });
  }
  return () => controller.abort();
}

const cataloguePaths = new Set(['movies', 'tv', 'new', 'search']);
const libraryPaths = new Set(['watchlist', 'watched', 'ratings', 'reading', 'history', 'notifications']);
const titleRoutePattern = /^(movie|tv)\/([1-9]\d{0,9})$/;

function resolveDataPage(flags: { home: boolean; isTitle: boolean; isReader: boolean; isPlayer: boolean }): string {
  if (flags.home) return 'home';
  if (flags.isTitle) return 'title';
  if (flags.isReader) return 'reader';
  if (flags.isPlayer) return 'player';
  return 'directory';
}

function resolveRoutePageContent(
  route: string,
  path: string,
  query: string,
  controls: ReturnType<typeof useLibrary>,
  matches: {
    home: boolean;
    catalogue: boolean;
    library: boolean;
    title: RegExpExecArray | null;
    comic: RegExpExecArray | null;
    reader: RegExpExecArray | null;
    playerRoute: ReturnType<typeof parsePlayerRoute>;
    playerKey: string | null;
  },
): { page: ReactNode; fallbackShape: 'posters' | 'hero' | 'rows' } {
  if (matches.home) return { page: <Home controls={controls} />, fallbackShape: 'hero' };
  if (matches.title) return { page: <DetailsPage key={path} type={matches.title[1] as MediaType} id={Number(matches.title[2])} controls={controls} />, fallbackShape: 'hero' };
  if (matches.playerRoute && matches.playerKey) return { page: <PlayerPage key={matches.playerKey} route={matches.playerRoute} controls={controls} />, fallbackShape: 'hero' };
  if ((path === 'anime' || path === 'tv') && new URLSearchParams(query).get('view') === 'schedule') {
    return { page: <AiringSchedulePage key={path} type={path} />, fallbackShape: 'rows' };
  }
  if (matches.catalogue) return { page: <Catalogue key={route} route={route} controls={controls} />, fallbackShape: 'posters' };
  if (path === 'anime') return { page: <AnimePage key={route} query={query} controls={controls} />, fallbackShape: 'posters' };
  if (path === 'comics' || path === 'manga') return { page: <ComicsPage key={route} query={query} controls={controls} />, fallbackShape: 'posters' };
  if (matches.comic) return { page: <ComicDetailsPage key={path} id={matches.comic[1]} query={query} controls={controls} />, fallbackShape: 'hero' };
  if (matches.reader) return { page: <ComicReader key={path} id={matches.reader[1]} chapterId={matches.reader[2]} query={query} controls={controls} />, fallbackShape: 'hero' };
  if (path === 'recommendations') return { page: <RecommendationsPage controls={controls} />, fallbackShape: 'posters' };
  if (matches.library) return { page: <LibraryPage key={path} path={path} query={query} controls={controls} />, fallbackShape: 'rows' };
  return {
    page: <section className="af-wrap af-directory"><h1>Page unavailable</h1><p className="af-meta">This page does not exist in Afterframe.</p><a className="af-text-link" href={webHref('home')}>Go to Home</a></section>,
    fallbackShape: 'posters',
  };
}

function resolveRouteView(route: string, path: string, query: string, controls: ReturnType<typeof useLibrary>) {
  const title = titleRoutePattern.exec(path);
  const comic = comicPath.exec(path);
  const reader = readerPath.exec(path);
  const playerRoute = parsePlayerRoute(path);
  const playerKey = playerRoute ? playerTitleKey(playerRoute) : null;
  const home = path === 'home' || path === 'main';
  const catalogue = cataloguePaths.has(path) || path.startsWith('search=');
  const library = libraryPaths.has(path);
  const comicRoute = Boolean(comic || reader);
  const isReader = Boolean(reader);
  const isPlayer = Boolean(playerRoute);
  const dataPage = resolveDataPage({ home, isTitle: Boolean(title || comic), isReader, isPlayer });
  const { page, fallbackShape } = resolveRoutePageContent(route, path, query, controls, {
    home, catalogue, library, title, comic, reader, playerRoute, playerKey,
  });

  return { page, fallbackShape, dataPage, playerKey, comicRoute, isReader, isPlayer };
}

function AppShell() {
  const confirmAction = useConfirm();
  const route = useSyncExternalStore(subscribeRoute, routeSnapshot);
  const [path, query = ''] = route.split('?', 2);
  const controls = useLibrary(confirmAction);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const appRef = useRef<HTMLDivElement>(null);
  const oldPath = useRef('');
  const oldPlayerKey = useRef<string | null>(null);
  const { page, fallbackShape, dataPage, playerKey, comicRoute, isReader, isPlayer } = resolveRouteView(route, path, query, controls);

  useEffect(() => {
    const app = appRef.current;
    if (!app) return;
    const onClick = (event: MouseEvent) => handleSpaClick(event, anchor => rememberRoute(anchor));
    app.addEventListener('click', onClick);
    return () => app.removeEventListener('click', onClick);
  }, []);

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

  return <ToastProvider libraryFeedback={libraryFeedback}><SettingsProvider controls={controls}><AccountProvider controls={controls}><OpenEntryPanel /><div
    ref={appRef}
    className="af-app"
    data-page={dataPage}
  >
    <a href="#main" className="af-skip" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
    {!isReader && <Header controls={controls} route={route} />}
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
        {controls.replaying && <output>Saving your recovered change…</output>}
        {controls.recoveryStatus && <output>{controls.recoveryStatus}</output>}
        {controls.recoveryError && <p role="alert">{controls.recoveryError}</p>}
      </section>}
    {controls.hasDeferredForOtherAccount && <output className="af-wrap af-recovery">
      A pending change belongs to another account. <AccountButton className="af-text-link">Switch accounts</AccountButton> to recover it.
    </output>}
    <main id="main" tabIndex={-1}>
      <PageBoundary key={playerKey ?? (comicRoute ? path : route)}>
        <Suspense fallback={<RouteFallback shape={fallbackShape} />}>{page}</Suspense>
      </PageBoundary>
    </main>
    {!isReader && <Footer onOpenShortcuts={() => setShortcutsOpen(true)} />}
    {!isReader && !isPlayer && <MobileNav route={route} />}
    <ShortcutsDialog
      open={shortcutsOpen}
      onOpenChange={setShortcutsOpen}
      singleKeyShortcuts={controls.library.preferences.singleKeyShortcuts !== false}
    />
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
