import { archiveCatalog, archiveFileUrl } from './catalog.js';
import { categories, browseGenres, sortOptions, matchesCatalog } from './discover.js';

const icons = {
  home: '<path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 21v-7h6v7"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4m-4 6h4m10-6h4m-4 6h4"/>',
  tv: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="m8 2 4 4 4-4M8 22h8"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8m-9 4h4"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M10 3h4l.7 2.8 2 .9 2.5-.9 2 3.5-1.9 2v2.1l1.9 2-2 3.5-2.5-.9-2 .9L14 21h-4l-.7-2.1-2-.9-2.5.9-2-3.5 1.9-2v-2.1l-1.9-2 2-3.5 2.5.9 2-.9z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4 4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c4 4 4 14 0 18-4-4-4-14 0-18z"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  play: '<path d="m8 4 12 8-12 8z" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  external: '<path d="M13 4h7v7m0-7-9 9m8 0v7H4V5h7"/>',
  user: '<circle cx="12" cy="8" r="3.2"/><path d="M5 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2"/>',
  star: '<path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2-5.7-3-5.7 3 1.1-6.2-4.5-4.4 6.3-.9z"/>',
  folder: '<path d="M3 6h7l2 2h9v12H3z"/>',
  fullscreen: '<path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"/>',
  'chevron-left': '<path d="m15 6-6 6 6 6"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}

function escape(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(`afterframe.${key}`)) ?? fallback; } catch { return fallback; }
}

function write(key, value) {
  try { localStorage.setItem(`afterframe.${key}`, JSON.stringify(value)); } catch { /* Browsing still works with storage disabled. */ }
}

const main = document.querySelector('#main');
const navigation = document.querySelector('#navigation');
const search = document.querySelector('#search');
const searchClear = document.querySelector('.search-clear');
const suggestions = document.querySelector('#search-suggestions');
const region = document.querySelector('#region');
const titlePage = document.querySelector('#title-page');
const settingsDialog = document.querySelector('#settings-dialog');
const creditsDialog = document.querySelector('#credits-dialog');
const accountDialog = document.querySelector('#account-dialog');
const accountButton = document.querySelector('#account-button');
const accountBody = document.querySelector('#account-body');
const localVideo = document.querySelector('#local-video');
const connectionForm = document.querySelector('#connection-form');
const connectionStatus = document.querySelector('#connection-status');
const toast = document.querySelector('#toast');
const titles = new Map(archiveCatalog.map(item => [item.key, item]));
const archiveById = new Map(archiveCatalog.filter(item => item.id).map(item => [`${item.type}-${item.id}`, item]));
const navLinks = [['home', 'Home', 'home'], ['movies', 'Movies', 'film'], ['tv', 'TV Shows', 'tv'], ['new', 'New Releases', 'clock'], ['watchlist', 'My Library', 'bookmark']];
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const countries = 'AE AR AT AU BE BG BR CA CH CL CO CZ DE DK EE ES FI FR GB GR HK HR HU ID IE IL IN IS IT JP KR LT LU LV MX MY NL NO NZ PE PH PL PT RO RS SE SG SI SK TH TR TW UA US ZA'.split(' ');
let saved;
let progress;
let ratings;
let skips;
let account = null;
let accountMode = 'signin';
let accountReady = false;
let libraryQueue = Promise.resolve();
const filesByTitle = new Map();
const catalogCache = new Map();
const detailsCache = new Map();
const imdbScores = new Map();
const checkedRatings = new Set();
const defaults = { category: '', decade: '', sort: 'popular' };
const cineSrcOrigin = 'https://cinesrc.st';

function libraryTitle(item) {
  const { key, id, archiveId, title, year, type, poster, backdrop, genre, genreIds, categories } = item;
  return { key, id, archiveId, title, year, type, poster, backdrop, genre, genreIds, categories };
}

function useLibrary(library = null) {
  saved = Object.assign(Object.create(null), library?.saved || read('saved', {}));
  progress = Object.assign(Object.create(null), library?.progress || read('progress', {}));
  ratings = Object.assign(Object.create(null), library?.ratings || read('ratings', {}));
  skips = Object.assign(Object.create(null), library?.skips || read('skips', {}));
  for (const item of [...Object.values(saved), ...Object.values(progress).map(entry => entry.item), ...Object.values(ratings).map(entry => entry.item)]) {
    if (item?.key && !titles.has(item.key)) titles.set(item.key, item);
  }
}
useLibrary();
const defaultRegion = navigator.language.match(/-([A-Z]{2})\b/)?.[1];
const savedRegion = read('region', defaultRegion);
const state = {
  page: 'home', query: '', filter: 'all', hero: 0, connected: false,
  region: countries.includes(savedRegion) ? savedRegion : 'LT', remote: [], loading: false, error: '',
  archive: [], archiveLoading: false, archiveError: '', archiveNext: null, remoteNext: null,
  collections: {},
  facets: { ...defaults }, autoSkip: read('autoSkip', false),
};
let active = null;
let requestId = 0;
let catalogRequest;
let openingId = 0;
let browseHash = '#home';
let episodeChoice;
let searchTimer;
let toastTimer;
let railObserver;
let undoToast;
let suggestionIndex = -1;
let suggestionsDismissed = false;
let showSearchCommands = false;

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function post(path, data = {}, keepalive = false) {
  return api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data), keepalive });
}

function libraryChange(kind, key, value) {
  const records = { saved, progress, ratings, skips }[kind];
  const previous = records[key];
  if (value === null) delete records[key];
  else records[key] = value;
  if (!account) {
    write(kind, records);
    return;
  }
  const accountId = account.id;
  libraryQueue = libraryQueue.then(async () => {
    if (account?.id !== accountId) return;
    try { await post('/api/account/library', { accountId, kind, key, value }, true); } catch {
      if (kind === 'progress') return;
      if (account?.id === accountId && (records[key] === value || (value === null && !Object.hasOwn(records, key)))) {
        if (previous === undefined) delete records[key];
        else records[key] = previous;
        if (kind === 'saved' && undoToast?.key === key) undoToast = null;
        renderLibraryControls();
      }
      showToast('Could not save this change. Try again.');
    }
  });
}

function imagePath(path, size = 'w500') {
  return /^\/[a-z0-9]+\.(jpg|png|webp)$/i.test(path || '') ? `https://image.tmdb.org/t/p/${size}${path}` : '';
}

function localizeTitle(item) {
  const key = `${item.media_type}-${item.id}`;
  const archiveItem = archiveById.get(key);
  if (archiveItem) return archiveItem;
  const title = {
    key, id: item.id, type: item.media_type, title: item.title || item.name,
    year: (item.release_date || item.first_air_date || '').slice(0, 4), date: item.release_date || item.first_air_date,
    description: item.overview, poster: imagePath(item.poster_path), backdrop: imagePath(item.backdrop_path, 'w1280'), genreIds: item.genre_ids || item.genres?.map(genre => genre.id),
    originalLanguage: item.original_language, score: item.vote_count ? item.vote_average : 0, votes: item.vote_count,
    duration: item.runtime, imdb: item.external_ids?.imdb_id || item.imdb_id,
  };
  titles.set(key, title);
  return title;
}

function meta(item) {
  const genre = item.genre || Object.entries(categories).find(([, ids]) => ids.includes(item.genreIds?.[0]))?.[0];
  return [item.year, genre, item.duration ? `${item.duration} min` : item.type === 'tv' ? 'TV series' : 'Movie'].filter(Boolean);
}

function isArchive(item) {
  return Boolean(item.archiveId || item.media || item.episodes?.length);
}

function hasCineSrcTitle(item) {
  return ['movie', 'tv'].includes(item.type) && Number.isSafeInteger(item.id) && item.id > 0;
}

function titlePath(item) {
  return hasCineSrcTitle(item) && !isArchive(item) ? `${item.type}/${item.id}` : `edition/${encodeURIComponent(item.key)}`;
}

function ratingBadge(item) {
  const imdb = imdbScores.get(item.imdb) || imdbScores.get(item.key);
  const score = imdb?.score || item.score;
  if (!(score > 0)) return '';
  return `<span class="catalog-score" title="${imdb ? `IMDb · ${imdb.votes.toLocaleString()} votes` : 'TMDb audience score'}"><span>${imdb ? 'IMDb' : 'TMDb'}</span> ${score.toFixed(1)}</span>`;
}

function cineSrcKey(item, episode) {
  return `${item.key}/cinesrc${episode ? `-s${episode.season}e${episode.number}` : ''}`;
}

function thumbnail(item, landscape = false) {
  if (landscape && item.backdrop) return `<img src="${escape(item.backdrop)}" alt="" loading="lazy">`;
  return `<span class="poster-placeholder">${icon(item.type === 'tv' ? 'tv' : 'film')}</span>${item.poster ? `<img src="${escape(item.poster)}" alt="" loading="lazy">` : ''}`;
}

function resumeFor(item) {
  return Object.entries(progress)
    .filter(([key, value]) => {
      if (value.time <= 5 || value.time >= value.duration - 20) return false;
      if (filesByTitle.has(key) && key.startsWith(`${item.key}/local`)) return true;
      if (isArchive(item) && (key === item.key || item.episodes?.some(episode => key === `${item.key}/${episode.key}`))) return true;
      const episode = item.type === 'tv' ? value.episode : null;
      return hasCineSrcTitle(item) && (item.type === 'movie' || validEpisode(episode)) && key === cineSrcKey(item, episode);
    })
    .sort((a, b) => b[1].updated - a[1].updated)[0];
}

function titleCard(item, resume = false) {
  const entry = resume ? resumeFor(item)?.[1] : null;
  const percent = entry ? Math.round(entry.time / entry.duration * 100) : 0;
  const score = ratings[item.key]?.score;
  const left = entry ? `${Math.ceil((entry.duration - entry.time) / 60)} min left` : '';
  const context = entry ? [entry.episode && episodeLabel(entry.episode), left].filter(Boolean) : meta(item).slice(0, 2);
  const url = `#${titlePath(item)}`;
  const tag = entry ? 'button' : 'a';
  return `<article class="poster-tile"><${tag} ${entry ? 'type="button"' : `href="${url}"`} class="poster-card${entry ? ' resume-card' : ''}" data-action="${entry ? 'resume' : 'details'}" data-key="${escape(item.key)}" title="${escape(item.title)}">
    <span class="poster-art">${thumbnail(item, Boolean(entry))}<span class="card-play" aria-hidden="true">${icon('play')}</span>${entry ? `<span class="progress-line" role="progressbar" aria-label="Watch progress" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><i style="width:${percent}%"></i></span>` : ''}</span>
    <span class="poster-title">${escape(item.title)}</span><span class="poster-meta"><span>${context.map(escape).join(' · ')}</span>${score ? `<span class="personal-badge" aria-label="Your rating ${score} out of 5">${icon('star')}${score}/5</span>` : ratingBadge(item)}</span>
  </${tag}>${entry ? '' : saveButton(item, true)}</article>`;
}

