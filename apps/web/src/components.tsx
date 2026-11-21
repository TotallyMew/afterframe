import { Dialog } from '@base-ui/react/dialog';
import { Children, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { legacyHref, normalizeTitles, request, titleHref, type CatalogRating, type Title, type TitleResults } from './catalog';
import type { LibraryControls } from './library';

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
  settings: <><circle cx="12" cy="12" r="3" /><path d="M10 3h4l.7 2.8 2 .9 2.5-.9 2 3.5-1.9 2v2.1l1.9 2-2 3.5-2.5-.9-2 .9L14 21h-4l-.7-2.1-2-.9-2.5.9-2-3.5 1.9-2v-2.1l-1.9-2 2-3.5 2.5.9 2-.9z" /></>,
  eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
  film: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4m-4 6h4m10-6h4m-4 6h4" /></>,
} satisfies Record<string, ReactNode>;

export function Icon({ name }: { name: keyof typeof glyphs }) {
  return <svg className="af-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{glyphs[name]}</svg>;
}

export function ActionLink({ href, primary = false, children }: { href: string; primary?: boolean; children: ReactNode }) {
  return <a className={`af-button ${primary ? 'af-primary' : 'af-secondary'}`} href={href}>{children}</a>;
}

export function SaveButton({ item, controls, compact = false }: { item: Title; controls: LibraryControls; compact?: boolean }) {
  const saved = Boolean(controls.library.saved[item.key]);
  return <button type="button" className={compact ? 'af-icon-button af-card-save' : 'af-button af-secondary'}
    aria-pressed={saved} aria-label={compact ? `${saved ? 'Remove from' : 'Add to'} watchlist: ${item.title}` : undefined}
    disabled={!controls.ready || controls.saving} onClick={() => void controls.toggleSaved(item)}>
    <Icon name={saved ? 'check' : 'plus'} />{!compact && (saved ? 'In Watchlist' : 'Watchlist')}
  </button>;
}

export function Score({ rating, mal }: { rating?: CatalogRating; mal?: number }) {
  return <>
    {rating && rating.score > 0 && <span className="af-score" title={rating.votes ? `${rating.votes.toLocaleString()} IMDb votes` : undefined}><span aria-hidden="true">★</span> {rating.score.toFixed(1)} <small>IMDb</small></span>}
    {mal != null && mal > 0 && <span className="af-score">{mal.toFixed(2)} <small>MAL</small></span>}
  </>;
}

