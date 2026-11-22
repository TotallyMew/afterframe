import { comicEditionCredit, comicLanguage } from '../../../afterframe/public/comic-display.js';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { request, routeWithParams, webHref, type Comic } from './catalog';
import { ActionLink, Icon, Loading } from './components';
import type { LibraryControls } from './library';
import './comic-reader.css';

type ReaderComic = Comic & { longStrip?: boolean };
type Chapter = { id: string; title?: string; label: string; language: string; groups?: { name?: string }[]; source?: string };
type ChapterContent = { chapter: Chapter; pages: string[]; transcript?: { pages?: string[]; source?: string } };
type Neighbor = { entry: Chapter; page: number };
type ChapterNavigation = { previous: Neighbor | null; next: Neighbor | null };
type ReaderData = ChapterContent & { item: ReaderComic };
type Layout = 'pages' | 'scroll';
type Fit = 'page' | 'width';

function readOption(key: string) {
  try { return JSON.parse(localStorage.getItem(`afterframe.${key}`) || 'null') as unknown; }
  catch { return null; }
}

function writeOption(key: string, value: string) {
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
  if (!data) return <section className="af-wrap af-comic-reader">
    <a className="af-text-link" href={backHref}><Icon name="left" /> Back to chapters</a>
    <h1>{error ? 'Chapter unavailable' : 'Comic reader'}</h1>
    {error ? <p className="af-state" role="alert">{error} <button className="af-text-link" type="button" onClick={retry}>Retry chapter</button></p>
      : <Loading label="Loading chapter…" shape="hero" />}
  </section>;
  if (!data.pages.length) return <section className="af-wrap af-comic-reader">
    <a className="af-text-link" href={backHref}><Icon name="left" /> {data.item.title}</a>
    <h1>{data.chapter.label}</h1>
    <p className="af-state" role="status">This edition has no pages available.</p>
    <ActionLink href={backHref}>Back to chapters</ActionLink>
  </section>;
  return <ChapterReader key={`${chapterId}:${position}`} data={data} listPage={listPage} requestedPage={position} controls={controls} back={back} />;
}