function syncCardRatings() {
  const cards = [...main.querySelectorAll('.poster-card:not(.resume-card)')];
  const items = new Map();
  for (const card of cards) {
    const item = titles.get(card.dataset.key);
    if (item && hasCineSrcTitle(item) && !imdbScores.has(item.key) && !checkedRatings.has(item.key)) {
      items.set(item.key, item);
      if (items.size >= 100) break;
    }
  }
  if (!items.size) return;
  for (const key of items.keys()) checkedRatings.add(key);
  const keys = [...items.values()].map(item => `${item.type}:${item.id}`).join(',');
  api(`/api/imdb/cached?titles=${encodeURIComponent(keys)}`).then(({ ratings }) => {
    for (const item of items.values()) {
      const rating = ratings[`${item.type}-${item.id}`];
      if (rating) imdbScores.set(item.key, rating);
    }
    for (const card of main.querySelectorAll('.poster-card:not(.resume-card)')) {
      const item = items.get(card.dataset.key);
      if (!item || !imdbScores.has(item.key)) continue;
      const badge = card.querySelector('.catalog-score');
      if (badge) badge.outerHTML = ratingBadge(item);
      else if (!card.querySelector('.personal-badge')) card.querySelector('.poster-meta')?.insertAdjacentHTML('beforeend', ratingBadge(item));
    }
  }).catch(() => {});
}

function grid(items) {
  return `<div class="poster-grid">${items.map(item => titleCard(item)).join('')}</div>`;
}

function shelf(title, items, link, resume = false) {
  if (!items.length) return '';
  return `<section class="shelf" aria-label="${title}"><div class="section-head"><h2>${title}</h2><div class="shelf-actions">${link ? `<a class="section-link" href="#${link}">View all ${icon('chevron-right')}</a>` : ''}<div class="rail-controls" hidden><button class="icon-button" type="button" data-action="rail" data-value="-1" aria-label="Scroll ${title} left">${icon('chevron-left')}</button><button class="icon-button" type="button" data-action="rail" data-value="1" aria-label="Scroll ${title} right">${icon('chevron-right')}</button></div></div></div><div class="poster-rail${resume ? ' resume-rail' : ''}">${items.map(item => titleCard(item, resume)).join('')}</div></section>`;
}

function syncRail(rail) {
  const controls = rail.closest('.shelf')?.querySelector('.rail-controls');
  if (!controls) return;
  const remaining = rail.scrollWidth - rail.clientWidth;
  controls.hidden = remaining < 4;
  controls.firstElementChild.setAttribute('aria-disabled', String(rail.scrollLeft < 4));
  controls.lastElementChild.setAttribute('aria-disabled', String(rail.scrollLeft >= remaining - 4));
}

function observeRails() {
  railObserver ??= new ResizeObserver(entries => entries.forEach(({ target }) => syncRail(target)));
  for (const rail of main.querySelectorAll('.poster-rail')) {
    railObserver.observe(rail);
    rail.addEventListener('scroll', () => syncRail(rail), { passive: true });
  }
}

function footer() {
  return `<footer class="page-footer"><button data-action="credits">Sources &amp; credits</button><span>·</span><a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">TMDB</a><span>·</span><a href="https://www.justwatch.com/" target="_blank" rel="noopener noreferrer">JustWatch</a><span>·</span><a href="https://archive.org/" target="_blank" rel="noopener noreferrer">Internet Archive</a></footer>`;
}

function saveButton(item, compact = false) {
  const isSaved = Object.hasOwn(saved, item.key);
  if (compact) return `<button type="button" class="card-save icon-button" data-action="save" data-key="${escape(item.key)}" aria-label="${isSaved ? 'Remove from' : 'Add to'} Watchlist: ${escape(item.title)}" aria-pressed="${isSaved}">${icon(isSaved ? 'check' : 'plus')}</button>`;
  return `<button type="button" class="button secondary" data-action="save" data-key="${escape(item.key)}" aria-pressed="${isSaved}">${icon(isSaved ? 'check' : 'plus')} ${isSaved ? 'In Watchlist' : 'Watchlist'}</button>`;
}

function ratingControl(item) {
  const score = ratings[item.key]?.score || 0;
  return `<fieldset class="rating-control" data-rating-key="${escape(item.key)}"><legend>Your rating</legend><div class="rating-stars">${[1, 2, 3, 4, 5].map(value => `<label><input type="radio" name="personal-rating" value="${value}" aria-label="${value} ${value === 1 ? 'star' : 'stars'}" ${value === score ? 'checked' : ''}><span class="${value <= score ? 'filled' : ''}">${icon('star')}</span></label>`).join('')}${score ? '<button type="button" class="plain-link" data-action="clear-rating">Clear rating</button>' : ''}</div></fieldset>`;
}

function updateRating() {
  const current = titlePage.querySelector('.rating-control');
  if (!current || !active) return;
  const focused = document.activeElement;
  const restore = current.contains(focused);
  const value = focused.value;
  current.outerHTML = ratingControl(active.item);
  if (restore) (titlePage.querySelector(`input[name="personal-rating"][value="${CSS.escape(value || '1')}"]`))?.focus({ preventScroll: true });
}

function renderLibraryControls() {
  if (active) updateRating();
  for (const button of document.querySelectorAll('[data-action="save"]')) {
    const isSaved = Object.hasOwn(saved, button.dataset.key);
    button.setAttribute('aria-pressed', isSaved);
    const item = titles.get(button.dataset.key);
    if (button.matches('.card-save') && item) button.outerHTML = saveButton(item, true);
    else button.innerHTML = `${icon(isSaved ? 'check' : 'plus')} ${isSaved ? 'In Watchlist' : 'Watchlist'}`;
  }
  if (!active && ['watchlist', 'ratings', 'home'].includes(state.page)) render();
}

function heroTitles() {
  const live = state.remote.filter(item => item.backdrop && hasReleased(item));
  const recent = (state.collections.newMovies || []).filter(item => item.backdrop && item.votes >= 15);
  return live.length || recent.length ? [...new Map([...live, ...recent].map(item => [item.key, item])).values()].slice(0, 4) : [];
}

function hasReleased(item) {
  return Boolean(item.date && item.date <= new Date().toISOString().slice(0, 10));
}

function renderHero() {
  const featured = heroTitles();
  const item = featured[state.hero] || featured[0];
  if (!item) return state.loading ? '<div class="hero home-loading" aria-label="Loading featured titles"></div>' : '';
  const resumed = resumeFor(item);
  const action = resumed ? 'resume' : item.type === 'movie' || isArchive(item) ? 'watch' : 'details';
  return `<section class="hero" aria-label="Featured titles">
    <img class="hero-image" src="${escape(item.backdrop)}" alt="" fetchpriority="high">
    <div class="hero-inner"><div class="hero-copy"><div class="eyebrow"><span></span>${isArchive(item) ? 'From the archive' : 'Featured'}</div>
      <h1${item.title.length > 24 ? ' class="long-title"' : ''}>${escape(item.title)}</h1>
      <div class="meta">${meta(item).map(value => `<span>${escape(value)}</span>`).join('')}</div>
      ${item.description ? `<p class="hero-summary">${escape(item.description)}</p>` : ''}
      <div class="hero-actions"><button type="button" class="button primary" data-action="${action}" data-key="${escape(item.key)}">${icon('play')} ${resumed ? 'Resume' : action === 'details' ? 'View episodes' : 'Watch now'}</button>${action === 'details' ? '' : `<button type="button" class="button secondary" data-action="details" data-key="${escape(item.key)}">${icon('info')} Details</button>`}${saveButton(item)}</div>
    </div>
    <div class="hero-selector" aria-label="Featured title selection">${featured.map((entry, i) => `<button class="hero-dot" type="button" data-action="feature" data-index="${i}" aria-label="Show ${escape(entry.title)}" aria-pressed="${i === featured.indexOf(item)}"></button>`).join('')}</div>
    </div>
  </section>`;
}

function renderNavigation() {
  const current = active ? active.item.type === 'tv' ? 'tv' : 'movies' : state.page === 'ratings' ? 'watchlist' : state.page;
  navigation.innerHTML = navLinks.map(([page, label, glyph]) => `<a href="#${page}" class="nav-link" ${current === page ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span></a>`).join('');
}

function filters(options) {
  return `<div class="filters" aria-label="Filter titles">${options.map(([value, label]) => `<button type="button" class="filter" data-action="filter" data-value="${escape(value)}" aria-pressed="${value === state.filter}">${escape(label)}</button>`).join('')}</div>`;
}

function catalogToolbar() {
  const { category, decade, sort } = state.facets;
  const select = (name, label, value, options) => `<details class="facet-menu"><summary aria-label="${label}">${label} ${icon('chevron-down')}</summary><div class="facet-options">${options.map(([key, text]) => `<button type="button" data-action="facet" data-name="${name}" data-value="${escape(key)}" aria-pressed="${String(key) === value}">${escape(text)}</button>`).join('')}</div></details>`;
  const decades = Array.from({ length: 15 }, (_, index) => 2020 - index * 10);
  const canSort = ['movies', 'tv', 'archive'].includes(state.page);
  const sorts = state.filter === 'free' || state.page === 'archive' ? Object.entries(sortOptions).filter(([key]) => key !== 'top') : Object.entries(sortOptions);
  const quick = ['', 'Action', 'Animation', 'Anime', 'Comedy', 'Drama', 'Horror', 'Science Fiction'];
  const chips = [[category && !quick.includes(category) ? category : '', 'category'], [decade ? `${decade}s` : '', 'decade'], [sort !== 'popular' ? sortOptions[sort] : '', 'sort']];
  return `<section id="catalog-filters" class="catalog-filters" aria-label="Catalog filters">
    <div class="genre-chips">${quick.map(genre => `<button class="filter" type="button" data-action="facet" data-name="category" data-value="${genre}" aria-pressed="${category === genre}">${genre || 'All genres'}</button>`).join('')}</div>
    <div class="facet-tools">
    ${select('category', 'Genres', category, [['', 'All genres'], ...Object.keys(browseGenres).map(name => [name, name])])}
    ${state.page !== 'new' ? select('decade', 'Decade', decade, [['', 'Any decade'], ...decades.map(year => [year, `${year}s`])]) : ''}
    ${canSort ? select('sort', 'Sort by', sort, sorts) : ''}
    ${chips.filter(([text]) => text).map(([text, name]) => `<button class="filter active-facet" type="button" data-action="facet" data-name="${name}" data-value="${defaults[name]}" aria-label="Clear ${escape(text)} filter">${escape(text)} ${icon('close')}</button>`).join('')}
    </div></section>`;
}

function addFacets(params) {
  for (const [name, value] of Object.entries(state.facets)) if (value) params.set(name, value);
}

function filterResults(items) {
  const filtered = items.filter(item => matchesCatalog(item, state.facets));
  if (state.facets.sort === 'newest') return filtered.sort((a, b) => (b.year || 0) - (a.year || 0));
  if (state.facets.sort === 'oldest') return filtered.sort((a, b) => (a.year || Infinity) - (b.year || Infinity));
  return filtered;
}

function renderCatalogResults(markup) {
  const target = main.querySelector('#catalog-results');
  if (!target) return;
  const current = document.activeElement;
  const focusKey = target.contains(current) && current.dataset.key;
  target.innerHTML = markup;
  if (state.page === 'search' && state.filter !== 'free' && state.connected) renderArchiveSection();
  if (focusKey) target.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  syncCardRatings();
}

function empty(heading, message, action = '') {
  const glyph = state.page === 'watchlist' ? 'bookmark' : state.page === 'ratings' ? 'star' : 'search';
  return `<div class="empty"><span class="empty-icon" aria-hidden="true">${icon(glyph)}</span><h2>${heading}</h2><p>${message}</p>${action}</div>`;
}

function connectionNotice(query = '') {
  const external = query ? `<a class="plain-link" href="${justWatchSearch(query)}" target="_blank" rel="noopener noreferrer">Search on JustWatch ${icon('external')}</a>` : '';
  return `<div class="inline-notice"><span>Connect TMDB to browse its full catalog and see regional availability.</span><div><button type="button" class="plain-link" data-action="settings">Connect TMDB ${icon('arrow')}</button>${external ? `<br>${external}` : ''}</div></div>`;
}

