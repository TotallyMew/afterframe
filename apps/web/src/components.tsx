import { Dialog } from '@base-ui/react/dialog';
import { Popover } from '@base-ui/react/popover';
import { isAnime } from '@afterframe/shared/discover';
import { Children, memo, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { comicCover, comicDetailsHref, formatDate, imagePath, libraryItemHref, navigate, normalizeTitles, request, resumeHref, searchHref, titleHref, webHref, type CatalogRating, type Comic, type Title, type TitleResults } from './catalog';
import { AccountButton } from './Account';
import { resumeEntries, type LibraryControls } from './library';
import { useSettings } from './settings-context';

const glyphs = {
  play: <path d="m8 4 12 8-12 8z" fill="currentColor" stroke="none" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12 4 4L19 6" />,
  search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4 4" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  left: <path d="m15 6-6 6 6 6" />,
  right: <path d="m9 6 6 6-6 6" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  bookmark: <path d="M6 4h12v17l-6-4-6 4z" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M10 3h4l.7 2.8 2 .9 2.5-.9 2 3.5-1.9 2v2.1l1.9 2-2 3.5-2.5-.9-2 .9L14 21h-4l-.7-2.1-2-.9-2.5.9-2-3.5 1.9-2v-2.1l-1.9-2 2-3.5 2.5.9 2-.9z" /></>,
  eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
  book: <><path d="M12 6v15M3 5a9 9 0 0 1 9 1 9 9 0 0 1 9-1v14a9 9 0 0 0-9 2 9 9 0 0 0-9-2z" /></>,
  film: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4m-4 6h4m10-6h4m-4 6h4" /></>,
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5.5v-6.5h-5V21H4a1 1 0 0 1-1-1z" />,
  bell: <><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9" /><path d="M10 19a2 2 0 0 0 4 0" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.2" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.2" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.2" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.2" /></>,
  list: <><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" /></>,
  more: <><circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none" /></>,
} satisfies Record<string, ReactNode>;

export function Icon({ name }: { name: keyof typeof glyphs }) {
  return <svg className="af-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{glyphs[name]}</svg>;
}

export function Artwork({ fallback, src, ...props }: ComponentProps<'img'> & { fallback?: ReactNode }) {
  const [failed, setFailed] = useState<string>();
  return src && failed !== src ? <img {...props} src={src} alt={props.alt ?? ''} onError={() => setFailed(src)} /> : fallback;
}

function tmdbImageSet(src: string | undefined, widths: readonly number[]) {
  const path = src?.match(/^https:\/\/image\.tmdb\.org\/t\/p\/w\d+(\/[a-z0-9]+\.(?:jpg|png|webp))$/i)?.[1];
  if (path) return widths.map(width => `${imagePath(path, `w${width}`)} ${width}w`).join(', ');
}

export function HeroBackdrop({ src, sizes }: { src?: string; sizes: string }) {
  return <Artwork className="af-backdrop" src={src} srcSet={tmdbImageSet(src, [300, 780, 1280])}
    sizes={sizes} fetchPriority="high" />;
}

export function Loading({ label, shape = 'posters' }: { label: string; shape?: 'posters' | 'releases' | 'hero' | 'rows' | 'details' }) {
  const count = { posters: 6, releases: 3, hero: 1, rows: 3, details: 4 }[shape];
  return <div data-route-loading={shape === 'hero' || shape === 'details' ? true : undefined}>
    {label && <p className="af-state" role="status">{label}</p>}
    <div className={`af-placeholder af-placeholder-${shape}`} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => <span key={index} />)}
    </div>
  </div>;
}

export function CatalogProblem({ error, retry }: { error: string; retry: () => void }) {
  const [managed, setManaged] = useState<boolean>();
  const openSettings = useSettings();
  const setup = /(?:connect the catalog|tmdb credential|film and tv catalog|catalog key|catalog rejected the api credential)/i.test(error);
  useEffect(() => {
    if (!setup) return;
    const task = new AbortController();
    request<{ managedIntegrations: boolean }>('/api/status', { signal: task.signal })
      .then(result => setManaged(result.managedIntegrations)).catch(() => {});
    return () => task.abort();
  }, [setup]);
  if (setup) {
    return <section className="af-setup-guide" aria-label="Catalog setup">
      <div className="af-setup-header">
        <span className="af-empty-emblem" aria-hidden="true"><Icon name="film" /></span>
        <div>
          <h2>Connect your film and TV catalog</h2>
          <p className="af-meta" role="alert">
            {managed
              ? 'The film and TV catalog is unavailable. Ask the server administrator to check its credentials.'
              : error}
          </p>
        </div>
      </div>
      {managed !== true && <p className="af-meta af-setup-hint">
        Add a free TMDB Read Access Token or API key in Settings to unlock movies, TV shows, anime schedules, and release notifications.
      </p>}
      <div className="af-actions">
        {managed !== true && <button className="af-button af-primary" type="button" onClick={event => openSettings('integrations', event.currentTarget, retry)}>Configure catalog</button>}
        <ActionLink href={webHref('comics')}>Browse manga</ActionLink>
        <ActionLink href={webHref('edition/sintel')}>Watch free classic</ActionLink>
        <ActionLink href={webHref('watchlist')}>Open library</ActionLink>
      </div>
    </section>;
  }
  return <div className="af-empty-state">
    <span className="af-empty-emblem" aria-hidden="true"><Icon name="film" /></span>
    <div className="af-empty-copy">
      <p role="alert">{error}</p>
      <div className="af-actions">
        <button type="button" className="af-button af-secondary" onClick={retry}>Retry</button>
      </div>
    </div>
  </div>;
}