function ChapterLinks({ id, neighbors, back, label }: { id: string; neighbors: ChapterNavigation; back: string; label: string }) {
  if (!neighbors.previous && !neighbors.next) return null;
  return <nav className="af-actions af-reader-chapter-links" aria-label={label}>
    {neighbors.previous && <ActionLink href={neighboringHref(id, neighbors.previous, back)}><Icon name="left" /> Previous chapter</ActionLink>}
    {neighbors.next && <ActionLink href={neighboringHref(id, neighbors.next, back)}>Next chapter <Icon name="right" /></ActionLink>}
  </nav>;
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

function ReaderImage({ page, src, visible, described, onLoad }: { page: number; src: string; visible: boolean; described: boolean; onLoad: (page: number) => void }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Retrying the same proxy address without its cached failure lets the server obtain a fresh manifest.
  const address = src && attempt ? `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}` : src;
  return <div className="af-reader-page" data-page-number={page} data-page-loaded={loaded || undefined}>
    {failed || !address ? <div className="af-reader-page-state" role="status">
      <p>Page {page} could not be loaded.</p>
      {address && <button className="af-button af-secondary" type="button" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Retry page {page}</button>}
    </div> : <>
      {!loaded && visible && <p className="af-reader-page-state" role="status">Loading page {page}…</p>}
      <img key={address} src={address} alt={`Comic page ${page}`} aria-describedby={described ? `comic-transcript-page-${page}` : undefined}
        aria-hidden={!loaded || undefined} loading={visible ? 'eager' : 'lazy'} decoding="async"
        onLoad={() => { setLoaded(true); onLoad(page); }} onError={() => { setLoaded(false); setFailed(true); }} />
    </>}
  </div>;
}

function ExpandIcon({ expanded }: { expanded: boolean }) {
  return <svg className="af-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={expanded ? 'M4 9h5V4m6 0v5h5m0 6h-5v5m-6 0v-5H4' : 'M9 4H4v5m16 0V4h-5m0 16h5v-5M4 15v5h5'} />
  </svg>;
}

function ChapterReader({ data: { item, chapter, pages, transcript }, listPage, requestedPage, controls, back }: {
  data: ReaderData; listPage: number; requestedPage: number; controls: LibraryControls; back: string;
}) {
  const recent = controls.library.reading[item.key];
  const total = pages.length;
  const bounded = (page: number) => Math.max(1, Math.min(total, page));
  const start = bounded(requestedPage || (recent?.chapter === chapter.id && controls.ready ? recent.page : 1));
  const [page, setPage] = useState(start);
  const [loaded, setLoaded] = useState<Set<number>>(() => new Set());
  const [layout, setLayout] = useState<Layout>(() => {
    const saved = readOption('comicLayout');
    return saved === 'scroll' || saved === 'pages' ? saved : item.longStrip ? 'scroll' : 'pages';
  });
  const [fit, setFit] = useState<Fit>(() => readOption('comicFit') === 'width' ? 'width' : 'page');
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [neighbors, setNeighbors] = useState<ChapterNavigation | null>();
  const [navError, setNavError] = useState('');
  const [navigationAttempt, setNavigationAttempt] = useState(0);
  const [resumeAttempt, setResumeAttempt] = useState(0);
  const [alignmentRequest, realign] = useState(0);
  const resumeResolved = useRef(Boolean(requestedPage || controls.state !== 'loading'));
  const pendingAlign = useRef(start > 1 ? start : 0);
  const lastAttempt = useRef<{ accountId: number | null; page: number; retry: number } | undefined>(undefined);
  const viewer = useRef<HTMLElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const fullscreen = nativeFullscreen || expanded;
  const listHref = chaptersHref(item.id, chapter.language, listPage, chapter.id, back);
  const mutationKey = `reading/${item.key}`;
  const saveProblem = controls.problems[mutationKey];

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ lang: chapter.language, page: String(listPage), chapter: chapter.id });
    request<{ neighbors?: ChapterNavigation | null; partial?: boolean }>(`/api/comics/${item.id}/chapters?${params}`, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        setNeighbors(result.neighbors ?? null);
        if (result.partial) setNavError('Some chapter sources are unavailable.');
      }).catch(() => { if (!controller.signal.aborted) setNavError('Chapter navigation could not load.'); });
    return () => controller.abort();
  }, [item.id, chapter.id, chapter.language, listPage, navigationAttempt]);

  useEffect(() => {
    if (!resumeResolved.current && controls.state !== 'loading') {
      resumeResolved.current = true;
      pendingAlign.current = start > 1 ? start : 0;
      setPage(start);
    }
  }, [controls.state, start]);

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

  useLayoutEffect(() => {
    const modal = dialog.current;
    if (!modal) return;
    if (expanded && !modal.open) modal.showModal();
    if (!expanded && modal.open) { modal.close(); expandButton.current?.focus({ preventScroll: true }); }
  }, [expanded]);

  useEffect(() => {
    const change = () => {
      pendingAlign.current = page;
      setNativeFullscreen(document.fullscreenElement === viewer.current);
    };
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, [page]);

  useLayoutEffect(() => {
    const element = toolbar.current;
    if (!element || !viewer.current) return;
    const container = viewer.current;
    const measure = () => {
      container.style.setProperty('--reader-toolbar', `${Math.ceil(element.getBoundingClientRect().height)}px`);
    };
    const observer = new ResizeObserver(measure);
    measure();
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded]);

  useLayoutEffect(() => {
    const target = pendingAlign.current;
    if (!target || !stage.current) return;
    const tick = requestAnimationFrame(() => {
      const slot = stage.current?.querySelector(`[data-page-number="${target}"]`);
      if (!slot || !toolbar.current) return;
      const scroller = expanded ? dialog.current : nativeFullscreen ? viewer.current : window;
      const header = fullscreen ? 0 : document.querySelector('.af-header')?.getBoundingClientRect().height ?? 0;
      const offset = getComputedStyle(toolbar.current).position === 'sticky' ? toolbar.current.offsetHeight + header : header;
      scroller?.scrollBy({ top: slot.getBoundingClientRect().top - offset, behavior: 'instant' });
      pendingAlign.current = 0;
    });
    return () => cancelAnimationFrame(tick);
  }, [page, fit, layout, expanded, nativeFullscreen, fullscreen, alignmentRequest]);

  useEffect(() => {
    if (layout !== 'scroll') return;
    const scroller = expanded ? dialog.current : nativeFullscreen ? viewer.current : window;
    let timer: number | undefined;
    const track = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const marker = Math.min(window.innerHeight - 1, (toolbar.current?.getBoundingClientRect().bottom ?? 0) + 24);
        const slots = stage.current?.children;
        if (!slots || pendingAlign.current || marker < 0) return;
        let low = 0, high = slots.length;
        while (low < high) {
          const middle = Math.floor((low + high) / 2);
          if (slots[middle].getBoundingClientRect().bottom > marker) high = middle;
          else low = middle + 1;
        }
        if (slots[low] && slots[low].getBoundingClientRect().top < window.innerHeight) {
          resumeResolved.current = true;
          setPage(low + 1);
        }
      }, 120);
    };
    scroller?.addEventListener('scroll', track, { passive: true });
    return () => { scroller?.removeEventListener('scroll', track); clearTimeout(timer); };
  }, [layout, nativeFullscreen, expanded]);

  function jump(next: number) {
    if (next < 1 || next > total) return;
    resumeResolved.current = true;
    pendingAlign.current = next;
    if (next === page) realign(value => value + 1);
    else setPage(next);
  }

  async function toggleFullscreen() {
    pendingAlign.current = page;
    if (expanded) { setExpanded(false); return; }
    if (nativeFullscreen) { await document.exitFullscreen().catch(() => {}); return; }
    const container = viewer.current;
    if (container && document.fullscreenEnabled) {
      try { await container.requestFullscreen(); return; } catch { /* The browser may restrict native fullscreen. */ }
    }
    if (container?.isConnected) setExpanded(true);
  }

  function shortcuts(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        target.closest('input, select, textarea, [contenteditable]') || document.querySelector('dialog[open]:not(.af-reader-expanded)')) return;
    if (event.key.toLowerCase() === 'f' && viewer.current?.contains(target)) {
      event.preventDefault();
      void toggleFullscreen();
    } else if (layout === 'pages' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      jump(page + (event.key === 'ArrowLeft' ? -1 : 1));
    }
  }

  function markLoaded(number: number) {
    setLoaded(current => current.has(number) ? current : new Set([...current, number]));
  }

  const fullscreenLabel = fullscreen ? 'Exit fullscreen' : 'Fullscreen';
  const view = <section className="af-reader-view" tabIndex={0} aria-label="Chapter reader" ref={viewer}>
    <div className="af-reader-toolbar" ref={toolbar}>
      <div className="af-reader-paging">
        <button className="af-icon-button" type="button" disabled={page <= 1} aria-label="Previous page" onClick={() => jump(page - 1)}><Icon name="left" /></button>
        <label><span>Page</span><select className="af-select" value={page} onChange={event => jump(Number(event.currentTarget.value))}>
          {pages.map((_, index) => <option value={index + 1} key={index}>{index + 1} / {total}</option>)}
        </select></label>
        <button className="af-icon-button" type="button" disabled={page >= total} aria-label="Next page" onClick={() => jump(page + 1)}><Icon name="right" /></button>
      </div>
      <div className="af-reader-options">
        <label><span>Layout</span><select className="af-select" value={layout} onChange={event => {
          const value = event.currentTarget.value as Layout;
          pendingAlign.current = page;
          writeOption('comicLayout', value);
          setLayout(value);
        }}><option value="pages">Single page</option><option value="scroll">Vertical scroll</option></select></label>
        {layout === 'pages' && <label><span>Fit</span><select className="af-select" value={fit} onChange={event => {
          const value = event.currentTarget.value as Fit;
          pendingAlign.current = page;
          writeOption('comicFit', value);
          setFit(value);
        }}><option value="page">Whole page</option><option value="width">Width</option></select></label>}
        <button ref={expandButton} type="button" className="af-icon-button" autoFocus={expanded} aria-label={fullscreenLabel} title={fullscreenLabel} onClick={() => void toggleFullscreen()}><ExpandIcon expanded={fullscreen} /></button>
      </div>
    </div>
    <p className="sr-only" role="status">Page {page} of {total}</p>
    <div className="af-reader-pages" data-layout={layout} data-fit={fit} ref={stage}>
      {(layout === 'scroll' ? pages.map((_, index) => index + 1) : [page]).map(number => {
        const text = transcript?.pages?.[number - 1];
        return <ReaderImage key={number} page={number} src={pages[number - 1]}
          visible={number === page} described={typeof text === 'string' && Boolean(text.trim())} onLoad={markLoaded} />;
      })}
    </div>
  </section>;
  const credit = comicEditionCredit(chapter);
  return <section className="af-wrap af-comic-reader" onKeyDown={shortcuts}>
    <header className="af-reader-heading">
      <div><a className="af-text-link" href={listHref}><Icon name="left" /> {item.title}</a>
        <h1>{chapter.label}{chapter.title ? ` · ${chapter.title}` : ''}</h1>
        <p className="af-meta">{comicLanguage(chapter.language)} · {total} {total === 1 ? 'page' : 'pages'}{credit ? ` · ${credit}` : ''}</p></div>
      {neighbors && <ChapterLinks id={item.id} neighbors={neighbors} back={back} label="Chapter navigation" />}
    </header>
    {navError ? <p className="af-meta" role="status">{navError} <button className="af-text-link" type="button" onClick={() => { setNavError(''); setNavigationAttempt(value => value + 1); }}>Retry chapter navigation</button></p>
      : neighbors === undefined && <p className="sr-only" role="status">Loading chapter navigation…</p>}
    <Transcript transcript={transcript} count={total} />
    {saveProblem && <p className="af-state" role="alert">Reading position could not be saved. {saveProblem} <button className="af-text-link" type="button" disabled={!controls.ready || controls.replaying} onClick={() => setResumeAttempt(value => value + 1)}>Retry saving position</button></p>}
    {!expanded && view}
    <dialog className="af-reader-expanded" aria-label="Fullscreen chapter reader" ref={dialog} onCancel={event => { event.preventDefault(); pendingAlign.current = page; setExpanded(false); }}>
      {expanded && view}
    </dialog>
    <footer className="af-reader-end">
      <a className="af-text-link" href={listHref}><Icon name="book" /> All chapters</a>
      {neighbors && <ChapterLinks id={item.id} neighbors={neighbors} back={back} label="Chapter navigation after reading" />}
    </footer>
  </section>;
}