function remoteNotice() {
  if (state.loading) return '<div class="inline-notice" role="status">Loading titles from TMDB…</div>';
  if (!state.error) return '';
  return `<div class="inline-notice" role="status"><span>${escape(state.error)}</span><button type="button" class="plain-link" data-action="refresh">Retry ${icon('arrow')}</button></div>`;
}

function archiveNotice() {
  if (state.archiveLoading) return '<p class="catalog-status" role="status">Loading Internet Archive titles…</p>';
  if (state.archiveError) return `<div class="inline-notice" role="status"><span>${escape(state.archiveError)}</span><button type="button" class="plain-link" data-action="retry-archive">Retry ${icon('arrow')}</button></div>`;
  return state.archiveNext ? '<div class="load-more"><button type="button" class="button secondary" data-action="more-archive">Load more from the Archive</button></div>' : '';
}

function titleIdentity(item) {
  const title = item.title.toLowerCase().replace(/\s*\(\d{4}\)\s*$/, '').replace(/[^\p{L}\p{N}]/gu, '');
  return `${item.type}:${title}:${item.year || ''}`;
}

function mergeTitles(items, additional) {
  const identities = new Set(items.map(titleIdentity));
  return [...items, ...additional.filter(item => {
    const identity = titleIdentity(item);
    if (identities.has(identity)) return false;
    identities.add(identity);
    return true;
  })];
}

function renderArchiveSection() {
  const target = main.querySelector('#archive-results');
  if (!target) return;
  const items = filterResults(mergeTitles([], state.archive));
  target.innerHTML = `${items.length ? grid(items) : ''}${archiveNotice()}`;
  target.closest('section').hidden = !items.length && !state.archiveLoading && !state.archiveError && !state.archiveNext;
}

