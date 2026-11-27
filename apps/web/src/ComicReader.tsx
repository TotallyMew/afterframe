import { Dialog } from '@base-ui/react/dialog';
import { comicEditionCredit, comicLanguage, groupComicEditions } from '@afterframe/shared/comic-display';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { navigate, request, routeWithParams, webHref, type Comic } from './catalog';
import { ActionLink, Icon, Loading } from './components';
import type { LibraryControls } from './library';
import './comic-reader.css';

type ReaderComic = Comic & { longStrip?: boolean };
type Chapter = { id: string; title?: string; label: string; number?: string | number; language: string; groups?: { name?: string }[]; source?: string };
type ChapterContent = { chapter: Chapter; pages: string[]; transcript?: { pages?: string[]; source?: string } };
type Neighbor = { entry: Chapter; page: number };
type ChapterNavigation = { previous: Neighbor | null; next: Neighbor | null };
type ReaderData = ChapterContent & { item: ReaderComic };
type Layout = 'single' | 'double' | 'scroll';
type Direction = 'rtl' | 'ltr';
type Fit = 'page' | 'width' | 'height' | 'original';
type EdgeProgressPos = 'left' | 'bottom' | 'right' | 'off';

function readOption<T>(key: string, fallback: T): T {
  try {
    const val = JSON.parse(localStorage.getItem(`afterframe.${key}`) || 'null');
    return val === null ? fallback : (val as T);
  } catch {
    return fallback;
  }
}

function writeOption(key: string, value: unknown) {
  try { localStorage.setItem(`afterframe.${key}`, JSON.stringify(value)); }
  catch { /* The setting still works in the open reader. */ }
}

function positiveInteger(value: string | null, fallback: number) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function chaptersHref(id: string, language: string, listPage: number, chapterId: string, back: string) {
  const params = new URLSearchParams({ chapters: chapterId });
  if (language) params.set('lang', language);
  if (listPage > 1) params.set('page', String(listPage));
  if (back) params.set('back', back);
  return webHref(routeWithParams(`comic/${id}`, params));
}

function neighboringHref(id: string, { entry, page }: Neighbor, back: string) {
  const params = new URLSearchParams({ lang: entry.language });
  if (page > 1) params.set('page', String(page));
  if (back) params.set('back', back);
  return webHref(routeWithParams(`comic/${id}/read/${encodeURIComponent(entry.id)}`, params));
}

function isCompactViewport() {
  return typeof window !== 'undefined' && window.innerWidth <= 768;
}

export function ComicReader({ id, chapterId, query, controls }: { id: string; chapterId: string; query: string; controls: LibraryControls }) {
  const [data, setData] = useState<ReaderData>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const params = new URLSearchParams(query);
  const listPage = Math.min(200, positiveInteger(params.get('page'), 1));
  const position = positiveInteger(params.get('position'), 0);
  const back = params.get('back') || '';
  const retry = () => { setError(''); setAttempt(value => value + 1); };

  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    Promise.all([request<ReaderComic>(`/api/comics/${id}`, options), request<ChapterContent>(`/api/comics/${id}/chapters/${chapterId}`, options)])
      .then(([item, chapter]) => {
        if (options.signal.aborted) return;
        if (item.type !== 'comic' || typeof item.title !== 'string' || typeof chapter.chapter?.label !== 'string' ||
          typeof chapter.chapter.language !== 'string' || !Array.isArray(chapter.pages)) {
          throw new Error('The chapter source returned an incomplete chapter.');
        }
        document.title = `${chapter.chapter.label} · ${item.title} · Afterframe`;
        setData({ item, ...chapter });
      })
      .catch(problem => { if (!options.signal.aborted) setError(problem.message); });
    return () => controller.abort();
  }, [id, chapterId, attempt]);

  const backHref = chaptersHref(id, data?.chapter.language || params.get('lang') || '', listPage, chapterId, back);
  if (!data) return <section className="af-wrap af-directory">
    <a className="af-text-link" href={backHref}><Icon name="left" /> Back to chapters</a>
    <h1>{error ? 'Chapter unavailable' : 'Manga reader'}</h1>
    {error ? <p className="af-state" role="alert">{error} <button className="af-text-link" type="button" onClick={retry}>Retry chapter</button></p>
      : <Loading label="Loading chapter…" shape="hero" />}
  </section>;
  if (!data.pages.length) return <section className="af-wrap af-directory">
    <a className="af-text-link" href={backHref}><Icon name="left" /> {data.item.title}</a>
    <h1>{data.chapter.label}</h1>
    <p className="af-state" role="status">This edition has no pages available.</p>
    <ActionLink href={backHref}>Back to chapters</ActionLink>
  </section>;
  return <ChapterReader key={`${chapterId}:${position}`} data={data} listPage={listPage} requestedPage={position} controls={controls} back={back} />;
}

function Transcript({ transcript, count }: { transcript: ChapterContent['transcript']; count: number }) {
  const text = Array.isArray(transcript?.pages) ? transcript.pages.slice(0, count) : [];
  const supplied = text.flatMap((line, index) => typeof line === 'string' && line.trim() ? [{ line, number: index + 1 }] : []);
  if (!supplied.length) return <p className="af-meta af-reader-transcript-note">A text transcript is unavailable for this edition.</p>;
  let source: URL | undefined;
  try { if (transcript?.source) source = new URL(transcript.source); } catch { /* The page text is still available. */ }
  return <details className="af-reader-transcript">
    <summary>Text transcript</summary>
    {supplied.length < count && <p className="af-meta">Text is available for some pages of this edition.</p>}
    <ol>{supplied.map(({ line, number }) => <li key={number} value={number}><h2>Page {number}</h2><p id={`comic-transcript-page-${number}`}>{line}</p></li>)}</ol>
    {source?.protocol === 'https:' && !source.username && !source.password && <a className="af-text-link" href={source.href} target="_blank" rel="noopener noreferrer">Transcript source</a>}
  </details>;
}