export function MutationStatus({ itemKey, controls, pending = 'Saving…' }: { itemKey: string; controls: LibraryControls; pending?: string }) {
  return controls.problems[itemKey] ? <span className="af-mutation-message" role="alert">{controls.problems[itemKey]}</span>
    : controls.isPending(itemKey) ? <span className="af-mutation-message" role="status">{controls.completing.includes(itemKey) ? 'Marking aired episodes…' : pending}</span> : null;
}

export function ActionLink({ href, primary = false, children, label }: { href: string; primary?: boolean; children: ReactNode; label?: string }) {
  return <a className={`af-button ${primary ? 'af-primary' : 'af-secondary'}`} href={href} aria-label={label}>{children}</a>;
}

export function SaveButton({ item, controls, compact = false }: { item: Title | Comic; controls: LibraryControls; compact?: boolean }) {
  const saved = Boolean(controls.library.saved[item.key]);
  const list = item.type === 'comic' ? 'Reading' : 'Library';
  return <><button type="button" className={compact ? 'af-icon-button af-card-save' : 'af-button af-secondary'}
    aria-pressed={saved} aria-label={compact ? `${saved ? 'Remove from' : 'Add to'} ${list}: ${item.title}` : undefined}
    aria-busy={controls.isPending(item.key)} disabled={!controls.ready || controls.isPending(item.key)} onClick={() => void controls.toggleSaved(item)}>
    <Icon name={saved ? 'check' : 'plus'} />{!compact && (saved ? `In ${list}` : list)}
  </button><MutationStatus itemKey={item.key} controls={controls} /></>;
}

export function useOptionalRating<T>(url?: string) {
  const [result, setResult] = useState<{ url: string; value?: T; failed?: boolean }>();
  const [attempt, retry] = useState(0);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (!url) return;
    const task = new AbortController();
    request<{ rating: T | null }>(url, { signal: task.signal })
      .then(({ rating }) => {
        if (!task.signal.aborted) setResult({ url, value: rating ?? undefined });
      })
      .catch(() => { if (!task.signal.aborted) setResult({ url, failed: true }); })
      .finally(() => { if (!task.signal.aborted) setRetrying(false); });
    return () => task.abort();
  }, [url, attempt]);
  const current = result?.url === url ? result : undefined;
  return { value: current?.value, failed: current?.failed, retrying, retry: () => {
    setRetrying(true);
    retry(count => count + 1);
  } };
}

export function RatingProblem({ name, rating }: { name: string; rating: ReturnType<typeof useOptionalRating> }) {
  if (!rating.failed && !rating.retrying) return null;
  return <p className="af-meta" role="status">{rating.retrying ? `Checking ${name}…` : <>
    {name} rating could not load. <button type="button" className="af-text-link" onClick={rating.retry}>Retry {name}</button>
  </>}</p>;
}

export function Score({ rating, mal }: { rating?: CatalogRating; mal?: number }) {
  return <>
    {rating && rating.score > 0 && <span className="af-score" title={rating.votes ? `${rating.votes.toLocaleString()} IMDb votes` : undefined}><span aria-hidden="true">★</span> {rating.score.toFixed(1)} <small>IMDb</small></span>}
    {mal != null && mal > 0 && <span className="af-score">{mal.toFixed(2)} <small>MAL</small></span>}
  </>;
}