function render() {
  if (active || main.hidden) return;
  railObserver?.disconnect();
  main.classList.toggle('home', state.page === 'home');
  renderSuggestions();
  if (state.page === 'home') {
    const recentlyWatched = [...titles.values()].map(item => [item, resumeFor(item)?.[1]])
      .filter(([, entry]) => entry).sort((a, b) => b[1].updated - a[1].updated).slice(0, 8).map(([item]) => item);
    const scrollPositions = new Map([...main.querySelectorAll('.poster-rail')].map(rail => [rail.parentElement.getAttribute('aria-label'), rail.scrollLeft]));
    const focused = document.activeElement;
    const focusKey = focused.matches('.poster-card') ? focused.dataset.key : '';
    const focusShelf = focused.closest('.shelf')?.getAttribute('aria-label');
    main.innerHTML = renderHero()
      + `<div class="home-shelves">${shelf('Continue watching', recentlyWatched, '', true)}
        ${state.connected ? shelf('Trending this week', state.remote.filter(hasReleased).slice(0, 16)) + remoteNotice() : connectionNotice()}
        ${shelf('New movies', (state.collections.newMovies || []).slice(0, 14), 'new')}
        ${shelf('New TV series', (state.collections.newTV || []).slice(0, 14), 'new?type=tv')}
        ${shelf('Top rated films', (state.collections.top || []).slice(0, 14), 'movies?sort=top')}
        ${shelf('Hidden gems', (state.collections.gems || []).slice(0, 14), 'movies?collection=gems')}
        ${shelf('Anime', (state.collections.anime || []).slice(0, 14), 'tv?genre=Anime')}
        <a class="section-link archive-link" href="#archive">Explore the Internet Archive ${icon('arrow')}</a>${footer()}</div>`;
    for (const rail of main.querySelectorAll('.poster-rail')) rail.scrollLeft = scrollPositions.get(rail.parentElement.getAttribute('aria-label')) || 0;
    if (focusKey && focusShelf) main.querySelector(`.shelf[aria-label="${CSS.escape(focusShelf)}"] [data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    observeRails();
    syncCardRatings();
    return;
  }

  let heading;
  let subtitle = '';
  let items = [];
  let choices = '';
  let notice = '';
  if (state.page === 'watchlist') {
    heading = 'Watchlist';
    items = Object.values(saved).map(item => titles.get(item.key) || item).reverse();
  } else if (state.page === 'ratings') {
    heading = 'My ratings';
    items = Object.values(ratings).map(entry => titles.get(entry.item.key) || entry.item).reverse();
  } else if (state.page === 'archive') {
    heading = 'Internet Archive';
    subtitle = 'Public-domain and Creative Commons films and episodes.';
    choices = filters([['all', 'All'], ['movie', 'Movies'], ['tv', 'TV Shows'], ['cc', 'Creative Commons']]);
    items = mergeTitles(archiveCatalog.filter(item => state.filter === 'all' || item.type === state.filter || (state.filter === 'cc' && item.license[0].startsWith('CC'))), state.archive);
    notice = archiveNotice();
  } else if (state.page === 'search') {
    heading = `Results for “${state.query}”`;
    choices = filters([['all', 'All'], ['movie', 'Movies'], ['tv', 'TV Shows'], ['free', 'Archive']]);
    const terms = state.query.toLowerCase().split(/\s+/);
    items = archiveCatalog.filter(item => terms.every(term => `${item.title} ${item.year} ${item.genre} ${(item.episodes || []).map(episode => episode.title).join(' ')}`.toLowerCase().includes(term)));
    if (state.filter !== 'free') {
      items = [...new Map([...items, ...state.remote].map(item => [item.key, item])).values()];
      notice = state.connected ? remoteNotice() : connectionNotice(state.query);
    }
    items = items.filter(item => state.filter === 'all' || state.filter === 'free' || item.type === state.filter);
    if (state.filter === 'free') {
      items = mergeTitles(items, state.archive);
      notice = archiveNotice();
    }
  } else if (state.page === 'new') {
    heading = 'New Releases';
    subtitle = 'Movies and series that premiered in the past 90 days.';
    choices = filters([['movie', 'Movies'], ['tv', 'TV Shows']]);
    items = state.remote;
    notice = state.connected ? remoteNotice() : connectionNotice();
  } else {
    const type = state.page === 'tv' ? 'tv' : 'movie';
    heading = state.collection === 'gems' ? 'Hidden gems' : type === 'tv' ? 'TV Shows' : 'Movies';
    choices = filters([['all', 'All titles'], ['free', 'Archive']]);
    items = state.connected && state.filter !== 'free' ? [] : archiveCatalog.filter(item => item.type === type);
    if (state.filter !== 'free') {
      items = [...new Map([...items, ...state.remote].map(item => [item.key, item])).values()];
      notice = state.connected ? remoteNotice() : connectionNotice();
    }
    if (!state.connected || state.filter === 'free') items = mergeTitles(items, state.archive);
  }
  if (state.remoteNext && !state.loading && state.filter !== 'free') notice += '<div class="load-more"><button type="button" class="button secondary" data-action="more-tmdb">Load more titles</button></div>';
  const libraryPage = ['watchlist', 'ratings'].includes(state.page);
  if (libraryPage) {
    heading = 'My Library';
    choices = `<nav class="filters library-tabs" aria-label="Library">${[['watchlist', 'Watchlist', 'bookmark'], ['ratings', 'My ratings', 'star']].map(([page, label, glyph]) => `<a href="#${page}" class="filter"${state.page === page ? ' aria-current="page"' : ''}>${icon(glyph)} ${label}</a>`).join('')}</nav>`;
  }
  if (!libraryPage) items = filterResults(items);
  const loading = state.loading || state.archiveLoading;
  let content = items.length ? grid(items) : loading
    ? `<div class="poster-grid skeleton-grid" aria-hidden="true">${'<div></div>'.repeat(7)}</div>` : '';
  if (!items.length && !state.loading && !state.error && !state.archiveLoading && !state.archiveError && !(state.page === 'search' && state.archive.length)) {
    content = libraryPage
      ? empty(state.page === 'ratings' ? 'No ratings yet' : 'Your watchlist is empty', state.page === 'ratings' ? 'Open a movie or show to give it a rating.' : 'Save a movie or show to find it here later.', '<a class="button primary" href="#movies">Browse movies</a>')
      : empty('No matching titles', 'Try a different title or filter.');
  }
  const separateArchive = state.page === 'search' && state.filter !== 'free' && state.connected;
  if (['movies', 'tv'].includes(state.page) && (!state.connected || state.filter === 'free')) notice += archiveNotice();
  if (state.page === 'search' && !separateArchive && state.filter !== 'free') {
    const merged = filterResults(mergeTitles(items, state.archive));
    if (merged.length) content = grid(merged);
    notice += archiveNotice();
  }
  const resultCount = items.length && !libraryPage ? `<p class="results-count" role="status">${items.length} ${items.length === 1 ? 'title' : 'titles'} shown</p>` : '';
  const results = `${resultCount}${content}${notice}${separateArchive ? '<section class="shelf"><div class="section-head"><h2>Internet Archive</h2></div><div id="archive-results"></div></section>' : ''}`;
  const shellKey = JSON.stringify([state.page, state.query, state.filter, state.facets]);
  if (main.dataset.catalogShell !== shellKey || !main.querySelector('#catalog-results')) {
    main.dataset.catalogShell = shellKey;
    main.innerHTML = `<div class="view-heading"><div><h1>${escape(heading)}</h1>${subtitle ? `<p>${subtitle}</p>` : ''}</div></div>${choices}${libraryPage ? '' : catalogToolbar()}<div id="catalog-results"></div>${footer()}`;
  }
  renderCatalogResults(results);
}

function catalogCacheKey() {
  return JSON.stringify([state.page, state.query, state.filter, state.facets, state.collection, state.connected]);
}

function cacheCatalog() {
  const key = catalogCacheKey();
  if (catalogCache.size >= 12 && !catalogCache.has(key)) catalogCache.delete(catalogCache.keys().next().value);
  const cached = catalogCache.get(key);
  catalogCache.set(key, {
    remote: state.error ? cached?.remote || [] : state.remote,
    archive: state.archiveError ? cached?.archive || [] : state.archive,
  });
}

async function loadTMDB(id, page) {
  const signal = catalogRequest.signal;
  state.error = '';
  state.loading = true;
  render();
  const params = new URLSearchParams({ page });
  if (state.page === 'search') {
    params.set('q', state.query);
    if (['movie', 'tv'].includes(state.filter)) params.set('type', state.filter);
  }
  if (state.page === 'movies') params.set('type', 'movie');
  if (state.page === 'tv') params.set('type', 'tv');
  if (state.page === 'new') {
    params.set('type', state.filter);
    params.set('collection', 'new');
  } else if (state.collection) params.set('collection', state.collection);
  addFacets(params);
  const endpoint = { search: 'search', home: 'trending', movies: 'browse', tv: 'browse', new: 'browse' }[state.page];
  try {
    const data = await api(`/api/${endpoint}?${params}`, { signal });
    if (id !== requestId) return;
    const previous = page === 1 ? [] : state.remote;
    state.remote = [...new Map([...previous, ...data.results.map(localizeTitle)].map(item => [item.key, item])).values()];
    state.remoteNext = data.nextPage;
  } catch (error) {
    if (id === requestId) state.error = error.message;
  } finally {
    if (id === requestId) {
      state.loading = false;
      if (!state.archiveLoading) cacheCatalog();
      render();
    }
  }
}

async function loadHome(id, signal) {
  try {
    const sections = await api('/api/home', { signal });
    if (id !== requestId) return;
    for (const [key, items] of Object.entries(sections)) state.collections[key] = items.map(localizeTitle);
    render();
  } catch { /* Trending and continue watching can still load. */ }
}

async function loadArchive(id, page) {
  const signal = catalogRequest.signal;
  const group = state.page === 'movies' ? 'movie' : state.page === 'tv' ? 'tv' : ['movie', 'tv', 'cc'].includes(state.filter) ? state.filter : 'all';
  const params = new URLSearchParams({ group, page });
  addFacets(params);
  if (state.page === 'search') params.set('q', state.query);
  state.archiveLoading = true;
  state.archiveError = '';
  render();
  try {
    const data = await api(`/api/archive?${params}`, { signal });
    if (id !== requestId) return;
    for (const item of data.results) {
      if (!titles.get(item.key)?.media) titles.set(item.key, item);
    }
    const previous = page === 1 ? [] : state.archive;
    state.archive = [...new Map([...previous, ...data.results].map(item => [item.key, titles.get(item.key)])).values()];
    state.archiveNext = data.nextPage;
  } catch (error) {
    if (id === requestId) state.archiveError = error.message;
  } finally {
    if (id === requestId) {
      state.archiveLoading = false;
      if (!state.loading) cacheCatalog();
      render();
    }
  }
}

function refreshCatalog() {
  const id = ++requestId;
  catalogRequest?.abort();
  catalogRequest = new AbortController();
  const cached = catalogCache.get(catalogCacheKey());
  Object.assign(state, { remote: cached?.remote || [], remoteNext: null, error: '', loading: false, archive: cached?.archive || [], archiveNext: null, archiveError: '', archiveLoading: false });
  render();
  if (state.connected && state.filter !== 'free' && ['home', 'search', 'movies', 'tv', 'new'].includes(state.page)) loadTMDB(id, 1);
  if (state.connected && state.page === 'home') loadHome(id, catalogRequest.signal);
  if (['archive', 'search'].includes(state.page) || (['movies', 'tv'].includes(state.page) && (!state.connected || state.filter === 'free'))) loadArchive(id, 1);
}

function showPage(page, params = new URLSearchParams()) {
  state.page = page;
  const selection = params.get('type');
  const filtersByPage = page === 'new' ? ['movie', 'tv'] : page === 'search' || page === 'archive' ? ['movie', 'tv', page === 'search' ? 'free' : 'cc'] : ['free'];
  state.filter = filtersByPage.includes(selection) ? selection : page === 'new' ? 'movie' : 'all';
  state.collection = page === 'movies' && params.get('collection') === 'gems' ? 'gems' : '';
  const genre = params.get('genre');
  const sort = params.get('sort');
  const decade = params.get('decade');
  state.facets = { ...defaults, category: Object.hasOwn(browseGenres, genre) ? genre : '', decade: /^(?:18[89]|19\d|20[0-2])0$/.test(decade || '') ? decade : '', sort: Object.hasOwn(sortOptions, sort) ? sort : 'popular' };
  if (page !== 'search') {
    state.query = '';
    search.value = '';
  }
  searchClear.hidden = !search.value;
  state.hero = 0;
  renderNavigation();
  window.scrollTo(0, 0);
  refreshCatalog();
}

function route() {
  clearTimeout(searchTimer);
  const hash = location.hash.slice(1);
  const title = hash.match(/^(?:(movie|tv)\/([1-9]\d{0,9})|edition\/([\w.-]+))(?:\/(watch|s(\d{1,4})e([1-9]\d{0,3}))(?:\/([\w-]+))?)?$/);
  if (title) return routeTitle(title);
  closeTitlePage();
  browseHash = location.hash || '#home';
  if (hash.startsWith('search=')) {
    const [query, params] = hash.slice(7).split('?');
    try { state.query = decodeURIComponent(query).trim().slice(0, 180); } catch { state.query = ''; }
    if (state.query) {
      search.value = state.query;
      return showPage('search', new URLSearchParams(params));
    }
  }
  const [page, params] = hash.split('?');
  const pages = ['archive', 'ratings', ...navLinks.map(([name]) => name)];
  showPage(pages.includes(page) ? page : 'home', new URLSearchParams(params));
}

function closeTitlePage() {
  openingId++;
  if (!main.hidden) return;
  stopVideo();
  active = null;
  titlePage.replaceChildren();
  titlePage.hidden = true;
  main.hidden = false;
}

function navigateTitle(item, suffix = '') {
  const hash = `#${titlePath(item)}${suffix}`;
  if (location.hash === hash) route();
  else location.hash = hash;
}

async function routeTitle(match) {
  const [, type, id, key, mode, season, number, editionEpisode] = match;
  const opening = ++openingId;
  const itemKey = key || `${type}-${id}`;
  const path = location.hash;
  stopVideo();
  active = null;
  main.hidden = true;
  titlePage.hidden = false;
  titlePage.className = 'title-page';
  titlePage.innerHTML = `<div class="title-status" role="status">Loading title…</div>`;
  let item = titles.get(itemKey);
  try {
    if (!item && type) {
      const details = await api(`/api/${type}/${id}`);
      if (opening !== openingId) return;
      detailsCache.set(itemKey, details);
      item = localizeTitle({ ...details, media_type: type });
    } else if (key?.startsWith('archive-') && !item?.media) {
      item = await api(`/api/archive/${encodeURIComponent(key.slice(8))}`);
      if (opening !== openingId) return;
      titles.set(item.key, item);
    }
    if (!item) throw new Error('This title could not be found.');
    if (mode?.startsWith('s') && type === 'tv') {
      const episode = episodeChoice?.path === path ? episodeChoice.episode : { season: Number(season), number: Number(number), title: `Episode ${number}` };
      openTitle(item, false, undefined, { embed: true, episode, progressKey: cineSrcKey(item, episode) });
    } else if (mode === 'watch') {
      if (type === 'movie') openTitle(item, false, undefined, { embed: true, progressKey: cineSrcKey(item) });
      else if (isArchive(item)) openTitle(item, true, editionEpisode);
      else openTitle(item);
    } else openTitle(item);
  } catch (error) {
    if (opening !== openingId) return;
    titlePage.innerHTML = `<div class="title-status" role="status"><h1 id="title-heading">Title unavailable</h1><p>${escape(error.message)}</p><a class="button secondary" href="${escape(browseHash)}">Back to browse</a></div>`;
  }
}

function submitSearch() {
  clearTimeout(searchTimer);
  const value = search.value.trim();
  if (value) location.hash = `search=${encodeURIComponent(value)}`;
  else if (state.page === 'search') location.hash = 'home';
}

function hideSuggestions() {
  suggestions.hidden = true;
  suggestionIndex = -1;
  search.setAttribute('aria-expanded', 'false');
  search.removeAttribute('aria-activedescendant');
}

function renderSuggestions() {
  const query = search.value.trim().toLowerCase();
  if (document.activeElement !== search || suggestionsDismissed) return hideSuggestions();
  if (!query && showSearchCommands) {
    suggestions.innerHTML = [...navLinks, ['settings', 'Settings', 'settings']].map(([page, label, glyph], index) =>
      `<div class="search-option" id="suggestion-${index}" role="option" aria-selected="false" data-action="search-command" data-value="${page}">${icon(glyph)}<span class="option-title">${label}</span></div>`).join('');
    suggestions.hidden = false;
    search.setAttribute('aria-expanded', 'true');
    selectSuggestion(suggestionIndex);
    return;
  }
  if (query.length < 2) return hideSuggestions();
  const matches = new Map();
  const current = state.query.toLowerCase() === query ? [...state.remote, ...state.archive] : [];
  for (const item of [...current, ...archiveCatalog, ...Object.values(saved)]) {
    if (item.title.toLowerCase().includes(query) && !matches.has(item.key)) matches.set(item.key, item);
    if (matches.size === 6) break;
  }
  if (!matches.size) return hideSuggestions();
  suggestions.innerHTML = [...matches.values()].map((item, index) => `<div class="search-option" id="suggestion-${index}" role="option" aria-selected="false" data-action="suggestion" data-key="${escape(item.key)}">${item.poster ? `<img src="${escape(item.poster)}" alt="">` : icon(item.type === 'tv' ? 'tv' : 'film')}<span class="option-title">${escape(item.title)}</span><small>${escape(item.year || '')}</small></div>`).join('');
  suggestions.hidden = false;
  search.setAttribute('aria-expanded', 'true');
  selectSuggestion(suggestionIndex < matches.size ? suggestionIndex : -1);
}

function selectSuggestion(index) {
  suggestionIndex = index;
  const option = suggestions.children[index];
  for (const entry of suggestions.children) entry.setAttribute('aria-selected', String(entry === option));
  if (option) {
    search.setAttribute('aria-activedescendant', option.id);
    option.scrollIntoView({ block: 'nearest' });
  } else search.removeAttribute('aria-activedescendant');
}

function justWatchSearch(title) {
  const country = state.region === 'GB' ? 'uk' : state.region.toLowerCase();
  const url = new URL(`https://www.justwatch.com/${country}/search`);
  url.searchParams.set('q', title);
  return escape(url.href);
}

function streamingLink(session) {
  if (session.item.type === 'movie' && session.item.id === 687163) {
    return `<a class="plain-link" data-streaming-link href="https://www.primevideo.com/detail/0J0SQMKFG51K9S3UTU9SDEMT7D" target="_blank" rel="noopener noreferrer">Open in Prime Video ${icon('external')}</a>`;
  }
  const url = session.details?.['watch/providers']?.results?.[state.region]?.link;
  const href = /^https:\/\/www\.themoviedb\.org\//.test(url || '') ? escape(url) : justWatchSearch(session.item.title);
  return `<a class="plain-link" data-streaming-link href="${href}" target="_blank" rel="noopener noreferrer">Streaming options ${icon('external')}</a>`;
}

function updateStreamingLink(session) {
  if (active !== session) return;
  const link = titlePage.querySelector('[data-streaming-link]');
  if (link) link.outerHTML = streamingLink(session);
}

function episodeLabel(episode) {
  const number = episode.number ?? episode.episode_number;
  const season = episode.season ?? episode.season_number;
  return [Number.isInteger(number) ? `S${season} E${number}` : '', episode.duration || episode.runtime ? `${episode.duration || episode.runtime} min` : ''].filter(Boolean).join(' · ');
}

function validEpisode(episode) {
  return Number.isSafeInteger(episode?.season) && episode.season >= 0
    && Number.isSafeInteger(episode.number) && episode.number > 0;
}

function episodeContext(episode) {
  return episode ? `${escape(episode.title)}${episodeLabel(episode) ? ` · ${episodeLabel(episode)}` : ''}` : '';
}

function episodesMarkup(session) {
  const { item, episode, details } = session;
  if (item.episodes?.length) {
    return `<h3>Watch free episodes</h3>${item.episodes.map(entry => `<button class="episode-row" type="button" data-action="episode" data-key="${entry.key}" aria-pressed="${episode?.key === entry.key}"><span>${escape(entry.title)}${episodeLabel(entry) ? `<small>${episodeLabel(entry)}</small>` : ''}</span>${icon('play')}</button>`).join('')}`;
  }
  const seasons = details?.seasons?.filter(season => season.season_number >= 0);
  if (!seasons?.length) return session.details ? '' : '<p class="catalog-status" role="status">Loading episodes…</p>';
  const selected = episode?.season ?? session.season ?? seasons.find(season => season.season_number > 0)?.season_number;
  return `<div class="episode-header"><h3 id="episode-heading">Episodes</h3><select class="season-select" aria-label="Season">${seasons.map(season => `<option value="${season.season_number}"${season.season_number === selected ? ' selected' : ''}>${escape(season.name)}</option>`).join('')}</select></div><div class="episode-list" id="season-episodes" aria-live="polite"></div>`;
}

async function loadSeason(session, number) {
  const target = titlePage.querySelector('#season-episodes');
  if (!target) return;
  const revision = (session.seasonRevision || 0) + 1;
  session.seasonRevision = revision;
  session.season = Number(number);
  target.textContent = 'Loading episodes…';
  try {
    const season = await api(`/api/tv/${session.item.id}/season/${number}`);
    if (active !== session || session.seasonRevision !== revision) return;
    target.innerHTML = season.episodes?.length ? season.episodes.map(entry => {
      const selected = session.episode?.season === entry.season_number && session.episode?.number === entry.episode_number;
      const coordinates = `data-season="${entry.season_number}" data-number="${entry.episode_number}" data-episode-title="${escape(entry.name)}"`;
      const image = imagePath(entry.still_path, 'w300');
      return `<div class="episode-row remote-episode"><button class="episode-play" type="button" data-action="stream-episode" ${coordinates} aria-pressed="${selected}"><span class="episode-number" aria-hidden="true">${entry.episode_number}</span><span class="episode-image">${image ? `<img src="${image}" alt="" loading="lazy">` : ''}<span>${icon('play')}</span></span><span class="episode-info"><strong>${escape(entry.name)}</strong><small>${episodeLabel(entry)}</small>${entry.overview ? `<span class="episode-summary">${escape(entry.overview)}</span>` : ''}</span></button><button class="icon-button episode-file" type="button" data-action="episode-file" ${coordinates} aria-label="Play local file for ${escape(entry.name)}" title="Play local file">${icon('folder')}</button></div>`;
    }).join('') : 'No episodes are listed.';
    if (session.media?.embed && session.episode?.season === Number(number)) {
      const current = season.episodes?.findIndex(entry => entry.episode_number === session.episode.number) ?? -1;
      if (current >= 0) {
        const entry = season.episodes[current];
        session.episode.title = entry.name;
        session.episode.duration = entry.runtime;
        titlePage.querySelector('.title-context').innerHTML = episodeContext(session.episode);
        const next = season.episodes[current + 1];
        const control = titlePage.querySelector('[data-action="next-episode"]');
        session.nextEpisode = next ? { season: next.season_number, number: next.episode_number, title: next.name } : null;
        control.hidden = !session.nextEpisode;
        const following = session.details?.seasons?.find(item => item.season_number === session.episode.season + 1);
        if (!next && following) {
          session.nextEpisode = { season: following.season_number, number: 1, title: 'Episode 1' };
          control.hidden = false;
        }
      }
    }
  } catch (error) {
    if (active === session && session.seasonRevision === revision) target.textContent = error.message;
  }
}

async function loadTitle(session) {
  if (!session.details && session.item.id) {
    try {
      session.details = await api(`/api/${session.item.type}/${session.item.id}`);
      detailsCache.set(session.item.key, session.details);
    } catch { /* The JustWatch search link still works when TMDB is unavailable. */ }
  }
  if (active !== session) return;
  const details = session.details;
  if (details) {
    session.item.imdb ||= details.external_ids?.imdb_id || details.imdb_id;
    session.item.score ||= details.vote_count ? details.vote_average : 0;
    const facts = titlePage.querySelector('.title-facts');
    if (facts) facts.innerHTML = titleFacts(session);
    const cast = titlePage.querySelector('.cast-section');
    if (cast && details.credits?.cast?.length) {
      cast.hidden = false;
      cast.innerHTML = `<h2>Cast</h2><div class="cast-list">${details.credits.cast.slice(0, 10).map(person => `<div class="cast-person">${person.profile_path ? `<img src="${imagePath(person.profile_path, 'w185')}" alt="" loading="lazy">` : `<span>${icon('user')}</span>`}<strong>${escape(person.name)}</strong><small>${escape(person.character)}</small></div>`).join('')}</div>`;
    }
    if (session.item.imdb) api(`/api/imdb?id=${encodeURIComponent(session.item.imdb)}`).then(({ rating }) => {
      if (!rating) return;
      imdbScores.set(session.item.imdb, rating);
      imdbScores.set(session.item.key, rating);
      if (active === session && facts) facts.innerHTML = titleFacts(session);
    }).catch(() => {});
  }
  const about = titlePage.querySelector('.title-about');
  if (about && !session.item.description && session.details?.overview) {
    about.textContent = session.details.overview;
    about.hidden = false;
  }
  updateStreamingLink(session);
  const episodes = titlePage.querySelector('.title-episodes');
  if (episodes && !session.item.episodes?.length) {
    episodes.innerHTML = session.details ? episodesMarkup(session) : '<p class="catalog-status" role="status">Episode details are unavailable.</p>';
    const select = episodes.querySelector('select');
    if (select) loadSeason(session, select.value);
  }
}

function watchCineSrc(item, episode = null) {
  if (!hasCineSrcTitle(item) || (item.type === 'tv' && !validEpisode(episode))) return;
  const suffix = episode ? `/s${episode.season}e${episode.number}` : '/watch';
  episodeChoice = episode ? { path: `#${titlePath(item)}${suffix}`, episode } : null;
  navigateTitle(item, suffix);
}

async function findArchiveEdition(session) {
  const { item } = session;
  if (item.type !== 'movie' || isArchive(item) || !item.year) return;
  const match = candidate => titleIdentity(candidate) === titleIdentity(item);
  try {
    const existing = state.archive.find(match);
    const params = new URLSearchParams({ group: Number(item.year) > 1969 ? 'cc' : 'movie', q: item.title });
    const edition = existing || (await api(`/api/archive?${params}`)).results.find(match);
    if (!edition || active !== session) return;
    const playable = await api(`/api/archive/${encodeURIComponent(edition.archiveId)}`);
    if (active !== session) return;
    titles.set(playable.key, playable);
    titlePage.querySelector('.playback-options-body')?.insertAdjacentHTML('afterbegin', `<button class="plain-link" type="button" data-action="watch" data-key="${escape(playable.key)}">${icon('play')} Watch Archive edition</button>`);
  } catch { /* Provider listings are still available when the Archive lookup fails. */ }
}

function remember({ currentTime, duration }, session, force = false) {
  if (!Number.isFinite(duration) || !Number.isFinite(currentTime) || currentTime < 5 || currentTime >= duration || session.accountId !== account?.id) return;
  const now = Date.now();
  if (!force && now - (session.lastSaved || 0) < 4000) return;
  const entry = { time: currentTime, duration, updated: now, item: libraryTitle(session.item) };
  if (session.media.embed && session.episode) entry.episode = session.episode;
  session.lastSaved = now;
  libraryChange('progress', session.progressKey, entry);
}

const segmentNames = { intro: 'Intro', recap: 'Recap', credits: 'Credits' };

function playbackBar() {
  return `<div class="playback-bar">
    <div class="timeline"><div class="timeline-markers"></div><input class="playback-scrubber" type="range" min="0" max="1" step=".1" value="0" aria-label="Seek through video" disabled></div>
    <div class="transport">
      <button class="icon-button transport-play" type="button" data-action="toggle-play" aria-label="Play" disabled>${icon('play')}</button>
      <button class="transport-text" type="button" data-action="seek-relative" data-value="-10" aria-label="Rewind 10 seconds" disabled>−10<span>s</span></button>
      <button class="transport-text" type="button" data-action="seek-relative" data-value="10" aria-label="Forward 10 seconds" disabled>+10<span>s</span></button>
      <span class="playback-time">0:00 / —</span>
      <button class="button primary" type="button" data-action="skip-segment" hidden></button>
      <button class="button secondary transport-next" type="button" data-action="next-episode" hidden>Next episode ${icon('chevron-right')}</button>
      ${document.fullscreenEnabled ? `<button class="icon-button transport-fullscreen" type="button" data-action="fullscreen" aria-label="Toggle fullscreen" title="Fullscreen (F)">${icon('fullscreen')}</button>` : ''}
    </div>
  </div>`;
}

function playbackPosition(session) {
  return session.embedPlayback?.position || titlePage.querySelector('video');
}

function playerCommand(command, ...args) {
  if (active?.media?.embed) {
    titlePage.querySelector('iframe')?.contentWindow?.postMessage({ type: 'cinesrc:command', command, args }, cineSrcOrigin);
    return;
  }
  const video = titlePage.querySelector('video');
  if (!video) return;
  if (command === 'seek' && Number.isFinite(video.duration)) video.currentTime = args[0];
  if (command === 'play') video.play().catch(() => {});
  if (command === 'pause') video.pause();
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else titlePage.querySelector('.watch-stage')?.requestFullscreen().catch(() => showToast('Fullscreen is unavailable.'));
}

function renderPlayerSegments(position, session) {
  if (!Number.isFinite(position?.duration) || position.duration <= 0) return;
  const markers = titlePage.querySelector('.timeline-markers');
  if (!markers) return;
  const segments = (skips[session.progressKey] ?? session.segments).filter(segment => segment.end <= position.duration);
  markers.innerHTML = segments.map(segment => {
    const name = segmentNames[segment.kind];
    const times = `${timeCode(segment.start)} – ${timeCode(segment.end)}`;
    return `<button class="timeline-marker${segment.start > position.duration * .6 ? ' marker-right' : ''}" type="button" data-action="seek-marker" data-value="${segment.start}" aria-label="${name}, ${times}" style="left:${segment.start / position.duration * 100}%;width:${(segment.end - segment.start) / position.duration * 100}%"><span>${name} · ${times}</span></button>`;
  }).join('');
}

function updateTransport(position, session) {
  if (!position || active !== session || !Number.isFinite(position.duration) || position.duration <= 0) return;
  const scrubber = titlePage.querySelector('.playback-scrubber');
  if (!scrubber) return;
  const ready = !scrubber.disabled;
  scrubber.disabled = false;
  scrubber.max = position.duration;
  if (!scrubber.matches(':active')) scrubber.value = position.currentTime;
  scrubber.style.setProperty('--progress', `${position.currentTime / position.duration * 100}%`);
  scrubber.setAttribute('aria-valuetext', timeCode(Math.floor(position.currentTime)));
  titlePage.querySelector('.playback-time').textContent = `${timeCode(Math.floor(position.currentTime))} / ${timeCode(Math.floor(position.duration))}`;
  const play = titlePage.querySelector('.transport-play');
  const label = position.paused ? 'Play' : 'Pause';
  if (play.getAttribute('aria-label') !== label) {
    play.setAttribute('aria-label', label);
    play.innerHTML = position.paused ? icon('play') : '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h3v14H7zm7 0h3v14h-3z"/></svg>';
  }
  if (!ready) {
    for (const button of titlePage.querySelectorAll('[data-action="toggle-play"], [data-action="seek-relative"]')) button.disabled = false;
  }
  if (!ready || session.timelineDuration !== position.duration) {
    session.timelineDuration = position.duration;
    renderPlayerSegments(position, session);
  }
  updateSkip(position, session);
}

function timeCode(seconds) {
  const milliseconds = Math.round(seconds * 1000);
  const time = Math.floor(milliseconds / 1000);
  const min = Math.floor(time / 60);
  const decimal = milliseconds % 1000;
  return `${min}:${String(time % 60).padStart(2, '0')}${decimal ? `.${String(decimal).padStart(3, '0').replace(/0+$/, '')}` : ''}`;
}

function parseTime(value) {
  const text = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (!/^\d{1,4}:[0-5]\d(?:\.\d+)?$/.test(text)) return NaN;
  const [minutes, seconds] = text.split(':').map(Number);
  return 60 * minutes + seconds;
}

function skipSettings(session) {
  const segments = skips[session.progressKey] ?? session.segments ?? [];
  return `<details class="skip-settings"><summary>Skip settings</summary><form class="skip-form"><p>Enter a start and end time for each section you want to skip. Use seconds or minutes:seconds.</p><div class="skip-fields">${Object.entries(segmentNames).map(([kind, name]) => {
    const range = segments.find(segment => segment.kind === kind);
    return `<fieldset><legend>${name}</legend><label>Start<input name="${kind}-start" inputmode="decimal" placeholder="0:00" value="${range ? timeCode(range.start) : ''}"></label><label>End<input name="${kind}-end" inputmode="decimal" placeholder="0:30" value="${range ? timeCode(range.end) : ''}"></label></fieldset>`;
  }).join('')}</div><div class="watch-actions"><button type="submit" class="button secondary">Save skip times</button><button type="button" class="plain-link" data-action="reset-skips">Reset</button></div><p class="form-status" role="status"></p></form></details>`;
}

function updateSkip(video, session) {
  const button = titlePage.querySelector('.playback-bar [data-action="skip-segment"]');
  if (!button || active !== session) return;
  const segments = skips[session.progressKey] ?? session.segments ?? [];
  const segment = segments.find(entry => video.currentTime >= entry.start && video.currentTime < entry.end - .25 && entry.end <= video.duration);
  button.hidden = !segment;
  if (!segment) return;
  button.textContent = `Skip ${segmentNames[segment.kind].toLowerCase()}`;
  button.dataset.end = segment.end;
  if (state.autoSkip && !video.paused && !video.seeking && segment.kind !== 'credits' && !session.autoSkipped.has(segment.kind)) {
    session.autoSkipped.add(segment.kind);
    playerCommand('seek', segment.end);
    button.hidden = true;
  }
}

async function loadSkipSegments(video, session) {
  const { item, episode } = session;
  if (!item.id || (item.type === 'tv' && (!Number.isInteger(episode?.season) || !Number.isInteger(episode?.number))) || !Number.isFinite(video.duration)) return;
  const params = new URLSearchParams({ id: item.id, type: item.type, duration: Math.round(video.duration * 1000) });
  if (item.type === 'tv') {
    params.set('season', episode.season);
    params.set('episode', episode.number);
  }
  const target = session.progressKey;
  const duration = Math.round(video.duration);
  if (session.segmentRequest === duration) return;
  session.segmentRequest = duration;
  try {
    const { segments } = await api(`/api/segments?${params}`);
    if (active !== session || session.progressKey !== target || session.segmentRequest !== duration || !segments.length) return;
    const supplied = new Set(session.segments.map(segment => segment.kind));
    session.segments = [...session.segments, ...segments.filter(segment => !supplied.has(segment.kind))];
    const editor = titlePage.querySelector('.skip-settings');
    if (editor && !editor.open) editor.outerHTML = skipSettings(session);
    const position = playbackPosition(session);
    renderPlayerSegments(position, session);
    updateTransport(position, session);
  } catch { /* Manual and bundled timestamps remain usable. */ }
}

function startVideo(session, direct = false) {
  const { item, episode, media, progressKey } = session;
  const player = titlePage.querySelector('.video-box');
  const sourcePage = media.page || `https://archive.org/details/${encodeURIComponent(media.archive)}`;
  player.innerHTML = `<video controls playsinline preload="auto" aria-label="${escape(episode?.title || item.title)}" ${item.backdrop ? `poster="${escape(item.backdrop)}"` : ''}></video><div class="video-error" role="status" hidden><p>${media.local ? 'This file could not play in your browser.' : 'The video could not load.'}</p><div class="watch-actions"><button type="button" class="button secondary" data-action="retry-video">Retry</button>${media.local ? '<button type="button" class="button primary" data-action="local-file">Choose another file</button>' : direct ? `<a class="button primary" href="${escape(sourcePage)}" target="_blank" rel="noopener noreferrer">Open source ${icon('external')}</a>` : '<button type="button" class="button primary" data-action="direct-video">Try direct stream</button>'}</div></div>`;
  const video = player.querySelector('video');
  if (media.captions) {
    const track = document.createElement('track');
    track.kind = 'captions';
    track.label = 'English (auto-generated)';
    track.srclang = 'en';
    track.src = media.captions;
    video.append(track);
  }
  video.addEventListener('loadedmetadata', () => {
    const previous = progress[progressKey];
    if (previous && previous.time > 5 && previous.time < video.duration - 20) video.currentTime = previous.time;
    updateTransport(video, session);
    loadSkipSegments(video, session);
  });
  const startOver = titlePage.querySelector('[data-action="start-over"]');
  if (startOver) startOver.hidden = !resumeFor(item) || !progress[progressKey];
  video.addEventListener('timeupdate', () => {
    updateTransport(video, session);
    remember(video, session);
  });
  video.addEventListener('seeked', () => updateTransport(video, session));
  video.addEventListener('play', () => updateTransport(video, session));
  video.addEventListener('pause', () => {
    updateTransport(video, session);
    remember(video, session, true);
  });
  video.addEventListener('ended', () => {
    if (session.accountId === account?.id) libraryChange('progress', progressKey, null);
  });
  const errorBox = player.querySelector('.video-error');
  video.addEventListener('error', () => { errorBox.hidden = false; });
  video.src = media.local || (direct ? archiveFileUrl(media) : `/stream/${item.key}${episode ? `/${episode.key}` : ''}`);
  video.play().catch(() => { /* The native play control remains available when autoplay is blocked. */ });
}

function episodeFromControl(control) {
  return { season: Number(control.dataset.season), number: Number(control.dataset.number), title: control.dataset.episodeTitle };
}

function updateEmbeddedEpisode(session, season, number, internalNavigation) {
  if (session.item.type !== 'tv' || !validEpisode({ season, number }) || (session.episode.season === season && session.episode.number === number)) return;
  const row = titlePage.querySelector(`[data-action="stream-episode"][data-season="${season}"][data-number="${number}"]`);
  const episode = row ? episodeFromControl(row) : { season, number, title: `Episode ${number}` };
  if (!internalNavigation) return watchCineSrc(session.item, episode);
  if (session.embedPlayback.position) remember(session.embedPlayback.position, session, true);
  session.episode = episode;
  session.progressKey = cineSrcKey(session.item, episode);
  session.lastSaved = 0;
  session.segments = [];
  session.segmentRequest = null;
  session.timelineDuration = null;
  session.autoSkipped.clear();
  session.embedPlayback.position = null;
  history.replaceState(null, '', `#${titlePath(session.item)}/s${season}e${number}`);
  titlePage.querySelector('.title-context').innerHTML = episodeContext(episode);
  const select = titlePage.querySelector('.season-select');
  if (select && [...select.options].some(option => Number(option.value) === season)) {
    select.value = String(season);
    if (session.season !== season) loadSeason(session, season);
    else for (const button of titlePage.querySelectorAll('[data-action="stream-episode"]')) button.setAttribute('aria-pressed', String(button === row));
  }
}

function startCineSrc(session) {
  const { item, episode, progressKey } = session;
  const url = new URL(`/embed/${item.type}/${item.id}`, cineSrcOrigin);
  url.searchParams.set('color', '#cbb4ff');
  if (episode) {
    url.searchParams.set('s', episode.season);
    url.searchParams.set('e', episode.number);
    url.searchParams.set('autonext', 'false');
    url.searchParams.set('autoskip', String(state.autoSkip));
  }
  const previous = progress[progressKey];
  if (previous && previous.time > 5 && previous.time < previous.duration - 20) url.searchParams.set('t', String(Math.floor(previous.time)));

  const frame = document.createElement('iframe');
  frame.title = `${item.title}${episode ? `, ${episodeLabel(episode)}` : ''} video player`;
  frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
  frame.allowFullscreen = true;
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
  frame.referrerPolicy = 'strict-origin';

  const notice = titlePage.querySelector('.embed-notice');
  const status = notice.querySelector('[role="status"]');
  const retry = notice.querySelector('button');
  const setStatus = (message = '', canRetry = false) => {
    status.textContent = message;
    retry.hidden = !canRetry;
    notice.hidden = !message;
  };
  setStatus('Loading player…');
  const timer = setTimeout(() => setStatus('The player is taking longer than expected. You can retry below.', true), 20000);
  const controller = new AbortController();
  const playback = {
    position: null,
    paused: true,
    stop() {
      clearTimeout(timer);
      controller.abort();
      frame.remove();
    },
  };
  session.embedPlayback = playback;

  window.addEventListener('message', event => {
    if (active !== session || event.origin !== cineSrcOrigin || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || typeof data.type !== 'string') return;
    switch (data.type) {
      case 'cinesrc:ready':
        clearTimeout(timer);
        setStatus();
        break;
      case 'cinesrc:play':
        playback.paused = false;
        if (playback.position) {
          playback.position.paused = false;
          updateTransport(playback.position, session);
        }
        clearTimeout(timer);
        setStatus();
        break;
      case 'cinesrc:loadedmetadata':
        if (Number.isFinite(data.duration) && data.duration > 0) {
          playback.position = { currentTime: 0, duration: data.duration, paused: playback.paused };
          updateTransport(playback.position, session);
          loadSkipSegments(playback.position, session);
        }
        break;
      case 'cinesrc:timeupdate':
      case 'cinesrc:seeked':
        if (!Number.isFinite(data.currentTime) || !Number.isFinite(data.duration) || data.duration <= 0 || data.currentTime < 0 || data.currentTime > data.duration) break;
        clearTimeout(timer);
        setStatus();
        if (data.type === 'cinesrc:timeupdate' && playback.position && data.currentTime > playback.position.currentTime + .05) playback.paused = false;
        playback.position = { currentTime: data.currentTime, duration: data.duration, paused: playback.paused, seeking: data.type === 'cinesrc:seeked' };
        updateTransport(playback.position, session);
        loadSkipSegments(playback.position, session);
        remember(playback.position, session, data.type === 'cinesrc:seeked');
        break;
      case 'cinesrc:pause':
        playback.paused = true;
        if (playback.position) {
          playback.position.paused = true;
          updateTransport(playback.position, session);
          remember(playback.position, session, true);
        }
        break;
      case 'cinesrc:ended':
        playback.position = null;
        if (session.accountId === account?.id) libraryChange('progress', session.progressKey, null);
        break;
      case 'cinesrc:nextepisode':
        updateEmbeddedEpisode(session, data.season, data.episode, data.internalNavigation === true);
        break;
      case 'cinesrc:error':
        clearTimeout(timer);
        setStatus('CineSrc could not play this source. Try another server in the player or retry.', true);
        break;
    }
  }, { signal: controller.signal });
  frame.src = url.href;
  titlePage.querySelector('.video-box').replaceChildren(frame);
}

function savePlayback() {
  if (!active) return;
  const video = titlePage.querySelector('video');
  if (video && !video.ended) remember(video, active, true);
  const position = active.embedPlayback?.position;
  if (position) remember(position, active, true);
}

function stopVideo() {
  savePlayback();
  active?.embedPlayback?.stop();
  const video = titlePage.querySelector('video');
  if (!video) return;
  video.pause();
  video.removeAttribute('src');
  video.load();
}

async function openTitle(item, watch = false, episodeKey, selection = null) {
  const opening = ++openingId;
  if (item.archiveId && !selection && !item.media) {
    showToast('Checking the Archive video…');
    try {
      item = await api(`/api/archive/${encodeURIComponent(item.archiveId)}`);
      if (opening !== openingId) return;
      titles.set(item.key, item);
    } catch (error) {
      if (opening === openingId) showToast(error.message);
      return;
    }
    toast.hidden = true;
  }
  stopVideo();
  const resumed = resumeFor(item);
  const episode = selection?.episode || (watch ? item.episodes?.find(entry => entry.key === (episodeKey || resumed?.[0].split('/')[1])) || item.episodes?.[0] : null);
  const media = selection || (watch ? episode?.media || item.media : null);
  const source = media || item.media || item.episodes?.[0]?.media;
  const session = {
    item, episode, media, accountId: account?.id, autoSkipped: new Set(), segments: media?.segments || [],
    progressKey: selection?.progressKey ?? (episode ? `${item.key}/${episode.key}` : item.key),
    details: detailsCache.get(item.key),
  };
  active = session;
  const sourcePage = source?.page || (source?.archive ? `https://archive.org/details/${encodeURIComponent(source.archive)}` : '');
  const watchSource = sourcePage ? `<div class="watch-source"><span>${escape(item.credit)}</span><a href="${escape(sourcePage)}" target="_blank" rel="noopener noreferrer">${escape(source.source || 'Internet Archive')} ${icon('external')}</a><a href="${escape(item.license[1])}" target="_blank" rel="noopener noreferrer">${escape(item.license[0])}</a></div>` : media?.embed ? '<div class="watch-source">CineSrc</div>' : media?.local ? `<p class="local-source">${escape(media.name)}</p>` : '';
  const canPlay = resumed || isArchive(item) || (item.type === 'movie' && hasCineSrcTitle(item));
  const back = `<a class="plain-link title-back" href="${media ? `#${titlePath(item)}` : escape(browseHash)}">${icon('chevron-left')} ${media ? 'Title details' : 'Back to browse'}</a>`;
  const primary = !media && (canPlay
    ? `<button class="button primary" type="button" data-action="${resumed ? 'resume' : 'watch'}" data-key="${escape(item.key)}">${icon('play')} ${resumed ? 'Resume' : 'Watch now'}</button>`
    : item.type === 'tv' ? `<button class="button primary" type="button" data-action="show-episodes">${icon('tv')} View episodes</button>` : '');
  const localOption = !media || media.embed || media.local;
  const externalOption = !isArchive(item) && (!media || media.embed);
  titlePage.classList.toggle('is-playing', Boolean(media));
  titlePage.hidden = false;
  main.hidden = true;
  titlePage.innerHTML = `${media ? `<div class="watch-heading">${back}<div><h1 id="title-heading" tabindex="-1">${escape(item.title)}</h1>${episode ? `<span class="title-context">${episodeContext(episode)}</span>` : ''}</div></div><div class="watch-stage"><div class="video-box"></div>${playbackBar(session)}</div>` :
    `<section class="title-hero">${item.backdrop || item.poster ? `<img src="${escape(item.backdrop || item.poster)}" alt="">` : ''}<div class="title-hero-content">${back}<h1 id="title-heading" tabindex="-1">${escape(item.title)}</h1><div class="meta title-facts">${titleFacts(session)}</div><div class="watch-actions title-actions">${primary}${saveButton(item)}</div></div></section>`}
    <div class="watch-body">
      ${media?.embed ? '<div class="inline-notice embed-notice" hidden><span role="status"></span><button type="button" class="plain-link" data-action="retry-video" hidden>Retry</button></div>' : ''}
      ${media ? `<div class="watch-actions player-actions">${saveButton(item)}<button class="button secondary" data-action="start-over">Start over</button>${item.type === 'tv' ? '<button class="button secondary" type="button" data-action="show-episodes">Episodes</button>' : ''}</div>` : ''}
      <div class="title-overview"><p class="title-about"${item.description ? '' : ' hidden'}>${escape(item.description)}</p>${ratingControl(item)}</div>
      ${item.type === 'tv' && !item.archiveId ? `<section class="title-episodes episode-list" tabindex="-1" aria-label="Episodes">${episodesMarkup(session)}</section>` : ''}
      ${!media ? '<section class="cast-section" hidden></section>' : ''}
      ${media ? skipSettings(session) : ''}
      ${localOption || externalOption ? `<details class="playback-options"><summary>Other ways to watch</summary><div class="playback-options-body">${localOption ? `<button class="plain-link" type="button" data-action="local-file">${icon('folder')} ${media?.local ? 'Change video file' : 'Play local file'}</button>` : ''}${externalOption ? streamingLink(session) : ''}</div></details>` : ''}
      ${watchSource}
    </div>`;
  renderNavigation();
  window.scrollTo(0, 0);
  titlePage.querySelector('#title-heading').focus({ preventScroll: true });
  if (media?.embed) startCineSrc(session);
  else if (media) startVideo(session);
  loadTitle(session);
  if (!media) findArchiveEdition(session);
}

function titleFacts(session) {
  const { item, details } = session;
  const released = details?.release_date || details?.first_air_date || item.date;
  const date = released && /^\d{4}-\d{2}-\d{2}$/.test(released) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(released)) : item.year;
  const duration = details?.runtime || item.duration;
  const genres = details?.genres?.slice(0, 3).map(genre => genre.name).join(' · ') || meta(item)[1];
  return `${[date, duration ? `${duration} min` : item.type === 'tv' ? 'TV series' : 'Movie', genres].filter(Boolean).map(value => `<span>${escape(value)}</span>`).join('')}${ratingBadge(item)}`;
}

function showToast(message) {
  const dialog = document.querySelector('dialog[open]');
  (dialog || document.body).append(toast);
  toast.classList.toggle('dialog-toast', Boolean(dialog));
  toast.querySelector('[role="status"]').textContent = message;
  const button = toast.querySelector('[data-action="undo"]');
  button.hidden = !undoToast;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
    undoToast = null;
  }, undoToast ? 6500 : 3000);
}

