import { archiveCatalog, archiveFileUrl } from './catalog.js';
import { categories, browseGenres, sortOptions, matchesCatalog, runtimeRanges, catalogFilters } from './discover.js';
import { preferenceDefaults, viewingSession, mergeRanges, samplePlayback, completionReached } from './playback.js';

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
  pause: '<path d="M9 5v14m6-14v14" stroke-width="3"/>',
  replay: '<path d="M3 11a9 9 0 1 1 3.4 7M3 5v6h6"/>',
  back10: '<path d="M3 10a9 9 0 1 1 4 9M3 4v6h6"/><path d="m8 12 2-1v5m4-5c-2 0-2 5 0 5s2-5 0-5"/>',
  forward10: '<path d="M21 10a9 9 0 1 0-4 9m4-15v6h-6"/><path d="m8 12 2-1v5m4-5c-2 0-2 5 0 5s2-5 0-5"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9zm12 0a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10"/>',
  muted: '<path d="M4 9v6h4l5 4V5L8 9zm12 1 4 4m0-4-4 4"/>',
  captions: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 10H7v4h3m7-4h-3v4h3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  external: '<path d="M13 4h7v7m0-7-9 9m8 0v7H4V5h7"/>',
  user: '<circle cx="12" cy="8" r="3.2"/><path d="M5 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2"/>',
  star: '<path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2-5.7-3-5.7 3 1.1-6.2-4.5-4.4 6.3-.9z"/>',
  folder: '<path d="M3 6h7l2 2h9v12H3z"/>',
  fullscreen: '<path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"/>',
  'exit-fullscreen': '<path d="M4 8h4V4m12 4h-4V4M8 20v-4H4m12 4v-4h4"/>',
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
let watched;
let preferences;
let account = null;
let accountMode = 'signin';
let accountReady = false;
let libraryQueue = Promise.resolve();
const catalogCache = new Map();
const detailsCache = new Map();
const seasonCache = new Map();
const imdbScores = new Map();
const checkedRatings = new Set();
const ratingBatches = new WeakSet();
const cardFacts = new Map();
const defaults = { category: '', decade: '', sort: 'popular', from: '', to: '', imdb: '', runtime: '' };
const libraryPages = ['watchlist', 'watched', 'ratings'];
const cineSrcOrigin = 'https://cinesrc.st';

function libraryTitle(item) {
  const { key, id, archiveId, title, year, date, type, poster, backdrop, genre, genreIds, categories } = item;
  return { key, id, archiveId, title, year, date, type, poster, backdrop, genre, genreIds, categories };
}

function useLibrary(library = null) {
  saved = Object.assign(Object.create(null), library?.saved || read('saved', {}));
  progress = Object.assign(Object.create(null), library?.progress || read('progress', {}));
  ratings = Object.assign(Object.create(null), library?.ratings || read('ratings', {}));
  watched = Object.assign(Object.create(null), library ? library.watched : read('watched', {}));
  preferences = Object.assign(Object.create(null), library ? library.preferences : read('preferences', {}));
  for (const item of [...Object.values(saved), ...Object.values(progress).map(entry => entry.item), ...Object.values(ratings).map(entry => entry.item), ...Object.values(watched).map(entry => entry.item)]) {
    if (item?.key && !titles.has(item.key)) titles.set(item.key, item);
  }
}
useLibrary();
const defaultRegion = navigator.language.match(/-([A-Z]{2})\b/)?.[1];
const savedRegion = read('region', defaultRegion);
const state = {
  page: 'home', query: '', filter: 'all', connected: false,
  region: countries.includes(savedRegion) ? savedRegion : 'LT', remote: [], loading: false, error: '',
  archive: [], archiveLoading: false, archiveError: '', archiveNext: null, remoteNext: null,
  collections: {}, total: null, filtersOpen: false, librarySort: 'recent',
  facets: { ...defaults },
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
let filterTimer;
let suggestionIndex = -1;
let suggestionsDismissed = false;
let showSearchCommands = false;
let suggestionRequest;
let suggestionResults = [];

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function post(path, data = {}, keepalive = false) {
  return api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data), keepalive });
}

function pref(name) {
  return preferences[name] ?? preferenceDefaults[name];
}

let volumeTimer;
function rememberVolume(volume, muted) {
  if (!pref('volume') || !Number.isFinite(volume) || volume < 0 || volume > 1 || typeof muted !== 'boolean') return;
  const profile = account?.id;
  clearTimeout(volumeTimer);
  volumeTimer = setTimeout(() => {
    if (account?.id !== profile || !pref('volume')) return;
    if (preferences.level !== volume) libraryChange('preferences', 'level', volume);
    if (preferences.muted !== muted) libraryChange('preferences', 'muted', muted);
  }, 350);
}

function syncPreferences() {
  document.documentElement.classList.toggle('reduce-motion', pref('reducedMotion'));
  document.documentElement.classList.toggle('compact-episodes', pref('compact'));
  for (const input of settingsDialog.querySelectorAll('[data-preference]')) input.checked = pref(input.dataset.preference);
  settingsDialog.querySelector('#preferred-quality').value = preferences.quality || '';
  if (active?.seasonData) renderEpisodeRows(active);
}