export function MediaCard({ item, controls, href, context, percent, landscape = false }: {
  item: Title; controls: LibraryControls; href?: string; context?: string; percent?: number; landscape?: boolean;
}) {
  const label = [item.year, landscape ? item.type === 'tv' ? 'TV series' : 'Movie' : item.genre].filter(Boolean).join(' · ');
  const art = landscape ? item.backdrop || item.poster : item.poster;
  return <article className="af-media-card">
    <a href={href ?? titleHref(item)}>
      <span className={`af-poster ${landscape ? 'af-landscape' : ''} ${landscape && !item.backdrop && item.poster ? 'af-landscape-fallback' : ''}`}>
        {art ? <img src={art} alt="" loading="lazy" /> : <Icon name="film" />}
        {context && <span className="af-resume-icon"><Icon name="play" /></span>}
        {percent != null && <progress className="af-progress af-card-progress" max={100} value={percent} aria-label={`${item.title} progress`} />}
      </span>
      <strong>{item.title}</strong>
      <span className="af-card-meta">{context || label}</span>
      {!context && <Score rating={item.rating} />}
    </a>
    {!context && <SaveButton item={item} controls={controls} compact />}
  </article>;
}

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
    node?.scrollBy({ left: direction * node.clientWidth * .8, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  return <section className="af-section" aria-label={title}>
    <header className="af-section-head">
      <h2>{title}</h2>
      <div className="af-shelf-controls">
        {actions}{href && <a className="af-text-link" href={href}>View all</a>}
        {(edges.previous || edges.next) && <>
          <button type="button" className="af-icon-button" aria-label={`Scroll ${title} left`} disabled={!edges.previous} onClick={() => scroll(-1)}><Icon name="left" /></button>
          <button type="button" className="af-icon-button" aria-label={`Scroll ${title} right`} disabled={!edges.next} onClick={() => scroll(1)}><Icon name="right" /></button>
        </>}
      </div>
    </header>
    <div className={`af-rail ${landscape ? 'af-wide-rail' : ''}`} ref={rail}>{children}</div>
  </section>;
}

const pages = [
  ['Movies', 'movies'], ['TV Shows', 'tv'], ['Anime', 'anime'],
  ['Comics', 'comics'], ['Releases', 'new'], ['For You', 'recommendations'],
];

function Search({ open, close }: { open: boolean; close: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Title[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(0);
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
  }, [open, query]);

  function onInput(value: string) {
    setQuery(value);
    setPending(Boolean(value.trim()));
    setSelected(0);
    setResults([]);
    setError('');
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    if (results[selected]) { window.location.assign(titleHref(results[selected])); close(); }
    else if (!pending && !error) window.location.assign(legacyHref(`search=${encodeURIComponent(query.trim())}`));
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (!results.length || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    setSelected(index => (index + direction + results.length) % results.length);
  }

  return <Dialog.Portal>
    <Dialog.Backdrop className="af-scrim" />
    <Dialog.Popup className="af-modal" initialFocus={input}>
      <header className="af-section-head"><Dialog.Title>Search</Dialog.Title><Dialog.Close className="af-icon-button" aria-label="Close search"><Icon name="close" /></Dialog.Close></header>
      <form onSubmit={submit}>
        <label className="af-search-field"><Icon name="search" /><input ref={input} type="search" placeholder="Search movies and series" aria-label="Search movies and series" value={query}
          role="combobox" aria-autocomplete="list" aria-expanded={results.length > 0} aria-controls="af-search-results"
          aria-activedescendant={results[selected] ? `af-search-${selected}` : undefined}
          onChange={event => onInput(event.target.value)} onKeyDown={onKey} /></label>
        <p className="af-search-status" role="status">{error || (pending ? 'Searching…' : query.trim() && !results.length ? 'No titles found.' : '')}</p>
        <div role="listbox" id="af-search-results" aria-label="Matching titles">
          {results.map((item, index) => <a role="option" aria-selected={index === selected} tabIndex={-1} id={`af-search-${index}`}
            key={item.key} href={titleHref(item)} onClick={close} className="af-search-result">
            <span className="af-result-art">{item.poster ? <img src={item.poster} alt="" /> : <Icon name="film" />}</span>
            <span><strong>{item.title}</strong><small>{item.type === 'tv' ? 'TV series' : 'Movie'}{item.year ? ` · ${item.year}` : ''}</small></span>
            <Icon name="right" />
          </a>)}
        </div>
        {results.length > 0 && <a href={legacyHref(`search=${encodeURIComponent(query.trim())}`)} className="af-text-link af-all-results">See all results</a>}
      </form>
    </Dialog.Popup>
  </Dialog.Portal>;
}

export function Header({ controls, route }: { controls: LibraryControls; route: string }) {
  const [search, setSearch] = useState(false);
  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable=true]')) return;
      if (event.key === '/' || (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey))) {
        event.preventDefault();
        setSearch(true);
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  return <header className="af-header">
    <a className="af-brand" href="/#home"><img src="/art/favicon.svg" alt="" />afterframe</a>
    <nav className="af-nav" aria-label="Main navigation">
      <a href="/#home" aria-current={route === 'home' ? 'page' : undefined}>Home</a>
      {pages.map(([label, path]) => <a href={legacyHref(path)} key={path} aria-current={route.startsWith(path === 'movies' ? 'movie/' : 'tv/') && ['movies', 'tv'].includes(path) ? 'page' : undefined}>{label}</a>)}
    </nav>
    <div className="af-tools">
      <Dialog.Root open={search} onOpenChange={setSearch}>
        <Dialog.Trigger className="af-icon-button" aria-label="Search"><Icon name="search" /><span>Search</span></Dialog.Trigger>
        {search && <Search open={search} close={() => setSearch(false)} />}
      </Dialog.Root>
      <a className="af-icon-button" href={legacyHref('watchlist')} aria-label="My Library"><Icon name="bookmark" /><span>Library</span></a>
      <a className="af-icon-button af-settings" href={legacyHref('home', 'settings')} aria-label="Settings"><Icon name="settings" /></a>
      <a className="af-account" href={legacyHref('home', 'account')}>{controls.account?.username ?? 'Sign in'}</a>
      <Dialog.Root>
        <Dialog.Trigger className="af-icon-button af-menu-trigger" aria-label="Browse"><Icon name="menu" /></Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Backdrop className="af-scrim" />
          <Dialog.Popup className="af-modal af-menu">
            <header className="af-section-head"><Dialog.Title>Browse</Dialog.Title><Dialog.Close className="af-icon-button" aria-label="Close navigation"><Icon name="close" /></Dialog.Close></header>
            <nav aria-label="Browse menu">
              {pages.map(([label, path]) => <a href={legacyHref(path)} key={path}>{label}</a>)}
              <a href={legacyHref('home', 'settings')}>Settings</a>
            </nav>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  </header>;
}