function toggleSaved(item) {
  const previous = saved[item.key] ?? null;
  libraryChange('saved', item.key, previous ? null : libraryTitle(item));
  undoToast = { key: item.key, previous, accountId: account?.id };
  showToast(previous ? 'Removed from Watchlist' : 'Added to Watchlist');
  renderLibraryControls();
}

function accountMarkup() {
  if (account) return `<div class="profile-summary"><span class="profile-avatar">${escape(account.username[0].toUpperCase())}</span><div><h3>${escape(account.username)}</h3><p>Your local watchlist, ratings, and playback history.</p></div></div><div class="dialog-actions"><button type="button" class="button secondary" data-action="signout">Sign out</button></div><p class="form-status" role="status"></p>`;
  const create = accountMode === 'create';
  return `<form id="account-form"><h3>${create ? 'Create a local account' : 'Sign in to Afterframe'}</h3>
    <label for="account-name">Username</label><input id="account-name" name="username" type="text" autocomplete="username" minlength="3" maxlength="30" pattern="[A-Za-z0-9][A-Za-z0-9_\\-]{2,29}" required>
    ${create ? '<p class="field-help">Use 3–30 letters, numbers, underscores or hyphens.</p>' : ''}
    <label for="account-password">Password</label><input id="account-password" name="password" type="password" autocomplete="${create ? 'new-password' : 'current-password'}" minlength="8" maxlength="128" required>
    ${create ? '<p class="field-help">At least 8 characters.</p>' : ''}
    <p class="form-status" role="status"></p>
    <div class="dialog-actions"><button class="button primary" type="submit">${create ? 'Create account' : 'Sign in'}</button><button class="plain-link" type="button" data-action="account-mode">${create ? 'Already have an account?' : 'Create account'}</button></div>
  </form>`;
}

