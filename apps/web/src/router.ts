const legacyHashPattern = /^#\/?(.*)$/;
const safeBackPattern = /^\/?(?:home|movies|tv|new|anime|comics|search|watchlist|watched|ratings|reading|history|notifications|recommendations)(?:[?/=]|$)/i;
const nonSpaPrefixes = ['/api/', '/art/', '/assets/', '/icons/', '/stream/', '/comic-cover/', '/comic-page/'];
const nonSpaExact = new Set(['/manifest.webmanifest', '/sw.js']);

export function normalizeRouteString(raw: string): string {
  const trimmed = raw.replace(/^[#/]+/, '');
  if (!trimmed || trimmed === 'home') return 'home';
  const [rawPath, rawQuery = ''] = trimmed.split('?', 2);
  const path = rawPath.replace(/\/+$/, '') || 'home';
  if (path.startsWith('search=')) {
    const q = new URLSearchParams(path).get('search') || '';
    const params = new URLSearchParams(rawQuery);
    if (q && !params.has('q')) params.set('q', q);
    const qs = params.toString();
    return qs ? `search?${qs}` : 'search';
  }
  return rawQuery ? `${path}?${rawQuery}` : path;
}

export function webHref(route: string): string {
  const normalized = normalizeRouteString(route);
  if (normalized === 'home') return '/';
  return `/${normalized}`;
}

export function searchHref(query: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ q: query });
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v) params.set(k, v);
    }
  }
  return `/search?${params}`;
}

export function currentLocationHref(): string {
  const { pathname, search, hash } = window.location;
  if ((pathname === '/' || pathname === '') && hash && hash !== '#main' && hash.startsWith('#')) {
    const match = hash.match(legacyHashPattern);
    if (match) return webHref(match[1]);
  }
  const cleanPath = pathname === '/home' ? '/' : pathname || '/';
  return `${cleanPath}${search}`;
}

export function routeSnapshot(): string {
  const { pathname, search, hash } = window.location;
  if ((pathname === '/' || pathname === '') && hash && hash !== '#main' && hash.startsWith('#')) {
    const match = hash.match(legacyHashPattern);
    if (match) return normalizeRouteString(match[1]);
  }
  const cleanPath = pathname.replace(/^\/+|\/+$/g, '');
  if (!cleanPath || cleanPath === 'home') return search ? `home${search}` : 'home';
  return normalizeRouteString(`${cleanPath}${search}`);
}

export function currentSearchParams(): URLSearchParams {
  const route = routeSnapshot();
  const query = route.split('?', 2)[1] || '';
  return new URLSearchParams(query);
}

export function normalizeBackParam(back: string | null | undefined): string | null {
  if (!back) return null;
  const trimmed = back.trim();
  if (!trimmed || trimmed.startsWith('//')) return null;
  if (trimmed === '/') return '/';
  const withoutPrefix = trimmed.replace(/^[#/]+/, '');
  if (!withoutPrefix) return '/';
  if (!safeBackPattern.test(withoutPrefix)) return null;
  return webHref(withoutPrefix);
}

export function navigate(to: string, options?: { replace?: boolean }) {
  const href = to.startsWith('/') ? to : webHref(to);
  const current = `${window.location.pathname}${window.location.search}`;
  if (current === href && !window.location.hash) return;
  if (options?.replace) window.history.replaceState(null, '', href);
  else window.history.pushState(null, '', href);
  window.dispatchEvent(new Event('afterframe-navigate'));
}

export function subscribeRoute(notify: () => void) {
  window.addEventListener('popstate', notify);
  window.addEventListener('hashchange', notify);
  window.addEventListener('afterframe-navigate', notify);
  return () => {
    window.removeEventListener('popstate', notify);
    window.removeEventListener('hashchange', notify);
    window.removeEventListener('afterframe-navigate', notify);
  };
}

export function isSpaHref(href: string): boolean {
  if (!href || href.startsWith('#')) return false;
  let url: URL;
  try {
    url = new URL(href, window.location.origin);
  } catch {
    return false;
  }
  if (url.origin !== window.location.origin) return false;
  if (nonSpaExact.has(url.pathname)) return false;
  if (nonSpaPrefixes.some(prefix => url.pathname.startsWith(prefix))) return false;
  return true;
}

export function handleSpaClick(
  event: {
    defaultPrevented: boolean;
    button: number;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    target: EventTarget | null;
    preventDefault: () => void;
  },
  onBeforeNavigate?: (anchor: HTMLAnchorElement) => void,
) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (!(event.target instanceof Element)) return;
  const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
  if (!anchor) return;
  if (anchor.target && anchor.target !== '_self') return;
  if (anchor.hasAttribute('download')) return;
  const rawHref = anchor.getAttribute('href') || '';
  if (!rawHref || rawHref.startsWith('#')) return;
  if (!isSpaHref(rawHref)) return;
  const url = new URL(rawHref, window.location.origin);
  onBeforeNavigate?.(anchor);
  event.preventDefault();
  if ((url.pathname === '/' || url.pathname === '') && url.hash && url.hash !== '#main') {
    navigate(normalizeRouteString(url.hash));
  } else {
    navigate(`${url.pathname}${url.search}`);
  }
}