export const MediaCard = memo(function MediaCard({ item, controls, href, context, percent, landscape = false, eager, onDismiss }: {
  item: Title; controls: LibraryControls; href?: string; context?: string; percent?: number; landscape?: boolean; eager?: boolean; onDismiss?: () => void;
}) {
  const label = [item.year, landscape ? item.type === 'tv' ? 'TV series' : 'Movie' : item.genre].filter(Boolean).join(' · ');
  const art = landscape ? item.backdrop || item.poster : item.poster;
  const backdrop = landscape ? item.backdrop : undefined;
  const tmdbBackdrop = backdrop?.startsWith('https://image.tmdb.org/t/p/w1280/') ? backdrop : undefined;
  const srcSet = backdrop ? tmdbImageSet(backdrop, [300, 780]) : tmdbImageSet(item.poster, [185, 342, 500]);
  return <article className="af-media-card">
    <a href={href ?? titleHref(item)}>
      <span className={`af-poster ${landscape ? 'af-landscape' : ''} ${landscape && !item.backdrop && item.poster ? 'af-landscape-fallback' : ''}`}>
        {<Artwork fallback={<Icon name="film" />} src={tmdbBackdrop ? tmdbBackdrop.replace('/w1280/', '/w780/') : art} srcSet={srcSet}
          sizes={landscape ? '(max-width: 600px) 70vw, 320px' : '(max-width: 480px) 46vw, (max-width: 760px) 31vw, (max-width: 1040px) 23vw, 220px'}
          alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" />}
        {context && <span className="af-resume-icon"><Icon name="play" /></span>}
        {percent != null && <progress className="af-progress af-card-progress" max={100} value={percent} aria-label={`${item.title} progress`} />}
      </span>
      <strong>{item.title}</strong>
      <span className="af-card-meta">{context || label}</span>
      {!context && <Score rating={item.rating} mal={item.mal} />}
    </a>
    {onDismiss ? <button type="button" className="af-icon-button af-card-save af-card-dismiss"
      aria-label={`Remove ${item.title} from Continue Watching`} title="Remove from Continue Watching"
      onClick={onDismiss}><Icon name="close" /></button>
      : !context && <SaveButton item={item} controls={controls} compact />}
  </article>;
});

export function Shelf({ title, children, href, hrefLabel = 'View all', actions, landscape = false }: {
  title: string; children: ReactNode; href?: string; hrefLabel?: string; actions?: ReactNode; landscape?: boolean;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ previous: false, next: false });
  const childCount = Children.count(children);

  useEffect(() => {
    const node = rail.current;
    if (!node) return;
    const measure = () => {
      const previous = node.scrollLeft > 1;
      const next = node.scrollWidth - node.clientWidth - node.scrollLeft > 1;
      setEdges(current => current.previous === previous && current.next === next ? current : { previous, next });
    };
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    node.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => { resize.disconnect(); node.removeEventListener('scroll', measure); };
  }, [childCount, landscape]);

  function scroll(direction: number) {
    const node = rail.current;
    node?.scrollBy({ left: direction * node.clientWidth * .8, behavior: (document.documentElement.classList.contains('reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches) ? 'instant' : 'smooth' });
  }
  return <section className="af-section" aria-label={title}>
    <header className="af-section-head">
      <div className="af-section-head-main">
        <h2>{title}</h2>
        {href && <a className="af-text-link af-section-link" href={href}>{hrefLabel} <Icon name="right" /></a>}
      </div>
      {(actions || edges.previous || edges.next) && <div className="af-shelf-controls">
        {actions}
        {(edges.previous || edges.next) && <div className="af-shelf-arrows">
          <button type="button" className="af-icon-button" aria-label={`Scroll ${title} left`} disabled={!edges.previous} onClick={() => scroll(-1)}><Icon name="left" /></button>
          <button type="button" className="af-icon-button" aria-label={`Scroll ${title} right`} disabled={!edges.next} onClick={() => scroll(1)}><Icon name="right" /></button>
        </div>}
      </div>}
    </header>
    <div className={`af-rail ${landscape ? 'af-wide-rail' : ''}`} ref={rail}>{children}</div>
  </section>;
}

const pages = [
  ['Movies', 'movies'], ['TV Shows', 'tv'], ['Anime', 'anime'],
  ['Manga', 'comics'], ['Releases', 'new'], ['For You', 'recommendations'],
];

type SearchEntry =
  | { kind: 'video'; key: string; title: string; subtitle: string; href: string; art?: string; mediaType: 'movie' | 'tv'; mediaId: number; rating?: CatalogRating; mal?: number }
  | { kind: 'comic'; key: string; title: string; subtitle: string; href: string; art?: string; malId?: number | null; mal?: number }
  | { kind: 'library'; key: string; title: string; subtitle: string; href: string; art?: string; isComic: boolean }
  | { kind: 'command'; key: string; title: string; subtitle: string; icon: keyof typeof glyphs; run: () => void };

const comicFormatNames: Record<string, string> = { manga: 'Manga', manhwa: 'Manhwa', manhua: 'Manhua', comic: 'Comic' };
const recentSearchKey = 'afterframe.recentSearches';

function readRecentSearches(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(recentSearchKey) || '[]');
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, 5) : [];
  } catch { return []; }
}

function saveRecentSearch(term: string) {
  const clean = term.trim();
  if (!clean) return;
  try {
    const next = [clean, ...readRecentSearches().filter(item => item.toLowerCase() !== clean.toLowerCase())].slice(0, 5);
    localStorage.setItem(recentSearchKey, JSON.stringify(next));
  } catch { /* Storage optional. */ }
}

function Search({ open, close, finalFocus, controls }: { open: boolean; close: () => void; finalFocus: () => HTMLElement | false | null; controls: LibraryControls }) {
  const [query, setQuery] = useState('');
  const [remoteResults, setRemoteResults] = useState<Extract<SearchEntry, { kind: 'video' | 'comic' }>[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => readRecentSearches());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(-1);
  const [attempt, setAttempt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const openSettings = useSettings();

  useEffect(() => {
    if (open) setRecentSearches(readRecentSearches());
  }, [open]);

  const trimmed = query.trim();
  const needle = trimmed.toLowerCase();

  const quickCommands: Extract<SearchEntry, { kind: 'command' }>[] = [
    { kind: 'command', key: 'cmd-watchlist', title: 'Library', subtitle: 'Open your library, stats, ratings, and history', icon: 'bookmark', run: () => { navigate('watchlist'); close(); } },
    { kind: 'command', key: 'cmd-comics', title: 'Manga', subtitle: 'Browse and read manga, manhwa, and manhua', icon: 'book', run: () => { navigate('comics'); close(); } },
    { kind: 'command', key: 'cmd-releases', title: 'New Releases', subtitle: 'Weekly movies and TV releases', icon: 'clock', run: () => { navigate('new'); close(); } },
    { kind: 'command', key: 'cmd-settings', title: 'Settings', subtitle: 'Playback, spoilers, interface, and API keys', icon: 'settings', run: () => { close(); openSettings('general', null); } },
    { kind: 'command', key: 'cmd-shortcuts', title: 'Keyboard shortcuts', subtitle: 'View all keyboard shortcuts (?)', icon: 'search', run: () => { close(); window.dispatchEvent(new Event('afterframe-shortcuts')); } },
  ];

  const continueItems: Extract<SearchEntry, { kind: 'library' }>[] = !trimmed ? [
    ...resumeEntries(controls.library).slice(0, 2).map(([key, entry]) => ({
      kind: 'library' as const,
      key: `resume-${key}`,
      title: entry.item.title,
      subtitle: entry.episode ? `Continue watching · S${entry.episode.season} E${entry.episode.number}` : 'Continue watching',
      href: resumeHref(entry.item, key, entry.episode),
      art: entry.item.poster,
      isComic: false,
    })),
    ...Object.values(controls.library.reading).sort((a, b) => b.updated - a.updated).slice(0, 1).map(entry => ({
      kind: 'library' as const,
      key: `reading-${entry.item.key}`,
      title: entry.item.title,
      subtitle: `Continue reading · ${entry.label} · Page ${entry.page}`,
      href: webHref(`comic/${encodeURIComponent(entry.item.id)}/read/${encodeURIComponent(entry.chapter)}?lang=${encodeURIComponent(entry.language)}&position=${entry.page}`),
      art: comicCover(entry.item.poster),
      isComic: true,
    })),
  ] : [];

  const libraryMatches: Extract<SearchEntry, { kind: 'library' }>[] = trimmed
    ? Object.values(controls.library.saved)
      .filter(item => item.title.toLowerCase().includes(needle))
      .slice(0, 3)
      .map(item => ({
        kind: 'library',
        key: `lib-${item.key}`,
        title: item.title,
        subtitle: `In Library · ${item.type === 'comic' ? 'Manga' : item.type === 'tv' ? 'TV series' : 'Movie'}`,
        href: libraryItemHref(item),
        art: item.type === 'comic' ? comicCover(item.poster) : item.poster,
        isComic: item.type === 'comic',
      }))
    : [];

  const matchedCommands = trimmed
    ? quickCommands.filter(cmd => cmd.title.toLowerCase().includes(needle) || cmd.subtitle.toLowerCase().includes(needle)).slice(0, 2)
    : quickCommands;

  const remoteFiltered = remoteResults.filter(entry => !libraryMatches.some(lib => lib.href === entry.href));
  const results: SearchEntry[] = trimmed
    ? [...libraryMatches, ...remoteFiltered, ...matchedCommands]
    : [...continueItems, ...matchedCommands];

  useEffect(() => {
    if (!open || !trimmed) return;
    const task = new AbortController();
    const timer = setTimeout(() => {
      Promise.allSettled([
        request<TitleResults>(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: task.signal }),
        request<{ results: Comic[] }>(`/api/comics?q=${encodeURIComponent(trimmed)}`, { signal: task.signal }),
      ]).then(([videoRes, comicRes]) => {
        if (task.signal.aborted) return;
        const videos: Extract<SearchEntry, { kind: 'video' }>[] = videoRes.status === 'fulfilled'
          ? normalizeTitles(videoRes.value.results).slice(0, 5).map(item => ({
            kind: 'video',
            key: item.key,
            title: item.title,
            subtitle: `${isAnime(item.originalLanguage, item.genreIds) ? 'Anime' : item.type === 'tv' ? 'TV series' : 'Movie'}${item.year ? ` · ${item.year}` : ''}`,
            href: titleHref(item),
            art: item.poster,
            mediaType: item.type,
            mediaId: item.id,
            rating: item.rating,
            mal: item.mal,
          }))
          : [];
        const comics: Extract<SearchEntry, { kind: 'comic' }>[] = comicRes.status === 'fulfilled' && Array.isArray(comicRes.value.results)
          ? comicRes.value.results.slice(0, 3).map(item => ({
            kind: 'comic',
            key: item.key,
            title: item.title,
            subtitle: `${comicFormatNames[item.format || ''] || 'Manga'}${item.year ? ` · ${item.year}` : ''}`,
            href: comicDetailsHref(item.id),
            art: comicCover(item.poster),
            malId: item.malId,
            mal: item.mal,
          }))
          : [];
        if (videoRes.status === 'rejected' && comicRes.status === 'rejected') {
          setError(videoRes.reason instanceof Error ? videoRes.reason.message : 'Search is temporarily unavailable.');
        } else {
          setRemoteResults([...videos, ...comics]);
          const videoKeys = videos.map(v => `${v.mediaType}:${v.mediaId}`);
          if (videoKeys.length) {
            request<{ facts: Record<string, { rating?: CatalogRating | null; mal?: number | null }> }>(`/api/catalog/facts?titles=${videoKeys.join(',')}`, { signal: task.signal })
              .then(({ facts }) => {
                if (task.signal.aborted || !facts) return;
                setRemoteResults(current => current.map(entry => {
                  if (entry.kind !== 'video') return entry;
                  const info = facts[entry.key];
                  return info ? { ...entry, rating: info.rating ?? entry.rating, mal: info.mal ?? entry.mal } : entry;
                }));
              }).catch(() => {});
          }
          const mangaIds = comics.flatMap(c => c.malId ? [String(c.malId)] : []);
          if (mangaIds.length) {
            request<{ ratings: Record<string, number> }>(`/api/mal/manga/batch?ids=${mangaIds.join(',')}`, { signal: task.signal })
              .then(({ ratings }) => {
                if (task.signal.aborted || !ratings) return;
                setRemoteResults(current => current.map(entry => (
                  entry.kind === 'comic' && entry.malId && ratings[String(entry.malId)]
                    ? { ...entry, mal: ratings[String(entry.malId)] } : entry
                )));
              }).catch(() => {});
          }
        }
      }).finally(() => { if (!task.signal.aborted) setPending(false); });
    }, 220);
    return () => { clearTimeout(timer); task.abort(); };
  }, [open, trimmed, attempt]);

  function onInput(value: string) {
    setQuery(value);
    setPending(Boolean(value.trim()));
    setSelected(-1);
    setRemoteResults([]);
    setError('');
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!trimmed) return;
    saveRecentSearch(trimmed);
    navigate(searchHref(trimmed));
    close();
  }

  function activateEntry(entry: SearchEntry) {
    if (trimmed) saveRecentSearch(trimmed);
    if (entry.kind === 'command') {
      entry.run();
      return;
    }
    navigate(entry.href);
    close();
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && results[selected] && !event.nativeEvent.isComposing) {
      event.preventDefault();
      activateEntry(results[selected]);
      return;
    }
    if (!results.length || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    setSelected(index => index < 0 ? (direction > 0 ? 0 : results.length - 1) : (index + direction + results.length) % results.length);
  }

  return <Dialog.Portal>
    <Dialog.Backdrop className="af-scrim" />
    <Dialog.Popup className="af-modal" initialFocus={input} finalFocus={finalFocus}>
      <header className="af-section-head"><Dialog.Title>Search &amp; Commands</Dialog.Title><Dialog.Close className="af-icon-button" aria-label="Close search"><Icon name="close" /></Dialog.Close></header>
      <form onSubmit={submit}>
        <label className="af-search-field"><Icon name="search" /><input ref={input} type="search" placeholder="Search movies, TV, anime, and manga" aria-label="Search movies, TV, anime, and manga" value={query}
          role="combobox" aria-autocomplete="list" aria-expanded={results.length > 0} aria-controls="af-search-results"
          aria-activedescendant={results[selected] ? `af-search-${selected}` : undefined}
          onChange={event => onInput(event.target.value)} onKeyDown={onKey} /></label>
        {!trimmed && recentSearches.length > 0 && <div className="af-recent-searches">
          <div className="af-palette-head">
            <span>Recent searches</span>
            <button type="button" className="af-text-link" onClick={() => { try { localStorage.removeItem(recentSearchKey); } catch { /* ignore */ } setRecentSearches([]); }}>Clear</button>
          </div>
          <div className="af-recent-chips">
            {recentSearches.map(term => (
              <button key={term} type="button" className="af-chip-btn" onClick={() => onInput(term)}>{term}</button>
            ))}
          </div>
        </div>}
        <p className="af-search-status" role="status">{error || (pending ? 'Searching…' : trimmed && !results.length ? 'No titles found.' : '')}</p>
        <div role="listbox" id="af-search-results" aria-label="Matching titles" hidden={!results.length}>
          {results.map((item, index) => item.kind === 'command' ? (
            <button
              type="button"
              role="option"
              aria-selected={index === selected}
              tabIndex={-1}
              id={`af-search-${index}`}
              key={item.key}
              onClick={() => activateEntry(item)}
              className="af-search-result af-search-command"
            >
              <span className="af-result-art af-command-icon"><Icon name={item.icon} /></span>
              <span><strong>{item.title}</strong><small className="af-search-result-meta">{item.subtitle}</small></span>
              <Icon name="right" />
            </button>
          ) : (
            <a role="option" aria-selected={index === selected} tabIndex={-1} id={`af-search-${index}`}
              key={item.key} href={item.href} onClick={() => { if (trimmed) saveRecentSearch(trimmed); close(); }} className="af-search-result">
              <span className="af-result-art"><Artwork src={item.art} fallback={<Icon name={item.kind === 'comic' || (item.kind === 'library' && item.isComic) ? 'book' : 'film'} />} /></span>
              <span><strong>{item.title}</strong><small className="af-search-result-meta">{item.subtitle}{item.kind !== 'library' && <Score rating={item.kind === 'video' ? item.rating : undefined} mal={item.mal} />}</small></span>
              <Icon name="right" />
            </a>
          ))}
        </div>
        {trimmed && <div className="af-actions af-all-results">
          <button type="submit" className="af-button af-secondary">See all results</button>
          <a href={searchHref(trimmed, { type: 'comic' })} onClick={() => { saveRecentSearch(trimmed); close(); }} className="af-text-link">Manga only</a>
          {error && <button type="button" className="af-text-link" onClick={() => { setError(''); setPending(true); setAttempt(value => value + 1); }}>Retry suggestions</button>}
        </div>}
      </form>
    </Dialog.Popup>
  </Dialog.Portal>;
}