function setAccount(user, library) {
  account = user;
  accountReady = true;
  useLibrary(library);
  accountButton.innerHTML = `${user ? `<span class="account-initial" aria-hidden="true">${escape(user.username[0].toUpperCase())}</span>` : icon('user')}<span class="account-name">${user ? escape(user.username) : 'Sign in'}</span>`;
  accountButton.setAttribute('aria-label', user ? `Account for ${user.username}` : 'Sign in');
  if (accountDialog.open) accountBody.innerHTML = accountMarkup();
  renderLibraryControls();
}

function openAccount() {
  if (!accountReady) return;
  accountMode = 'signin';
  accountBody.innerHTML = accountMarkup();
  accountDialog.showModal();
  accountBody.querySelector('input')?.focus();
}

async function signOut(button) {
  button.disabled = true;
  try {
    await libraryQueue;
    await post('/api/account/signout');
    setAccount(null);
    accountDialog.close();
    showToast('Signed out');
  } catch (error) {
    accountBody.querySelector('.form-status').textContent = error.message;
    button.disabled = false;
  }
}

function applyFacets(facets) {
  state.facets = { ...defaults, ...facets };
  rememberBrowseFilters();
  refreshCatalog();
}

function rememberBrowseFilters() {
  const params = new URLSearchParams();
  if (state.filter !== 'all') params.set('type', state.filter);
  if (state.facets.category) params.set('genre', state.facets.category);
  if (state.facets.decade) params.set('decade', state.facets.decade);
  if (state.facets.sort !== 'popular') params.set('sort', state.facets.sort);
  if (state.collection) params.set('collection', state.collection);
  const base = state.page === 'search' ? `search=${encodeURIComponent(state.query)}` : state.page;
  browseHash = `#${base}${params.size ? `?${params}` : ''}`;
  history.replaceState(null, '', browseHash);
}