const ReaderImage = memo(function ReaderImage({ page, src, visible, described, onLoad }: { page: number; src: string; visible: boolean; described: boolean; onLoad: (page: number) => void }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [ratio, setRatio] = useState<string>();
  const address = src && attempt ? `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}` : src;
  return <div className="af-reader-page" data-page-number={page} data-page-loaded={loaded || undefined} style={ratio ? { aspectRatio: ratio } : undefined}>
    {failed || !address ? <div className="af-reader-page-state" role="status">
      <p>Page {page} could not be loaded.</p>
      {address && <button className="af-button af-secondary" type="button" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Retry page {page}</button>}
    </div> : <>
      {!loaded && visible && <p className="af-reader-page-state" role="status">Loading page {page}…</p>}
      <img key={address} src={address} alt={`Manga page ${page}`} aria-describedby={described ? `comic-transcript-page-${page}` : undefined}
        aria-hidden={!loaded || undefined} loading={visible ? 'eager' : 'lazy'} decoding="async"
        onLoad={event => {
          const { naturalWidth, naturalHeight } = event.currentTarget;
          if (naturalWidth > 0 && naturalHeight > 0) setRatio(`${naturalWidth} / ${naturalHeight}`);
          setLoaded(true);
          onLoad(page);
        }}
        onError={() => { setLoaded(false); setFailed(true); }} />
    </>}
  </div>;
});

function ExpandIcon({ expanded }: { expanded: boolean }) {
  return <svg className="af-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={expanded ? 'M4 9h5V4m6 0v5h5m0 6h-5v5m-6 0v-5H4' : 'M9 4H4v5m16 0V4h-5m0 16h5v-5M4 15v5h5'} />
  </svg>;
}

function FitIcon() {
  return <svg className="af-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3" />
  </svg>;
}

function doublePageSpread(page: number, total: number, offsetCover: boolean): number[] {
  if (offsetCover && page === 1) return [1];
  const base = offsetCover
    ? (page % 2 === 0 ? page : page - 1)
    : (page % 2 === 1 ? page : page - 1);
  const first = Math.max(1, base);
  return first + 1 <= total ? [first, first + 1] : [first];
}