function NotificationsBell({ controls }: { controls: LibraryControls }) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(controls.library.notifications).sort(([, a], [, b]) => b.created - a.created);
  const unread = entries.filter(([, entry]) => !entry.read).length;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className="af-icon-button af-notif-trigger"
        aria-label={unread ? `Notifications (${unread} unread)` : 'Notifications'}
        title="Release notifications"
      >
        <Icon name="bell" />
        {unread > 0 && <span className="af-notif-badge" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="af-popover-positioner" side="bottom" align="end" sideOffset={8}>
          <Popover.Popup className="af-popover-popup af-notif-popover">
            <div className="af-popover-head">
              <Popover.Title className="af-popover-title">Notifications</Popover.Title>
              <div className="af-notif-head-actions">
                {unread > 1 && (
                  <button
                    type="button"
                    className="af-text-link af-popover-done"
                    disabled={!controls.ready || controls.isPending('notifications-read-all')}
                    onClick={() => void controls.markAllNotificationsRead()}
                  >
                    Mark all read
                  </button>
                )}
                <a className="af-text-link af-popover-done" href={webHref('notifications')} onClick={() => setOpen(false)}>View all</a>
              </div>
            </div>
            {!controls.account ? (
              <div className="af-notif-empty">
                <p className="af-meta">Sign in to follow new episodes and season premieres.</p>
                <AccountButton className="af-button af-primary">Sign in</AccountButton>
              </div>
            ) : !entries.length ? (
              <p className="af-meta af-notif-empty">All caught up. Release updates for followed series will appear here.</p>
            ) : (
              <ul className="af-notif-list">
                {entries.slice(0, 6).map(([key, entry]) => (
                  <li key={key} className={`af-notif-item ${entry.read ? '' : 'is-unread'}`}>
                    <a href={webHref(`tv/${entry.seriesId}`)} onClick={() => setOpen(false)}>
                      <strong>{entry.title}</strong>
                      <span className="af-meta">{entry.message.replace(/ \(TMDb\)/gi, '')}</span>
                      <time className="af-meta">{formatDate(new Date(entry.created).toISOString())}</time>
                    </a>
                    {!entry.read && (
                      <button
                        type="button"
                        className="af-text-link af-notif-mark"
                        disabled={!controls.ready || controls.isPending(key)}
                        onClick={() => void controls.markNotification(key)}
                      >
                        Mark read
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function Header({ controls, route }: { controls: LibraryControls; route: string }) {
  const [search, setSearch] = useState(false);
  const [browse, setBrowse] = useState(false);
  const [titleSection, setTitleSection] = useState<string>('');
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ x: number; width: number; ready: boolean; animate: boolean }>({ x: 0, width: 0, ready: false, animate: false });
  const hadPillRef = useRef(false);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const searchReturn = useRef<HTMLElement | null>(null);
  const searchNavigated = useRef(false);
  const browseTrigger = useRef<HTMLButtonElement>(null);
  const browseOpeningSettings = useRef(false);
  const openSettings = useSettings();
  const path = route.split('?')[0];
  useEffect(() => {
    setTitleSection('');
    const onSection = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail === 'string') setTitleSection(detail);
    };
    window.addEventListener('afterframe-section', onSection);
    return () => window.removeEventListener('afterframe-section', onSection);
  }, [path]);
  const isNavCurrent = (link: string) => {
    if (path === link) return true;
    if (titleSection) return link === titleSection;
    return (link === 'movies' && path.startsWith('movie/'))
      || (link === 'tv' && path.startsWith('tv/'))
      || (link === 'comics' && (path === 'manga' || path.startsWith('comic/')));
  };
  const activeNavKey = route === 'home' ? 'home' : (pages.find(([, link]) => isNavCurrent(link))?.[1] ?? '');

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const active = nav.querySelector<HTMLAnchorElement>('a[aria-current="page"]');
      if (!active || active.offsetWidth === 0) {
        hadPillRef.current = false;
        setPill(prev => prev.ready ? { ...prev, ready: false } : prev);
        return;
      }
      const x = active.offsetLeft;
      const width = active.offsetWidth;
      const animate = hadPillRef.current;
      hadPillRef.current = true;
      setPill(prev => prev.x === x && prev.width === width && prev.ready && prev.animate === animate
        ? prev : { x, width, ready: true, animate });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [activeNavKey]);
  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable=true]')) return;
      const isCmdK = event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey);
      const isSlash = event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (isCmdK || isSlash) {
        event.preventDefault();
        if (search || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        const current = document.activeElement;
        searchReturn.current = current instanceof HTMLElement && current !== document.body ? current : searchTrigger.current;
        searchNavigated.current = false;
        setSearch(true);
      }
    };
    window.addEventListener('keydown', shortcut);
    const openSearchEvent = () => {
      searchReturn.current = searchTrigger.current;
      searchNavigated.current = false;
      setSearch(true);
    };
    const openBrowseEvent = () => {
      browseOpeningSettings.current = false;
      setBrowse(true);
    };
    window.addEventListener('afterframe-open-search', openSearchEvent);
    window.addEventListener('afterframe-open-browse', openBrowseEvent);
    return () => {
      window.removeEventListener('keydown', shortcut);
      window.removeEventListener('afterframe-open-search', openSearchEvent);
      window.removeEventListener('afterframe-open-browse', openBrowseEvent);
    };
  }, [search]);
  const isLibraryActive = ['watchlist', 'watched', 'ratings', 'reading', 'history', 'notifications'].includes(path);
  const accountName = controls.account?.username;
  return <header className="af-header">
    <a className="af-brand" href={webHref('home')}><img src="/art/favicon.svg" alt="" />afterframe</a>
    <nav ref={navRef} className={`af-nav ${pill.ready ? 'has-indicator' : ''}`} aria-label="Main navigation">
      {pill.ready && <span
        className={`af-nav-indicator ${pill.animate ? 'is-animated' : ''}`}
        style={{ transform: `translateX(${pill.x}px)`, width: `${pill.width}px` }}
        aria-hidden="true"
      />}
      <a href={webHref('home')} aria-current={route === 'home' ? 'page' : undefined}>Home</a>
      {pages.map(([label, link]) => <a href={webHref(link)} key={link} aria-current={isNavCurrent(link) ? 'page' : undefined}>{label}</a>)}
    </nav>
    <div className="af-tools">
      <Dialog.Root open={search} onOpenChange={open => {
        if (open) { searchReturn.current = searchTrigger.current; searchNavigated.current = false; }
        setSearch(open);
      }}>
        <Dialog.Trigger ref={searchTrigger} className="af-icon-button af-search-trigger" aria-label="Search" aria-keyshortcuts="/ Control+K Meta+K" title="Search (/ or Ctrl/Command + K)"><Icon name="search" /><span>Search</span></Dialog.Trigger>
        <Search open={search} controls={controls} close={() => { searchNavigated.current = true; setSearch(false); }}
          finalFocus={() => searchNavigated.current ? false : searchReturn.current?.isConnected ? searchReturn.current : searchTrigger.current} />
      </Dialog.Root>
      <a
        className="af-icon-button af-header-library-link"
        href={webHref('watchlist')}
        aria-label="Library"
        aria-current={isLibraryActive ? 'page' : undefined}
      >
        <Icon name="bookmark" /><span>Library</span>
      </a>
      <span className="af-tools-divider" aria-hidden="true" />
      <div className="af-tool-icons">
        <NotificationsBell controls={controls} />
        <button type="button" className="af-icon-button af-settings" aria-label="Settings" aria-haspopup="dialog" title="Settings"
          onClick={event => openSettings('general', event.currentTarget)}><Icon name="settings" /></button>
      </div>
      <AccountButton className={`af-account ${accountName ? 'is-signed-in' : ''}`}>
        {accountName ? <>
          <span className="af-account-avatar" aria-hidden="true">{accountName.slice(0, 1).toUpperCase()}</span>
          <span className="af-account-name">{accountName}</span>
        </> : 'Sign in'}
      </AccountButton>
      <Dialog.Root open={browse} onOpenChange={open => { if (open) browseOpeningSettings.current = false; setBrowse(open); }}>
        <Dialog.Trigger ref={browseTrigger} className="af-icon-button af-menu-trigger" aria-label="Browse"><Icon name="menu" /></Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Backdrop className="af-scrim" />
          <Dialog.Popup className="af-modal af-menu" finalFocus={() => browseOpeningSettings.current ? false : browseTrigger.current}>
            <header className="af-section-head"><Dialog.Title>Browse</Dialog.Title><Dialog.Close className="af-icon-button" aria-label="Close navigation"><Icon name="close" /></Dialog.Close></header>
            <nav aria-label="Browse menu">
              {pages.map(([label, destination]) => <a href={webHref(destination)} onClick={() => setBrowse(false)} key={destination} aria-current={path === destination ? 'page' : undefined}>{label}</a>)}
              <button type="button" aria-haspopup="dialog" onClick={() => {
                browseOpeningSettings.current = true;
                setBrowse(false);
                openSettings('general', browseTrigger.current);
              }}>Settings</button>
            </nav>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  </header>;
}