function saveSkips(form) {
  const values = new FormData(form);
  const status = form.querySelector('.form-status');
  const video = playbackPosition(active);
  const segments = [];
  for (const [kind, name] of Object.entries(segmentNames)) {
    const startText = values.get(`${kind}-start`).trim();
    const endText = values.get(`${kind}-end`).trim();
    if (!startText && !endText) continue;
    const start = parseTime(startText);
    const end = parseTime(endText);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end > 86400 || (Number.isFinite(video?.duration) && end > video.duration)) {
      status.textContent = `${name} needs a valid start and a later end within the video.`;
      return;
    }
    segments.push({ kind, start, end });
  }
  segments.sort((a, b) => a.start - b.start);
  if (segments.some((segment, index) => index > 0 && segment.start < segments[index - 1].end)) {
    status.textContent = 'Skip sections must not overlap.';
    return;
  }
  libraryChange('skips', active.progressKey, segments);
  active.autoSkipped.clear();
  renderPlayerSegments(video, active);
  updateTransport(video, active);
  status.textContent = 'Skip times saved.';
}

function updateRegion() {
  region.value = state.region;
  if (active) updateStreamingLink(active);
  if (state.page === 'search' && !state.connected) render();
}

function openSettings() {
  connectionStatus.textContent = state.connected ? 'Connected' : 'Not connected';
  connectionStatus.dataset.connected = state.connected;
  document.querySelector('#connection-details').open = !state.connected;
  settingsDialog.showModal();
}