function ChapterReader({ data: { item, chapter, pages, transcript }, listPage, requestedPage, controls, back }: {
  data: ReaderData; listPage: number; requestedPage: number; controls: LibraryControls; back: string;
}) {
  const recent = controls.library.reading[item.key];
  const total = pages.length;
  const bounded = (p: number) => Math.max(1, Math.min(total, p));
  const start = bounded(requestedPage || (recent?.chapter === chapter.id && controls.ready ? recent.page : 1));
  const [page, setPage] = useState(start);
  const [loaded, setLoaded] = useState<Set<number>>(() => new Set());
  const [layout, setLayout] = useState<Layout>(() => {
    const saved = readOption<string>('comicLayout', '');
    if (saved === 'single' || saved === 'double' || saved === 'scroll') return saved;
    if (saved === 'pages') return 'single';
    if (item.longStrip || item.format === 'manhwa' || isCompactViewport()) return 'scroll';
    return 'single';
  });
  const [direction, setDirection] = useState<Direction>(() => {
    const saved = readOption<string>('comicDirection', '');
    if (saved === 'rtl' || saved === 'ltr') return saved;
    return item.format === 'manga' ? 'rtl' : 'ltr';
  });
  const [fit, setFit] = useState<Fit>(() => {
    const saved = readOption<string>('comicFit', '');
    if (saved === 'page' || saved === 'width' || saved === 'height' || saved === 'original') return saved;
    return 'page';
  });
  const [offsetCover, setOffsetCover] = useState<boolean>(() => readOption('comicOffsetCover', true));
  const [seamlessStrip, setSeamlessStrip] = useState<boolean>(() => readOption('comicSeamless', true));
  const [progressPos, setProgressPos] = useState<EdgeProgressPos>(() => {
    const saved = readOption<string>('comicProgressPos', '');
    if (saved === 'left' || saved === 'bottom' || saved === 'right' || saved === 'off') return saved;
    return readOption('comicShowProgress', true) ? 'left' : 'off';
  });
  const [oledMode, setOledMode] = useState<boolean>(() => readOption('comicOled', false));
  const [dimLevel, setDimLevel] = useState<number>(() => {
    const saved = readOption<number>('comicDim', 0);
    return Number.isFinite(saved) ? Math.max(0, Math.min(60, Math.round(saved))) : 0;
  });
  const [grayscale, setGrayscale] = useState<boolean>(() => readOption('comicGrayscale', false));
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const tapOriginRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const zoneClickTimerRef = useRef<number | undefined>(undefined);
  const prefetchedNextRef = useRef<string>('');
  const [hudVisible, setHudVisible] = useState(true);
  const [pinHud, setPinHud] = useState<boolean>(() => readOption('comicPinHud', false));
  const [drawerTab, setDrawerTab] = useState<'settings' | 'chapters' | null>(null);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [neighbors, setNeighbors] = useState<ChapterNavigation | null>();
  const [chapterList, setChapterList] = useState<Chapter[]>([]);
  const [chapterFilter, setChapterFilter] = useState('');
  const [navError, setNavError] = useState('');
  const [navigationAttempt, setNavigationAttempt] = useState(0);
  const [resumeAttempt, setResumeAttempt] = useState(0);

  const resumeResolved = useRef(Boolean(requestedPage || controls.state !== 'loading'));
  const pendingAlign = useRef(start > 1 ? start : 0);
  const lastScrollY = useRef(0);
  const lastAttempt = useRef<{ accountId: number | null; page: number; retry: number } | undefined>(undefined);
  const shellRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const activeChapterRef = useRef<HTMLAnchorElement>(null);
  const listHref = chaptersHref(item.id, chapter.language, listPage, chapter.id, back);
  const mutationKey = `reading/${item.key}`;
  const saveProblem = controls.problems[mutationKey];

  // Blend mobile browser status bar & background cleanly with the reader canvas
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previousTheme = meta?.getAttribute('content') || '#121416';
    const readerBg = oledMode ? '#000000' : '#0b0d0f';
    if (meta) meta.setAttribute('content', readerBg);
    const prevBodyBg = document.body.style.backgroundColor;
    document.body.style.backgroundColor = readerBg;
    return () => {
      if (meta) meta.setAttribute('content', previousTheme);
      document.body.style.backgroundColor = prevBodyBg;
    };
  }, [oledMode]);

  // Fetch all chapters & neighbors so chapter search works across the whole series
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ lang: chapter.language, chapter: chapter.id, all: '1' });
    request<{ results?: Chapter[]; neighbors?: ChapterNavigation | null; partial?: boolean }>(`/api/comics/${item.id}/chapters?${params}`, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        setNeighbors(result.neighbors ?? null);
        if (Array.isArray(result.results)) {
          const primary = groupComicEditions(result.results).map(group => group.find(entry => entry.id === chapter.id) ?? group[0]);
          setChapterList(primary);
        }
        if (result.partial) setNavError('Some chapter sources are unavailable.');
      }).catch(() => { if (!controller.signal.aborted) setNavError('Chapter navigation could not load.'); });
    return () => controller.abort();
  }, [item.id, chapter.id, chapter.language, navigationAttempt]);

  // Scroll active chapter into view when Chapters modal opens
  useEffect(() => {
    if (drawerTab !== 'chapters') return;
    const tick = requestAnimationFrame(() => {
      activeChapterRef.current?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
    });
    return () => cancelAnimationFrame(tick);
  }, [drawerTab, chapterList.length]);

  useEffect(() => {
    if (!resumeResolved.current && controls.state !== 'loading') {
      resumeResolved.current = true;
      pendingAlign.current = start > 1 ? start : 0;
      setPage(start);
    }
  }, [controls.state, start]);

  // Save reading position
  useEffect(() => {
    if (!controls.ready || controls.replaying || !resumeResolved.current || !loaded.has(page) || (recent?.chapter === chapter.id && recent.page === page)) return;
    const accountId = controls.account?.id ?? null;
    const previous = lastAttempt.current;
    if (previous?.accountId === accountId && previous.page === page && previous.retry === resumeAttempt) return;
    lastAttempt.current = { accountId, page, retry: resumeAttempt };
    const { key, id, title, year, type, format, poster } = item;
    void controls.recordReading({
      item: { key, id, title, year, type, format, poster }, chapter: chapter.id, label: chapter.label, language: chapter.language,
      page, listPage, updated: Date.now(),
    });
  }, [controls, loaded, page, recent, chapter, item, listPage, resumeAttempt]);

  // Preload next 2 pages silently for snappy page turns, plus next chapter's first page near chapter end
  useEffect(() => {
    const preload: HTMLImageElement[] = [];
    if (layout !== 'scroll') {
      for (const offset of [1, 2]) {
        const url = pages[page - 1 + offset];
        if (!url) continue;
        const img = new Image();
        img.src = url;
        preload.push(img);
      }
    }
    const nextChapter = neighbors?.next?.entry;
    if (nextChapter && page >= Math.max(1, total - 1) && prefetchedNextRef.current !== nextChapter.id) {
      prefetchedNextRef.current = nextChapter.id;
      const controller = new AbortController();
      request<ChapterContent>(`/api/comics/${item.id}/chapters/${nextChapter.id}`, { signal: controller.signal })
        .then(nextData => {
          if (controller.signal.aborted || !nextData.pages?.[0]) return;
          const img = new Image();
          img.src = nextData.pages[0];
          preload.push(img);
        }).catch(() => {});
      return () => { controller.abort(); preload.length = 0; };
    }
    return () => { preload.length = 0; };
  }, [page, pages, layout, total, neighbors?.next?.entry, item.id]);

  // Reset zoom/pan when changing page or layout (without unnecessary re-renders during scroll)
  useEffect(() => {
    setZoom(prev => prev === 1 ? prev : 1);
    setPan(prev => prev.x === 0 && prev.y === 0 ? prev : { x: 0, y: 0 });
  }, [page, layout]);

  const adjustZoom = (next: number) => {
    const clamped = Math.round(Math.max(1, Math.min(3, next)) * 100) / 100;
    setZoom(clamped);
    if (clamped <= 1) setPan({ x: 0, y: 0 });
  };

  useEffect(() => {
    const onFs = () => setNativeFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useLayoutEffect(() => {
    const target = pendingAlign.current;
    if (!target || !stageRef.current || layout !== 'scroll') return;
    const tick = requestAnimationFrame(() => {
      const slot = stageRef.current?.querySelector(`[data-page-number="${target}"]`);
      if (slot) slot.scrollIntoView({ block: 'start', behavior: 'instant' });
      pendingAlign.current = 0;
    });
    return () => cancelAnimationFrame(tick);
  }, [page, layout]);

  // Track active page while scrolling AND auto-hide subtle HUD when scrolling down
  useEffect(() => {
    if (layout !== 'scroll') return;
    lastScrollY.current = window.scrollY;
    let timer: number | undefined;
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastScrollY.current;
      if (!pinHud && drawerTab === null && y > 36 && delta > 8) {
        setHudVisible(false);
      }
      lastScrollY.current = y;

      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const slots = stageRef.current?.children;
        if (!slots || pendingAlign.current) return;
        const marker = Math.min(window.innerHeight * 0.35, 220);
        let low = 0, high = slots.length;
        while (low < high) {
          const mid = Math.floor((low + high) / 2);
          if (slots[mid].getBoundingClientRect().bottom > marker) high = mid;
          else low = mid + 1;
        }
        if (slots[low] && slots[low].getBoundingClientRect().top < window.innerHeight) {
          resumeResolved.current = true;
          setPage(low + 1);
        }
      }, 100);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); clearTimeout(timer); };
  }, [layout, pinHud, drawerTab]);

  const visiblePages = useMemo(() => {
    if (layout === 'scroll') return pages.map((_, idx) => idx + 1);
    if (layout === 'double') return doublePageSpread(page, total, offsetCover);
    return [page];
  }, [layout, page, total, offsetCover, pages]);

  const stepForward = () => {
    const step = layout === 'double' ? visiblePages.length : 1;
    const next = visiblePages[visiblePages.length - 1] + 1;
    if (next <= total) {
      resumeResolved.current = true;
      setPage(next);
      window.scrollTo(0, 0);
    } else if (neighbors?.next) {
      navigate(neighboringHref(item.id, neighbors.next, back));
    } else if (page + step <= total) {
      setPage(bounded(page + step));
    }
  };

  const stepBackward = () => {
    if (layout === 'double') {
      const first = visiblePages[0];
      if (first > 1) {
        resumeResolved.current = true;
        setPage(Math.max(1, first - (offsetCover && first === 2 ? 1 : 2)));
        window.scrollTo(0, 0);
        return;
      }
    } else if (page > 1) {
      resumeResolved.current = true;
      setPage(page - 1);
      window.scrollTo(0, 0);
      return;
    }
    if (neighbors?.previous) {
      navigate(neighboringHref(item.id, neighbors.previous, back));
    }
  };

  const jump = (next: number) => {
    const clamped = bounded(next);
    resumeResolved.current = true;
    pendingAlign.current = clamped;
    setPage(clamped);
    if (layout !== 'scroll') window.scrollTo(0, 0);
  };

  const toggleHud = () => {
    if (pinHud) {
      setPinHud(false);
      writeOption('comicPinHud', false);
      setHudVisible(false);
    } else {
      setHudVisible(v => !v);
    }
  };

  const cycleFit = () => {
    const order: Fit[] = ['page', 'width', 'height'];
    const next = order[(order.indexOf(fit) + 1) % order.length];
    writeOption('comicFit', next);
    setFit(next);
  };

  const toggleFullscreen = async () => {
    if (nativeFullscreen || document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
      return;
    }
    const target = document.documentElement ?? shellRef.current;
    if (target && document.fullscreenEnabled) {
      await target.requestFullscreen().catch(() => {});
    }
  };

  const modalInvokerRef = useRef<HTMLElement | null>(null);
  const modalCloseRef = useRef<HTMLButtonElement>(null);
  const openModalTab = (next: 'settings' | 'chapters' | null, invoker?: HTMLElement | null) => {
    if (next && invoker) modalInvokerRef.current = invoker;
    setDrawerTab(next);
  };
  const singleKeyEnabled = controls.library.preferences.singleKeyShortcuts !== false;
  const shortcutsRef = useRef<(event: globalThis.KeyboardEvent) => void>(() => {});
  shortcutsRef.current = (event: globalThis.KeyboardEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
      target?.closest('input, select, textarea, [contenteditable]')) return;
    const openDialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    if (openDialog && !shellRef.current?.contains(openDialog)) return;
    const key = event.key.toLowerCase();
    if (key === 'escape' && drawerTab) { event.preventDefault(); setDrawerTab(null); return; }
    if (layout !== 'scroll' && !openDialog && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      if (target?.closest('button, a, summary')) return;
      event.preventDefault();
      const leftPressed = event.key === 'ArrowLeft';
      if ((direction === 'rtl' && leftPressed) || (direction === 'ltr' && !leftPressed)) stepForward();
      else stepBackward();
      return;
    }
    if (!singleKeyEnabled || target?.closest('button, a, summary')) return;
    if (openDialog && key !== 'g' && key !== 's') return;
    if (key === 'f') { event.preventDefault(); void toggleFullscreen(); return; }
    if (key === 'm' || key === 'x') { event.preventDefault(); toggleHud(); return; }
    if (key === 'g') { event.preventDefault(); openModalTab(drawerTab === 'chapters' ? null : 'chapters', document.activeElement as HTMLElement | null); return; }
    if (key === 's') { event.preventDefault(); openModalTab(drawerTab === 'settings' ? null : 'settings', document.activeElement as HTMLElement | null); return; }
    if (key === '+' || key === '=') { event.preventDefault(); adjustZoom(zoom + 0.25); return; }
    if (key === '-') { event.preventDefault(); adjustZoom(zoom - 0.25); return; }
    if (key === '0') { event.preventDefault(); adjustZoom(1); return; }
    if (key === 'd') {
      event.preventDefault();
      setDirection(curr => {
        const next = curr === 'rtl' ? 'ltr' : 'rtl';
        writeOption('comicDirection', next);
        return next;
      });
      return;
    }
  };

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => shortcutsRef.current(event);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(zoneClickTimerRef.current);
    };
  }, []);

  const markLoaded = useCallback((num: number) => {
    setLoaded(current => current.has(num) ? current : new Set([...current, num]));
  }, []);

  const handleStagePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (layout !== 'scroll' || zoom > 1) return;
    tapOriginRef.current = { x: event.clientX, y: event.clientY, time: Date.now() };
  };

  const handleStageClick = (event: MouseEvent<HTMLDivElement>) => {
    if (layout !== 'scroll' || zoom > 1) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('a, button, input, select, summary, details, [role="dialog"]')) return;
    const origin = tapOriginRef.current;
    tapOriginRef.current = null;
    if (origin) {
      const dist = Math.hypot(event.clientX - origin.x, event.clientY - origin.y);
      if (dist > 10 || Date.now() - origin.time > 450) return;
    }
    toggleHud();
  };

  const pct = total > 1 ? `${((page - 1) / (total - 1)) * 100}%` : '100%';
  const credit = comicEditionCredit(chapter);
  const hudShown = pinHud || hudVisible || drawerTab !== null;
  const pageIndicator = layout === 'double' && visiblePages.length === 2
    ? `${visiblePages[0]}–${visiblePages[1]} / ${total}`
    : `${page} / ${total}`;
  const fitLabel = fit === 'width' ? 'Fit width' : fit === 'height' ? 'Fit height' : fit === 'original' ? 'No limit' : 'Fit both';
  const imageFilter = [
    dimLevel > 0 ? `brightness(${(100 - dimLevel) / 100})` : '',
    grayscale ? 'grayscale(1)' : '',
  ].filter(Boolean).join(' ') || undefined;

  const pageStyle: CSSProperties = {
    ...(zoom > 1 ? { transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` } : {}),
    ...(imageFilter ? { filter: imageFilter } : {}),
  };

  const activeSet = useMemo(() => new Set(visiblePages), [visiblePages]);

  const handleModalTabKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'settings' : event.key === 'End' ? 'chapters' : drawerTab === 'settings' ? 'chapters' : 'settings';
    setDrawerTab(next);
    document.getElementById(`af-reader-tab-${next}`)?.focus();
  };

  return <section className="af-comic-reader" aria-label="Chapter reader" data-layout={layout} data-oled={oledMode || undefined}>
    <h1 className="sr-only" tabIndex={-1}>{chapter.label}</h1>
    <div className={`af-reader-shell ${hudShown ? '' : 'is-hud-hidden'}`} data-layout={layout} ref={shellRef}>
      {!hudShown && (
        <button type="button" className="af-reader-reveal-btn" onClick={() => setHudVisible(true)}>
          Show reader controls
        </button>
      )}

      {/* Subtle Floating Top-Left Back Pill */}
      <div className="af-reader-float af-reader-float-back" aria-hidden={!hudShown || undefined}>
        <a className="af-reader-capsule-btn af-reader-back-pill" href={listHref} aria-label={`Back to ${item.title}`} tabIndex={hudShown ? 0 : -1}>
          <Icon name="left" />
          <span className="af-reader-back-title">{item.title}</span>
        </a>
      </div>

      {/* Subtle Floating Top-Right Chapter Pill (< Ch. X >) */}
      <div className="af-reader-float af-reader-float-chapter" aria-hidden={!hudShown || undefined}>
        <div className="af-reader-chapter-capsule">
          {neighbors?.previous
            ? <a className="af-reader-cap-arrow" href={neighboringHref(item.id, neighbors.previous, back)} aria-label="Previous chapter" title="Previous chapter" tabIndex={hudShown ? 0 : -1}><Icon name="left" /></a>
            : <button type="button" className="af-reader-cap-arrow" disabled aria-label="No previous chapter" tabIndex={-1}><Icon name="left" /></button>}
          <button
            type="button"
            className="af-reader-cap-label"
            aria-expanded={drawerTab === 'chapters'}
            title={`${chapter.label}${chapter.title ? ` · ${chapter.title}` : ''} — Open chapters`}
            tabIndex={hudShown ? 0 : -1}
            onClick={event => openModalTab(drawerTab === 'chapters' ? null : 'chapters', event.currentTarget)}
          >
            <span className="af-reader-cap-title">{chapter.label}</span>
          </button>
          {neighbors?.next
            ? <a className="af-reader-cap-arrow" href={neighboringHref(item.id, neighbors.next, back)} aria-label="Next chapter" title="Next chapter" tabIndex={hudShown ? 0 : -1}><Icon name="right" /></a>
            : <button type="button" className="af-reader-cap-arrow" disabled aria-label="No next chapter" tabIndex={-1}><Icon name="right" /></button>}
        </div>
      </div>

      {/* Subtle Floating Right-Edge Vertical Icon Dock */}
      <nav className="af-reader-float af-reader-dock" aria-label="Reader tools" aria-hidden={!hudShown || undefined}>
        <button
          type="button"
          className="af-reader-dock-btn"
          aria-label="Chapters"
          title="Chapters (G)"
          aria-expanded={drawerTab === 'chapters'}
          tabIndex={hudShown ? 0 : -1}
          onClick={event => openModalTab(drawerTab === 'chapters' ? null : 'chapters', event.currentTarget)}
        >
          <Icon name="book" />
        </button>
        <button
          type="button"
          className="af-reader-dock-btn"
          aria-label="Settings"
          title="Reader settings (S)"
          aria-expanded={drawerTab === 'settings'}
          tabIndex={hudShown ? 0 : -1}
          onClick={event => openModalTab(drawerTab === 'settings' ? null : 'settings', event.currentTarget)}
        >
          <Icon name="settings" />
        </button>
        <button
          type="button"
          className="af-reader-dock-btn"
          aria-label={`Image sizing: ${fitLabel}`}
          title={`Image sizing: ${fitLabel} (click to cycle)`}
          tabIndex={hudShown ? 0 : -1}
          onClick={cycleFit}
        >
          <FitIcon />
        </button>
        <button
          type="button"
          className="af-reader-dock-btn"
          aria-label="Fullscreen"
          title={nativeFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
          aria-pressed={nativeFullscreen}
          tabIndex={hudShown ? 0 : -1}
          onClick={() => void toggleFullscreen()}
        >
          <ExpandIcon expanded={nativeFullscreen} />
        </button>
      </nav>

      {/* Ultra-Thin Visual Edge Progress Bar (decorative pointer scrub; keyboard/AT use bottom range slider) */}
      {progressPos !== 'off' && total > 1 && (
        <div
          className={`af-reader-edge-rail is-${progressPos}`}
          aria-hidden="true"
        >
          {total <= 80 ? (
            pages.map((_, idx) => {
              const num = idx + 1;
              const isCurrent = layout === 'scroll' ? num === page : activeSet.has(num);
              const isRead = num < page;
              return (
                <span
                  key={num}
                  className={`af-reader-edge-tick ${isCurrent ? 'is-current' : isRead ? 'is-read' : ''}`}
                  title={`Page ${num} / ${total}`}
                  onClick={event => { event.stopPropagation(); jump(num); }}
                />
              );
            })
          ) : (
            <span className="af-reader-edge-fill" style={{ '--pct': pct } as CSSProperties} />
          )}
        </div>
      )}

      {/* Main Reading Stage */}
      <div
        className="af-reader-stage"
        data-layout={layout}
        onPointerDown={handleStagePointerDown}
        onClick={handleStageClick}
      >
        <p className="sr-only" role="status">Page {page} of {total}</p>
        {saveProblem && <p className="af-state af-reader-save-alert" role="alert">Reading position could not be saved. {saveProblem} <button className="af-text-link" type="button" disabled={!controls.ready || controls.replaying} onClick={() => setResumeAttempt(v => v + 1)}>Retry saving position</button></p>}

        <div
          className={`af-reader-pages ${zoom > 1 ? 'is-zoomed' : ''}`}
          data-layout={layout}
          data-fit={fit}
          data-direction={direction}
          data-seamless={seamlessStrip || undefined}
          style={Object.keys(pageStyle).length ? pageStyle : undefined}
          onDoubleClick={event => {
            if (layout === 'scroll') return;
            event.stopPropagation();
            adjustZoom(zoom > 1 ? 1 : 2);
          }}
          onPointerDown={event => {
            if (zoom <= 1) return;
            dragStateRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: pan.x, originY: pan.y };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            const drag = dragStateRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            setPan({ x: drag.originX + (event.clientX - drag.startX), y: drag.originY + (event.clientY - drag.startY) });
          }}
          onPointerUp={event => {
            if (dragStateRef.current?.pointerId === event.pointerId) dragStateRef.current = null;
          }}
          onPointerCancel={() => { dragStateRef.current = null; }}
          ref={stageRef}
        >
          {visiblePages.map(num => {
            const text = transcript?.pages?.[num - 1];
            return <ReaderImage key={num} page={num} src={pages[num - 1]}
              visible={layout === 'scroll' ? Math.abs(num - page) <= 2 : visiblePages.includes(num)}
              described={typeof text === 'string' && Boolean(text.trim())}
              onLoad={markLoaded} />;
          })}
        </div>

        {zoom > 1 && <button type="button" className="af-reader-zoom-reset" onClick={() => adjustZoom(1)} aria-label="Reset zoom">
          {Math.round(zoom * 100)}% · Reset zoom
        </button>}

        {/* Tap / Click Zones for Single & Double paged modes (in scroll mode, tapping anywhere on stage toggles HUD directly without overlay blockers) */}
        {zoom <= 1 && layout !== 'scroll' && <div className="af-reader-zones">
          <button type="button" tabIndex={-1} className="af-reader-zone af-reader-zone-prev"
            aria-label={direction === 'rtl' ? 'Tap zone: next page' : 'Tap zone: previous page'}
            onClick={direction === 'rtl' ? stepForward : stepBackward} />
          <button type="button" tabIndex={-1} className="af-reader-zone af-reader-zone-center"
            aria-label={hudShown ? 'Tap zone: hide reader controls' : 'Tap zone: show reader controls'}
            onClick={() => {
              window.clearTimeout(zoneClickTimerRef.current);
              zoneClickTimerRef.current = window.setTimeout(() => { toggleHud(); }, 220);
            }}
            onDoubleClick={event => {
              event.stopPropagation();
              window.clearTimeout(zoneClickTimerRef.current);
              adjustZoom(2);
            }} />
          <button type="button" tabIndex={-1} className="af-reader-zone af-reader-zone-next"
            aria-label={direction === 'rtl' ? 'Tap zone: previous page' : 'Tap zone: next page'}
            onClick={direction === 'rtl' ? stepBackward : stepForward} />
        </div>}
      </div>

      {/* Subtle Floating Bottom Scrubber Pill (unmounted when hidden so mobile browsers have zero bottom-fixed blockers on scroll) */}
      {hudShown && <div className="af-reader-float af-reader-float-bottom" role="region" aria-label="Reading progress">
        <div className="af-reader-bottom-pill">
          <button type="button" className="af-reader-cap-arrow" aria-label="Previous page" disabled={(visiblePages[0] ?? page) <= 1 && !neighbors?.previous} onClick={stepBackward}>
            <Icon name="left" />
          </button>
          <input
            className="af-reader-range"
            type="range"
            dir={direction}
            min={1}
            max={total}
            value={page}
            aria-label="Page progress"
            aria-valuetext={`Page ${page} of ${total}`}
            style={{ '--pct': pct } as CSSProperties}
            onChange={event => jump(Number(event.currentTarget.value))}
          />
          <span className="af-reader-page-badge">{pageIndicator}</span>
          <button type="button" className="af-reader-cap-arrow" aria-label="Next page" disabled={(visiblePages[visiblePages.length - 1] ?? page) >= total && !neighbors?.next} onClick={stepForward}>
            <Icon name="right" />
          </button>
        </div>

        {layout !== 'scroll' && (
          <div className="af-reader-zoom-pill" role="group" aria-label="Zoom controls">
            <button type="button" className="af-reader-cap-arrow" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => adjustZoom(zoom - 0.25)}>−</button>
            <button type="button" className="af-reader-zoom-val" aria-label="Reset zoom" onClick={() => adjustZoom(1)}>{zoom.toFixed(1)}×</button>
            <button type="button" className="af-reader-cap-arrow" aria-label="Zoom in" disabled={zoom >= 3} onClick={() => adjustZoom(zoom + 0.25)}>+</button>
          </div>
        )}
      </div>}

      {/* Centered Translucent Settings & Chapters Modal (Base UI Dialog for focus trap & restoration) */}
      <Dialog.Root open={drawerTab !== null} onOpenChange={next => { if (!next) setDrawerTab(null); }}>
        <Dialog.Portal>
          <Dialog.Backdrop className="af-reader-modal-scrim" />
          <Dialog.Popup
            className="af-reader-modal"
            aria-label="Reader menu"
            initialFocus={modalCloseRef}
            finalFocus={() => modalInvokerRef.current?.isConnected ? modalInvokerRef.current : document.getElementById('main')}
          >
            <Dialog.Title className="sr-only">Reader menu</Dialog.Title>
            <div className="af-reader-modal-head">
              <div className="af-reader-modal-tabs" role="tablist" aria-label="Reader menu sections" onKeyDown={handleModalTabKey}>
                <button
                  id="af-reader-tab-settings"
                  type="button"
                  role="tab"
                  aria-selected={drawerTab === 'settings'}
                  aria-controls="af-reader-panel-settings"
                  tabIndex={drawerTab === 'settings' ? 0 : -1}
                  onClick={() => setDrawerTab('settings')}
                >Settings</button>
                <button
                  id="af-reader-tab-chapters"
                  type="button"
                  role="tab"
                  aria-selected={drawerTab === 'chapters'}
                  aria-controls="af-reader-panel-chapters"
                  tabIndex={drawerTab === 'chapters' ? 0 : -1}
                  onClick={() => setDrawerTab('chapters')}
                >Chapters</button>
              </div>
              <Dialog.Close ref={modalCloseRef} className="af-icon-button af-reader-modal-close" aria-label="Close reader menu">
                <Icon name="close" />
              </Dialog.Close>
            </div>

            <div
              className="af-reader-modal-body"
              role="tabpanel"
              id={`af-reader-panel-${drawerTab ?? 'settings'}`}
              aria-labelledby={`af-reader-tab-${drawerTab ?? 'settings'}`}
            >
            {drawerTab === 'settings' ? <>
              <div className="af-reader-control-group">
                <span className="af-reader-control-label">Page style</span>
                <div className="af-reader-segmented" role="group" aria-label="Page style">
                  {([['single', 'Single'], ['double', 'Double'], ['scroll', 'Long strip']] as const).map(([val, lbl]) => (
                    <button key={val} type="button" aria-pressed={layout === val} onClick={() => {
                      writeOption('comicLayout', val);
                      setLayout(val);
                    }}>{lbl}</button>
                  ))}
                </div>
              </div>

              <div className="af-reader-control-group">
                <span className="af-reader-control-label">Reading direction</span>
                <div className="af-reader-segmented" role="group" aria-label="Reading direction">
                  {([['rtl', 'Right to Left'], ['ltr', 'Left to Right']] as const).map(([val, lbl]) => (
                    <button key={val} type="button" aria-pressed={direction === val} onClick={() => {
                      writeOption('comicDirection', val);
                      setDirection(val);
                    }}>{lbl}</button>
                  ))}
                </div>
              </div>

              <div className="af-reader-control-group">
                <span className="af-reader-control-label">Image sizing</span>
                <div className="af-reader-segmented" role="group" aria-label="Image sizing">
                  {([['page', 'Fit both'], ['width', 'Fit width'], ['height', 'Fit height'], ['original', 'No limit']] as const).map(([val, lbl]) => (
                    <button key={val} type="button" aria-pressed={fit === val} onClick={() => {
                      writeOption('comicFit', val);
                      setFit(val);
                    }}>{lbl}</button>
                  ))}
                </div>
              </div>

              <div className="af-reader-control-group">
                <span className="af-reader-control-label">Progress bar</span>
                <div className="af-reader-segmented" role="group" aria-label="Progress bar placement">
                  {([['left', 'Left'], ['bottom', 'Bottom'], ['right', 'Right'], ['off', 'Off']] as const).map(([val, lbl]) => (
                    <button key={val} type="button" aria-pressed={progressPos === val} onClick={() => {
                      writeOption('comicProgressPos', val);
                      setProgressPos(val);
                    }}>{lbl}</button>
                  ))}
                </div>
              </div>

              <div className="af-reader-toggles-box">
                {layout === 'double' && <label className="af-reader-toggle">
                  <span>Offset cover page (solo page 1)</span>
                  <input type="checkbox" checked={offsetCover} onChange={e => { setOffsetCover(e.target.checked); writeOption('comicOffsetCover', e.target.checked); }} />
                </label>}

                {layout === 'scroll' && <label className="af-reader-toggle">
                  <span>Seamless strip (no page gaps)</span>
                  <input type="checkbox" checked={seamlessStrip} onChange={e => { setSeamlessStrip(e.target.checked); writeOption('comicSeamless', e.target.checked); }} />
                </label>}

                <label className="af-reader-toggle">
                  <span>Pin controls while scrolling</span>
                  <input type="checkbox" checked={pinHud} onChange={e => { setPinHud(e.target.checked); setHudVisible(true); writeOption('comicPinHud', e.target.checked); }} />
                </label>
              </div>

              <div className="af-reader-divider" />

              <div className="af-reader-control-group">
                <div className="af-reader-slider-head">
                  <label htmlFor="af-reader-dim" className="af-reader-control-label">Dim screen</label>
                  <span className="af-meta">{dimLevel}%</span>
                </div>
                <input
                  id="af-reader-dim"
                  className="af-reader-range af-reader-dim-slider"
                  type="range"
                  min={0}
                  max={60}
                  step={5}
                  value={dimLevel}
                  style={{ '--pct': `${(dimLevel / 60) * 100}%` } as CSSProperties}
                  onChange={e => {
                    const next = Number(e.currentTarget.value);
                    setDimLevel(next);
                    writeOption('comicDim', next);
                  }}
                />
              </div>

              <div className="af-reader-toggles-box">
                <label className="af-reader-toggle">
                  <span>Grayscale pages</span>
                  <input type="checkbox" checked={grayscale} onChange={e => { setGrayscale(e.target.checked); writeOption('comicGrayscale', e.target.checked); }} />
                </label>

                <label className="af-reader-toggle">
                  <span>True black OLED canvas</span>
                  <input type="checkbox" checked={oledMode} onChange={e => { setOledMode(e.target.checked); writeOption('comicOled', e.target.checked); }} />
                </label>
              </div>

              <div className="af-reader-control-group">
                <span className="af-reader-control-label">Zoom ({Math.round(zoom * 100)}%)</span>
                <div className="af-reader-segmented" role="group" aria-label="Zoom">
                  <button type="button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => adjustZoom(zoom - 0.25)}>−</button>
                  <button type="button" aria-pressed={zoom === 1} onClick={() => adjustZoom(1)}>100%</button>
                  <button type="button" aria-label="Zoom in" disabled={zoom >= 3} onClick={() => adjustZoom(zoom + 0.25)}>+</button>
                </div>
              </div>

              <div className="af-reader-shortcuts">
                <span className="af-reader-control-label">Shortcuts</span>
                <div><span>Turn page</span><kbd>← / →</kbd></div>
                <div><span>Toggle controls</span><kbd>M / X</kbd></div>
                <div><span>Chapters</span><kbd>G</kbd></div>
                <div><span>Settings</span><kbd>S</kbd></div>
                <div><span>Flip RTL / LTR</span><kbd>D</kbd></div>
                <div><span>Zoom</span><kbd>+ / − / 0</kbd></div>
                <div><span>Fullscreen</span><kbd>F</kbd></div>
              </div>
            </> : <>
              <div className="af-reader-chapter-meta">
                <strong>{item.title}</strong>
                <span className="af-meta">{comicLanguage(chapter.language)} · {total} {total === 1 ? 'page' : 'pages'}{credit ? ` · ${credit}` : ''}</span>
              </div>
              {navError && <p className="af-meta" role="alert">{navError} <button type="button" className="af-text-link" onClick={() => { setNavError(''); setNavigationAttempt(v => v + 1); }}>Retry</button></p>}
              {chapterList.length > 0 && <label className="af-reader-chapter-search-wrap">
                <span className="sr-only">Search chapters</span>
                <input
                  type="search"
                  className="af-select af-input af-reader-chapter-search"
                  placeholder="Search chapter # or title"
                  value={chapterFilter}
                  onChange={event => setChapterFilter(event.target.value)}
                />
              </label>}
              {chapterList.length > 0 ? <div className="af-reader-chapter-list">
                {chapterList.filter(entry => {
                  const needle = chapterFilter.trim().toLowerCase();
                  if (!needle) return true;
                  return String(entry.number ?? '').toLowerCase().includes(needle)
                    || entry.label.toLowerCase().includes(needle)
                    || (entry.title?.toLowerCase().includes(needle) ?? false);
                }).map(entry => (
                  <a key={entry.id}
                    ref={entry.id === chapter.id ? activeChapterRef : undefined}
                    className="af-reader-chapter-item"
                    aria-current={entry.id === chapter.id ? 'page' : undefined}
                    href={neighboringHref(item.id, { entry, page: 1 }, back)}
                    onClick={() => setDrawerTab(null)}>
                    <span>{entry.label}{entry.title ? ` · ${entry.title}` : ''}</span>
                    {entry.id === chapter.id && <Icon name="check" />}
                  </a>
                ))}
              </div> : <p className="af-meta">Loading chapter list…</p>}
              <a className="af-text-link" href={listHref}><Icon name="book" /> Back to manga details</a>
            </>}
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>

    {/* Clean end-of-chapter footer & accessible transcript */}
    <div className="af-wrap af-reader-footer-wrap">
      <footer className="af-reader-end">
        <div className="af-reader-end-meta">
          <span className="af-meta">End of {chapter.label}{chapter.title ? ` · ${chapter.title}` : ''}</span>
          <a className="af-text-link" href={listHref}><Icon name="book" /> All chapters</a>
        </div>
        {neighbors && (neighbors.previous || neighbors.next) && <nav className="af-actions" aria-label="Chapter navigation after reading">
          {neighbors.previous && <ActionLink href={neighboringHref(item.id, neighbors.previous, back)}><Icon name="left" /> Previous chapter</ActionLink>}
          {neighbors.next && <ActionLink primary href={neighboringHref(item.id, neighbors.next, back)}>Next chapter <Icon name="right" /></ActionLink>}
        </nav>}
      </footer>
      <Transcript transcript={transcript} count={total} />
    </div>
  </section>;
}