export function MobileNav({ route }: { route: string }) {
  const path = route.split('?')[0];
  const isHome = path === 'home' || path === 'main';
  const isBrowse = ['movies', 'tv', 'anime', 'new', 'recommendations'].includes(path) || path.startsWith('movie/') || path.startsWith('tv/');
  const isComics = path === 'comics' || path === 'manga' || path.startsWith('comic/');
  const isLibrary = ['watchlist', 'watched', 'ratings', 'reading', 'history', 'notifications'].includes(path);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setHidden(false);
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastY;
      if (y <= 32) setHidden(false);
      else if (delta > 10 && y > 64) setHidden(true);
      else if (delta < -8) setHidden(false);
      lastY = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [path]);

  return <nav className={`af-mobile-nav ${hidden ? 'is-scroll-hidden' : ''}`} aria-label="Mobile navigation">
    <a href={webHref('home')} aria-current={isHome ? 'page' : undefined}>
      <Icon name="home" /><span>Home</span>
    </a>
    <button type="button" aria-pressed={isBrowse} onClick={() => window.dispatchEvent(new Event('afterframe-open-browse'))}>
      <Icon name="film" /><span>Browse</span>
    </button>
    <a href={webHref('comics')} aria-current={isComics ? 'page' : undefined}>
      <Icon name="book" /><span>Manga</span>
    </a>
    <button type="button" onClick={() => window.dispatchEvent(new Event('afterframe-open-search'))}>
      <Icon name="search" /><span>Search</span>
    </button>
    <a href={webHref('watchlist')} aria-current={isLibrary ? 'page' : undefined}>
      <Icon name="bookmark" /><span>Library</span>
    </a>
  </nav>;
}
