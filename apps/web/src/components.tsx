import { Dialog } from '@base-ui/react/dialog';
import { Children, memo, useEffect, useRef, useState, type ComponentProps, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { imagePath, normalizeTitles, request, titleHref, webHref, type CatalogRating, type Comic, type Title, type TitleResults } from './catalog';
import { AccountButton } from './Account';
import type { LibraryControls } from './library';
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

export function Loading({ label, shape = 'posters' }: { label: string; shape?: 'posters' | 'releases' | 'hero' | 'rows' }) {
  const count = { posters: 6, releases: 3, hero: 1, rows: 3 }[shape];
  return <div data-route-loading={shape === 'hero' ? true : undefined}>
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
  return <div className="af-state">
    <p role="alert">{setup && managed ? 'The film and TV catalog is unavailable. Ask the server administrator to check its credentials.' : error}</p>
    <div className="af-actions">
      {setup ? managed !== true && <button className="af-button af-primary" type="button" onClick={event => openSettings('integrations', event.currentTarget, retry)}>Configure catalog</button>
        : <button type="button" className="af-button af-secondary" onClick={retry}>Retry</button>}
      {setup && <ActionLink href={webHref('comics')}>Browse comics</ActionLink>}
      {setup && <ActionLink href={webHref('watchlist')}>Open library</ActionLink>}
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
  const list = item.type === 'comic' ? 'Reading list' : 'Watchlist';
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

export const MediaCard = memo(function MediaCard({ item, controls, href, context, percent, landscape = false, eager }: {
  item: Title; controls: LibraryControls; href?: string; context?: string; percent?: number; landscape?: boolean; eager?: boolean;
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
      {!context && <Score rating={item.rating} />}
    </a>
    {!context && <SaveButton item={item} controls={controls} compact />}
  </article>;
});

export function Shelf({ title, children, href, actions, landscape = false }: {
  title: string; children: ReactNode; href?: string; actions?: ReactNode; landscape?: boolean;
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
      <h2>{title}</h2>
      <div className="af-shelf-controls">
        {actions}{href && <a className="af-text-link" href={href}>View all</a>}
        {(edges.previous || edges.next) && <div className="af-shelf-arrows">
          <button type="button" className="af-icon-button" aria-label={`Scroll ${title} left`} disabled={!edges.previous} onClick={() => scroll(-1)}><Icon name="left" /></button>
          <button type="button" className="af-icon-button" aria-label={`Scroll ${title} right`} disabled={!edges.next} onClick={() => scroll(1)}><Icon name="right" /></button>
        </div>}
      </div>
    </header>
    <div className={`af-rail ${landscape ? 'af-wide-rail' : ''}`} ref={rail}>{children}</div>
  </section>;
}

const pages = [
  ['Movies', 'movies'], ['TV Shows', 'tv'], ['Anime', 'anime'],
  ['Comics', 'comics'], ['Releases', 'new'], ['For You', 'recommendations'],
];

function Search({ open, close, finalFocus }: { open: boolean; close: () => void; finalFocus: () => HTMLElement | false | null }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Title[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(-1);
  const [attempt, setAttempt] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const search = query.trim();
    if (!open || !search) return;
    const task = new AbortController();
    const timer = setTimeout(() => {
      request<TitleResults>(`/api/search?q=${encodeURIComponent(search)}`, { signal: task.signal })
        .then(data => { if (!task.signal.aborted) setResults(normalizeTitles(data.results).slice(0, 7)); })
        .catch(problem => { if (!task.signal.aborted) setError(problem.message); })
        .finally(() => { if (!task.signal.aborted) setPending(false); });
    }, 220);
    return () => { clearTimeout(timer); task.abort(); };
  }, [open, query, attempt]);

  function onInput(value: string) {
    setQuery(value);
    setPending(Boolean(value.trim()));
    setSelected(-1);
    setResults([]);
    setError('');
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    window.location.assign(webHref(`search=${encodeURIComponent(query.trim())}`));
    close();
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && results[selected] && !event.nativeEvent.isComposing) {
      event.preventDefault();
      window.location.assign(titleHref(results[selected])); close();
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
      <header className="af-section-head"><Dialog.Title>Search</Dialog.Title><Dialog.Close className="af-icon-button" aria-label="Close search"><Icon name="close" /></Dialog.Close></header>
      <form onSubmit={submit}>
        <label className="af-search-field"><Icon name="search" /><input ref={input} type="search" placeholder="Search movies and series" aria-label="Search movies and series" value={query}
          role="combobox" aria-autocomplete="list" aria-expanded={results.length > 0} aria-controls="af-search-results"
          aria-activedescendant={results[selected] ? `af-search-${selected}` : undefined}
          onChange={event => onInput(event.target.value)} onKeyDown={onKey} /></label>
        <p className="af-search-status" role="status">{error || (pending ? 'Searching…' : query.trim() && !results.length ? 'No titles found.' : '')}</p>
        <div role="listbox" id="af-search-results" aria-label="Matching titles" hidden={!results.length}>
          {results.map((item, index) => <a role="option" aria-selected={index === selected} tabIndex={-1} id={`af-search-${index}`}
            key={item.key} href={titleHref(item)} onClick={close} className="af-search-result">
            <span className="af-result-art"><Artwork src={item.poster} fallback={<Icon name="film" />} /></span>
            <span><strong>{item.title}</strong><small>{item.type === 'tv' ? 'TV series' : 'Movie'}{item.year ? ` · ${item.year}` : ''}</small></span>
            <Icon name="right" />
          </a>)}
        </div>
        {query.trim() && <div className="af-actions af-all-results">
          <button type="submit" className="af-button af-secondary">Search movies and TV</button>
          <a href={webHref(`comics?q=${encodeURIComponent(query.trim())}`)} onClick={close} className="af-text-link">Search comics</a>
          {error && <button type="button" className="af-text-link" onClick={() => { setError(''); setPending(true); setAttempt(value => value + 1); }}>Retry suggestions</button>}
        </div>}
      </form>
    </Dialog.Popup>
  </Dialog.Portal>;
}

export function Header({ controls, route }: { controls: LibraryControls; route: string }) {
  const [search, setSearch] = useState(false);
  const [browse, setBrowse] = useState(false);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const searchReturn = useRef<HTMLElement | null>(null);
  const searchNavigated = useRef(false);
  const browseTrigger = useRef<HTMLButtonElement>(null);
  const browseOpeningSettings = useRef(false);
  const openSettings = useSettings();
  const path = route.split('?')[0];
  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable=true]')) return;
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (search || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        const current = document.activeElement;
        searchReturn.current = current instanceof HTMLElement && current !== document.body ? current : searchTrigger.current;
        searchNavigated.current = false;
        setSearch(true);
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [search]);
  return <header className="af-header">
    <a className="af-brand" href="/#home"><img src="/art/favicon.svg" alt="" />afterframe</a>
    <nav className="af-nav" aria-label="Main navigation">
      <a href="/#home" aria-current={route === 'home' ? 'page' : undefined}>Home</a>
      {pages.map(([label, link]) => <a href={webHref(link)} key={link} aria-current={path === link || (link === 'movies' && path.startsWith('movie/')) || (link === 'tv' && path.startsWith('tv/')) || (link === 'comics' && path.startsWith('comic/')) ? 'page' : undefined}>{label}</a>)}
    </nav>
    <div className="af-tools">
      <Dialog.Root open={search} onOpenChange={open => {
        if (open) { searchReturn.current = searchTrigger.current; searchNavigated.current = false; }
        setSearch(open);
      }}>
        <Dialog.Trigger ref={searchTrigger} className="af-icon-button af-search-trigger" aria-label="Search" aria-keyshortcuts="Control+K Meta+K" title="Search (Ctrl or Command + K)"><Icon name="search" /><span>Search</span></Dialog.Trigger>
        <Search open={search} close={() => { searchNavigated.current = true; setSearch(false); }}
          finalFocus={() => searchNavigated.current ? false : searchReturn.current?.isConnected ? searchReturn.current : searchTrigger.current} />
      </Dialog.Root>
      <a className="af-icon-button" href={webHref('watchlist')} aria-label="My Library"><Icon name="bookmark" /><span>Library</span></a>
      <button type="button" className="af-icon-button af-settings" aria-label="Settings" aria-haspopup="dialog"
        onClick={event => openSettings('general', event.currentTarget)}><Icon name="settings" /></button>
      <AccountButton className="af-account">{controls.account?.username ?? (controls.state === 'loading' ? 'Account' : 'Sign in')}</AccountButton>
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