function libraryChange(kind, key, value) {
  const records = { saved, progress, ratings, watched, preferences }[kind];
  const previous = records[key];
  if (value === null) delete records[key];
  else records[key] = value;
  if (!account) {
    write(kind, records);
    return;
  }
  const accountId = account.id;
  const pendingKey = `pendingPlayback.${accountId}`;
  const recordKey = `${kind}/${key}`;
  const queued = kind === 'progress' || kind === 'watched' ? { value, at: Date.now() } : null;
  if (queued) write(pendingKey, { ...read(pendingKey, {}), [recordKey]: queued });
  libraryQueue = libraryQueue.then(async () => {
    if (account?.id !== accountId) return;
    try {
      await post('/api/account/library', { accountId, kind, key, value }, true);
      if (queued) {
        const pending = read(pendingKey, {});
        if (pending[recordKey]?.at === queued.at && JSON.stringify(pending[recordKey].value) === JSON.stringify(value)) {
          delete pending[recordKey];
          write(pendingKey, pending);
        }
      }
    } catch {
      if (queued) return;
      if (account?.id === accountId && (records[key] === value || (value === null && !Object.hasOwn(records, key)))) {
        if (previous === undefined) delete records[key];
        else records[key] = previous;
        if (kind === 'saved' && undoToast?.key === key) undoToast = null;
        renderLibraryControls();
        if (kind === 'preferences') syncPreferences();
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
  if (item.catalog_facts) {
    const itemKey = archiveItem?.key || key;
    cardFacts.set(itemKey, item.catalog_facts);
    imdbScores.set(itemKey, item.catalog_facts.rating);
    checkedRatings.add(itemKey);
  }
  if (archiveItem) return archiveItem;
  const title = {
    key, id: item.id, type: item.media_type, title: item.title || item.name,
    year: (item.release_date || item.first_air_date || '').slice(0, 4), date: item.release_date || item.first_air_date,
    description: item.overview, poster: imagePath(item.poster_path), backdrop: imagePath(item.backdrop_path, 'w1280'), genreIds: item.genre_ids || item.genres?.map(genre => genre.id),
    originalLanguage: item.original_language, votes: item.vote_count,
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
  if (!(imdb?.score > 0)) return '';
  return `<span class="catalog-score" title="IMDb · ${imdb.votes.toLocaleString()} votes"><span class="score-star" aria-hidden="true">★</span> ${imdb.score.toFixed(1)} <small>IMDb</small></span>`;
}

function imdbVotes(item) {
  const rating = imdbScores.get(item.imdb) || imdbScores.get(item.key);
  return rating?.votes ? `<span class="title-votes">${rating.votes.toLocaleString()} votes</span>` : '';
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
      if (value.time <= 5 || value.time >= value.duration - 2) return false;
      if (watched[item.type === 'movie' ? item.key : key]) return false;
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
  const episode = entry?.episode || (entry && item.episodes?.find(candidate => progress[`${item.key}/${candidate.key}`] === entry));
  const context = entry ? [episodeLabel(episode), left].filter(Boolean) : meta(item).slice(0, 2);
  if (!entry && item.type === 'tv' && state.page === 'tv' && item.date) context[0] = formatReleaseDate(item.date) || item.year;
  const url = `#${titlePath(item)}`;
  const tag = entry ? 'button' : 'a';
  return `<article class="poster-tile"><${tag} ${entry ? `type="button" aria-label="Resume ${escape(item.title)}${episode ? `, ${escape(episode.title)}` : ''}"` : `href="${url}"`} class="poster-card${entry ? ' resume-card' : ''}" data-action="${entry ? 'resume' : 'details'}" data-key="${escape(item.key)}" title="${escape(item.title)}">
    <span class="poster-art">${thumbnail(item, Boolean(entry))}<span class="card-play" aria-hidden="true">${icon('play')}</span>${entry ? `<span class="progress-line" role="progressbar" aria-label="Watch progress" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><i style="width:${percent}%"></i></span>` : ''}</span>
    <span class="poster-title">${escape(item.title)}</span><span class="poster-meta">${context.map(escape).join(' · ')}</span>
    <span class="card-facts">${cardDetails(item)}</span><span class="card-ratings"><span class="imdb-rating" data-rating-for="${escape(item.key)}">${ratingBadge(item)}</span>${score ? `<span class="personal-badge" aria-label="Your rating ${score} out of 5">You ${score}/5</span>` : ''}</span>
  </${tag}>${entry ? '' : saveButton(item, true)}</article>`;
}

function cardDetails(item) {
  const facts = cardFacts.get(item.key);
  if (item.type !== 'tv' || !facts) return '';
  return [facts.seasons ? `${facts.seasons} ${facts.seasons === 1 ? 'season' : 'seasons'}` : '', seriesStatus(facts.status)].filter(Boolean).map(escape).join(' · ');
}

function seriesStatus(status) {
  return ({ 'Returning Series': 'Ongoing', Ended: 'Ended', Canceled: 'Canceled', 'In Production': 'In production', Planned: 'Planned', Pilot: 'Pilot' })[status] || '';
}

function uncheckedRatings(root) {
  const items = new Map();
  for (const slot of root.querySelectorAll('[data-rating-for]')) {
    const item = titles.get(slot.dataset.ratingFor);
    if (item && hasCineSrcTitle(item) && !checkedRatings.has(item.key)) items.set(item.key, item);
    if (items.size >= 20) break;
  }
  return items;
}

async function syncCardRatings(root = main) {
  if (!state.connected || ratingBatches.has(root)) return;
  ratingBatches.add(root);
  try {
    while (root.isConnected && (root !== main || !main.hidden)) {
      const items = uncheckedRatings(root);
      if (!items.size) break;
      for (const key of items.keys()) checkedRatings.add(key);
      const keys = [...items.values()].map(item => `${item.type}:${item.id}`).join(',');
      try {
        const { facts } = await api(`/api/catalog/facts?titles=${encodeURIComponent(keys)}`);
        for (const item of items.values()) {
          const entry = facts[`${item.type}-${item.id}`];
          if (entry?.rating) imdbScores.set(item.key, entry.rating);
          if (entry) cardFacts.set(item.key, entry);
        }
        for (const slot of document.querySelectorAll('[data-rating-for]')) {
          const item = items.get(slot.dataset.ratingFor);
          if (!item) continue;
          slot.innerHTML = ratingBadge(item);
          const factsLine = slot.closest('.poster-card')?.querySelector('.card-facts');
          if (factsLine) factsLine.innerHTML = cardDetails(item);
        }
      } catch {
        for (const key of items.keys()) checkedRatings.delete(key);
        break;
      }
    }
  } finally {
    ratingBatches.delete(root);
  }
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
    if (button.matches('.card-save') && item) {
      button.setAttribute('aria-label', `${isSaved ? 'Remove from' : 'Add to'} Watchlist: ${item.title}`);
      button.innerHTML = icon(isSaved ? 'check' : 'plus');
    }
    else button.innerHTML = `${icon(isSaved ? 'check' : 'plus')} ${isSaved ? 'In Watchlist' : 'Watchlist'}`;
  }
  for (const button of titlePage.querySelectorAll('[data-action="mark-watched"]')) {
    const marked = Object.hasOwn(watched, button.dataset.watchedKey);
    button.setAttribute('aria-pressed', marked);
    if (button.classList.contains('episode-status')) {
      button.innerHTML = marked ? icon('check') : '<span aria-hidden="true">○</span>';
      button.setAttribute('aria-label', marked ? 'Mark episode unwatched' : 'Mark episode watched');
      button.title = marked ? 'Mark episode unwatched' : 'Mark episode watched';
    } else button.innerHTML = marked ? `${icon('check')} Watched` : 'Mark watched';
  }
  if (!active && libraryPages.includes(state.page)) render();
  if (active) updateSeriesTracking(active);
}

function featuredFilm() {
  const live = state.remote.filter(item => item.type === 'movie' && item.backdrop && hasReleased(item));
  const recent = (state.collections.newMovies || []).filter(item => item.backdrop && item.votes >= 15);
  return live[0] || recent[0];
}

function hasReleased(item) {
  return Boolean(item.date && item.date <= new Date().toISOString().slice(0, 10));
}

function renderHero() {
  const item = featuredFilm();
  if (!item) return state.loading ? '<div class="hero home-loading" aria-label="Loading featured titles"></div>' : '';
  const resumed = pref('resume') && resumeFor(item);
  const action = resumed ? 'resume' : item.type === 'movie' || isArchive(item) ? 'watch' : 'details';
  return `<section class="hero" aria-label="Featured title">
    <div class="hero-inner"><div class="hero-copy"><div class="eyebrow">Featured film</div>
      <h1>${escape(item.title)}</h1>
      <div class="meta">${meta(item).map(value => `<span>${escape(value)}</span>`).join('')}<span class="imdb-rating" data-rating-for="${escape(item.key)}">${ratingBadge(item)}</span></div>
      ${item.description ? `<p class="hero-summary">${escape(item.description)}</p>` : ''}
      <div class="hero-actions"><button type="button" class="button primary" data-action="${action}" data-key="${escape(item.key)}">${icon('play')} ${resumed ? 'Resume' : action === 'details' ? 'View episodes' : 'Watch now'}</button>${action === 'details' ? '' : `<button type="button" class="button secondary" data-action="details" data-key="${escape(item.key)}">${icon('info')} Details</button>`}${saveButton(item)}</div>
    </div><a class="hero-art" href="#${titlePath(item)}" aria-label="Details for ${escape(item.title)}"><img class="hero-image" src="${escape(item.backdrop)}" alt="" fetchpriority="high"></a></div>
  </section>`;
}

function editorialGrid(title, items, link, className = '') {
  if (!items.length) return '';
  const action = link ? `<a class="section-link" href="#${link}">View all ${icon('arrow')}</a>` : '';
  return `<section class="editorial-section ${className}" aria-label="${title}"><header class="section-head"><h2>${title}</h2>${action}</header>${grid(items)}</section>`;
}

function releaseIndex(movies, shows) {
  if (!movies.length && !shows.length) return '';
  const column = (title, items, link) => items.length ? `<section><h3>${title}</h3><ol>${items.slice(0, 4).map(item => `<li><a href="#${titlePath(item)}"><span>${escape(item.title)}</span><small>${escape(formatReleaseDate(item.date) || item.year)}</small></a></li>`).join('')}</ol><a class="section-link" href="#${link}">View all ${icon('arrow')}</a></section>` : '';
  return `<section class="editorial-section release-index" aria-label="Recent releases"><header class="section-head"><h2>Recent releases</h2></header><div class="release-columns">${column('Films', movies, 'new')}${column('Series', shows, 'new?type=tv')}</div></section>`;
}

function renderNavigation() {
  const current = active ? active.item.type === 'tv' ? 'tv' : 'movies' : libraryPages.includes(state.page) ? 'watchlist' : state.page;
  navigation.innerHTML = navLinks.map(([page, label, glyph]) => `<a href="#${page}" class="nav-link" ${current === page ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span></a>`).join('');
}

function filters(options) {
  return `<div class="filters" aria-label="Filter titles">${options.map(([value, label]) => `<button type="button" class="filter" data-action="filter" data-value="${escape(value)}" aria-pressed="${value === state.filter}">${escape(label)}</button>`).join('')}</div>`;
}

function catalogToolbar(search = false) {
  const { category, decade, from, to, imdb, runtime } = state.facets;
  const advanced = ['movies', 'tv', 'new'].includes(state.page) && state.connected && state.filter !== 'free';
  const genres = Object.keys(browseGenres).sort((a, b) => a.localeCompare(b));
  const checked = (name, value, label, current) => `<label class="facet-choice"><input type="radio" name="${name}" value="${escape(value)}"${current === value ? ' checked' : ''}>${escape(label)}</label>`;
  const years = Array.from({ length: 15 }, (_, index) => 2020 - index * 10);
  const hasFilters = category || decade || from || to || imdb || runtime;
  return `${search ? `<details class="search-filters"${state.filtersOpen ? ' open' : ''}><summary>Genre and year ${icon('chevron-down')}</summary>` : `<aside class="catalog-sidebar" aria-label="Filters"><details class="catalog-disclosure"${state.filtersOpen ? ' open' : ''}><summary>Filters ${icon('chevron-down')}</summary></details>`}
    <form id="catalog-filters" class="catalog-filters" aria-label="Catalog filters" data-mobile-open="${state.filtersOpen}">
      <fieldset><legend>Genre</legend><div class="genre-options">${checked('category', '', 'All genres', category)}${genres.map(genre => checked('category', genre, genre, category)).join('')}</div></fieldset>
      ${state.page !== 'new' ? `<fieldset><legend>${state.page === 'tv' ? 'First aired' : 'Release year'}</legend><div class="year-range"><input type="number" name="from" aria-label="From year" placeholder="From" min="1870" max="2099" value="${escape(from)}"><span aria-hidden="true">–</span><input type="number" name="to" aria-label="To year" placeholder="To" min="1870" max="2099" value="${escape(to)}"></div><label class="decade-select"><span>Decade</span><select name="decade" aria-label="Decade"><option value="">Any</option>${years.map(year => `<option value="${year}"${decade === String(year) ? ' selected' : ''}>${year}s</option>`).join('')}</select></label></fieldset>` : ''}
      ${advanced ? `<fieldset><legend>Minimum IMDb rating</legend><div class="rating-range"><input type="range" name="imdb" aria-label="Minimum IMDb rating" min="0" max="10" step="0.5" value="${imdb || 0}"><output>${imdb ? `≥ ${Number(imdb).toFixed(1)}` : 'Any'}</output></div></fieldset><fieldset><legend>${state.page === 'tv' || (state.page === 'new' && state.filter === 'tv') ? 'Episode runtime' : 'Runtime'}</legend>${checked('runtime', '', 'Any length', runtime)}${Object.entries(runtimeRanges).map(([key, range]) => checked('runtime', key, range.label, runtime)).join('')}</fieldset>` : ''}
      ${hasFilters ? '<button class="plain-link" type="button" data-action="reset-facets">Clear filters</button>' : ''}
    </form>${search ? '</details>' : '</aside>'}`;
}

function sortControl(libraryPage) {
  const options = libraryPage ? { recent: 'Recently added', title: 'Title A–Z', rating: 'Your rating' } : sortOptions;
  if (!libraryPage && (state.page === 'search' || state.page === 'new')) return '';
  const current = libraryPage ? state.librarySort : state.facets.sort;
  return `<label class="sort-control"><span>Sort by</span><select aria-label="Sort titles" data-sort="${libraryPage ? 'library' : 'catalog'}">${Object.entries(options).filter(([key]) => key !== 'top' || (state.filter !== 'free' && state.page !== 'archive')).map(([key, label]) => `<option value="${key}"${key === current ? ' selected' : ''}>${label}</option>`).join('')}</select></label>`;
}

function appliedFilters() {
  const { category, decade, from, to, imdb, runtime } = state.facets;
  const entries = { category, decade: decade && `${decade}s`, from: from && `From ${from}`, to: to && `Through ${to}`, imdb: imdb && `IMDb ≥ ${imdb}`, runtime: runtimeRanges[runtime]?.label };
  const chips = Object.entries(entries).filter(([, label]) => label);
  return chips.length ? `<div class="applied-filters" aria-label="Applied filters">${chips.map(([name, label]) => `<button type="button" class="filter" data-action="facet" data-name="${name}" data-value="" aria-label="Remove ${escape(label)} filter">${escape(label)} ${icon('close')}</button>`).join('')}</div>` : '';
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
  const focusedSort = target.contains(current) && current.dataset.sort;
  const focusFacet = target.contains(current) && current.form?.id === 'catalog-filters' ? current.name : '';
  const focusSearchFilters = current.matches('.search-filters summary');
  target.innerHTML = markup;
  if (state.page === 'search' && state.filter !== 'free' && state.connected) renderArchiveSection();
  if (focusKey) target.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  if (focusedSort) target.querySelector('[data-sort]')?.focus({ preventScroll: true });
  if (focusFacet) target.querySelector(`#catalog-filters [name="${CSS.escape(focusFacet)}"]${current.type === 'radio' ? ':checked' : ''}`)?.focus({ preventScroll: true });
  if (focusSearchFilters) target.querySelector('.search-filters summary')?.focus({ preventScroll: true });
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
    const trending = state.remote.filter(hasReleased);
    main.innerHTML = renderHero()
      + `<div class="home-shelves">${shelf('Continue watching', pref('resume') ? recentlyWatched : [], '', true)}
        ${state.connected ? remoteNotice() : connectionNotice()}
        ${editorialGrid('Trending this week', trending.filter(item => item.key !== featuredFilm()?.key).slice(0, 6), '')}
        ${releaseIndex(state.collections.newMovies || [], state.collections.newTV || [])}
        <div class="home-collections">${editorialGrid('Top films on TMDb', (state.collections.top || []).slice(0, 3), 'movies?sort=top')}${editorialGrid('Anime', (state.collections.anime || []).slice(0, 3), 'tv?genre=Anime')}</div>
        <section class="editorial-section library-entry"><h2>My Library</h2><nav aria-label="Library"><a class="section-link" href="#watchlist">Watchlist ${icon('arrow')}</a><a class="section-link" href="#watched">Watched ${icon('arrow')}</a><a class="section-link" href="#ratings">My ratings ${icon('arrow')}</a></nav></section>
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
  } else if (state.page === 'watched') {
    heading = 'Watched';
    const completed = Object.values(watched).sort((a, b) => b.updated - a.updated);
    items = [...new Map(completed.map(entry => [entry.item.key, titles.get(entry.item.key) || entry.item])).values()];
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
  const libraryPage = libraryPages.includes(state.page);
  if (libraryPage) {
    heading = 'My Library';
    choices = `<nav class="filters library-tabs" aria-label="Library">${[['watchlist', 'Watchlist'], ['watched', 'Watched'], ['ratings', 'My ratings']].map(([page, label]) => `<a href="#${page}" class="filter"${state.page === page ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
    if (state.filter !== 'all') items = items.filter(item => item.type === state.filter);
    if (state.librarySort === 'title') items.sort((a, b) => a.title.localeCompare(b.title));
    if (state.librarySort === 'rating') items.sort((a, b) => (ratings[b.key]?.score || 0) - (ratings[a.key]?.score || 0));
  }
  if (!libraryPage) items = filterResults(items);
  const loading = state.loading || state.archiveLoading;
  let content = items.length ? grid(items) : loading
    ? `<div class="poster-grid skeleton-grid" aria-hidden="true">${'<div></div>'.repeat(7)}</div>` : '';
  if (!items.length && !state.loading && !state.error && !state.archiveLoading && !state.archiveError && !(state.page === 'search' && state.archive.length)) {
    content = libraryPage
      ? empty(state.filter !== 'all' ? 'No matching titles' : { ratings: 'No ratings yet', watchlist: 'Your watchlist is empty', watched: 'No watched titles yet' }[state.page], { ratings: 'Rate a film or series to add it here.', watchlist: 'Save a film or series to find it here.', watched: 'Finish a film or episode, or mark it watched from its detail page.' }[state.page], '<a class="button primary" href="#movies">Browse movies</a>')
      : empty('No matching titles', state.facets.imdb && state.remoteNext ? 'Load more titles to check the next page for matching IMDb ratings.' : 'Try a different title or filter.');
  }
  const separateArchive = state.page === 'search' && state.filter !== 'free' && state.connected;
  if (['movies', 'tv'].includes(state.page) && (!state.connected || state.filter === 'free')) notice += archiveNotice();
  if (state.page === 'search' && !separateArchive && state.filter !== 'free') {
    const merged = filterResults(mergeTitles(items, state.archive));
    if (merged.length) content = grid(merged);
    notice += archiveNotice();
  }
  const counted = !state.facets.imdb && !libraryPage && state.total !== null ? state.total : items.length;
  const resultCount = `<p class="results-count" role="status">${counted.toLocaleString()} ${counted === 1 ? 'title' : 'titles'}${state.facets.imdb ? ' matched so far' : ''}</p>`;
  const searchFilters = state.page === 'search' && (counted >= 8 || state.facets.category || state.facets.decade || state.facets.from || state.facets.to);
  const results = `<div class="catalog-header">${resultCount}${searchFilters ? catalogToolbar(true) : sortControl(libraryPage)}</div>${libraryPage ? '' : appliedFilters()}${content}${notice}${separateArchive ? '<section class="shelf"><div class="section-head"><h2>Internet Archive</h2></div><div id="archive-results"></div></section>' : ''}`;
  const shellKey = JSON.stringify([state.page, state.query, state.filter, state.facets, state.collection, state.connected]);
  if (main.dataset.catalogShell !== shellKey || !main.querySelector('#catalog-results')) {
    const sidebarScroll = main.querySelector('.catalog-sidebar')?.scrollTop || 0;
    main.dataset.catalogShell = shellKey;
    const simple = libraryPage || state.page === 'search';
    main.innerHTML = `<header class="view-heading"><h1>${escape(heading)}</h1>${subtitle ? `<p>${subtitle}</p>` : ''}</header>${choices}${libraryPage ? filters([['all', 'All titles'], ['movie', 'Films'], ['tv', 'Series']]) : ''}<div class="catalog-layout${simple ? ' library-layout' : ''}">${simple ? '' : catalogToolbar()}<section id="catalog-results" aria-label="Titles"></section></div>${footer()}`;
    const sidebar = main.querySelector('.catalog-sidebar');
    if (sidebar) sidebar.scrollTop = sidebarScroll;
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
    state.total = Number.isSafeInteger(data.total) ? data.total : null;
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
  Object.assign(state, { remote: cached?.remote || [], remoteNext: null, total: null, error: '', loading: false, archive: cached?.archive || [], archiveNext: null, archiveError: '', archiveLoading: false });
  render();
  if (state.connected && state.filter !== 'free' && ['home', 'search', 'movies', 'tv', 'new'].includes(state.page)) loadTMDB(id, 1);
  if (state.connected && state.page === 'home') loadHome(id, catalogRequest.signal);
  if (['archive', 'search'].includes(state.page) || (['movies', 'tv'].includes(state.page) && (!state.connected || state.filter === 'free'))) loadArchive(id, 1);
}

function showPage(page, params = new URLSearchParams()) {
  state.page = page;
  const selection = params.get('type');
  const filtersByPage = page === 'new' || libraryPages.includes(page) ? ['movie', 'tv'] : page === 'search' || page === 'archive' ? ['movie', 'tv', page === 'search' ? 'free' : 'cc'] : ['free'];
  state.filter = filtersByPage.includes(selection) ? selection : page === 'new' ? 'movie' : 'all';
  state.collection = page === 'movies' && params.get('collection') === 'gems' ? 'gems' : '';
  params.set('category', params.get('genre') || '');
  state.facets = Object.fromEntries(Object.entries(catalogFilters(params)).map(([name, value]) => [name, value ? String(value) : '']));
  state.filtersOpen = Object.entries(state.facets).some(([name, value]) => value !== defaults[name]);
  if (page !== 'search') {
    state.query = '';
    search.value = '';
  }
  searchClear.hidden = !search.value;
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
  const pages = ['archive', ...libraryPages, ...navLinks.map(([name]) => name)];
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
  suggestionRequest?.abort();
  suggestionsDismissed = true;
  hideSuggestions();
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
  const current = state.query.toLowerCase() === query ? [...state.remote, ...state.archive] : suggestionResults;
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

async function fetchSuggestions() {
  const query = search.value.trim();
  if (suggestionsDismissed || document.activeElement !== search || query.length < 2 || !state.connected) return;
  const status = document.querySelector('#search-status');
  const controller = new AbortController();
  suggestionRequest = controller;
  status.textContent = 'Searching titles…';
  try {
    const params = new URLSearchParams({ q: query });
    const data = await api(`/api/search?${params}`, { signal: controller.signal });
    if (controller.signal.aborted || search.value.trim() !== query) return;
    suggestionResults = data.results.map(localizeTitle);
    renderSuggestions();
    if (!suggestionsDismissed && document.activeElement === search) {
      const count = suggestions.hidden ? 0 : suggestions.children.length;
      status.textContent = count ? `${count} ${count === 1 ? 'suggestion' : 'suggestions'}` : 'No suggestions. Press Enter to search the catalogue.';
    }
  } catch {
    if (!controller.signal.aborted && document.activeElement === search) status.textContent = 'Suggestions are unavailable. Press Enter to search the catalogue.';
  }
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

function episodeLabel(episode) {
  if (!episode) return '';
  const number = episode.number ?? episode.episode_number;
  const season = episode.season ?? episode.season_number;
  return [Number.isInteger(number) ? Number.isInteger(season) ? `S${season} E${number}` : `Episode ${number}` : '', episode.duration || episode.runtime ? `${episode.duration || episode.runtime} min` : ''].filter(Boolean).join(' · ');
}

function validEpisode(episode) {
  return Number.isSafeInteger(episode?.season) && episode.season >= 0
    && Number.isSafeInteger(episode.number) && episode.number > 0;
}

function updateWatchHeading(session) {
  const heading = titlePage.querySelector('.watch-heading h1');
  if (!heading || !session.episode) return;
  heading.textContent = session.episode.title;
  titlePage.querySelector('.title-context').textContent = [session.item.title, episodeLabel(session.episode)].filter(Boolean).join(' · ');
}

function watchedButton(item, key = item.key, episode = null) {
  const marked = Object.hasOwn(watched, key);
  const label = marked ? 'Mark episode unwatched' : 'Mark episode watched';
  const data = `data-action="mark-watched" data-key="${escape(item.key)}" data-watched-key="${escape(key)}" aria-pressed="${marked}"`;
  if (episode) return `<button class="icon-button episode-status" type="button" ${data} aria-label="${label}" title="${label}">${marked ? icon('check') : '<span aria-hidden="true">○</span>'}</button>`;
  return `<button class="button secondary" type="button" ${data}>${marked ? `${icon('check')} Watched` : 'Mark watched'}</button>`;
}

function recordWatched(item, key, marked = true) {
  const value = marked ? { item: libraryTitle(item), updated: Date.now() } : null;
  libraryChange('watched', key, value);
  renderLibraryControls();
  if (active?.seasonData && active.item.key === item.key) {
    const focused = document.activeElement?.dataset.watchedKey;
    if (!marked) active.revealed?.delete(key);
    renderEpisodeRows(active);
    if (focused === key) titlePage.querySelector(`.episode-status[data-watched-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  }
}

function finishPlayback(session) {
  if (session.ended) return;
  const position = playbackPosition(session);
  if (Number.isFinite(position?.duration) && position.duration > 0) checkCompletion(session, { currentTime: position.duration, duration: position.duration }, true);
  session.ended = true;
  if (!session.media.embed) startCountdown(session);
}

function resumePlayback(session) {
  if (!session.ended) return;
  session.ended = false;
  session.countdownCancelled = false;
  session.tracking.sample = null;
  cancelCountdown(session);
}

function checkCompletion(session, position, ended = false) {
  if (session.completed || session.embedPlayback?.unidentifiedEpisode || session.accountId !== account?.id) return;
  const credits = session.segments.filter(segment => segment.kind === 'credits');
  if (!completionReached(session.tracking.ranges, position, credits, ended, session.tracking.skipped)) return;
  session.completed = true;
  const key = session.episode ? session.progressKey : session.item.key;
  if (!watched[key]) recordWatched(session.item, key);
  if (progress[session.progressKey]) libraryChange('progress', session.progressKey, null);
}

function cancelCountdown(session) {
  clearInterval(session.countdown);
  session.countdown = null;
  const overlay = titlePage.querySelector('.next-countdown');
  if (overlay) overlay.hidden = true;
}

function playEpisodeChoice(session, episode) {
  if (!episode || active !== session) return;
  cancelCountdown(session);
  if (episode.key) navigateTitle(session.item, `/watch/${episode.key}`);
  else watchCineSrc(session.item, episode);
}

function startCountdown(session) {
  if (!session.nextEpisode || !pref('autoplay') || session.countdown || session.countdownCancelled) return;
  const overlay = titlePage.querySelector('.next-countdown');
  if (!overlay) return;
  if (document.fullscreenElement?.matches('.video-box > video, .video-box > iframe')) document.exitFullscreen().catch(() => {});
  overlay.querySelector('.next-title').textContent = session.nextEpisode.title;
  overlay.hidden = false;
  const label = overlay.querySelector('.countdown-time');
  const deadline = performance.now() + 10000;
  label.textContent = 10;
  session.countdown = setInterval(() => {
    if (active !== session || !pref('autoplay')) return cancelCountdown(session);
    const seconds = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
    label.textContent = seconds;
    if (seconds === 0) playEpisodeChoice(session, session.nextEpisode);
  }, 250);
}

function regularSeasons(session) {
  return (session.details?.seasons || []).filter(season => season.season_number > 0 && season.episode_count > 0).sort((a, b) => a.season_number - b.season_number);
}

function seriesSeasons(session) {
  if (session.item.episodes) return [null];
  const seasons = regularSeasons(session);
  if (seasons.length) return seasons;
  return (session.details?.seasons || []).filter(season => season.season_number === 0 && season.episode_count > 0);
}

function episodeCoordinates(entry) {
  return { season: entry.season_number, number: entry.episode_number, title: entry.name, duration: entry.runtime };
}

function airedEpisode(entry) {
  return !entry.air_date || entry.air_date <= new Date().toISOString().slice(0, 10);
}

function getSeason(item, number) {
  const key = `${item.id}/${number}`;
  if (!seasonCache.has(key)) {
    seasonCache.set(key, api(`/api/tv/${item.id}/season/${number}`).catch(error => {
      seasonCache.delete(key);
      throw error;
    }));
  }
  return seasonCache.get(key);
}

function episodesMarkup(session) {
  const { item, episode, details } = session;
  if (item.episodes?.length) {
    return `<div class="episode-header"><h2 id="episode-heading">Episodes</h2><p class="season-progress"></p></div><div id="season-episodes" class="episode-list" aria-live="polite"></div>`;
  }
  const seasons = (details?.seasons || []).filter(season => season.season_number >= 0 && season.episode_count > 0);
  if (!seasons.length) return details ? '<p class="catalog-status">No seasons are listed.</p>' : '<p class="catalog-status" role="status">Loading episodes…</p>';
  const selected = episode?.season ?? session.season ?? regularSeasons(session)[0]?.season_number ?? seasons[0].season_number;
  const name = seasons.find(season => season.season_number === selected)?.name || `Season ${selected}`;
  return `<div class="episode-header"><div><h2 id="episode-heading">Episodes</h2><p class="season-progress"></p></div><details class="season-picker"><summary aria-label="Select season"><span>${escape(name)}</span>${icon('chevron-down')}</summary><div class="season-menu" role="group" aria-label="Seasons">${seasons.map(season => `<button type="button" data-action="select-season" data-value="${season.season_number}" aria-pressed="${season.season_number === selected}">${escape(season.name)}</button>`).join('')}</div></details></div><div class="episode-list" id="season-episodes" aria-live="polite"></div>`;
}

function episodeRow(session, entry, index) {
  const { item, episode } = session;
  const archive = Boolean(entry.key);
  const coordinates = archive ? entry : episodeCoordinates(entry);
  const key = archive ? `${item.key}/${entry.key}` : cineSrcKey(item, coordinates);
  const marked = Boolean(watched[key]);
  const selected = archive ? episode?.key === entry.key : episode?.season === coordinates.season && episode?.number === coordinates.number;
  const reveals = session.revealed?.get(key);
  const image = imagePath(entry.still_path, 'w300');
  const blurred = image && !marked && pref('blur') && !reveals?.has('image');
  const description = entry.overview || '';
  const revealedDescription = reveals?.has('description');
  const hiddenDescription = description && !marked && pref('hideSynopsis');
  const resume = pref('resume') && progress[key]?.time > 5 && !marked;
  const action = archive ? `data-action="episode" data-key="${escape(entry.key)}"` : `data-action="stream-episode" data-season="${coordinates.season}" data-number="${coordinates.number}" data-episode-title="${escape(coordinates.title)}"`;
  const available = archive || airedEpisode(entry);
  return `<article class="episode-row${marked ? ' episode-watched' : ''}" data-episode-key="${escape(key)}"${selected ? ' aria-current="true"' : ''}>
    <span class="episode-number" aria-hidden="true">${coordinates.number || index + 1}</span>
    <div class="episode-image${blurred ? ' is-spoiler' : ''}">${image ? `<img src="${image}" alt="" loading="lazy">` : icon('film')}${blurred ? `<button type="button" data-action="reveal-episode" data-value="image" aria-label="Reveal thumbnail for ${escape(coordinates.title)}" title="Reveal thumbnail">Reveal</button>` : ''}</div>
    <div class="episode-info"><button class="episode-play" type="button" ${action} aria-label="${resume ? 'Resume' : 'Play'} ${escape(coordinates.title)}"${available ? '' : ' disabled'}>${escape(coordinates.title)}${selected ? ' <span class="episode-current">Playing</span>' : ''}</button><small>${episodeLabel(coordinates)}${resume ? ` · ${timeCode(progress[key].time)}` : ''}${available ? '' : ' · Not aired'}</small>
      ${description ? `<details class="episode-description"${hiddenDescription ? ' data-spoiler-description' : ''}${revealedDescription ? ' open' : ''}><summary>${hiddenDescription ? 'Reveal description' : `<span class="episode-preview">${escape(description)}</span><span class="episode-expanded-label">Hide description</span>`}</summary><p>${escape(description)}</p></details>` : ''}</div>
    ${watchedButton(item, key, entry)}
  </article>`;
}

function renderEpisodeRows(session) {
  const target = titlePage.querySelector('#season-episodes');
  if (!target || !session.seasonData) return;
  const entries = session.seasonData;
  target.innerHTML = entries.length ? entries.map((entry, index) => episodeRow(session, entry, index)).join('') : '<p class="catalog-status">No episodes are listed.</p>';
  const eligible = entries.filter(airedEpisode);
  const seen = eligible.filter(entry => watched[entry.key ? `${session.item.key}/${entry.key}` : cineSrcKey(session.item, episodeCoordinates(entry))]).length;
  const progressText = titlePage.querySelector('.season-progress');
  if (progressText) progressText.textContent = eligible.length
    ? `${seen} of ${eligible.length} watched · ${seen === eligible.length ? 'Season complete' : `${eligible.length - seen} remaining`}` : '';
}

function updateEpisodeNavigation(session) {
  const previous = titlePage.querySelector('.transport [data-action="previous-episode"]');
  const next = titlePage.querySelector('.transport [data-action="next-episode"]');
  if (previous) previous.disabled = !session.previousEpisode;
  if (next) next.disabled = !session.nextEpisode;
  if (session.ended && !session.media.embed) startCountdown(session);
}

function updateSeriesTracking(session) {
  if (active !== session || session.item.type !== 'tv' || session.media) return;
  const text = titlePage.querySelector('.series-tracking');
  const primary = titlePage.querySelector('[data-action="series-start"]');
  if (!text || !primary) return;
  const seasons = seriesSeasons(session);
  const total = session.item.episodes?.length || session.details?.number_of_episodes;
  const prefix = `${session.item.key}/`;
  const seen = Object.keys(watched).filter(key => key.startsWith(prefix) && !key.startsWith(`${prefix}cinesrc-s0e`)).length;
  const resume = pref('resume') ? resumeFor(session.item)?.[1] : null;
  const resumeEpisode = resume?.episode || (resume && session.item.episodes?.find(episode => progress[`${prefix}${episode.key}`] === resume));
  const baseText = [total ? `${seen} of ${total} episodes watched · ${Math.max(0, total - seen)} remaining` : '', resume ? `Resume ${episodeLabel(resumeEpisode)} at ${timeCode(resume.time)}` : ''].filter(Boolean).join(' · ');
  const revision = (session.trackingRevision || 0) + 1;
  session.trackingRevision = revision;
  text.textContent = baseText;
  primary.textContent = resume ? 'Continue watching' : seen ? 'Play next unwatched' : 'Start watching';
  primary.disabled = !seasons.length;
  if (resume || !seasons.length) return;
  findSeriesEpisode(session).then(({ first, next }) => {
    if (active !== session || session.trackingRevision !== revision) return;
    if (next) text.textContent = [baseText, `Next unwatched · ${[episodeLabel(next), next.title].filter(Boolean).join(' · ')}`].filter(Boolean).join(' · ');
    else if (first) primary.textContent = 'Watch again';
    else primary.disabled = true;
  }).catch(() => {});
}

async function findSeriesEpisode(session) {
  let first;
  for (const season of seriesSeasons(session)) {
    const data = season ? await getSeason(session.item, season.season_number) : { episodes: session.item.episodes };
    if (active !== session) break;
    for (const entry of (data.episodes || []).filter(airedEpisode)) {
      const episode = entry.key ? entry : episodeCoordinates(entry);
      first ||= episode;
      const key = entry.key ? `${session.item.key}/${entry.key}` : cineSrcKey(session.item, episode);
      if (!watched[key]) return { first, next: episode };
    }
  }
  return { first };
}

async function startSeries(session) {
  const recent = pref('resume') && resumeFor(session.item);
  if (recent) {
    const entry = recent[1];
    if (entry.episode) return playEpisodeChoice(session, entry.episode);
    if (session.item.episodes) {
      const episode = session.item.episodes.find(candidate => `${session.item.key}/${candidate.key}` === recent[0]);
      if (episode) return playEpisodeChoice(session, episode);
    }
  }
  const control = titlePage.querySelector('[data-action="series-start"]');
  if (control) control.disabled = true;
  try {
    const { first, next } = await findSeriesEpisode(session);
    if (active !== session) return;
    if (next || first) playEpisodeChoice(session, next || first);
    else showToast('No aired episodes are available.');
  } catch (error) {
    if (active === session) showToast(error.message);
  } finally {
    if (active === session) updateSeriesTracking(session);
  }
}

async function resolveEpisodeNavigation(session, entries) {
  const current = session.episode;
  if (!current) return;
  const eligible = entries.filter(airedEpisode);
  const index = eligible.findIndex(entry => current.key ? entry.key === current.key : entry.episode_number === current.number);
  if (index < 0) return;
  const convert = entry => entry && (entry.key ? entry : episodeCoordinates(entry));
  session.previousEpisode = convert(eligible[index - 1]);
  session.nextEpisode = convert(eligible[index + 1]);
  if (!current.key && current.season > 0) {
    const seasons = regularSeasons(session);
    const seasonIndex = seasons.findIndex(season => season.season_number === current.season);
    if (seasonIndex >= 0) {
      const adjacent = async (step, edge) => {
        for (let cursor = seasonIndex + step; seasons[cursor]; cursor += step) {
          const data = await getSeason(session.item, seasons[cursor].season_number);
          const entry = (data.episodes || []).filter(airedEpisode).at(edge);
          if (entry) return convert(entry);
        }
      };
      await Promise.allSettled([
        !session.previousEpisode && adjacent(-1, -1).then(entry => { if (session.episode === current) session.previousEpisode = entry; }),
        !session.nextEpisode && adjacent(1, 0).then(entry => { if (session.episode === current) session.nextEpisode = entry; }),
      ]);
    }
  }
  if (active === session && session.episode === current) updateEpisodeNavigation(session);
}

async function loadSeason(session, number) {
  const target = titlePage.querySelector('#season-episodes');
  if (!target) return;
  const revision = (session.seasonRevision || 0) + 1;
  session.seasonRevision = revision;
  session.season = Number(number);
  target.setAttribute('aria-busy', 'true');
  session.seasonData = null;
  target.textContent = 'Loading episodes…';
  const seasonProgress = titlePage.querySelector('.season-progress');
  if (seasonProgress) seasonProgress.textContent = '';
  const picker = titlePage.querySelector('.season-picker');
  if (picker) {
    for (const choice of picker.querySelectorAll('button')) {
      const selected = Number(choice.dataset.value) === session.season;
      choice.setAttribute('aria-pressed', selected);
      if (selected) picker.querySelector('summary span').textContent = choice.textContent;
    }
  }
  try {
    const season = session.item.episodes ? { episodes: session.item.episodes } : await getSeason(session.item, number);
    if (active !== session || session.seasonRevision !== revision) return;
    session.seasonData = season.episodes || [];
    renderEpisodeRows(session);
    if (session.episode && (session.episode.key || session.episode.season === Number(number))) {
      const entry = session.seasonData.find(entry => session.episode.key ? entry.key === session.episode.key : entry.episode_number === session.episode.number);
      if (entry && !entry.key) Object.assign(session.episode, episodeCoordinates(entry));
      updateWatchHeading(session);
      if (!session.media?.embed) resolveEpisodeNavigation(session, session.seasonData);
    }
    updateSeriesTracking(session);
  } catch (error) {
    if (active === session && session.seasonRevision === revision) {
      target.innerHTML = `<p class="catalog-status" role="status">${escape(error.message)} <button type="button" class="plain-link" data-action="retry-season">Retry</button></p>`;
    }
  } finally {
    if (active === session && session.seasonRevision === revision) target.setAttribute('aria-busy', 'false');
  }
}

async function loadTitle(session) {
  if (!session.details && session.item.id) {
    try {
      session.details = await api(`/api/${session.item.type}/${session.item.id}`);
      detailsCache.set(session.item.key, session.details);
    } catch { /* Basic title information remains available. */ }
  }
  if (active !== session) return;
  const details = session.details;
  if (details) {
    session.item.imdb ||= details.external_ids?.imdb_id || details.imdb_id;
    const facts = titlePage.querySelector('.title-facts');
    if (facts) facts.innerHTML = titleFacts(session);
    const byline = titlePage.querySelector('.title-byline');
    if (byline) {
      byline.textContent = titleByline(details);
      byline.hidden = !byline.textContent;
    }
    const cast = titlePage.querySelector('.cast-section');
    if (cast && (details.credits?.cast?.length || details.credits?.crew?.length)) {
      cast.hidden = false;
      const crew = details.credits.crew?.filter(person => ['Director', 'Writer', 'Screenplay', 'Director of Photography', 'Original Music Composer', 'Editor'].includes(person.job)).slice(0, 10) || [];
      cast.innerHTML = `<h2>Cast &amp; crew</h2><div class="cast-list">${(details.credits.cast || []).slice(0, 8).map(person => `<div class="cast-person">${person.profile_path ? `<img src="${imagePath(person.profile_path, 'w185')}" alt="" loading="lazy">` : `<span>${icon('user')}</span>`}<strong>${escape(person.name)}</strong><small>${escape(person.character)}</small></div>`).join('')}</div>${crew.length ? `<dl class="crew-list">${crew.map(person => `<div><dt>${escape(person.job)}</dt><dd>${escape(person.name)}</dd></div>`).join('')}</dl>` : ''}`;
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
  const episodes = titlePage.querySelector('.title-episodes');
  if (episodes) {
    episodes.innerHTML = session.details || session.item.episodes?.length ? episodesMarkup(session) : '<p class="catalog-status" role="status">Episode details are unavailable.</p>';
    const selected = episodes.querySelector('[data-action="select-season"][aria-pressed="true"]');
    if (selected || session.item.episodes?.length) loadSeason(session, selected?.dataset.value ?? 0);
  }
  updateSeriesTracking(session);
}

function watchCineSrc(item, episode = null) {
  if (!hasCineSrcTitle(item) || (item.type === 'tv' && !validEpisode(episode))) return;
  const suffix = episode ? `/s${episode.season}e${episode.number}` : '/watch';
  episodeChoice = episode ? { path: `#${titlePath(item)}${suffix}`, episode } : null;
  navigateTitle(item, suffix);
}

function remember({ currentTime, duration }, session, force = false) {
  if (session.completed || session.ended || session.embedPlayback?.unidentifiedEpisode || !Number.isFinite(duration) || !Number.isFinite(currentTime) || currentTime < 5 || currentTime >= duration || session.accountId !== account?.id) return;
  if (!session.tracking.ranges.some(([start, end]) => currentTime >= start && currentTime <= end + .5)) return;
  const now = Date.now();
  if (!force && now - (session.lastSaved || 0) < 8000) return;
  if (force && Math.abs((progress[session.progressKey]?.time ?? -1) - currentTime) < .5) return;
  const entry = { time: currentTime, duration, updated: now, item: libraryTitle(session.item), ranges: session.tracking.ranges.slice(-40), skipped: session.tracking.skipped.slice(-20) };
  if (session.media.embed && session.episode) entry.episode = session.episode;
  session.lastSaved = now;
  libraryChange('progress', session.progressKey, entry);
}

const segmentNames = { intro: 'Intro', recap: 'Recap', credits: 'Credits' };

function playbackBar(session) {
  if (session.media.embed) return '';
  const episode = session.item.type === 'tv';
  return `<div class="playback-bar"${episode ? '' : ' hidden'}>
    <div class="transport" aria-label="Episode navigation">
      ${episode ? '<button class="button secondary" type="button" data-action="previous-episode" disabled>Previous episode</button><button class="button secondary" type="button" data-action="next-episode" disabled>Next episode</button>' : ''}
      <button class="button primary" type="button" data-action="skip-segment" hidden></button>
    </div>
  </div>`;
}


function playbackPosition(session) {
  return session.embedPlayback?.position || titlePage.querySelector('video');
}

function playerCommand(command, ...args) {
  if (active?.media?.embed) {
    active.embedPlayback?.frame.contentWindow?.postMessage({ type: 'cinesrc:command', command, args }, cineSrcOrigin);
    return;
  }
  const video = titlePage.querySelector('video');
  if (!video) return;
  if (command === 'seek' && Number.isFinite(video.duration)) video.currentTime = args[0];
  if (command === 'play') video.play().catch(() => {});
  if (command === 'pause') video.pause();
}

function toggleFullscreen() {
  const stage = titlePage.querySelector('.watch-stage');
  const video = stage?.querySelector('video');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if (video?.webkitDisplayingFullscreen) video.webkitExitFullscreen();
  else if (document.fullscreenEnabled && stage) stage.requestFullscreen().catch(() => showToast('Fullscreen is unavailable.'));
  else video?.webkitEnterFullscreen?.();
}

function bindPictureGestures(picture, session, signal) {
  let pendingClick;
  const clearClick = () => clearTimeout(pendingClick);
  signal.addEventListener('abort', clearClick, { once: true });
  picture.addEventListener('click', event => {
    clearClick();
    if (event.detail !== 1) return;
    pendingClick = setTimeout(() => {
      const position = playbackPosition(session);
      if (active === session && (position || session.ended)) playerCommand(session.ended || position.paused ? 'play' : 'pause');
    }, 260);
  }, { signal });
  picture.addEventListener('dblclick', event => {
    clearClick();
    event.preventDefault();
    if (active === session) toggleFullscreen();
  }, { signal });
}

function trackPosition(position, session, seek = false) {
  if (!position || active !== session || !Number.isFinite(position.duration) || position.duration <= 0) return;
  if (seek) session.tracking.sample = null;
  const advanced = samplePlayback(session.tracking, position, performance.now());
  updateSkip(position, session);
  if (advanced && !session.ended) checkCompletion(session, position);
}


function timeCode(seconds) {
  const time = Math.floor(seconds);
  const minutes = Math.floor(time / 60);
  const tail = String(time % 60).padStart(2, '0');
  return minutes < 60 ? `${minutes}:${tail}` : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${tail}`;
}

function updateSkip(video, session) {
  if (session.media.embed) return;
  const button = titlePage.querySelector('[data-action="skip-segment"]');
  if (!button || active !== session) return;
  const segment = session.segments.find(entry => video.currentTime >= entry.start && video.currentTime < entry.end - .25 && entry.end <= video.duration);
  if (segment && pref(segment.kind) && !video.paused && !video.seeking && !session.autoSkipped.has(segment)) {
    skipSegment(session, segment);
    if (segment.kind === 'credits') checkCompletion(session, video);
    button.hidden = true;
  } else {
    button.hidden = !segment;
    if (segment) {
      button.textContent = `Skip ${segmentNames[segment.kind].toLowerCase()}`;
      button.dataset.end = segment.end;
    }
  }
  button.closest('.playback-bar').hidden = !session.episode && button.hidden;
}

function skipSegment(session, segment) {
  session.autoSkipped.add(segment);
  session.tracking.skipped = mergeRanges(session.tracking.skipped, segment.start, segment.end);
  session.tracking.sample = null;
  playerCommand('seek', segment.end);
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
  const sourceRevision = session.sourceRevision;
  try {
    const { segments } = await api(`/api/segments?${params}`);
    if (active !== session || session.progressKey !== target || session.sourceRevision !== sourceRevision || session.segmentRequest !== duration || !segments.length) return;
    const position = playbackPosition(session);
    if (!position || Math.round(position.duration) !== duration) return;
    const supplied = new Set(session.segments.map(segment => segment.kind));
    session.segments = [...session.segments, ...segments.filter(segment => !supplied.has(segment.kind))
      .map(segment => ({ ...segment, end: Math.min(segment.end, position.duration) }))];
    if (!session.media.embed) updateSkip(position, session);
    else if (session.embedPlayback.skippedTo !== undefined) creditCineSkip(session, session.embedPlayback.skippedTo);
    session.renderSegments?.();
  } catch { /* Bundled timestamps remain usable. */ }
}

function playerButton(name, label, glyph, hidden = false) {
  return `<button class="player-button" type="button" data-player="${name}" aria-label="${label}" title="${label}"${hidden ? ' hidden' : ''}>${icon(glyph)}</button>`;
}

function playerControls() {
  return `<div class="player-controls" role="group" aria-label="Playback controls">
    <div class="player-timeline"><div class="player-markers" aria-hidden="true"></div><output class="player-marker-tip" aria-hidden="true" hidden></output><input class="player-seek" type="range" min="0" max="1" step=".1" value="0" aria-label="Seek" disabled></div>
    <div class="player-transport">
      ${playerButton('play', 'Play', 'play')}
      ${playerButton('back', 'Back 10 seconds', 'back10')}
      ${playerButton('forward', 'Forward 10 seconds', 'forward10')}
      ${playerButton('mute', 'Mute', 'volume')}
      <input class="player-volume" type="range" min="0" max="1" step=".05" value="1" aria-label="Volume">
      <span class="player-time" aria-hidden="true">0:00</span>
      <span class="player-spacer"></span>
      ${playerButton('captions', 'Captions', 'captions', true)}
      ${playerButton('fullscreen', 'Fullscreen', 'fullscreen')}
    </div>
  </div>`;
}

function bindVideoControls(video, player, session, signal) {
  const controls = player.querySelector('.player-controls');
  const seek = controls.querySelector('.player-seek');
  const volume = controls.querySelector('.player-volume');
  const time = controls.querySelector('.player-time');
  const markers = controls.querySelector('.player-markers');
  const markerTip = controls.querySelector('.player-marker-tip');
  const play = controls.querySelector('[data-player="play"]');
  const mute = controls.querySelector('[data-player="mute"]');
  const captions = controls.querySelector('[data-player="captions"]');
  const fullscreen = controls.querySelector('[data-player="fullscreen"]');
  const track = video.textTracks[0];
  let scrubbing = false;
  let idleTimer;

  function setControlsVisible(visible) {
    player.classList.toggle('has-pointer', visible);
    positionCaptions();
  }
  function positionCaptions() {
    const line = player.classList.contains('has-pointer') || video.paused ? 74 : 94;
    for (const cue of track?.activeCues || []) {
      cue.snapToLines = false;
      cue.line = line;
    }
  }

  function updateButton(button, label, glyph) {
    if (button.getAttribute('aria-label') === label) return;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = icon(glyph);
  }
  function updateTime(position = video.currentTime) {
    const duration = video.duration;
    seek.disabled = !(Number.isFinite(duration) && duration > 0);
    if (!seek.disabled) seek.max = duration;
    if (!scrubbing) seek.value = position;
    seek.setAttribute('aria-valuetext', seek.disabled ? timeCode(position) : `${timeCode(position)} of ${timeCode(duration)}`);
    seek.style.setProperty('--played', `${seek.disabled ? 0 : position / duration * 100}%`);
    time.textContent = seek.disabled ? timeCode(position) : `${timeCode(position)} / ${timeCode(duration)}`;
  }
  function updatePlayback() {
    player.classList.toggle('is-paused', video.paused || video.ended);
    updateButton(play, video.ended ? 'Replay' : video.paused ? 'Play' : 'Pause', video.ended ? 'replay' : video.paused ? 'play' : 'pause');
    if (video.paused) revealControls();
  }
  function updateVolume() {
    const muted = video.muted || video.volume === 0;
    updateButton(mute, muted ? 'Unmute' : 'Mute', muted ? 'muted' : 'volume');
    volume.value = muted ? 0 : video.volume;
  }
  function revealControls() {
    setControlsVisible(true);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => setControlsVisible(false), 2500);
  }
  session.renderSegments = () => {
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    markers.replaceChildren(...session.segments.filter(segment => segment.end <= duration).map(segment => {
      const marker = document.createElement('span');
      marker.className = 'player-marker';
      marker.style.left = `${segment.start / duration * 100}%`;
      marker.style.width = `${(segment.end - segment.start) / duration * 100}%`;
      return marker;
    }));
  };
  captions.hidden = !track;
  captions.setAttribute('aria-pressed', String(track?.mode === 'showing'));
  fullscreen.hidden = !document.fullscreenEnabled && !video.webkitSupportsFullscreen && !video.webkitEnterFullscreen;
  updatePlayback();
  updateTime();
  revealControls();

  bindPictureGestures(player.querySelector('.video-picture'), session, signal);
  controls.addEventListener('click', event => {
    const action = event.target.closest('[data-player]')?.dataset.player;
    if (action === 'play') playerCommand(video.paused ? 'play' : 'pause');
    if (action === 'back') playerCommand('seek', Math.max(0, video.currentTime - 10));
    if (action === 'forward') playerCommand('seek', Math.min(video.duration, video.currentTime + 10));
    if (action === 'mute') {
      if (video.volume === 0) video.volume = .5;
      video.muted = mute.getAttribute('aria-label') === 'Mute';
    }
    if (action === 'captions' && track) track.mode = track.mode === 'showing' ? 'disabled' : 'showing';
    if (action === 'fullscreen') toggleFullscreen();
  }, { signal });
  seek.addEventListener('input', () => {
    scrubbing = true;
    updateTime(Number(seek.value));
  }, { signal });
  seek.addEventListener('change', () => {
    const position = Number(seek.value);
    scrubbing = false;
    playerCommand('seek', position);
  }, { signal });
  seek.addEventListener('pointercancel', () => {
    scrubbing = false;
    updateTime();
  }, { signal });
  seek.addEventListener('pointermove', event => {
    if (seek.disabled || !session.segments.length) return;
    const { left, width } = seek.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (event.clientX - left) / width));
    const position = percent * video.duration;
    const segment = session.segments.find(entry => position >= entry.start && position < entry.end);
    markerTip.hidden = !segment;
    if (segment) {
      markerTip.textContent = `${segmentNames[segment.kind]} · ${timeCode(segment.start)}`;
      markerTip.style.left = `clamp(68px, ${percent * 100}%, 100% - 68px)`;
    }
  }, { signal });
  seek.addEventListener('pointerleave', () => { markerTip.hidden = true; }, { signal });
  volume.addEventListener('input', () => {
    video.volume = Number(volume.value);
    video.muted = video.volume === 0;
  }, { signal });
  for (const type of ['play', 'pause', 'ended']) video.addEventListener(type, updatePlayback, { signal });
  for (const type of ['timeupdate', 'seeking', 'loadedmetadata', 'durationchange']) {
    video.addEventListener(type, () => { if (!scrubbing) updateTime(); }, { signal });
  }
  video.addEventListener('loadedmetadata', session.renderSegments, { signal });
  video.addEventListener('volumechange', updateVolume, { signal });
  video.textTracks.addEventListener('change', () => captions.setAttribute('aria-pressed', String(track?.mode === 'showing')), { signal });
  track?.addEventListener('cuechange', positionCaptions, { signal });
  document.addEventListener('fullscreenchange', () => {
    const full = document.fullscreenElement === player.closest('.watch-stage');
    updateButton(fullscreen, full ? 'Exit fullscreen' : 'Fullscreen', full ? 'exit-fullscreen' : 'fullscreen');
    revealControls();
  }, { signal });
  player.addEventListener('pointermove', revealControls, { signal });
  signal.addEventListener('abort', () => clearTimeout(idleTimer), { once: true });
}

function startVideo(session, direct = false) {
  const { item, episode, media, progressKey } = session;
  const player = titlePage.querySelector('.video-box');
  const sourcePage = media.page || `https://archive.org/details/${encodeURIComponent(media.archive)}`;
  player.innerHTML = `<video playsinline preload="auto" aria-label="${escape(episode?.title || item.title)}" ${item.backdrop ? `poster="${escape(item.backdrop)}"` : ''}></video><div class="video-picture" aria-hidden="true"></div>${playerControls()}<div class="video-error" role="status" hidden><p>The video could not load.</p><div class="watch-actions"><button type="button" class="button secondary" data-action="retry-video">Retry</button>${direct ? `<a class="button primary" href="${escape(sourcePage)}" target="_blank" rel="noopener noreferrer">Open source ${icon('external')}</a>` : '<button type="button" class="button primary" data-action="direct-video">Try direct stream</button>'}</div></div>`;
  const video = player.querySelector('video');
  const controller = new AbortController();
  session.videoController = controller;
  if (media.captions) {
    const track = document.createElement('track');
    track.kind = 'captions';
    track.label = 'English (auto-generated)';
    track.srclang = 'en';
    track.src = media.captions;
    video.append(track);
  }
  bindVideoControls(video, player, session, controller.signal);
  video.addEventListener('loadedmetadata', () => {
    const previous = progress[progressKey];
    if (pref('resume') && previous && previous.time > 5 && previous.time < video.duration - 2) video.currentTime = previous.time;
    if (pref('volume')) {
      video.volume = preferences.level ?? 1;
      video.muted = preferences.muted ?? false;
    }
    if (pref('subtitles') && video.textTracks[0] && preferences.captions) video.textTracks[0].mode = 'showing';
    loadSkipSegments(video, session);
  });
  video.addEventListener('timeupdate', () => {
    trackPosition(video, session);
    if (!video.seeking) remember(video, session);
  });
  video.addEventListener('seeking', () => { session.tracking.sample = null; });
  video.addEventListener('play', () => resumePlayback(session));
  video.addEventListener('pause', () => {
    session.tracking.sample = null;
    remember(video, session, true);
  });
  video.addEventListener('volumechange', () => rememberVolume(video.volume, video.muted));
  video.textTracks.addEventListener('change', () => {
    if (pref('subtitles') && video.textTracks.length) {
      const enabled = [...video.textTracks].some(track => track.mode === 'showing');
      if (preferences.captions !== enabled) libraryChange('preferences', 'captions', enabled);
    }
  });
  video.addEventListener('ended', () => finishPlayback(session));
  const errorBox = player.querySelector('.video-error');
  video.addEventListener('error', () => { errorBox.hidden = false; });
  video.src = direct ? archiveFileUrl(media) : `/stream/${item.key}${episode ? `/${episode.key}` : ''}`;
  video.play().catch(() => { /* The native play control remains available when autoplay is blocked. */ });
}

function episodeFromControl(control) {
  return { season: Number(control.dataset.season), number: Number(control.dataset.number), title: control.dataset.episodeTitle };
}

function updateEmbeddedEpisode(session, season, number, internalNavigation) {
  if (!session.episode || !validEpisode({ season, number }) || (session.episode.season === season && session.episode.number === number)) return false;
  const row = titlePage.querySelector(`[data-action="stream-episode"][data-season="${season}"][data-number="${number}"]`);
  const episode = row ? episodeFromControl(row) : { season, number, title: `Episode ${number}` };
  if (!internalNavigation) {
    watchCineSrc(session.item, episode);
    return false;
  }
  const playback = session.embedPlayback;
  if (playback.position) remember(playback.position, session, true);
  session.episode = episode;
  session.progressKey = cineSrcKey(session.item, episode);
  session.lastSaved = 0;
  session.segments = [];
  session.segmentRequest = null;
  session.autoSkipped.clear();
  playback.position = null;
  playback.paused = true;
  playback.seekStarted = null;
  playback.unidentifiedEpisode = false;
  playback.resumeTime = cineResumeTime(session.progressKey);
  playback.restoreVolume = true;
  playback.lastUpdate = 0;
  playback.duration = null;
  playback.skippedTo = undefined;
  playback.frame.title = `${session.item.title}, ${episodeLabel(episode)} video player`;
  history.replaceState(null, '', `#${titlePath(session.item)}/s${season}e${number}`);
  updateWatchHeading(session);
  session.tracking = viewingSession(progress[session.progressKey]);
  session.completed = false;
  session.ended = false;
  session.countdownCancelled = false;
  loadSeason(session, season);
  return true;
}

function cineResumeTime(key) {
  const previous = progress[key];
  return pref('resume') && previous?.time > 5 && previous.time < previous.duration - 2 ? previous.time : null;
}

function creditCineSkip(session, time) {
  const segment = session.segments.find(entry => ['intro', 'recap'].includes(entry.kind) && Math.abs(entry.end - time) <= 2);
  if (segment) session.tracking.skipped = mergeRanges(session.tracking.skipped, segment.start, segment.end);
}

function cineSrcUrl(session) {
  const { item, episode, progressKey } = session;
  const url = new URL(`/embed/${item.type}/${item.id}`, cineSrcOrigin);
  url.searchParams.set('color', '#b34636');
  url.searchParams.set('controls', 'true');
  if (episode) {
    url.searchParams.set('s', episode.season);
    url.searchParams.set('e', episode.number);
    url.searchParams.set('autonext', String(pref('autoplay')));
    url.searchParams.set('autoskip', String(pref('intro') && pref('recap')));
  }
  const resumeTime = cineResumeTime(progressKey);
  url.searchParams.set('continueprompt', 'false');
  if (resumeTime) url.searchParams.set('t', String(Math.floor(resumeTime)));
  if (preferences.quality) url.searchParams.set('quality', preferences.quality);
  if (pref('volume') && preferences.muted) url.searchParams.set('muted', 'true');
  return url.href;
}

function startCineSrc(session) {
  const { item, episode } = session;
  const frame = document.createElement('iframe');
  frame.title = `${item.title}${episode ? `, ${episodeLabel(episode)}` : ''} video player`;
  frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
  frame.allowFullscreen = true;
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
  frame.referrerPolicy = 'strict-origin';
  const picture = document.createElement('div');
  picture.className = 'video-picture embed-picture';
  picture.setAttribute('aria-hidden', 'true');
  picture.hidden = true;

  const notice = titlePage.querySelector('.embed-notice');
  const status = notice.querySelector('[role="status"]');
  const retry = notice.querySelector('button');
  const setStatus = (message = '', canRetry = false) => {
    status.textContent = message;
    retry.hidden = !canRetry;
    notice.hidden = !message;
  };
  let timer;
  let recoveryTimer;
  const waitForStream = (message = 'Loading player…') => {
    setStatus(message);
    clearTimeout(timer);
    timer = setTimeout(() => setStatus('The player is taking longer than expected. Try a source in the player or reload it here.', true), 20000);
  };
  waitForStream();
  const controller = new AbortController();
  const playback = {
    frame,
    position: null,
    paused: true,
    lastUpdate: 0,
    restoreVolume: true,
    stop() {
      clearTimeout(timer);
      clearTimeout(recoveryTimer);
      controller.abort();
      frame.remove();
      picture.remove();
    },
  };
  session.embedPlayback = playback;
  bindPictureGestures(picture, session, controller.signal);

  function restoreVolume() {
    if (!playback.restoreVolume || !pref('volume')) return;
    playback.restoreVolume = false;
    if (Number.isFinite(preferences.level)) playerCommand('setVolume', preferences.level);
    if (typeof preferences.muted === 'boolean') playerCommand('setMuted', preferences.muted);
  }

  function resumeEmbeddedEpisode(duration) {
    const time = playback.resumeTime;
    playback.resumeTime = null;
    if (time > 5 && time < duration - 2) {
      playback.seekStarted = performance.now();
      playerCommand('seek', time);
    }
  }

  function readPosition(currentTime, duration, seeking = false) {
    if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0 || currentTime < 0 || currentTime > duration + .5) return;
    const previousDuration = playback.position?.duration || progress[session.progressKey]?.duration;
    if (previousDuration && Math.abs(previousDuration - duration) > 2.5) {
      session.tracking = viewingSession();
      session.segments = [];
      session.segmentRequest = null;
    }
    playback.position = { currentTime: Math.min(currentTime, duration), duration, paused: playback.paused, seeking };
    if (!playback.unidentifiedEpisode && !session.ended) {
      clearTimeout(recoveryTimer);
      clearTimeout(timer);
      setStatus();
      trackPosition(playback.position, session, seeking);
      loadSkipSegments(playback.position, session);
      if (!seeking) remember(playback.position, session);
    }
  }

  function startStreamTimeout() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      setStatus('The video stopped responding. Try a source in the player or reload it here.', true);
    }, 20000);
  }

  window.addEventListener('message', event => {
    if (active !== session || event.origin !== cineSrcOrigin || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || typeof data.type !== 'string') return;
    switch (data.type) {
      case 'cinesrc:ready':
        restoreVolume();
        break;
      case 'cinesrc:play':
        resumePlayback(session);
        picture.hidden = false;
        playback.paused = false;
        if (playback.position) {
          playback.position.paused = false;
          trackPosition(playback.position, session);
        }
        if (!playback.unidentifiedEpisode && playback.position) {
          clearTimeout(timer);
          setStatus();
        }
        break;
      case 'cinesrc:loadedmetadata':
        if (Number.isFinite(data.duration) && data.duration > 0) {
          playback.duration = data.duration;
          session.tracking.sample = null;
          playback.seekStarted = null;
          restoreVolume();
          resumeEmbeddedEpisode(data.duration);
          readPosition(0, data.duration, true);
        }
        break;
      case 'cinesrc:timeupdate':
      case 'cinesrc:seeked':
        if (!Number.isFinite(data.currentTime) || !Number.isFinite(data.duration) || data.duration <= 0 || data.currentTime < 0 || data.currentTime > data.duration) break;
        playback.lastUpdate = performance.now();
        if (data.currentTime > 0) picture.hidden = false;
        if (playback.resumeTime && data.type === 'cinesrc:timeupdate') resumeEmbeddedEpisode(data.duration);
        const seeking = data.type === 'cinesrc:seeked' || performance.now() - (playback.seekStarted ?? -Infinity) < 1800;
        if (!seeking && playback.position && data.currentTime > playback.position.currentTime + .05) playback.paused = false;
        if (data.type === 'cinesrc:seeked') playback.seekStarted = null;
        readPosition(data.currentTime, data.duration, seeking);
        if (!seeking && !playback.paused && !session.ended && !playback.unidentifiedEpisode) startStreamTimeout();
        break;
      case 'cinesrc:pause':
        playback.paused = true;
        if (playback.position) clearTimeout(timer);
        session.tracking.sample = null;
        if (playback.position) {
          playback.position.paused = true;
          remember(playback.position, session, true);
        }
        break;
      case 'cinesrc:seeking':
        playback.seekStarted = performance.now();
        session.tracking.sample = null;
        break;
      case 'cinesrc:skipintro': {
        if (!Number.isFinite(data.time) || data.time < 0) break;
        playback.skippedTo = data.time;
        creditCineSkip(session, data.time);
        session.tracking.sample = null;
        break;
      }
      case 'cinesrc:volumechange':
        rememberVolume(data.volume, data.muted);
        break;
      case 'cinesrc:ended':
        finishPlayback(session);
        clearTimeout(timer);
        playback.position = null;
        playback.paused = true;
        break;
      case 'cinesrc:nextepisode':
        if (updateEmbeddedEpisode(session, data.season, data.episode, data.internalNavigation === true)) {
          picture.hidden = true;
          waitForStream('Loading episode…');
          clearTimeout(recoveryTimer);
          recoveryTimer = setTimeout(() => {
            // Some internal transitions leave CineSrc's commands attached to the old video.
            if (playback.position) return;
            playback.resumeTime = null;
            waitForStream('Reconnecting this episode…');
            frame.src = cineSrcUrl(session);
          }, 12000);
        }
        break;
      case 'cinesrc:sourceused':
        if (playback.position) {
          remember(playback.position, session, true);
          playback.resumeTime = cineResumeTime(session.progressKey);
        }
        if (session.ended && session.episode && pref('autoplay')) {
          playback.unidentifiedEpisode = true;
          setStatus('Playback changed without an episode update. Select the episode below to reconnect your progress.', true);
        } else {
          waitForStream('Connecting to the video source…');
        }
        session.tracking.sample = null;
        session.sourceRevision = (session.sourceRevision || 0) + 1;
        session.segmentRequest = null;
        session.segments = [];
        playback.skippedTo = undefined;
        playback.position = null;
        playback.duration = null;
        playback.lastUpdate = 0;
        playback.seekStarted = null;
        playback.restoreVolume = true;
        break;
      case 'cinesrc:response':
        if (data.command === 'getPaused' && typeof data.result === 'boolean') playback.paused = data.result;
        if (data.command === 'getDuration' && Number.isFinite(data.result) && data.result > 0) playback.duration = data.result;
        if (data.command === 'getCurrentTime' && performance.now() - playback.lastUpdate > 2200) {
          readPosition(data.result, playback.duration, performance.now() - (playback.seekStarted ?? -Infinity) < 1800);
        }
        break;
      case 'cinesrc:error':
        clearTimeout(timer);
        picture.hidden = true;
        if (playback.position) remember(playback.position, session, true);
        session.tracking.sample = null;
        playback.paused = true;
        setStatus('CineSrc could not play this source. Try another server in the player or retry.', true);
        break;
    }
  }, { signal: controller.signal });
  const poll = setInterval(() => {
    if (session.ended || performance.now() - playback.lastUpdate < 2200) return;
    playerCommand('getDuration');
    playerCommand('getPaused');
    playerCommand('getCurrentTime');
  }, 2500);
  controller.signal.addEventListener('abort', () => clearInterval(poll), { once: true });
  frame.src = cineSrcUrl(session);
  titlePage.querySelector('.video-box').replaceChildren(frame, picture);
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
  if (active) cancelCountdown(active);
  active?.embedPlayback?.stop();
  active?.videoController?.abort();
  const video = titlePage.querySelector('video');
  if (!video) return;
  video.pause();
  video.removeAttribute('src');
  video.load();
}

async function openTitle(item, watch = false, episodeKey, selection = null) {
  const opening = ++openingId;
  if ((watch || selection) && !accountReady) {
    await initialAccount;
    if (opening !== openingId) return;
  }
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
  session.tracking = viewingSession(progress[session.progressKey]);
  active = session;
  const sourcePage = source?.page || (source?.archive ? `https://archive.org/details/${encodeURIComponent(source.archive)}` : '');
  const watchSource = sourcePage ? `<div class="watch-source"><span>${escape(item.credit)}</span><a href="${escape(sourcePage)}" target="_blank" rel="noopener noreferrer">${escape(source.source || 'Internet Archive')} ${icon('external')}</a><a href="${escape(item.license[1])}" target="_blank" rel="noopener noreferrer">${escape(item.license[0])}</a></div>` : media?.embed ? '<div class="watch-source">CineSrc</div>' : '';
  const canPlay = resumed || isArchive(item) || (item.type === 'movie' && hasCineSrcTitle(item) && (!item.date || hasReleased(item)));
  const back = `<a class="plain-link title-back" href="${media ? `#${titlePath(item)}` : escape(browseHash)}">${icon('chevron-left')} ${media ? `Back to ${escape(item.title)}` : 'Back to browse'}</a>`;
  const primary = !media && (item.type === 'tv'
    ? '<button class="button primary" type="button" data-action="series-start" disabled>Start watching</button>'
    : canPlay ? `<button class="button primary" type="button" data-action="${resumed && pref('resume') ? 'resume' : 'watch'}" data-key="${escape(item.key)}">${icon('play')} ${resumed && pref('resume') ? 'Resume' : 'Watch now'}</button>` : '');
  const about = `<p class="title-about"${item.description ? '' : ' hidden'}>${escape(item.description)}</p>`;
  titlePage.classList.toggle('is-playing', Boolean(media));
  titlePage.hidden = false;
  main.hidden = true;
  const countdown = episode && !media.embed ? '<div class="next-countdown" role="region" aria-label="Next episode" hidden><p class="next-title"></p><p>Next episode in <span class="countdown-time">10</span> seconds</p><div class="watch-actions"><button class="button primary" type="button" data-action="next-episode">Play now</button><button class="button secondary" type="button" data-action="cancel-countdown">Cancel</button></div></div>' : '';
  titlePage.innerHTML = `${media
    ? `<header class="watch-heading">${back}<h1 id="title-heading" tabindex="-1">${escape(episode?.title || item.title)}</h1>${episode ? `<p class="title-context">${escape([item.title, episodeLabel(episode)].filter(Boolean).join(' · '))}</p>` : ''}</header><div class="watch-stage"><div class="video-box"></div>${countdown}${playbackBar(session)}</div>`
    : `<section class="title-record">${back}<div class="record-copy">${item.poster ? `<img class="record-poster" src="${escape(item.poster)}" alt="">` : ''}<div class="record-information"><h1 id="title-heading" tabindex="-1">${escape(item.title)}</h1><div class="meta title-facts">${titleFacts(session)}</div><p class="title-byline" hidden></p>${about}<div class="watch-actions title-actions">${primary}${saveButton(item)}${item.type === 'movie' ? watchedButton(item) : ''}</div>${item.type === 'tv' ? '<p class="series-tracking" aria-live="polite"></p>' : ''}${ratingControl(item)}</div>${item.backdrop ? `<div class="record-still"><img src="${escape(item.backdrop)}" alt="" fetchpriority="high"></div>` : ''}</div></section>`}
    <div class="watch-body">
      ${media?.embed ? '<div class="inline-notice embed-notice" hidden><span role="status"></span><button type="button" class="plain-link" data-action="retry-video" hidden>Retry</button></div>' : ''}
      ${media && !episode ? `<div class="title-overview">${about}${ratingControl(item)}</div>` : ''}
      ${item.type === 'tv' && !item.archiveId ? `<section class="title-episodes episode-list" tabindex="-1" aria-label="Episodes">${episodesMarkup(session)}</section>` : ''}
      ${!media ? '<section class="cast-section" hidden></section><section class="related-section" hidden></section>' : ''}
      ${watchSource}
    </div>`;

  renderNavigation();
  window.scrollTo(0, 0);
  titlePage.querySelector('#title-heading').focus({ preventScroll: true });
  if (media?.embed) startCineSrc(session);
  else if (media) startVideo(session);
  loadTitle(session);
  if (!media) loadRelated(session);
}

async function loadRelated(session) {
  if (!hasCineSrcTitle(session.item)) return;
  try {
    const { results } = await api(`/api/${session.item.type}/${session.item.id}/related`);
    if (active !== session || !results.length) return;
    const section = titlePage.querySelector('.related-section');
    const related = results.map(localizeTitle).filter(item => item.key !== session.item.key).slice(0, 6);
    if (!section || !related.length) return;
    section.hidden = false;
    section.innerHTML = `<h2>${session.item.type === 'tv' ? 'Related series' : 'Related films'}</h2>${grid(related)}`;
    syncCardRatings(section);
  } catch { /* Recommendations are optional. */ }
}

function formatReleaseDate(released) {
  if (!released || !/^\d{4}-\d{2}-\d{2}$/.test(released)) return '';
  const date = new Date(released);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

function titleFacts(session) {
  const { item, details } = session;
  const released = details?.release_date || details?.first_air_date || item.date;
  const date = formatReleaseDate(released) || item.year;
  const duration = details?.runtime || item.duration;
  const genres = details?.genres?.slice(0, 3).map(genre => genre.name).join(' · ') || meta(item)[1];
  const seasons = details?.number_of_seasons ? `${details.number_of_seasons} ${details.number_of_seasons === 1 ? 'season' : 'seasons'}` : '';
  const facts = item.type === 'tv' ? [date, seasons, seriesStatus(details?.status), genres] : [date, duration ? `${duration} min` : '', genres];
  return `${facts.filter(Boolean).map(value => `<span>${escape(value)}</span>`).join('')}${ratingBadge(item)}${imdbVotes(item)}`;
}

function titleByline(details) {
  const directors = [...new Set((details?.credits?.crew || []).filter(person => person.job === 'Director').map(person => person.name))];
  const creators = (details?.created_by || []).map(person => person.name);
  if (directors.length) return `Directed by ${directors.join(', ')}`;
  if (creators.length) return `Created by ${creators.join(', ')}`;
  return '';
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

function applyFilterForm(form, name, type) {
  if (!form.isConnected || !form.reportValidity()) return;
  const focused = document.activeElement;
  const data = new URLSearchParams(new FormData(form));
  data.set('sort', state.facets.sort);
  const facets = catalogFilters(data);
  if (facets.from && facets.to && facets.from > facets.to) {
    showToast('The starting year must come before the ending year.');
    return;
  }
  state.collection = '';
  applyFacets(Object.fromEntries(Object.entries(facets).map(([key, value]) => [key, value ? String(value) : ''])));
  if (name && type !== 'number' && focused?.form === form && focused.name === name) {
    main.querySelector(`#catalog-filters [name="${CSS.escape(name)}"]${type === 'radio' ? ':checked' : ''}`)?.focus({ preventScroll: true });
  }
}

function toggleSaved(item) {
  const previous = saved[item.key] ?? null;
  if (previous && pref('confirmRemoval') && !confirm('Remove this title from your watchlist?')) return;
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
  if (user) {
    const pendingKey = `pendingPlayback.${user.id}`;
    const pending = read(pendingKey, {});
    const retry = [];
    for (const [recordKey, entry] of Object.entries(pending)) {
      const separator = recordKey.indexOf('/');
      const kind = recordKey.slice(0, separator);
      const key = recordKey.slice(separator + 1);
      const records = kind === 'progress' ? progress : kind === 'watched' ? watched : null;
      if (records && entry?.at >= (records[key]?.updated || 0)) retry.push([kind, key, entry.value]);
      else delete pending[recordKey];
    }
    write(pendingKey, pending);
    for (const [kind, key, value] of retry) libraryChange(kind, key, value);
  }
  syncPreferences();
  accountButton.innerHTML = `${user ? `<span class="account-initial" aria-hidden="true">${escape(user.username[0].toUpperCase())}</span>` : icon('user')}<span class="account-name">${user ? escape(user.username) : 'Sign in'}</span>`;
  accountButton.setAttribute('aria-label', user ? `Account for ${user.username}` : 'Sign in');
  if (accountDialog.open) accountBody.innerHTML = accountMarkup();
  renderLibraryControls();
  if (!active && state.page === 'home') render();
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
  for (const [name, value] of Object.entries(state.facets)) {
    if (value && value !== defaults[name]) params.set(name === 'category' ? 'genre' : name, value);
  }
  if (state.collection) params.set('collection', state.collection);
  const base = state.page === 'search' ? `search=${encodeURIComponent(state.query)}` : state.page;
  browseHash = `#${base}${params.size ? `?${params}` : ''}`;
  history.replaceState(null, '', browseHash);
}

function updateRegion() {
  region.value = state.region;
  if (state.page === 'search' && !state.connected) render();
}

function openSettings() {
  syncPreferences();
  connectionStatus.textContent = state.connected ? 'Connected' : 'Not connected';
  connectionStatus.dataset.connected = state.connected;
  document.querySelector('#connection-details').open = !state.connected;
  settingsDialog.showModal();
}

document.addEventListener('click', event => {
  const control = event.target.closest('[data-action]');
  if (!control) return;
  const { action, key, value } = control.dataset;
  const item = titles.get(key);
  if (action === 'settings') openSettings();
  if (action === 'clear-search') {
    search.value = '';
    searchClear.hidden = true;
    search.focus();
    submitSearch();
  }
  if (action === 'focus-search') search.focus();
  if (action === 'suggestion' && item) {
    clearTimeout(searchTimer);
    suggestionRequest?.abort();
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
  if (action === 'series-start' && active) startSeries(active);
  if (['watch', 'resume'].includes(action) && item) {
    const recent = action === 'resume' ? resumeFor(item) : null;
    if (recent?.[0] === cineSrcKey(item, recent?.[1].episode) || (!isArchive(item) && item.type === 'movie')) {
      watchCineSrc(item, recent?.[1].episode);
    }
    else if (isArchive(item)) navigateTitle(item, `/watch${recent?.[0].includes('/') ? `/${recent[0].split('/')[1]}` : ''}`);
    else navigateTitle(item);
  }
  if (action === 'episode' && active) navigateTitle(active.item, `/watch/${key}`);
  if (action === 'stream-episode' && active) watchCineSrc(active.item, episodeFromControl(control));
  if (action === 'save' && item) toggleSaved(item);
  if (action === 'mark-watched' && item) {
    const watchedKey = control.dataset.watchedKey;
    const marked = !Object.hasOwn(watched, watchedKey);
    if (!marked && pref('confirmRemoval') && !confirm('Mark this as unwatched?')) return;
    recordWatched(item, watchedKey, marked);
    showToast(marked ? 'Marked as watched' : 'Marked as unwatched');
  }
  if (action === 'clear-rating' && active) {
    if (pref('confirmRemoval') && !confirm('Remove your rating?')) return;
    libraryChange('ratings', active.item.key, null);
    renderLibraryControls();
  }
  if (action === 'select-season' && active) {
    const picker = control.closest('.season-picker');
    picker.open = false;
    picker.querySelector('summary').focus({ preventScroll: true });
    loadSeason(active, Number(value));
  }
  if (action === 'retry-season' && active) loadSeason(active, active.season);
  if (action === 'reveal-episode' && active) {
    const row = control.closest('[data-episode-key]');
    const key = row.dataset.episodeKey;
    active.revealed ||= new Map();
    if (!active.revealed.has(key)) active.revealed.set(key, new Set());
    active.revealed.get(key).add(value);
    control.parentElement.classList.remove('is-spoiler');
    control.remove();
    row.querySelector('.episode-play').focus({ preventScroll: true });
  }
  if (action === 'facet') {
    const { name } = control.dataset;
    state.collection = '';
    applyFacets({ ...state.facets, [name]: value });
    main.querySelector(`#catalog-filters [name="${CSS.escape(name)}"]`)?.focus({ preventScroll: true });
  }
  if (action === 'reset-facets') {
    applyFacets({ ...defaults, sort: state.facets.sort });
    main.querySelector('#catalog-filters [name="category"]:checked')?.focus({ preventScroll: true });
  }
  if (action === 'filter') {
    state.filter = value;
    if (value === 'free' && state.facets.sort === 'top') state.facets.sort = 'popular';
    if (value === 'free') Object.assign(state.facets, { runtime: '', imdb: '' });
    rememberBrowseFilters();
    refreshCatalog();
    main.querySelector(`[data-value="${CSS.escape(value)}"]`)?.focus({ preventScroll: true });
  }
  if (action === 'rail' && control.getAttribute('aria-disabled') !== 'true') {
    const rail = control.closest('.shelf').querySelector('.poster-rail');
    rail.scrollBy({ left: Number(value) * rail.clientWidth * .8, behavior: pref('reducedMotion') || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  if (action === 'refresh') refreshCatalog();
  if (action === 'retry-archive' && !state.archiveLoading) loadArchive(requestId, state.archiveNext || 1);
  if (action === 'more-archive' && !state.archiveLoading && state.archiveNext) loadArchive(requestId, state.archiveNext);
  if (action === 'more-tmdb' && !state.loading && state.remoteNext) loadTMDB(requestId, state.remoteNext);
  if (['retry-video', 'direct-video'].includes(action) && active?.media) {
    stopVideo();
    if (active.media.embed) startCineSrc(active);
    else startVideo(active, action === 'direct-video');
  }
  if (action === 'skip-segment' && active?.media) {
    const position = playbackPosition(active);
    const segment = active.segments.find(entry => entry.end === Number(control.dataset.end));
    if (segment && Number.isFinite(position?.duration)) skipSegment(active, segment);
  }
  if (action === 'next-episode' && active) playEpisodeChoice(active, active.nextEpisode);
  if (action === 'previous-episode' && active) playEpisodeChoice(active, active.previousEpisode);
  if (action === 'cancel-countdown' && active) {
    active.countdownCancelled = true;
    cancelCountdown(active);
    titlePage.querySelector('.transport [data-action="next-episode"]')?.focus({ preventScroll: true });
  }
});

main.addEventListener('submit', event => {
  if (event.target.id !== 'catalog-filters') return;
  event.preventDefault();
  clearTimeout(filterTimer);
  applyFilterForm(event.target);
});
main.addEventListener('toggle', event => {
  if (!event.target.matches('.catalog-disclosure, .search-filters') || !event.target.isConnected) return;
  state.filtersOpen = event.target.open;
  const form = main.querySelector('#catalog-filters');
  if (form) form.dataset.mobileOpen = String(state.filtersOpen);
}, true);
main.addEventListener('input', event => {
  if (!event.target.matches('#catalog-filters [name="imdb"]')) return;
  event.target.nextElementSibling.value = Number(event.target.value) ? `≥ ${Number(event.target.value).toFixed(1)}` : 'Any';
});
main.addEventListener('change', event => {
  const { target } = event;
  if (target.dataset.sort === 'library') {
    state.librarySort = target.value;
    render();
    main.querySelector('[data-sort="library"]')?.focus({ preventScroll: true });
    return;
  }
  if (target.dataset.sort === 'catalog') {
    applyFacets({ ...state.facets, sort: target.value });
    main.querySelector('[data-sort="catalog"]')?.focus({ preventScroll: true });
    return;
  }
  if (target.form?.id !== 'catalog-filters') return;
  clearTimeout(filterTimer);
  const { form, name, type } = target;
  if (type === 'range') filterTimer = setTimeout(() => applyFilterForm(form, name, type), 200);
  else applyFilterForm(form, name, type);
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
  if (event.target.matches('[name="personal-rating"]') && active) {
    libraryChange('ratings', active.item.key, { score: Number(event.target.value), item: libraryTitle(active.item) });
    renderLibraryControls();
  }
});
titlePage.addEventListener('toggle', event => {
  if (!active || !event.target.matches('[data-spoiler-description]') || !event.target.isConnected) return;
  const key = event.target.closest('[data-episode-key]').dataset.episodeKey;
  active.revealed ||= new Map();
  if (!active.revealed.has(key)) active.revealed.set(key, new Set());
  if (event.target.open) active.revealed.get(key).add('description');
  else active.revealed.get(key).delete('description');
}, true);
titlePage.addEventListener('keydown', event => {
  const picker = event.target.closest('.season-picker');
  if (!picker || !['Escape', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'Escape') {
    picker.open = false;
    picker.querySelector('summary').focus();
    return;
  }
  picker.open = true;
  const choices = [...picker.querySelectorAll('button')];
  const current = choices.indexOf(event.target);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
    : current < 0 ? choices.findIndex(button => button.getAttribute('aria-pressed') === 'true')
    : (current + (event.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length;
  choices[Math.max(0, next)]?.focus();
});
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || !active?.media || document.querySelector('dialog[open]') || event.altKey || event.ctrlKey || event.metaKey || event.target.closest('button, a, input, select, summary, iframe, [contenteditable]')) return;
  const key = event.key.toLowerCase();
  if (key === 's') {
    const control = titlePage.querySelector('[data-action="skip-segment"]:not([hidden])');
    if (control) { event.preventDefault(); control.click(); }
    return;
  }
  if (key === 'f' && document.fullscreenEnabled) { event.preventDefault(); toggleFullscreen(); return; }
  const position = playbackPosition(active);
  if (!Number.isFinite(position?.duration)) return;
  if (key === ' ') { event.preventDefault(); playerCommand(position.paused ? 'play' : 'pause'); }
  if (key === 'arrowleft' || key === 'arrowright') {
    event.preventDefault();
    const time = position.currentTime + (key === 'arrowleft' ? -10 : 10);
    playerCommand('seek', Math.max(0, Math.min(position.duration, time)));
  }
});
document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  const target = main.hidden ? titlePage.querySelector('#title-heading') : main;
  target?.focus();
  target?.scrollIntoView();
});
accountDialog.addEventListener('submit', async event => {
  if (event.target.id !== 'account-form') return;
  event.preventDefault();
  const button = event.target.querySelector('button[type="submit"]');
  const status = event.target.querySelector('.form-status');
  button.disabled = true;
  status.textContent = accountMode === 'create' ? 'Creating your account…' : 'Signing in…';
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
settingsDialog.addEventListener('change', event => {
  if (event.target.id === 'preferred-quality') {
    libraryChange('preferences', 'quality', event.target.value);
    return;
  }
  const name = event.target.dataset.preference;
  if (!name || !Object.hasOwn(preferenceDefaults, name)) return;
  libraryChange('preferences', name, event.target.checked);
  syncPreferences();
  if (name === 'autoplay' && active?.ended && !active.media.embed) {
    if (pref('autoplay')) startCountdown(active);
    else cancelCountdown(active);
  }
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
  suggestionRequest?.abort();
  suggestionResults = [];
  renderSuggestions();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(fetchSuggestions, 260);
});
search.addEventListener('focus', () => {
  suggestionsDismissed = false;
  renderSuggestions();
});
search.addEventListener('blur', () => {
  document.querySelector('#search-status').textContent = '';
  hideSuggestions();
});
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
syncPreferences();
window.addEventListener('hashchange', route);
window.addEventListener('pagehide', savePlayback);
api('/api/status').then(({ connected }) => {
  state.connected = connected;
  if (connected) refreshCatalog();
}).catch(() => { /* The local archive catalog works while the connection is unavailable. */ });
accountButton.disabled = true;
const initialAccount = api('/api/account').then(({ account: user, library }) => {
  setAccount(user, library);
}).catch(() => {
  accountReady = true;
}).finally(() => { accountButton.disabled = false; });
route();