document.addEventListener('click', event => {
  const control = event.target.closest('[data-action]');
  if (!control) return;
  const { action, key, index, value } = control.dataset;
  const item = titles.get(key);
  if (action === 'settings') openSettings();
  if (action === 'clear-search') {
    search.value = '';
    searchClear.hidden = true;
    search.focus();
    submitSearch();
  }
  if (action === 'suggestion' && item) {
    clearTimeout(searchTimer);
    suggestionsDismissed = true;
    hideSuggestions();
    navigateTitle(item);
  }
  if (action === 'search-command') {
    suggestionsDismissed = true;
    hideSuggestions();
    if (value === 'settings') openSettings();
    else {
      search.blur();
      location.hash = value;
    }
  }
  if (action === 'undo' && undoToast) {
    const { key, previous, accountId } = undoToast;
    undoToast = null;
    if (accountId === account?.id) {
      libraryChange('saved', key, previous);
      renderLibraryControls();
      showToast('Watchlist change undone');
    } else {
      toast.hidden = true;
    }
  }
  if (action === 'account') openAccount();
  if (action === 'account-mode') {
    accountMode = accountMode === 'signin' ? 'create' : 'signin';
    accountBody.innerHTML = accountMarkup();
    accountBody.querySelector('input').focus();
  }
  if (action === 'signout') signOut(control);
  if (action === 'credits') {
    if (settingsDialog.open) settingsDialog.close();
    creditsDialog.showModal();
  }
  if (action === 'close') control.closest('dialog')?.close();
  if (action === 'details' && item) {
    if (control.matches('a') && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) return;
    event.preventDefault();
    navigateTitle(item);
  }
  if (action === 'show-episodes') {
    const episodes = titlePage.querySelector('.title-episodes');
    episodes?.focus({ preventScroll: true });
    episodes?.scrollIntoView({ block: 'start' });
  }
  if (['watch', 'resume'].includes(action) && item) {
    const recent = action === 'resume' ? resumeFor(item) : null;
    const local = filesByTitle.get(recent?.[0]);
    if (recent?.[0] === cineSrcKey(item, recent?.[1].episode) || (!local && !isArchive(item) && item.type === 'movie')) {
      watchCineSrc(item, recent?.[1].episode);
    } else if (local) {
      const current = location.hash;
      if (!main.hidden) browseHash = current || '#home';
      history.pushState(null, '', `#${titlePath(item)}`);
      openTitle(item, true, undefined, local);
    }
    else if (isArchive(item)) navigateTitle(item, `/watch${recent?.[0].includes('/') ? `/${recent[0].split('/')[1]}` : ''}`);
    else navigateTitle(item);
  }
  if (action === 'episode' && active) navigateTitle(active.item, `/watch/${key}`);
  if (action === 'stream-episode' && active) watchCineSrc(active.item, episodeFromControl(control));
  if (action === 'save' && item) toggleSaved(item);
  if (action === 'clear-rating' && active) {
    libraryChange('ratings', active.item.key, null);
    renderLibraryControls();
  }
  if (['local-file', 'episode-file'].includes(action) && active) {
    active.localEpisode = action === 'episode-file' ? episodeFromControl(control) : active.episode;
    localVideo.click();
  }
  if (action === 'facet') {
    const { name } = control.dataset;
    state.collection = '';
    applyFacets({ ...state.facets, [name]: value });
    const options = main.querySelectorAll(`[data-action="facet"][data-name="${CSS.escape(name)}"]`);
    ([...options].find(button => button.dataset.value === value && button.closest('.genre-chips')) || options[0]?.closest('details')?.querySelector('summary'))?.focus({ preventScroll: true });
  }
  if (action === 'filter') {
    state.filter = value;
    if (value === 'free' && state.facets.sort === 'top') state.facets.sort = 'popular';
    rememberBrowseFilters();
    refreshCatalog();
    main.querySelector(`[data-value="${CSS.escape(value)}"]`)?.focus({ preventScroll: true });
  }
  if (action === 'feature') {
    state.hero = Number(index);
    main.querySelector('.hero').outerHTML = renderHero();
    main.querySelector(`[data-index="${index}"]`).focus({ preventScroll: true });
  }
  if (action === 'rail' && control.getAttribute('aria-disabled') !== 'true') {
    const rail = control.closest('.shelf').querySelector('.poster-rail');
    rail.scrollBy({ left: Number(value) * rail.clientWidth * .8, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  if (action === 'refresh') refreshCatalog();
  if (action === 'fullscreen') toggleFullscreen();
  if (action === 'retry-archive' && !state.archiveLoading) loadArchive(requestId, state.archiveNext || 1);
  if (action === 'more-archive' && !state.archiveLoading && state.archiveNext) loadArchive(requestId, state.archiveNext);
  if (action === 'more-tmdb' && !state.loading && state.remoteNext) loadTMDB(requestId, state.remoteNext);
  if (['retry-video', 'direct-video'].includes(action) && active?.media) {
    stopVideo();
    if (active.media.embed) startCineSrc(active);
    else startVideo(active, action === 'direct-video');
  }
  if (action === 'start-over' && active?.media) {
    libraryChange('progress', active.progressKey, null);
    active.autoSkipped.clear();
    playerCommand('seek', 0);
  }
  if (action === 'toggle-play' && active?.media) {
    const position = playbackPosition(active);
    if (position) playerCommand(position.paused ? 'play' : 'pause');
  }
  if (['skip-segment', 'seek-relative', 'seek-marker'].includes(action) && active?.media) {
    const position = playbackPosition(active);
    if (Number.isFinite(position?.duration)) {
      const target = action === 'skip-segment' ? Number(control.dataset.end) : action === 'seek-relative' ? position.currentTime + Number(value) : Number(value);
      playerCommand('seek', Math.max(0, Math.min(position.duration, target)));
    }
  }
  if (action === 'next-episode' && active?.nextEpisode) watchCineSrc(active.item, active.nextEpisode);
  if (action === 'reset-skips' && active?.media) {
    libraryChange('skips', active.progressKey, null);
    control.closest('details').outerHTML = skipSettings(active);
    titlePage.querySelector('.skip-settings').open = true;
    titlePage.querySelector('.skip-settings summary').focus();
    const position = playbackPosition(active);
    renderPlayerSegments(position, active);
    updateTransport(position, active);
  }
});

for (const dialog of [settingsDialog, creditsDialog, accountDialog]) {
  dialog.addEventListener('close', () => {
    if (toast.parentElement === dialog) {
      toast.classList.remove('dialog-toast');
      document.body.append(toast);
    }
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
}
titlePage.addEventListener('change', event => {
  if (event.target.matches('.playback-scrubber')) playerCommand('seek', Number(event.target.value));
  if (event.target.matches('.season-select') && active) loadSeason(active, event.target.value);
  if (event.target.matches('[name="personal-rating"]') && active) {
    libraryChange('ratings', active.item.key, { score: Number(event.target.value), item: libraryTitle(active.item) });
    renderLibraryControls();
  }
});
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || !active?.media || document.querySelector('dialog[open]') || event.altKey || event.ctrlKey || event.metaKey || event.target.closest('button, a, input, select, summary, video, iframe, [contenteditable]')) return;
  const key = event.key.toLowerCase();
  const actions = { ' ': 'toggle-play', f: 'fullscreen', s: 'skip-segment', arrowleft: 'seek-relative', arrowright: 'seek-relative' };
  const action = actions[key];
  if (!action) return;
  const selector = key.startsWith('arrow') ? `[data-action="${action}"][data-value="${key === 'arrowleft' ? -10 : 10}"]` : `[data-action="${action}"]`;
  const control = titlePage.querySelector(`${selector}:not([hidden]):not(:disabled)`);
  if (control) {
    event.preventDefault();
    control.click();
  }
});
titlePage.addEventListener('submit', event => {
  if (!event.target.matches('.skip-form') || !active?.media) return;
  event.preventDefault();
  saveSkips(event.target);
});
document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  const target = main.hidden ? titlePage.querySelector('#title-heading') : main;
  target?.focus();
  target?.scrollIntoView();
});
localVideo.addEventListener('change', () => {
  const file = localVideo.files?.[0];
  if (!file || !active) return;
  const { item, localEpisode: episode } = active;
  const suffix = Number.isInteger(episode?.season) && Number.isInteger(episode?.number) ? `-s${episode.season}e${episode.number}` : '';
  const progressKey = `${item.key}/local${suffix}`;
  const previous = filesByTitle.get(progressKey);
  const local = { local: URL.createObjectURL(file), name: file.name, episode, progressKey };
  filesByTitle.set(progressKey, local);
  localVideo.value = '';
  openTitle(item, false, undefined, local).finally(() => { if (previous) URL.revokeObjectURL(previous.local); });
});
accountDialog.addEventListener('submit', async event => {
  if (event.target.id !== 'account-form') return;
  event.preventDefault();
  const button = event.target.querySelector('button[type="submit"]');
  const status = event.target.querySelector('.form-status');
  button.disabled = true;
  status.textContent = '';
  try {
    const { account: user, library } = await post(`/api/account/${accountMode}`, Object.fromEntries(new FormData(event.target)));
    setAccount(user, library);
    accountDialog.close();
    showToast(`Signed in as ${user.username}`);
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
});
const autoSkip = document.querySelector('#auto-skip');
autoSkip.checked = state.autoSkip;
autoSkip.addEventListener('change', () => {
  state.autoSkip = autoSkip.checked;
  write('autoSkip', state.autoSkip);
});
connectionForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = connectionForm.querySelector('button[type="submit"]');
  const input = connectionForm.querySelector('#token');
  button.disabled = true;
  connectionStatus.dataset.connected = 'false';
  connectionStatus.textContent = 'Connecting…';
  try {
    await api('/api/connection', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: input.value.trim() }),
    });
    input.value = '';
    state.connected = true;
    connectionStatus.dataset.connected = 'true';
    connectionStatus.textContent = 'TMDB is connected.';
    refreshCatalog();
  } catch (error) {
    connectionStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
document.querySelector('#search-form').addEventListener('submit', event => {
  event.preventDefault();
  const option = !suggestions.hidden && suggestions.children[suggestionIndex];
  if (option) option.click();
  else {
    suggestionsDismissed = true;
    hideSuggestions();
    submitSearch();
  }
});
search.addEventListener('input', () => {
  suggestionsDismissed = false;
  suggestionIndex = -1;
  searchClear.hidden = !search.value;
  renderSuggestions();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(submitSearch, 285);
});
search.addEventListener('focus', () => {
  suggestionsDismissed = false;
  renderSuggestions();
});
search.addEventListener('blur', hideSuggestions);
suggestions.addEventListener('mousedown', event => event.preventDefault());
search.addEventListener('keydown', event => {
  if (suggestions.hidden) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    suggestionsDismissed = true;
    hideSuggestions();
  } else if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault();
    const length = suggestions.children.length;
    const next = suggestionIndex < 0 && event.key === 'ArrowUp' ? length - 1 : suggestionIndex + (event.key === 'ArrowDown' ? 1 : -1);
    selectSuggestion((next + length) % length);
  }
});
document.addEventListener('keydown', event => {
  const slash = event.key === '/' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.target.matches('input, textarea, select, [contenteditable]');
  const command = event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey) && !event.altKey;
  if ((slash || command) && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    showSearchCommands = command;
    suggestionsDismissed = false;
    search.focus();
    if (command) search.select();
    renderSuggestions();
  }
});
region.innerHTML = countries.sort((a, b) => regionNames.of(a).localeCompare(regionNames.of(b))).map(country => `<option value="${country}">${escape(regionNames.of(country))}</option>`).join('');
region.addEventListener('change', () => {
  state.region = region.value;
  write('region', state.region);
  updateRegion();
});
updateRegion();
window.addEventListener('hashchange', route);
window.addEventListener('pagehide', savePlayback);
route();
api('/api/status').then(({ connected }) => {
  state.connected = connected;
  if (connected) refreshCatalog();
}).catch(() => { /* The local archive catalog works while the connection is unavailable. */ });
accountButton.disabled = true;
api('/api/account').then(({ account: user, library }) => {
  setAccount(user, library);
}).catch(() => {
  accountReady = true;
}).finally(() => { accountButton.disabled = false; });
