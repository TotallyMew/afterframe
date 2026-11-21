import { archiveCatalog, archiveFileUrl } from './catalog.js';
import { categories, browseGenres, sortOptions, matchesCatalog, runtimeRanges, catalogFilters, isAnime } from './discover.js';
import { preferenceDefaults, viewingSession, mergeRanges, samplePlayback, completionReached, watchedSeconds, activeSkipSegment, bufferedIntervals } from './playback.js';
import { findSubtitles, loadSubtitle, playbackLanguage, samePlaybackLanguage } from './subtitles.js';
import { ratingOnTen, titleProgress, watchStatus, watchStatuses } from './library.js';
import { createDiscoveryPages } from './discovery-pages.js';
import { comicCover, comicFormat, comicRoute, comicsHash, createComics, readerHash } from './comics.js';

const icons = {
  home: '<path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 21v-7h6v7"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4m-4 6h4m10-6h4m-4 6h4"/>',
  book: '<path d="M12 6C9 4 6 4 3 5v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v14"/>',
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
  'player-pause': '<path d="M9 5v14m6-14v14" stroke-width="2.8"/>',
  replay: '<path d="M3 11a9 9 0 1 1 3.4 7M3 5v6h6"/>',
  back10: '<path d="M3 10a9 9 0 1 1 4 9M3 4v6h6"/><path d="m8 12 2-1v5m4-5c-2 0-2 5 0 5s2-5 0-5"/>',
  forward10: '<path d="M21 10a9 9 0 1 0-4 9m4-15v6h-6"/><path d="m8 12 2-1v5m4-5c-2 0-2 5 0 5s2-5 0-5"/>',
  'player-speaker': '<path d="M3.5 9.5h4L12.5 5v14l-5-4.5h-4zM16 9a4.5 4.5 0 0 1 0 6m2.5-8.5a8 8 0 0 1 0 11"/>',
  'player-speaker-muted': '<path d="M3.5 9.5h4L12.5 5v14l-5-4.5h-4zM16 10l4 4m0-4-4 4"/>',
  'player-subtitle-icon': '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M7 11h4m2 0h4M7 14.5h6m2 0h2"/>',
  'player-tune': '<path d="M4 7h3m4 0h9M4 12h8m4 0h4M4 17h2m4 0h10"/><circle cx="9" cy="7" r="2"/><circle cx="14" cy="12" r="2"/><circle cx="8" cy="17" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  external: '<path d="M13 4h7v7m0-7-9 9m8 0v7H4V5h7"/>',
  user: '<circle cx="12" cy="8" r="3.2"/><path d="M5 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2"/>',
  star: '<path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2-5.7-3-5.7 3 1.1-6.2-4.5-4.4 6.3-.9z"/>',
  folder: '<path d="M3 6h7l2 2h9v12H3z"/>',
  fullscreen: '<path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"/>',
  'exit-fullscreen': '<path d="M4 8h4V4m12 4h-4V4M8 20v-4H4m12 4v-4h4"/>',
  'chevron-left': '<path d="m15 6-6 6 6 6"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  'previous-episode': '<path d="M5 5v14m14-14-11 7 11 7z"/>',
  'next-episode': '<path d="M19 5v14M5 5l11 7-11 7z"/>',
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
const settingsTabs = [...settingsDialog.querySelectorAll('[role="tab"]')];
const creditsDialog = document.querySelector('#credits-dialog');
const accountDialog = document.querySelector('#account-dialog');
const accountButton = document.querySelector('#account-button');
const accountBody = document.querySelector('#account-body');
const connectionForms = [...settingsDialog.querySelectorAll('[data-provider]')];
const toast = document.querySelector('#toast');
const titles = new Map(archiveCatalog.map(item => [item.key, item]));
const navLinks = [['home', 'Home', 'home'], ['movies', 'Movies', 'film'], ['tv', 'TV Shows', 'tv'], ['anime', 'Anime', 'tv'], ['comics', 'Comics', 'book'], ['new', 'New Releases', 'clock'], ['recommendations', 'Recommendations', 'star'], ['watchlist', 'My Library', 'bookmark']];
const discoveryPath = /^(?:anime|recommendations)$/;
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const countries = 'AE AR AT AU BE BG BR CA CH CL CO CZ DE DK EE ES FI FR GB GR HK HR HU ID IE IL IN IS IT JP KR LT LU LV MX MY NL NO NZ PE PH PL PT RO RS SE SG SI SK TH TR TW UA US ZA'.split(' ');
let saved;
let progress;
let reading;
let ratings;
let watched;
let watchHistory;
let notifications;
let preferences;
let account = null;
let accountMode = 'signin';
let accountReady = false;
let libraryQueue = Promise.resolve();
let libraryRevision = 0;
let syncingLibrary = false;
const catalogCache = new Map();
const detailsCache = new Map();
const seasonCache = new Map();
const imdbScores = new Map();
const checkedRatings = new Set();
const ratingBatches = new WeakSet();
const cardFacts = new Map();
const defaults = { category: '', decade: '', sort: 'popular', from: '', to: '', imdb: '', runtime: '' };
const libraryTabs = [['watchlist', 'Watchlist'], ['watched', 'Watched'], ['history', 'History'], ['ratings', 'My ratings'], ['reading', 'Reading'], ['notifications', 'Notifications']];
const libraryPages = libraryTabs.map(([page]) => page);
const cineSrcOrigin = 'https://cinesrc.st';
const animePlayers = {
  animeembed: { label: 'AnimeEmbed', origin: 'https://animeembed.com', next: 'anipm' },
  anipm: { label: 'Ani.pm', origin: 'https://ani.pm', next: 'cinesrc' },
  cinesrc: { label: 'CineSrc', origin: cineSrcOrigin, next: 'animeembed' },
};

function libraryTitle(item) {
  if (item.type === 'comic') {
    const { key, id, title, year, type, format, poster } = item;
    return { key, id, title, year, type, format, poster };
  }
  const { key, id, archiveId, title, year, date, type, poster, backdrop, genre, genreIds, categories, originalLanguage, totalEpisodes } = item;
  return { key, id, archiveId, title, year, date, type, poster, backdrop, genre, genreIds, categories, originalLanguage, totalEpisodes };
}

function useLibrary(library = null) {
  saved = Object.assign(Object.create(null), library?.saved || read('saved', {}));
  progress = Object.assign(Object.create(null), library?.progress || read('progress', {}));
  reading = Object.assign(Object.create(null), library ? library.reading : read('reading', {}));
  ratings = Object.assign(Object.create(null), Object.fromEntries(Object.entries(library ? library.ratings || {} : read('ratings', {})).map(([key, entry]) => [key, ratingOnTen(entry)])));
  watched = Object.assign(Object.create(null), library ? library.watched : read('watched', {}));
  preferences = Object.assign(Object.create(null), library ? library.preferences : read('preferences', {}));
  watchHistory = Object.assign(Object.create(null), library ? library.history : read('history', {}));
  notifications = Object.assign(Object.create(null), library?.notifications);
  const tracked = [progress, reading, ratings, watched, watchHistory].flatMap(records => Object.values(records).map(entry => entry.item));
  for (const item of [...Object.values(saved), ...tracked]) {
    if (item?.key && !titles.has(item.key)) titles.set(item.key, item);
  }
}
useLibrary();
const defaultRegion = navigator.language.match(/-([A-Z]{2})\b/)?.[1];
const savedRegion = read('region', defaultRegion);
const state = {
  page: 'home', query: '', filter: 'all', connected: false, omdbConnected: false,
  featuredKey: null, homeTrending: 'all',
  region: countries.includes(savedRegion) ? savedRegion : 'LT', remote: [], loading: false, error: '',
  remoteNext: null,
  collections: {}, total: null, filtersOpen: false, librarySort: 'recent', libraryFilters: {}, historyPage: 1,
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
  for (const field of settingsDialog.querySelectorAll('[data-language-preference]')) {
    for (const option of field.querySelectorAll('[data-custom]')) option.remove();
    const language = field.dataset.languagePreference === 'subtitleLanguage'
      ? preferences.subtitleLanguage ?? (preferences.captions ? 'English' : '') : preferences.audioLanguage || '';
    if (language && ![...field.options].some(option => option.value === language)) {
      const option = new Option(language, language);
      option.dataset.custom = '';
      field.add(option);
    }
    field.value = language;
  }
  if (active?.seasonData) renderEpisodeRows(active);
}

function libraryChange(kind, key, value, at = Date.now()) {
  libraryRevision++;
  const records = { saved, progress, reading, ratings, watched, preferences, history: watchHistory }[kind];
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
  const queued = ['progress', 'reading', 'watched', 'history'].includes(kind) ? { value, at } : null;
  if (queued) write(pendingKey, { ...read(pendingKey, {}), [recordKey]: queued });
  libraryQueue = libraryQueue.then(async () => {
    if (account?.id !== accountId) return;
    try {
      await post('/api/account/library', { accountId, kind, key, value, at }, true);
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
  if (item.catalog_facts) {
    const itemKey = key;
    cardFacts.set(itemKey, item.catalog_facts);
    imdbScores.set(itemKey, item.catalog_facts.rating);
    checkedRatings.add(itemKey);
  }
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
  if (item.type === 'comic') return [comicFormat(item), item.year].filter(Boolean);
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
  if (item.type === 'comic') return `comic/${item.id}`;
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
  const poster = item.type === 'comic' ? comicCover(item.poster, 256) : item.poster;
  return `<span class="poster-placeholder">${icon(item.type === 'comic' ? 'book' : item.type === 'tv' ? 'tv' : 'film')}</span>${poster ? `<img src="${escape(poster)}" alt="" loading="lazy">` : ''}`;
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

function titleCard(item, resume = false, showDate = false) {
  if (item.type === 'comic') {
    const entry = resume && reading[item.key];
    return `<article class="poster-tile"><a href="${escape(entry ? readerHash(item, entry) : `#${titlePath(item)}`)}" class="poster-card comic-card" data-key="${escape(item.key)}">
      <span class="poster-art">${thumbnail(item)}<span class="card-play" aria-hidden="true">${icon('book')}</span></span>
      <span class="poster-title">${escape(item.title)}</span><span class="poster-meta">${(entry ? [entry.label, `Page ${entry.page}`] : meta(item)).map(escape).join(' · ')}</span>
    </a>${entry ? '' : saveButton(item, true)}</article>`;
  }
  const entry = resume ? resumeFor(item)?.[1] : null;
  const percent = entry ? Math.round(entry.time / entry.duration * 100) : 0;
  const score = ratings[item.key]?.score;
  const left = entry ? `${Math.ceil((entry.duration - entry.time) / 60)} min left` : '';
  const episode = entry?.episode || (entry && item.episodes?.find(candidate => progress[`${item.key}/${candidate.key}`] === entry));
  const context = entry ? [episodeLabel(episode), left].filter(Boolean) : meta(item).slice(0, 2);
  if (!entry && item.date && (showDate || state.page === 'new' || item.type === 'tv' && state.page === 'tv')) context[0] = formatReleaseDate(item.date) || item.year;
  const url = `#${titlePath(item)}`;
  const tag = entry ? 'button' : 'a';
  return `<article class="poster-tile"><${tag} ${entry ? `type="button" aria-label="Resume ${escape(item.title)}${episode ? `, ${escape(episode.title)}` : ''}"` : `href="${url}"`} class="poster-card${entry ? ' resume-card' : ''}" data-action="${entry ? 'resume' : 'details'}" data-key="${escape(item.key)}" title="${escape(item.title)}">
    <span class="poster-art">${thumbnail(item, Boolean(entry))}<span class="card-play" aria-hidden="true">${icon('play')}</span>${entry ? `<span class="progress-line" role="progressbar" aria-label="Watch progress" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><i style="width:${percent}%"></i></span>` : ''}</span>
    <span class="poster-title">${escape(item.title)}</span><span class="poster-meta">${context.map(escape).join(' · ')}</span>
    <span class="card-facts">${cardDetails(item)}</span><span class="card-ratings"><span class="imdb-rating" data-rating-for="${escape(item.key)}">${ratingBadge(item)}</span>${score ? `<span class="personal-badge" aria-label="Your rating ${score} out of 10">You ${score}/10</span>` : ''}</span>
  </${tag}>${entry ? '' : saveButton(item, true)}${state.page === 'watchlist' ? watchStatusControl(item) : ''}</article>`;
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
      const omdbConnected = state.omdbConnected;
      try {
        const { facts } = await api(`/api/catalog/facts?titles=${encodeURIComponent(keys)}`);
        if (omdbConnected !== state.omdbConnected) continue;
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

function railControls(title) {
  return `<div class="rail-controls" hidden><button class="icon-button" type="button" data-action="rail" data-value="-1" aria-label="Scroll ${title} left">${icon('chevron-left')}</button><button class="icon-button" type="button" data-action="rail" data-value="1" aria-label="Scroll ${title} right">${icon('chevron-right')}</button></div>`;
}

function shelf(title, items, link, resume = false, showDate = false) {
  if (!items.length) return '';
  return `<section class="shelf" aria-label="${title}"><div class="section-head"><h2>${title}</h2><div class="shelf-actions">${link ? `<a class="section-link" href="#${link}">View all ${icon('chevron-right')}</a>` : ''}${railControls(title)}</div></div><div class="poster-rail${resume ? ' resume-rail' : ''}">${items.map(item => titleCard(item, resume, showDate)).join('')}</div></section>`;
}

function syncRail(rail) {
  const controls = rail.closest('.shelf')?.querySelector('.rail-controls');
  if (!controls) return;
  const remaining = rail.scrollWidth - rail.clientWidth;
  controls.hidden = remaining < 4;
  controls.firstElementChild.setAttribute('aria-disabled', String(rail.scrollLeft < 4));
  controls.lastElementChild.setAttribute('aria-disabled', String(rail.scrollLeft >= remaining - 4));
}

function observeRails(root = main) {
  railObserver ??= new ResizeObserver(entries => entries.forEach(({ target }) => syncRail(target)));
  for (const rail of root.querySelectorAll('.poster-rail')) {
    railObserver.observe(rail);
    rail.addEventListener('scroll', () => syncRail(rail), { passive: true });
  }
}

function footer() {
  return `<footer class="page-footer"><button data-action="credits">Sources &amp; credits</button></footer>`;
}

function saveButton(item, compact = false) {
  const isSaved = Object.hasOwn(saved, item.key);
  const label = item.type === 'comic' ? 'Reading list' : 'Watchlist';
  if (compact) return `<button type="button" class="card-save icon-button" data-action="save" data-key="${escape(item.key)}" aria-label="${isSaved ? 'Remove from' : 'Add to'} ${label}: ${escape(item.title)}" aria-pressed="${isSaved}">${icon(isSaved ? 'check' : 'plus')}</button>`;
  return `<button type="button" class="button secondary" data-action="save" data-key="${escape(item.key)}" aria-pressed="${isSaved}">${icon(isSaved ? 'check' : 'plus')} ${isSaved ? `In ${label}` : label}</button>`;
}

function ratingControl(item) {
  const score = ratings[item.key]?.score || 0;
  return `<div class="rating-control" data-rating-key="${escape(item.key)}"><label>Your rating <select name="personal-rating"><option value="">Choose 1–10</option>${Array.from({ length: 10 }, (_, index) => `<option${index + 1 === score ? ' selected' : ''}>${index + 1}</option>`).join('')}</select></label>${score ? ' <button type="button" class="plain-link" data-action="clear-rating">Clear rating</button>' : ''}</div>`;
}

function updateRating() {
  const current = titlePage.querySelector('.rating-control');
  if (!current || !active) return;
  const focused = document.activeElement;
  const restore = current.contains(focused);
  current.outerHTML = ratingControl(active.item);
  if (restore) titlePage.querySelector('[name="personal-rating"]')?.focus({ preventScroll: true });
}

function watchStatusControl(item) {
  const entry = saved[item.key];
  return `<label class="watch-status"${entry ? '' : ' hidden'}><span class="sr-only">Watch status for ${escape(item.title)}</span><select data-watch-key="${escape(item.key)}">${Object.entries(watchStatuses).map(([value, label]) => `<option value="${value}"${watchStatus(entry) === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>`;
}

function renderLibraryControls() {
  if (active) updateRating();
  for (const select of titlePage.querySelectorAll('[data-watch-key]')) {
    const entry = saved[select.dataset.watchKey];
    select.closest('label').hidden = !entry;
    select.value = watchStatus(entry);
  }
  for (const button of document.querySelectorAll('[data-action="save"]')) {
    const isSaved = Object.hasOwn(saved, button.dataset.key);
    button.setAttribute('aria-pressed', isSaved);
    const item = titles.get(button.dataset.key);
    const label = item?.type === 'comic' ? 'Reading list' : 'Watchlist';
    if (button.matches('.card-save') && item) {
      button.setAttribute('aria-label', `${isSaved ? 'Remove from' : 'Add to'} ${label}: ${item.title}`);
      button.innerHTML = icon(isSaved ? 'check' : 'plus');
    }
    else button.innerHTML = `${icon(isSaved ? 'check' : 'plus')} ${isSaved ? `In ${label}` : label}`;
  }
  for (const button of titlePage.querySelectorAll('[data-action="mark-watched"]')) {
    const marked = Object.hasOwn(watched, button.dataset.watchedKey);
    button.setAttribute('aria-pressed', marked);
    if (button.classList.contains('episode-status')) {
      button.title = marked ? 'Mark episode unwatched' : 'Mark episode watched';
    } else button.innerHTML = marked ? `${icon('check')} Watched` : 'Mark watched';
  }
  if (!active && libraryPages.includes(state.page)) render();
  if (active) updateSeriesTracking(active);
}

function featuredFilms() {
  const movies = [...state.remote, ...(state.collections.newMovies || [])].filter(item => item.type === 'movie' && item.backdrop && hasReleased(item));
  return [...new Map(movies.map(item => [item.key, item])).values()].slice(0, 3);
}

function hasReleased(item) {
  return Boolean(item.date && item.date <= new Date().toISOString().slice(0, 10));
}

function renderHero(item, choices) {
  if (!item) return state.loading
    ? '<div class="home-hero home-loading" role="status"><span class="sr-only">Loading featured titles</span></div>'
    : '<header class="view-heading home-welcome"><h1>Home</h1></header>';
  const resumed = pref('resume') && resumeFor(item);
  return `<section class="home-hero" aria-label="Featured film">
    <img class="home-hero-image" src="${escape(item.backdrop)}" alt="" fetchpriority="high">
    <div class="home-hero-copy"><p class="home-feature-label">Featured film</p>
      <h1>${escape(item.title)}</h1>
      <div class="meta">${meta(item).map(value => `<span>${escape(value)}</span>`).join('')}<span class="imdb-rating" data-rating-for="${escape(item.key)}">${ratingBadge(item)}</span></div>
      ${item.description ? `<p class="home-hero-summary">${escape(item.description)}</p>` : ''}
      <div class="hero-actions"><button type="button" class="button primary" data-action="${resumed ? 'resume' : 'watch'}" data-key="${escape(item.key)}">${icon('play')} ${resumed ? 'Resume' : 'Watch now'}</button><button type="button" class="button secondary" data-action="details" data-key="${escape(item.key)}">Details</button>${saveButton(item)}</div>
    </div>
    ${choices.length > 1 ? `<div class="home-feature-choices" role="group" aria-label="Choose a featured film">${choices.map(choice => `<button type="button" class="home-feature-choice" data-action="home-feature" data-key="${escape(choice.key)}" aria-pressed="${choice.key === item.key}" aria-label="Feature ${escape(choice.title)}" title="${escape(choice.title)}"><img src="${escape(choice.poster || choice.backdrop)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
  </section>`;
}

function renderHomeTrending(items) {
  if (!items.length) return '';
  const title = 'Trending this week';
  const activeFilter = state.homeTrending;
  const filtered = activeFilter === 'all' ? items : items.filter(item => item.type === activeFilter);
  return `<section class="shelf home-trending" aria-label="${title}"><div class="section-head"><h2>${title}</h2><div class="shelf-actions"><div class="home-trending-filters" role="group" aria-label="Filter trending titles">${[['all', 'All'], ['movie', 'Movies'], ['tv', 'TV Shows']].map(([value, label]) => `<button class="home-trending-filter" type="button" data-action="home-trending" data-value="${value}" aria-pressed="${value === activeFilter}">${label}</button>`).join('')}</div>${railControls(title)}</div></div>${filtered.length
    ? `<div class="poster-rail" aria-label="Trending titles">${filtered.slice(0, 12).map(item => titleCard(item)).join('')}</div>`
    : '<p class="catalog-status" role="status">No trending titles for this filter.</p>'}</section>`;
}

function releaseIndex(movies, shows) {
  if (!movies.length && !shows.length) return '';
  return shelf('New movies', movies.slice(0, 8), 'new', false, true) + shelf('New series', shows.slice(0, 8), 'new?type=tv', false, true);
}

function renderNavigation() {
  const scroll = navigation.scrollLeft;
  const current = active ? active.item.type === 'tv' ? 'tv' : 'movies' : libraryPages.includes(state.page) ? 'watchlist' : state.page;
  const unread = Object.values(notifications).filter(entry => !entry.read).length;
  navigation.innerHTML = navLinks.map(([page, label, glyph]) => `<a href="#${page}" class="nav-link" ${current === page ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}${page === 'watchlist' && unread ? ` <span class="nav-unread" aria-label="${unread} unread notifications">${unread}</span>` : ''}</span></a>`).join('');
  navigation.scrollLeft = scroll;
}

function renderLibraryTabs() {
  const unread = Object.values(notifications).filter(entry => !entry.read).length;
  return `<nav class="filters library-tabs" aria-label="Library">${libraryTabs.map(([page, label]) => `<a href="#${page}" class="filter"${state.page === page ? ' aria-current="page"' : ''}>${label}${page === 'notifications' && unread ? ` (${unread})` : ''}</a>`).join('')}</nav>`;
}

function renderHistory() {
  const entries = Object.entries(watchHistory).sort(([, a], [, b]) => b.updated - a.updated);
  const repeated = new Set();
  const rewatches = new Set();
  for (const [id, entry] of [...entries].reverse()) {
    if (repeated.has(entry.mediaKey)) rewatches.add(id);
    if (entry.completed) repeated.add(entry.mediaKey);
  }
  const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const rows = entries.slice(0, 30 * state.historyPage).map(([id, entry]) => {
    const percent = Math.floor(entry.coverage / entry.duration * 100);
    return `<li><a href="#${titlePath(entry.item)}">${escape(entry.item.title)}</a>${entry.episode ? `<span>${escape([episodeLabel(entry.episode), entry.episode.title].filter(Boolean).join(' · '))}</span>` : ''}<small>${escape(formatter.format(entry.updated))} · ${percent}% watched · Last position ${timeCode(entry.time)}${entry.completed ? ' · Completed' : ''}${rewatches.has(id) ? ' · Rewatch' : ''}</small></li>`;
  });
  return rows.length ? `<ul class="activity-list">${rows.join('')}</ul>${entries.length > rows.length ? '<button class="button secondary" data-action="more-history">Show more</button>' : ''}` : '<p class="catalog-status">Your playback sessions will appear here after you start watching.</p>';
}

function renderNotifications() {
  if (!account) return '<p class="catalog-status">Sign in to receive release notifications for your watchlist.</p>';
  const rows = Object.entries(notifications).sort(([, a], [, b]) => b.created - a.created).map(([key, entry]) =>
    `<li><a href="#tv/${entry.seriesId}">${escape(entry.title)}</a><span>${escape(entry.message.replace(/ \(TMDb\)/gi, ''))}${entry.source ? ` · <a href="${escape(entry.source)}" target="_blank" rel="noopener noreferrer">Announcement source</a>` : ''}</span>${entry.read ? '' : `<button class="plain-link" data-action="notification-read" data-key="${escape(key)}">Mark as read</button>`}</li>`);
  return rows.length ? `<ul class="activity-list">${rows.join('')}</ul>` : '<p class="catalog-status">New releases for followed series will appear here.</p>';
}

function watchlistFilters(items) {
  const { query, status, genre, rating, progress: coverage, after, before } = state.libraryFilters;
  const genres = Object.keys(categories).filter(name => items.some(item => item.genre === name || item.genreIds?.some(id => categories[name].includes(id))));
  const options = (choices, selected, emptyLabel) => `<option value="">${emptyLabel}</option>${choices.map(([value, label]) => `<option value="${escape(value)}"${value === selected ? ' selected' : ''}>${escape(label)}</option>`).join('')}`;
  return `<form id="watchlist-filters" class="library-filters"><label>Title <input name="query" value="${escape(query || '')}" type="search" maxlength="180"></label><label>Status <select name="status">${options(Object.entries(watchStatuses), status, 'All statuses')}</select></label><label>Genre <select name="genre">${options(genres.map(name => [name, name]), genre, 'All genres')}</select></label><label>Personal rating <select name="rating">${options(Array.from({ length: 10 }, (_, i) => [String(i + 1), `${i + 1}+`]), rating, 'Any rating')}</select></label><label>Progress <select name="progress">${options([['unstarted', 'Unstarted'], ['started', 'Started'], ['complete', 'Complete']], coverage, 'Any progress')}</select></label><details${after || before ? ' open' : ''}><summary>Date added</summary><label>From <input type="date" name="after" value="${escape(after || '')}"></label><label>Through <input type="date" name="before" value="${escape(before || '')}"></label></details><button class="button secondary" type="submit">Apply</button></form>`;
}

function watchlistProgress(item) {
  const entry = saved[item.key];
  return watchStatus(entry) === 'completed' ? 100 : titleProgress({ ...item, totalEpisodes: item.totalEpisodes || entry?.totalEpisodes || item.episodes?.length }, progress, watched);
}

function filters(options) {
  return `<div class="filters" aria-label="Filter titles">${options.map(([value, label]) => `<button type="button" class="filter" data-action="filter" data-value="${escape(value)}" aria-pressed="${value === state.filter}">${escape(label)}</button>`).join('')}</div>`;
}

function catalogToolbar(search = false) {
  const { category, decade, from, to, imdb, runtime } = state.facets;
  const advanced = ['movies', 'tv', 'new'].includes(state.page) && state.connected;
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
  const options = libraryPage ? { recent: 'Recently added', title: 'Title A–Z', rating: 'Your rating', ...(state.page === 'watchlist' ? { progress: 'Watch progress', status: 'Watch status', genre: 'Genre' } : {}) } : sortOptions;
  if (!libraryPage && (state.page === 'search' || state.page === 'new')) return '';
  const current = libraryPage ? state.librarySort : state.facets.sort;
  return `<label class="sort-control"><span>Sort by</span><select aria-label="Sort titles" data-sort="${libraryPage ? 'library' : 'catalog'}">${Object.entries(options).map(([key, label]) => `<option value="${key}"${key === current ? ' selected' : ''}>${label}</option>`).join('')}</select></label>`;
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
  if (state.facets.sort === 'newest') return filtered.sort((a, b) => (b.date || b.year || '').localeCompare(a.date || a.year || ''));
  if (state.facets.sort === 'oldest') return filtered.sort((a, b) => (a.date || a.year || '9999').localeCompare(b.date || b.year || '9999'));
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
  return `<div class="inline-notice"><span>Connect the catalog to browse releases and regional availability.</span><div><button type="button" class="plain-link" data-action="settings" data-value="integrations">Catalog settings ${icon('arrow')}</button>${external ? `<br>${external}` : ''}</div></div>`;
}

function remoteNotice() {
  if (state.loading) return '<div class="inline-notice" role="status">Loading titles…</div>';
  if (!state.error) return '';
  return `<div class="inline-notice" role="status"><span>${escape(state.error)}</span><button type="button" class="plain-link" data-action="refresh">Retry ${icon('arrow')}</button></div>`;
}

function titleIdentity(item) {
  const title = item.title.toLowerCase().replace(/\s*\(\d{4}\)\s*$/, '').replace(/[^\p{L}\p{N}]/gu, '');
  return `${item.type}:${title}:${item.year || ''}`;
}

function render() {
  if (active || main.hidden || state.page === 'comics') return;
  railObserver?.disconnect();
  main.classList.toggle('home', state.page === 'home');
  renderSuggestions();
  if (state.page === 'home') {
    const recentlyWatched = [...titles.values()].map(item => [item, resumeFor(item)?.[1]])
      .filter(([, entry]) => entry).sort((a, b) => b[1].updated - a[1].updated).slice(0, 8).map(([item]) => item);
    const recentHistory = [...new Map(Object.values(watchHistory).sort((a, b) => a.updated - b.updated)
      .map(entry => [entry.item.key, entry])).values()].sort((a, b) => b.updated - a.updated)
      .slice(0, 8).map(({ item }) => titles.get(item.key) || item);
    const scrollPositions = new Map([...main.querySelectorAll('.poster-rail')].map(rail => [rail.parentElement.getAttribute('aria-label'), rail.scrollLeft]));
    const focused = document.activeElement;
    const focusKey = focused.matches('.poster-card') ? focused.dataset.key : '';
    const focusShelf = focused.closest('.shelf')?.getAttribute('aria-label');
    const homeControl = focused.matches('[data-action="home-feature"], [data-action="home-trending"]') ? focused.dataset : null;
    const choices = featuredFilms();
    const featured = choices.find(item => item.key === state.featuredKey) || choices[0];
    const trending = state.remote.filter(item => item.key !== featured?.key && hasReleased(item));
    main.innerHTML = renderHero(featured, choices)
      + `<div class="home-shelves">${shelf('Continue watching', pref('resume') ? recentlyWatched : [], '', true)}
        ${shelf('Recently watched', recentHistory, 'history')}
        ${shelf('Continue reading', recentlyRead().slice(0, 8), 'reading', true)}
        ${state.connected ? remoteNotice() : connectionNotice()}
        ${renderHomeTrending(trending)}
        ${releaseIndex(state.collections.newMovies || [], state.collections.newTV || [])}
        ${shelf('Anime', (state.collections.anime || []).slice(0, 8), 'anime')}
        <section class="editorial-section library-entry"><h2>My Library</h2><nav aria-label="Library">${libraryTabs.map(([page, label]) => `<a class="section-link" href="#${page}">${label} ${icon('arrow')}</a>`).join('')}</nav></section>
        ${footer()}</div>`;
    for (const rail of main.querySelectorAll('.poster-rail')) rail.scrollLeft = scrollPositions.get(rail.parentElement.getAttribute('aria-label')) || 0;
    if (focusKey && focusShelf) main.querySelector(`.shelf[aria-label="${CSS.escape(focusShelf)}"] [data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    if (homeControl) main.querySelector(`[data-action="${homeControl.action}"][data-${homeControl.key ? 'key' : 'value'}="${CSS.escape(homeControl.key || homeControl.value)}"]`)?.focus({ preventScroll: true });
    observeRails();
    syncCardRatings();
    return;
  }

  if (state.page === 'reading') {
    const books = Object.values(saved).filter(item => item.type === 'comic').reverse();
    main.innerHTML = `<header class="view-heading"><h1>My Library</h1></header>${renderLibraryTabs()}
      ${shelf('Continue reading', recentlyRead(), '', true)}
      <section class="shelf" aria-label="Reading list"><div class="section-head"><h2>Reading list</h2><a class="section-link" href="#comics">Browse comics ${icon('arrow')}</a></div>
      ${books.length ? grid(books) : '<p class="catalog-status">Save a comic to add it to your reading list.</p>'}</section>${footer()}`;
    observeRails();
    return;
  }
  if (['history', 'notifications'].includes(state.page)) {
    main.innerHTML = `<header class="view-heading"><h1>My Library</h1></header>${renderLibraryTabs()}<section class="shelf"><h2>${state.page === 'history' ? 'Watch history' : 'Notifications'}</h2>${state.page === 'history' ? renderHistory() : renderNotifications()}</section>${footer()}`;
    return;
  }

  let heading;
  let subtitle = '';
  let items = [];
  let choices = '';
  let notice = '';
  let libraryFilterMarkup = '';
  if (state.page === 'watchlist') {
    heading = 'Watchlist';
    items = Object.values(saved).filter(item => item.type !== 'comic').map(item => titles.get(item.key) || item).reverse();
    libraryFilterMarkup = watchlistFilters(items);
    const { query, status, genre, rating, progress: coverage, after, before } = state.libraryFilters;
    const from = after ? Date.parse(`${after}T00:00`) : -Infinity;
    const to = before ? new Date(`${before}T23:59:59.999`).getTime() : Infinity;
    items = items.filter(item => (!query || item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
      && (!status || watchStatus(saved[item.key]) === status)
      && (!genre || item.genre === genre || item.genreIds?.some(id => categories[genre]?.includes(id)))
      && (!rating || ratings[item.key]?.score >= Number(rating))
      && (!(after || before) || (saved[item.key].added >= from && saved[item.key].added <= to))
      && (!coverage || (coverage === 'complete' ? watchlistProgress(item) === 100 : coverage === 'started' ? watchlistProgress(item) > 0 && watchlistProgress(item) < 100 : watchlistProgress(item) === 0)));
    if (state.librarySort === 'recent') items.sort((a, b) => (saved[b.key].added || 0) - (saved[a.key].added || 0));
    if (state.librarySort === 'progress') items.sort((a, b) => watchlistProgress(b) - watchlistProgress(a));
    if (state.librarySort === 'status') items.sort((a, b) => Object.keys(watchStatuses).indexOf(watchStatus(saved[a.key])) - Object.keys(watchStatuses).indexOf(watchStatus(saved[b.key])));
    if (state.librarySort === 'genre') items.sort((a, b) => (meta(a)[1] || '').localeCompare(meta(b)[1] || ''));
  } else if (state.page === 'ratings') {
    heading = 'My ratings';
    items = Object.values(ratings).map(entry => titles.get(entry.item.key) || entry.item).reverse();
  } else if (state.page === 'watched') {
    heading = 'Watched';
    const completed = [...Object.values(watched), ...Object.values(saved).filter(entry => watchStatus(entry) === 'completed').map(item => ({ item, updated: item.completedAt || 0 }))].sort((a, b) => b.updated - a.updated);
    items = [...new Map(completed.map(entry => [entry.item.key, titles.get(entry.item.key) || entry.item])).values()];
  } else if (state.page === 'search') {
    heading = `Results for “${state.query}”`;
    choices = `<div class="search-media">${filters([['all', 'All'], ['movie', 'Movies'], ['tv', 'TV Shows']])}<a class="filter" href="${escape(comicsHash(state.query))}">Search comics ${icon('arrow')}</a></div>`;
    items = state.remote;
    notice = state.connected ? remoteNotice() : connectionNotice(state.query);
    items = items.filter(item => state.filter === 'all' || item.type === state.filter);
  } else if (state.page === 'new') {
    heading = 'New Releases';
    subtitle = 'Movies and series that premiered in the last 60 days.';
    choices = filters([['movie', 'Movies'], ['tv', 'TV Shows']]);
    items = state.remote;
    notice = state.connected ? remoteNotice() : connectionNotice();
  } else {
    const type = state.page === 'tv' ? 'tv' : 'movie';
    heading = state.collection === 'gems' ? 'Hidden gems' : type === 'tv' ? 'TV Shows' : 'Movies';
    items = state.remote;
    notice = state.connected ? remoteNotice() : connectionNotice();
  }
  if (state.remoteNext && !state.loading) notice += '<div class="load-more"><button type="button" class="button secondary" data-action="more-tmdb">Load more titles</button></div>';
  const libraryPage = libraryPages.includes(state.page);
  if (libraryPage) {
    heading = 'My Library';
    choices = renderLibraryTabs();
    if (state.filter !== 'all') items = items.filter(item => item.type === state.filter);
    if (state.librarySort === 'title') items.sort((a, b) => a.title.localeCompare(b.title));
    if (state.librarySort === 'rating') items.sort((a, b) => (ratings[b.key]?.score || 0) - (ratings[a.key]?.score || 0));
  }
  if (!libraryPage) items = filterResults(items);
  const loading = state.loading;
  let content = items.length ? grid(items) : loading
    ? `<div class="poster-grid skeleton-grid" aria-hidden="true">${'<div></div>'.repeat(7)}</div>` : '';
  if (!items.length && !state.loading && !state.error) {
    content = libraryPage
      ? empty(state.filter !== 'all' ? 'No matching titles' : { ratings: 'No ratings yet', watchlist: 'Your watchlist is empty', watched: 'No watched titles yet' }[state.page], { ratings: 'Rate a film or series to add it here.', watchlist: 'Save a film or series to find it here.', watched: 'Finish a film or episode, or mark it watched from its detail page.' }[state.page], '<a class="button primary" href="#movies">Browse movies</a>')
      : empty('No matching titles', state.facets.imdb && state.remoteNext ? 'Load more titles to check the next page for matching IMDb ratings.' : 'Try a different title or filter.');
  }
  const counted = !state.facets.imdb && !libraryPage && state.total !== null ? state.total : items.length;
  const resultCount = `<p class="results-count" role="status">${counted.toLocaleString()} ${counted === 1 ? 'title' : 'titles'}${state.facets.imdb ? ' matched so far' : ''}</p>`;
  const searchFilters = state.page === 'search' && (counted >= 8 || state.facets.category || state.facets.decade || state.facets.from || state.facets.to);
  const results = `${libraryFilterMarkup}<div class="catalog-header">${resultCount}${searchFilters ? catalogToolbar(true) : sortControl(libraryPage)}</div>${libraryPage ? '' : appliedFilters()}${content}${notice}`;
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

function recentlyRead() {
  return Object.values(reading).sort((a, b) => b.updated - a.updated).map(entry => titles.get(entry.item.key) || entry.item);
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
      cacheCatalog();
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

function refreshCatalog() {
  const id = ++requestId;
  catalogRequest?.abort();
  catalogRequest = new AbortController();
  if (discoveryPath.test(state.page)) {
    const { signal } = catalogRequest;
    const page = state.page;
    main.classList.remove('home');
    if (page === 'recommendations' && !accountReady) initialAccount.then(() => { if (!signal.aborted) discoveryPages.load(page, state.discoveryQuery, signal); });
    else discoveryPages.load(page, state.discoveryQuery, signal);
    return;
  }
  const cached = catalogCache.get(catalogCacheKey());
  Object.assign(state, { remote: cached?.remote || [], remoteNext: null, total: null, error: '', loading: false });
  render();
  if (state.connected && ['home', 'search', 'movies', 'tv', 'new'].includes(state.page)) loadTMDB(id, 1);
  if (state.connected && state.page === 'home') loadHome(id, catalogRequest.signal);
}

function showPage(page, params = new URLSearchParams()) {
  state.page = page;
  state.discoveryQuery = params.toString();
  const selection = params.get('type');
  const filtersByPage = page === 'new' || libraryPages.includes(page) || page === 'search' ? ['movie', 'tv'] : [];
  state.filter = filtersByPage.includes(selection) ? selection : page === 'new' ? 'movie' : 'all';
  state.collection = page === 'movies' && params.get('collection') === 'gems' ? 'gems' : '';
  params.set('category', params.get('genre') || '');
  if (page === 'new' && !params.has('sort')) params.set('sort', 'newest');
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
  if (libraryPages.includes(page)) syncLibrary();
}

function route() {
  if (settingsDialog.open) settingsDialog.close();
  clearTimeout(searchTimer);
  const hash = location.hash.slice(1);
  const [path, query] = hash.split('?');
  const comic = path.match(comicRoute);
  comics.close();
  if (path === 'comics' || comic) {
    closeTitlePage();
    catalogRequest?.abort();
    railObserver?.disconnect();
    suggestionRequest?.abort();
    suggestionResults = [];
    state.page = 'comics';
    const params = new URLSearchParams(query);
    state.query = comic ? '' : params.get('q')?.trim().slice(0, 180) || '';
    search.value = state.query;
    search.setAttribute('placeholder', 'Search comics');
    search.setAttribute('aria-label', 'Search comics');
    searchClear.hidden = !search.value;
    hideSuggestions();
    renderNavigation();
    window.scrollTo(0, 0);
    if (comic) {
      main.hidden = true;
      titlePage.hidden = false;
      titlePage.innerHTML = '<div class="title-status" role="status">Loading comic…</div>';
      const back = browseHash.startsWith('#comics') || browseHash === '#reading' ? browseHash : '#comics';
      const load = () => { if (location.hash === `#${hash}`) comics.show(comic[1], comic[2], params, back); };
      if (comic[2] && !accountReady) initialAccount.then(load);
      else load();
    } else {
      browseHash = location.hash;
      comics.browse(params);
    }
    return;
  }
  search.setAttribute('placeholder', 'Search titles');
  search.setAttribute('aria-label', 'Search movies and TV shows');
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
  const pages = [...libraryPages, ...navLinks.map(([name]) => name)];
  showPage(pages.includes(page) || discoveryPath.test(page) ? page : 'home', new URLSearchParams(params));
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
  const itemKey = key || `${type}-${id}`;
  const path = location.hash;
  let episode;
  if (mode?.startsWith('s') && type === 'tv') {
    episode = episodeChoice?.path === path ? episodeChoice.episode : { season: Number(season), number: Number(number), title: `Episode ${number}` };
  }
  if (active?.episode && active.item.key === itemKey) {
    const choice = episode || (mode === 'watch' && active.item.episodes?.find(entry => entry.key === editionEpisode));
    if (choice) {
      switchWatchedEpisode(active, choice);
      return;
    }
  }
  const opening = ++openingId;
  stopVideo();
  active = null;
  main.hidden = true;
  titlePage.hidden = false;
  titlePage.className = 'title-page';
  titlePage.innerHTML = `<div class="title-status" role="status">Loading title…</div>`;
  let item = titles.get(itemKey);
  try {
    if (type && (!item || (!item.originalLanguage && !isArchive(item)))) {
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
    if (episode) {
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
  if (state.page === 'comics') {
    const params = new URLSearchParams(location.hash.split('?')[1]);
    const browse = location.hash.startsWith('#comics');
    const target = comicsHash(value, browse ? params.get('type') : '', 1, browse ? {
      genre: params.get('genre'), status: params.get('status'), sort: params.get('sort'),
    } : {});
    if (location.hash !== target) location.hash = target;
    else route();
    return;
  }
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
  const comicSearch = state.page === 'comics';
  const current = comicSearch ? suggestionResults.filter(item => item.type === 'comic')
    : state.query.toLowerCase() === query ? state.remote : suggestionResults.filter(item => item.type !== 'comic');
  if (comicSearch) for (const item of current.slice(0, 6)) matches.set(item.key, item);
  for (const item of comicSearch ? current : [...current, ...Object.values(saved).filter(item => item.type !== 'comic' && !isArchive(item))]) {
    if (matches.size === 6) break;
    if (item.title.toLowerCase().includes(query) && !matches.has(item.key)) matches.set(item.key, item);
  }
  if (!matches.size) return hideSuggestions();
  suggestions.innerHTML = [...matches.values()].map((item, index) => {
    const poster = item.type === 'comic' ? comicCover(item.poster, 256) : item.poster;
    return `<div class="search-option" id="suggestion-${index}" role="option" aria-selected="false" data-action="suggestion" data-key="${escape(item.key)}">${poster ? `<img src="${escape(poster)}" alt="">` : icon(item.type === 'comic' ? 'book' : item.type === 'tv' ? 'tv' : 'film')}<span class="option-title">${escape(item.title)}</span><small>${escape(item.year || '')}</small></div>`;
  }).join('');
  suggestions.hidden = false;
  search.setAttribute('aria-expanded', 'true');
  selectSuggestion(suggestionIndex < matches.size ? suggestionIndex : -1);
}

async function fetchSuggestions() {
  const query = search.value.trim();
  const comicSearch = state.page === 'comics';
  if (suggestionsDismissed || document.activeElement !== search || query.length < (comicSearch ? 3 : 2) || (!comicSearch && !state.connected)) return;
  const status = document.querySelector('#search-status');
  const controller = new AbortController();
  suggestionRequest = controller;
  status.textContent = 'Searching titles…';
  try {
    const params = new URLSearchParams({ q: query });
    if (comicSearch && location.hash.startsWith('#comics')) {
      const activeFilters = new URLSearchParams(location.hash.split('?')[1]);
      for (const name of ['type', 'genre', 'status', 'sort']) if (activeFilters.has(name)) params.set(name, activeFilters.get(name));
    }
    const data = await api(`/api/${comicSearch ? 'comics' : 'search'}?${params}`, { signal: controller.signal });
    if (controller.signal.aborted || search.value.trim() !== query) return;
    suggestionResults = comicSearch ? data.results : data.results.map(localizeTitle);
    if (comicSearch) comics.rememberTitles(suggestionResults);
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

function episodeLabel(episode, includeRuntime = true) {
  if (!episode) return '';
  const number = episode.number ?? episode.episode_number;
  const season = episode.season ?? episode.season_number;
  const label = Number.isInteger(number) ? Number.isInteger(season) ? `S${season} E${number}` : `Episode ${number}` : '';
  const duration = episode.duration || episode.runtime;
  return [label, includeRuntime && duration ? `${duration} min` : ''].filter(Boolean).join(' · ');
}

function validEpisode(episode) {
  return Number.isSafeInteger(episode?.season) && episode.season >= 0
    && Number.isSafeInteger(episode.number) && episode.number > 0;
}

function updateWatchHeading(session) {
  const heading = titlePage.querySelector('#title-heading');
  if (!heading || !session.episode) return;
  heading.textContent = session.episode.title;
  const pausedTitle = titlePage.querySelector('.player-pause-title');
  const context = titlePage.querySelector('.player-pause-description');
  const watchTitle = titlePage.querySelector('.player-context-title');
  const watchEpisode = titlePage.querySelector('.player-context-episode');
  const episodeContext = [session.item.title, episodeLabel(session.episode)].filter(Boolean).join(' · ');
  if (pausedTitle) pausedTitle.textContent = session.episode.title;
  if (context) context.textContent = episodeContext;
  if (watchTitle) watchTitle.textContent = session.episode.title;
  if (watchEpisode) watchEpisode.textContent = episodeContext;
}

function watchedButton(item, key = item.key, episode = null) {
  const marked = Object.hasOwn(watched, key);
  const label = marked ? 'Mark episode unwatched' : 'Mark episode watched';
  const data = `data-action="mark-watched" data-key="${escape(item.key)}" data-watched-key="${escape(key)}" aria-pressed="${marked}"`;
  if (episode) return `<button class="icon-button episode-status" type="button" ${data} aria-label="Watched: ${escape(episode.title)}" title="${label}"><span class="episode-check" aria-hidden="true">${icon('check')}</span></button>`;
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
  startCountdown(session);
}

function resumePlayback(session) {
  if (!session.ended) return;
  session.ended = false;
  session.inCredits = false;
  session.countdownCancelled = false;
  session.tracking.sample = null;
  if (session.completed) {
    session.completed = false;
    session.tracking = viewingSession();
  }
  session.history = null;
  cancelCountdown(session);
}

function checkCompletion(session, position, ended = false) {
  if (session.completed || session.embedPlayback?.unidentifiedEpisode || session.accountId !== account?.id) return;
  const credits = session.segments.filter(segment => segment.kind === 'credits');
  if (!completionReached(session.tracking.ranges, position, credits, ended, session.tracking.skipped)) return;
  session.completed = true;
  rememberHistory(position, session, true, true);
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
  if (!episode || active !== session || (!episode.key && !validEpisode(episode))) return;
  cancelCountdown(session);
  if (session.episode) {
    const suffix = episode.key ? `/watch/${episode.key}` : `/s${episode.season}e${episode.number}`;
    const hash = `#${titlePath(session.item)}${suffix}`;
    if (location.hash !== hash) history.pushState(null, '', hash);
    switchWatchedEpisode(session, episode);
    return;
  }
  if (episode.key) navigateTitle(session.item, `/watch/${episode.key}`);
  else watchCineSrc(session.item, episode);
}

function switchWatchedEpisode(previous, episode) {
  const { item } = previous;
  const progressKey = episode.key ? `${item.key}/${episode.key}` : cineSrcKey(item, episode);
  if (progressKey === previous.progressKey) return;
  // The stage owns fullscreen, so only replace its playback contents.
  const stage = titlePage.querySelector('.watch-stage');
  const restoreFocus = stage.contains(document.activeElement);
  stopVideo();
  const media = episode.key ? episode.media : { embed: true, episode, progressKey };
  const session = {
    item, episode, media, progressKey, accountId: account?.id,
    details: previous.details, revealed: previous.revealed, animeEligible: previous.animeEligible,
    animeProvider: previous.animeProvider, providerControls: previous.providerControls,
    preferredQuality: previous.preferredQuality, autoSkipped: new Set(), segments: media.segments || [],
    tracking: viewingSession(progress[progressKey]),
  };
  active = session;
  updateWatchHeading(session);
  if (media.embed) startCatalogPlayback(session);
  else {
    const source = titlePage.querySelector('.watch-source a');
    if (source) source.href = media.page || `https://archive.org/details/${encodeURIComponent(media.archive)}`;
    startVideo(session);
  }
  if (restoreFocus) (stage.querySelector('[data-player="play"]') || stage.querySelector('iframe'))?.focus({ preventScroll: true });
  loadTitle(session);
}

function startCountdown(session) {
  if (active !== session || session.providerControls || (!session.inCredits && !session.ended)
    || !session.nextEpisode || !pref('autoplay') || session.countdown || session.countdownCancelled) return;
  const overlay = titlePage.querySelector('.next-countdown');
  if (!overlay) return;
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

const episodeRangeSize = 15;

function preferredEpisode(session) {
  if (session.episode) return session.episode;
  const resume = pref('resume') ? resumeFor(session.item) : null;
  return resume?.[1].episode || session.item.episodes?.find(entry => `${session.item.key}/${entry.key}` === resume?.[0]);
}

function updateEpisodeRanges(session) {
  const picker = titlePage.querySelector('.episode-range');
  const entries = session.seasonData;
  const episode = preferredEpisode(session);
  const current = episode ? entries.findIndex(entry => episode.key
    ? entry.key === episode.key
    : entry.season_number === episode.season && entry.episode_number === episode.number) : -1;
  session.episodeRange = Math.max(0, Math.floor(current / episodeRangeSize));
  const count = Math.ceil(entries.length / episodeRangeSize);
  const numberAt = index => entries[index].episode_number ?? entries[index].number ?? index + 1;
  picker.replaceChildren(...Array.from({ length: count }, (_, range) => {
    const start = range * episodeRangeSize;
    const end = Math.min(start + episodeRangeSize, entries.length) - 1;
    return new Option(`Episodes ${numberAt(start)}${start === end ? '' : `–${numberAt(end)}`}`, range);
  }));
  picker.value = String(session.episodeRange);
  picker.hidden = count <= 1;
}

function episodesMarkup(session) {
  const { item, details } = session;
  const seasons = (details?.seasons || []).filter(season => season.season_number >= 0 && season.episode_count > 0);
  if (!item.episodes?.length && !seasons.length) return details ? '<p class="catalog-status">No seasons are listed.</p>' : '<p class="catalog-status" role="status">Loading episodes…</p>';
  const preferredSeason = preferredEpisode(session)?.season;
  const selected = session.season ?? seasons.find(season => season.season_number === preferredSeason)?.season_number ?? regularSeasons(session)[0]?.season_number ?? seasons[0]?.season_number;
  const name = seasons.find(season => season.season_number === selected)?.name || `Season ${selected}`;
  const seasonPicker = item.episodes?.length ? '' : `<details class="season-picker"><summary aria-label="Select season"><span>${escape(name)}</span>${icon('chevron-down')}</summary><div class="season-menu" role="group" aria-label="Seasons">${seasons.map(season => `<button type="button" data-action="select-season" data-value="${season.season_number}" aria-pressed="${season.season_number === selected}">${escape(season.name)}</button>`).join('')}</div></details>`;
  return `<div class="episode-header"><div><h2 id="episode-heading">Episodes</h2><p class="season-progress"></p></div><div class="episode-filters">${seasonPicker}<select class="episode-range" aria-label="Episode range" aria-controls="season-episodes" hidden></select></div></div><div class="episode-list" id="season-episodes" aria-live="polite"></div>`;
}

function episodeAction(coordinates) {
  return coordinates.key ? `data-action="episode" data-key="${escape(coordinates.key)}"`
    : `data-action="stream-episode" data-season="${coordinates.season}" data-number="${coordinates.number}" data-episode-title="${escape(coordinates.title)}"`;
}

function episodeProgressMarkup(entry) {
  if (!(entry?.time > 5) || entry.time >= entry.duration) return '';
  const seconds = watchedSeconds(Array.isArray(entry.ranges) ? entry.ranges : [], entry.duration);
  const percent = Math.min(100, Math.floor(seconds / entry.duration * 100));
  const label = pref('resume') ? 'Resume at' : 'Last position';
  return `<span class="episode-resume">${label} <strong>${timeCode(entry.time)}</strong></span>${percent > 0
    ? `<progress value="${percent}" max="100" aria-label="${percent}% of the episode played"></progress><span class="episode-coverage">${percent}% played</span>` : ''}`;
}

function refreshEpisodeProgress(key) {
  const row = titlePage.querySelector(`.episode-row[data-episode-key="${CSS.escape(key)}"]`);
  if (!row || watched[key]) return;
  row.querySelector('.episode-progress').innerHTML = episodeProgressMarkup(progress[key]);
  const button = row.querySelector('.episode-play');
  button.setAttribute('aria-label', `${pref('resume') ? 'Resume' : 'Play'} ${row.dataset.episodeTitle}`);
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
  const protectImage = image && !marked && pref('blur');
  const blurred = protectImage && !reveals?.has('image');
  const thumbnail = image ? `<img src="${image}" alt="" loading="lazy">` : icon('film');
  const description = entry.overview || '';
  const revealedDescription = reveals?.has('description');
  const hiddenDescription = description && !marked && pref('hideSynopsis');
  const resume = pref('resume') && progress[key]?.time > 5 && !marked;
  const available = archive || airedEpisode(entry);
  const airDate = available ? '' : formatReleaseDate(entry.air_date);
  return `<article class="episode-row${marked ? ' episode-watched' : ''}" data-episode-key="${escape(key)}" data-episode-title="${escape(coordinates.title)}"${selected ? ' aria-current="true"' : ''}>
    <span class="episode-number" aria-hidden="true">${coordinates.number || index + 1}</span>
    ${protectImage ? `<button class="episode-image episode-reveal${blurred ? ' is-spoiler' : ''}" type="button" data-action="reveal-episode" aria-label="Show thumbnail for ${escape(coordinates.title)}" aria-pressed="${!blurred}" title="${blurred ? 'Reveal' : 'Hide'} thumbnail">${thumbnail}<span class="episode-reveal-icon">${icon('eye')}</span></button>` : `<div class="episode-image">${thumbnail}</div>`}
    <div class="episode-info"><button class="episode-play" type="button" ${episodeAction(coordinates)} aria-label="${resume ? 'Resume' : 'Play'} ${escape(coordinates.title)}"${available ? '' : ' disabled'}>${escape(coordinates.title)}${selected ? ' <span class="episode-current">Selected</span>' : ''}</button><small>${episodeLabel(coordinates)}${airDate ? ` · Scheduled for ${escape(airDate)}` : available ? '' : ' · Not aired'}</small>
      ${description ? `<details class="episode-description"${hiddenDescription ? ' data-spoiler-description' : ''}${revealedDescription ? ' open' : ''}><summary><span class="episode-preview">${hiddenDescription ? 'Show description' : escape(description)}</span><span class="episode-expanded-label">Hide description</span></summary><p>${escape(description)}</p></details>` : ''}</div>
    <div class="episode-progress">${!marked ? episodeProgressMarkup(progress[key]) : ''}</div>
    ${watchedButton(item, key, coordinates)}
  </article>`;
}

function renderEpisodeRows(session) {
  const target = titlePage.querySelector('#season-episodes');
  if (!target || !session.seasonData) return;
  const entries = session.seasonData;
  const start = session.episodeRange * episodeRangeSize;
  target.innerHTML = entries.length ? entries.slice(start, start + episodeRangeSize).map((entry, index) => episodeRow(session, entry, start + index)).join('') : '<p class="catalog-status">No episodes are listed.</p>';
  const eligible = entries.filter(airedEpisode);
  const seen = eligible.filter(entry => watched[entry.key ? `${session.item.key}/${entry.key}` : cineSrcKey(session.item, episodeCoordinates(entry))]).length;
  const progressText = titlePage.querySelector('.season-progress');
  if (progressText) progressText.textContent = eligible.length
    ? `${seen} of ${eligible.length} aired episodes watched${seen === entries.length ? ' · Season complete' : ''}` : '';
}

function updateEpisodeNavigation(session) {
  const previous = titlePage.querySelector('.player-transport [data-action="previous-episode"]');
  const next = titlePage.querySelector('.player-transport [data-action="next-episode"]');
  if (previous) previous.hidden = !session.previousEpisode;
  if (next) next.hidden = !session.nextEpisode;
  startCountdown(session);
}

function updateSeriesTracking(session) {
  if (active !== session || session.item.type !== 'tv' || session.media) return;
  const text = titlePage.querySelector('.series-tracking');
  const primary = titlePage.querySelector('[data-action="series-start"]');
  if (!text || !primary) return;
  const label = primary.querySelector('span');
  const seasons = seriesSeasons(session);
  const total = session.item.episodes?.length || session.details?.number_of_episodes;
  const prefix = `${session.item.key}/`;
  const seen = Object.keys(watched).filter(key => key.startsWith(prefix) && !key.startsWith(`${prefix}cinesrc-s0e`)).length;
  const resume = pref('resume') ? resumeFor(session.item)?.[1] : null;
  const resumeEpisode = resume?.episode || (resume && session.item.episodes?.find(episode => progress[`${prefix}${episode.key}`] === resume));
  const baseText = [total ? `${seen} of ${total} episodes watched` : '', resume ? `Resume at ${timeCode(resume.time)}` : ''].filter(Boolean).join(' · ');
  const revision = (session.trackingRevision || 0) + 1;
  session.trackingRevision = revision;
  text.textContent = baseText;
  label.textContent = resume ? ['Resume', episodeLabel(resumeEpisode, false)].filter(Boolean).join(' ') : seen ? 'Play next unwatched' : 'Start watching';
  primary.disabled = !seasons.length;
  if (resume || !seasons.length) return;
  findSeriesEpisode(session).then(({ first, next }) => {
    if (active !== session || session.trackingRevision !== revision) return;
    if (next) label.textContent = ['Play', episodeLabel(next, false) || next.title].filter(Boolean).join(' ');
    else if (first) label.textContent = 'Watch again';
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
  if (index < 0) {
    session.episodeNavigationReady = true;
    return;
  }
  const convert = entry => entry && (entry.key ? entry : episodeCoordinates(entry));
  session.previousEpisode = convert(eligible[index - 1]);
  session.nextEpisode = convert(eligible[index + 1]);
  updateEpisodeNavigation(session);
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
  if (active === session && session.episode === current) {
    session.episodeNavigationReady = true;
    updateEpisodeNavigation(session);
  }
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
  titlePage.querySelector('.episode-range').hidden = true;
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
    updateEpisodeRanges(session);
    renderEpisodeRows(session);
    if (session.episode && (session.episode.key || session.episode.season === Number(number))) {
      const entry = session.seasonData.find(entry => session.episode.key ? entry.key === session.episode.key : entry.episode_number === session.episode.number);
      if (entry && !entry.key) Object.assign(session.episode, episodeCoordinates(entry));
      updateWatchHeading(session);
      resolveEpisodeNavigation(session, session.seasonData);
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
    session.item.totalEpisodes = details.number_of_episodes || session.item.episodes?.length;
    session.item.imdb ||= details.external_ids?.imdb_id || details.imdb_id;
    const facts = titlePage.querySelector('.title-facts');
    if (facts) facts.innerHTML = titleFacts(session);
    const schedule = titlePage.querySelector('.details-schedule');
    if (schedule) schedule.textContent = titleSchedule(details);
    const byline = titlePage.querySelector('.title-byline');
    if (byline) {
      byline.textContent = titleByline(details);
      byline.hidden = !byline.textContent;
    }
    const cast = titlePage.querySelector('.cast-section');
    if (cast && (details.credits?.cast?.length || details.credits?.crew?.length)) {
      cast.hidden = false;
      titlePage.querySelector('[data-value="details-cast"]').hidden = false;
      const crew = details.credits.crew?.filter(person => ['Director', 'Writer', 'Screenplay', 'Director of Photography', 'Original Music Composer', 'Editor'].includes(person.job)).slice(0, 10) || [];
      const castList = (details.credits.cast || []).slice(0, 8).map(person => {
        const portrait = imagePath(person.profile_path, 'w185');
        return `<div class="cast-person">${portrait ? `<img src="${portrait}" alt="" loading="lazy">` : `<span aria-hidden="true">${icon('user')}</span>`}<div><strong>${escape(person.name)}</strong>${person.character ? `<small>${escape(person.character)}</small>` : ''}</div></div>`;
      });
      if (castList.length || crew.length) cast.innerHTML = `<h2>Cast &amp; crew</h2>${castList.length ? `<div class="cast-list">${castList.join('')}</div>` : ''}${crew.length ? `<dl class="crew-list">${crew.map(person => `<div><dt>${escape(person.job)}</dt><dd>${escape(person.name)}</dd></div>`).join('')}</dl>` : ''}`;
      else {
        cast.hidden = true;
        titlePage.querySelector('[data-value="details-cast"]').hidden = true;
      }
    }
    refreshTitleRating(session);
    if (facts && session.item.id && isAnime(session.item.originalLanguage, session.item.genreIds)) {
      const season = session.episode?.season || regularSeasons(session)[0]?.season_number || 1;
      api(`/api/mal/catalog/${session.item.type}/${session.item.id}?season=${season}`).then(({ rating }) => {
        if (active !== session || !rating) return;
        session.malRating = rating;
        facts.innerHTML = titleFacts(session);
      }).catch(() => {});
    }
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
  const status = saved[session.item.key];
  const select = titlePage.querySelector('[data-watch-key]');
  if (select && session.item.type === 'tv' && watchStatus(status) === 'completed' && !status.completedAt) changeWatchStatus({ target: select });
}

function watchCineSrc(item, episode = null) {
  if (!hasCineSrcTitle(item) || (item.type === 'tv' && !validEpisode(episode))) return;
  const suffix = episode ? `/s${episode.season}e${episode.number}` : '/watch';
  episodeChoice = episode ? { path: `#${titlePath(item)}${suffix}`, episode } : null;
  navigateTitle(item, suffix);
}

function remember({ currentTime, duration }, session, force = false) {
  rememberHistory({ currentTime, duration }, session, force);
  if (session.completed || session.ended || session.embedPlayback?.unidentifiedEpisode || !Number.isFinite(duration) || !Number.isFinite(currentTime) || currentTime < 5 || currentTime >= duration || session.accountId !== account?.id) return;
  if (!session.tracking.ranges.some(([start, end]) => currentTime >= start && currentTime <= end + .5)) return;
  const now = Date.now();
  if (!force && now - (session.lastSaved || 0) < 8000) return;
  if (force && Math.abs((progress[session.progressKey]?.time ?? -1) - currentTime) < .5) return;
  const entry = { time: currentTime, duration, updated: now, item: libraryTitle(session.item), ranges: session.tracking.ranges.slice(-40), skipped: session.tracking.skipped.slice(-20) };
  if (session.embedPlayback?.provider) entry.provider = session.embedPlayback.provider;
  if (session.media.embed && session.episode) entry.episode = session.episode;
  session.lastSaved = now;
  libraryChange('progress', session.progressKey, entry);
  if (session.episode) refreshEpisodeProgress(session.progressKey);
}

const segmentNames = { intro: 'Intro', recap: 'Recap', credits: 'Credits' };

function rememberHistory(position, session, force = false, completed = false) {
  if (!session.history || session.accountId !== account?.id || session.embedPlayback?.unidentifiedEpisode) return;
  const { currentTime, duration } = position;
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) return;
  const { id, tracking, started } = session.history;
  const coverage = Math.min(duration, watchedSeconds(tracking.ranges, duration));
  const previous = watchHistory[id];
  const now = Date.now();
  if (coverage < Math.min(5, duration / 2) || (!completed && previous && (force ? coverage <= previous.coverage : now - previous.updated < 8000))) return;
  libraryChange('history', id, {
    item: libraryTitle(session.item), mediaKey: session.progressKey, episode: session.episode,
    started, updated: now, duration, time: Math.max(0, Math.min(duration, currentTime)), coverage, completed: completed || Boolean(previous?.completed),
  });
}

function playbackPosition(session) {
  return session.embedPlayback?.position || titlePage.querySelector('video');
}

function playerCommand(command, ...args) {
  if (active?.media?.embed) {
    const playback = active.embedPlayback;
    if (!playback) return;
    if (playback.provider) {
      if (command === 'seek' && Number.isFinite(args[0])) {
        active.tracking.sample = null;
        playback.send('seek', { time: args[0] });
      } else if (command === 'play' || command === 'pause') playback.send(command);
      return;
    }
    if (command === 'seek') {
      if (!Number.isFinite(args[0])) return;
      playback.relativeJump = undefined;
      playback.seekTarget = args[0];
      playback.seekStarted = performance.now();
      active.tracking.sample = null;
    }
    playback.frame.contentWindow?.postMessage({ type: 'cinesrc:command', command, args }, cineSrcOrigin);
    return;
  }
  const video = titlePage.querySelector('video');
  if (!video) return;
  if (command === 'seek' && Number.isFinite(video.duration)) video.currentTime = args[0];
  if (command === 'play') video.play().catch(() => {});
  if (command === 'pause') video.pause();
}

function pendingCineSeek(playback) {
  if (Number.isFinite(playback.seekTarget) && performance.now() - (playback.seekStarted ?? -Infinity) < 1800) return playback.seekTarget;
}

function jumpPlayback(delta) {
  const position = playbackPosition(active);
  if (!Number.isFinite(position?.duration)) return;
  const playback = active.embedPlayback;
  if (playback?.provider) {
    playerCommand('seek', Math.max(0, Math.min(position.duration, position.currentTime + delta)));
    return;
  }
  const target = playback && pendingCineSeek(playback);
  if (playback && target === undefined) {
    const waiting = playback.relativeJump !== undefined;
    playback.relativeJump = (playback.relativeJump ?? 0) + delta;
    if (!waiting) playerCommand('getCurrentTime');
    return;
  }
  playerCommand('seek', Math.max(0, Math.min(position.duration, (target ?? position.currentTime) + delta)));
}

function toggleFullscreen() {
  const stage = titlePage.querySelector('.watch-stage');
  const video = stage?.querySelector('video');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if (video?.webkitDisplayingFullscreen) video.webkitExitFullscreen();
  else if (document.fullscreenEnabled && stage) stage.requestFullscreen().catch(() => showToast('Fullscreen is unavailable.'));
  else video?.webkitEnterFullscreen?.();
}

function bindPictureGestures(picture, session, signal, revealControls) {
  let pendingClick;
  const clearClick = () => clearTimeout(pendingClick);
  signal.addEventListener('abort', clearClick, { once: true });
  picture.addEventListener('click', event => {
    clearClick();
    if (event.detail !== 1) return;
    const touch = event.pointerType === 'touch' || (!event.pointerType && matchMedia('(pointer: coarse)').matches);
    if (revealControls && touch && !picture.closest('.video-box').classList.contains('controls-active') && !playbackPosition(session)?.paused) {
      revealControls();
      return;
    }
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
  if (!session.ended && !session.embedPlayback?.unidentifiedEpisode) {
    session.history ??= { id: crypto.randomUUID(), started: Date.now(), tracking: viewingSession() };
    if (seek) session.history.tracking.sample = null;
    samplePlayback(session.history.tracking, position, performance.now());
  }
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
  if (session.providerControls) return;
  const button = titlePage.querySelector('[data-action="skip-segment"]');
  if (active !== session) return;
  const segment = activeSkipSegment(session.segments, video);
  if (segment?.kind === 'credits' && !video.paused && !video.seeking && !session.embedPlayback?.unidentifiedEpisode) {
    session.inCredits = true;
    startCountdown(session);
  }
  const firstCredit = session.segments.find(entry => entry.kind === 'credits');
  if (session.inCredits && (!firstCredit || video.currentTime < firstCredit.start) && !session.ended) {
    session.inCredits = false;
    cancelCountdown(session);
  }
  if (!button) return;
  const creditsWithNext = segment?.kind === 'credits' && (session.nextEpisode || (session.episode && !session.episodeNavigationReady));
  if (segment && !creditsWithNext && pref(segment.kind) && !video.paused && !video.seeking && !session.autoSkipped.has(segment)) {
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
}

function skipSegment(session, segment) {
  if (segment.kind === 'credits' && session.nextEpisode) {
    checkCompletion(session, playbackPosition(session));
    playEpisodeChoice(session, session.nextEpisode);
    return;
  }
  session.autoSkipped.add(segment);
  session.tracking.skipped = mergeRanges(session.tracking.skipped, segment.start, segment.end);
  session.tracking.sample = null;
  playerCommand('seek', segment.end);
}

async function loadSkipSegments(video, session) {
  const { item, episode } = session;
  if (!item.id || (item.type === 'tv' && (!Number.isInteger(episode?.season) || !Number.isInteger(episode?.number))) || !Number.isFinite(video.duration)) return;
  const params = new URLSearchParams({ id: item.id, type: item.type, duration: Math.round(video.duration * 1000) });
  if (session.media.embed) params.set('source', session.embedPlayback?.provider || 'cinesrc');
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
    session.segments = [...session.segments, ...segments.filter(segment => !supplied.has(segment.kind) && (!session.embedPlayback?.provider || segment.kind === 'credits'))
      .map(segment => ({ ...segment, end: Math.min(segment.end, position.duration) }))];
    if (!session.providerControls) updateSkip(position, session);
    if (session.embedPlayback?.skippedTo !== undefined) creditCineSkip(session, session.embedPlayback.skippedTo);
    session.renderSegments?.();
  } catch { /* Bundled timestamps remain usable. */ }
}

function playerButton(name, label, glyph, hidden = false) {
  return `<button class="player-button" type="button" data-player="${name}" aria-label="${label}" title="${label}"${hidden ? ' hidden' : ''}>${icon(glyph)}</button>`;
}

function playerChoices(name, title, options) {
  return `<div class="player-choice" role="group" aria-label="${title}">
    <p>${title}</p>
    <div class="player-choice-options">${options.map(([value, label]) => `<button type="button" data-player-option="${name}" value="${value}" aria-pressed="false">${label}</button>`).join('')}</div>
  </div>`;
}

function nextCountdownMarkup(episode) {
  return episode ? '<div class="next-countdown" role="region" aria-label="Next episode" hidden><p class="next-title"></p><p>Next episode in <span class="countdown-time">10</span> seconds</p><div class="watch-actions"><button class="button primary" type="button" data-action="next-episode">Play now</button><button class="button secondary" type="button" data-action="cancel-countdown">Cancel</button></div></div>' : '';
}

function videoOverlay(session) {
  const { item, episode } = session;
  const title = episode?.title || item.title;
  const description = episode ? [item.title, episodeLabel(episode)].filter(Boolean).join(' · ') : item.description;
  return `<div class="player-pause" aria-hidden="true">
    <div class="player-pause-copy">
      <p class="player-pause-status">Paused</p>
      <p class="player-pause-title">${escape(title)}</p>
      ${description ? `<p class="player-pause-description">${escape(description)}</p>` : ''}
      <p class="player-remaining"></p>
    </div>
  </div>
  <div class="player-header">
    <div class="player-identification">
      <a class="player-button player-back" href="#${titlePath(item)}" aria-label="Back to ${escape(item.title)}">${icon('chevron-left')}<span>Back to details</span></a>
      <div class="player-context" aria-hidden="true">
        <p class="player-context-title">${escape(title)}</p>
        ${episode ? `<p class="player-context-episode">${escape(description)}</p>` : ''}
      </div>
    </div>
  </div>
  ${session.media.embed ? '<div class="player-caption" aria-hidden="true" hidden><span></span></div>' : ''}
  <div class="player-lower">
    ${nextCountdownMarkup(episode)}
    <button class="player-skip" type="button" data-action="skip-segment" hidden></button>
    <div class="player-controls" role="group" aria-label="Playback controls">
      <div class="player-timeline">
        <div class="player-markers" aria-hidden="true"></div>
        <output class="player-seek-preview" aria-hidden="true" hidden><span class="player-preview-time"></span><span class="player-preview-segment" hidden></span></output>
        <input class="player-seek" type="range" min="0" max="1" step=".1" value="0" aria-label="Seek" disabled>
      </div>
      <div class="player-transport">
        <div class="player-playback">
          ${episode ? `<button class="player-button" type="button" data-action="previous-episode" aria-label="Previous episode" title="Previous episode" hidden>${icon('previous-episode')}</button>` : ''}
          ${playerButton('play', 'Play', 'play')}
          ${episode ? `<button class="player-button" type="button" data-action="next-episode" aria-label="Next episode" title="Next episode" hidden>${icon('next-episode')}</button>` : ''}
        </div>
        <div class="player-jump">
          ${playerButton('back', 'Back 10 seconds', 'back10')}
          ${playerButton('forward', 'Forward 10 seconds', 'forward10')}
        </div>
        <span class="player-time" aria-hidden="true"><span class="player-elapsed">0:00</span><span class="player-duration"></span></span>
        <div class="player-utilities">
          <details class="player-menu player-audio">
            <summary class="player-button player-utility" aria-label="Audio controls" title="Audio controls">${icon('player-speaker')}</summary>
            <div class="player-popup player-audio-panel">
              <label class="player-popup-heading" for="player-volume">Volume <span class="player-volume-level" aria-hidden="true">100%</span></label>
              <input id="player-volume" class="player-volume" type="range" min="0" max="1" step=".05" value="1">
              <button class="player-popup-action" type="button" data-player="mute">Mute</button>
              ${session.media.embed ? '' : '<label class="player-language" hidden>Audio track <select class="player-select"></select></label>'}
            </div>
          </details>
          <details class="player-menu player-subtitles">
            <summary class="player-button player-utility" aria-label="Subtitles" title="Subtitles">${icon('player-subtitle-icon')}</summary>
            <div class="player-popup player-subtitle-panel">
              <div class="player-popup-heading"><span>Subtitles</span><button class="player-popup-action subtitle-off" type="button" aria-pressed="true">Off</button></div>
              ${session.media.embed ? `<label class="player-language" hidden>Language <select class="player-select" aria-label="Subtitle language"></select></label>
              <div class="subtitle-tracks" role="group" aria-label="Subtitle versions"></div><p class="subtitle-status" role="status" hidden></p>` : `<button class="subtitle-choice subtitle-native-track" type="button" aria-pressed="false"><span></span>${icon('check')}</button>`}
            </div>
          </details>
          <details class="player-menu player-settings">
            <summary class="player-button player-utility" aria-label="Playback settings" title="Playback settings">${icon('player-tune')}</summary>
            <div class="player-popup player-settings-panel">
              <p class="player-popup-heading">Playback</p>
              ${playerChoices('player-speed', 'Speed', [['0.5', '0.5×'], ['0.75', '0.75×'], ['1', '1×'], ['1.25', '1.25×'], ['1.5', '1.5×'], ['2', '2×']])}
              ${session.media.embed ? playerChoices('player-quality', 'Preferred quality', [['', 'Auto'], ['480', '480p'], ['720', '720p'], ['1080', '1080p']]) : ''}
              ${session.media.embed ? `<button class="player-provider" type="button" data-action="cine-options">Video sources ${icon('chevron-right')}</button>` : ''}
            </div>
          </details>
          ${playerButton('fullscreen', 'Fullscreen', 'fullscreen')}
        </div>
      </div>
    </div>
  </div>`;
}

function updateSubtitleButton(menu, enabled) {
  const button = menu.querySelector('summary');
  button.classList.toggle('has-subtitles', enabled);
  button.setAttribute('aria-label', enabled ? 'Subtitles on' : 'Subtitles');
  menu.querySelector('.subtitle-off').setAttribute('aria-pressed', String(!enabled));
}

function preferredSubtitleLanguage() {
  return pref('subtitles') ? preferences.subtitleLanguage ?? (preferences.captions ? 'English' : '') : '';
}

function rememberSubtitleLanguage(language) {
  if (pref('subtitles') && preferences.subtitleLanguage !== language) libraryChange('preferences', 'subtitleLanguage', language);
}

function bindNativeAudio(video, select, signal) {
  const tracks = video.audioTracks;
  if (!tracks) return;
  const field = select.closest('label');
  const describe = track => playbackLanguage(track.language) || track.label;
  function choose(index) {
    for (let cursor = 0; cursor < tracks.length; cursor++) tracks[cursor].enabled = cursor === index;
  }
  function syncTracks() {
    const available = Array.from(tracks);
    field.hidden = available.length < 2;
    if (field.hidden) return;
    select.replaceChildren(...available.map((track, index) => new Option(track.label || describe(track) || `Track ${index + 1}`, index)));
    const preferred = available.findIndex(track => samePlaybackLanguage(describe(track), preferences.audioLanguage));
    if (preferred >= 0) choose(preferred);
    select.value = available.findIndex(track => track.enabled);
  }
  for (const event of ['addtrack', 'removetrack']) tracks.addEventListener(event, syncTracks, { signal });
  tracks.addEventListener('change', () => { select.value = Array.from(tracks).findIndex(track => track.enabled); }, { signal });
  select.addEventListener('change', () => {
    const index = Number(select.value);
    choose(index);
    const language = describe(tracks[index]);
    if (language?.length <= 60) libraryChange('preferences', 'audioLanguage', language);
  }, { signal });
  syncTracks();
}

function bindNativeSubtitles(menu, video, track, signal) {
  menu.hidden = !track;
  if (!track) return;
  const option = menu.querySelector('.subtitle-native-track');
  const language = playbackLanguage(track.language) || track.label;
  option.querySelector('span').textContent = track.label || 'Captions';
  function syncTrack() {
    const enabled = track.mode === 'showing';
    option.setAttribute('aria-pressed', String(enabled));
    updateSubtitleButton(menu, enabled);
  }
  option.addEventListener('click', () => {
    track.mode = 'showing';
    rememberSubtitleLanguage(language);
    syncTrack();
  }, { signal });
  menu.querySelector('.subtitle-off').addEventListener('click', () => {
    track.mode = 'disabled';
    rememberSubtitleLanguage('');
    syncTrack();
  }, { signal });
  video.textTracks.addEventListener('change', syncTrack, { signal });
  const applyPreference = () => {
    track.mode = samePlaybackLanguage(language, preferredSubtitleLanguage()) ? 'showing' : 'disabled';
    syncTrack();
  };
  document.addEventListener('afterframe-subtitle-preference', applyPreference, { signal });
  applyPreference();
}

function bindEmbedSubtitles(player, menu, session, signal) {
  const language = menu.querySelector('select');
  const choices = menu.querySelector('.subtitle-tracks');
  const status = menu.querySelector('.subtitle-status');
  const output = player.querySelector('.player-caption');
  const line = output.querySelector('span');
  let selected = session.subtitleTrack?.key === session.progressKey ? session.subtitleTrack : null;
  let tracks;
  let listing = false;
  let download;

  function showStatus(message) {
    status.textContent = message;
    status.hidden = !message;
  }
  function render(time) {
    const text = selected?.key === session.progressKey
      ? selected.cues.filter(({ start, end }) => time >= start && time < end).map(cue => cue.text).join('\n') : '';
    output.hidden = !text;
    if (line.textContent !== text) line.textContent = text;
  }
  function syncSelection() {
    updateSubtitleButton(menu, Boolean(selected));
    for (const option of choices.querySelectorAll('[data-subtitle-index]')) {
      option.setAttribute('aria-pressed', String(tracks[Number(option.dataset.subtitleIndex)].url === selected?.url));
    }
    render(playbackPosition(session)?.currentTime);
  }
  function renderTracks() {
    const versions = tracks.filter(track => track.language === language.value);
    choices.innerHTML = versions.map((track, index) => `<button class="subtitle-choice" type="button" data-subtitle-index="${track.index}" aria-pressed="false">
      <span>${escape(track.release || `Version ${index + 1}`)}</span>${icon('check')}
    </button>`).join('');
    syncSelection();
  }
  async function listTracks() {
    if (tracks || listing) return;
    listing = true;
    showStatus('Loading subtitle tracks…');
    try {
      const available = await findSubtitles(session.item, session.episode, signal);
      if (signal.aborted) return;
      tracks = available.map((track, index) => ({ ...track, index }));
      const languages = [...new Set(tracks.map(track => track.language))];
      language.replaceChildren(...languages.map(name => new Option(name, name)));
      const activeLanguage = tracks.find(track => track.url === selected?.url)?.language;
      const preferred = languages.find(name => samePlaybackLanguage(name, preferredSubtitleLanguage()));
      language.value = activeLanguage || preferred || (languages.includes('English') ? 'English' : languages[0] || '');
      language.closest('label').hidden = !tracks.length;
      renderTracks();
      showStatus(tracks.length ? '' : 'No subtitle tracks available.');
      if (!selected && preferredSubtitleLanguage()) await restorePreferred();
    } catch {
      if (!signal.aborted) showStatus('Subtitle tracks could not load. Reopen the menu to retry.');
    } finally {
      listing = false;
    }
  }
  async function restorePreferred() {
    const preferred = preferredSubtitleLanguage();
    if (!tracks) return listTracks();
    const candidates = tracks.filter(track => samePlaybackLanguage(track.language, preferred));
    for (const track of candidates) {
      if (signal.aborted || preferred !== preferredSubtitleLanguage()) return;
      if (await selectTrack(track)) return;
      if (download?.signal.aborted) return;
    }
    if (preferred && tracks.length && !candidates.length) showStatus(`${preferred} subtitles are unavailable for this video.`);
  }
  document.addEventListener('afterframe-subtitle-preference', () => {
    download?.abort();
    selected = session.subtitleTrack = null;
    showStatus('');
    syncSelection();
    if (preferredSubtitleLanguage()) restorePreferred();
  }, { signal });
  menu.addEventListener('toggle', () => { if (menu.open) listTracks(); }, { signal });
  language.addEventListener('change', renderTracks, { signal });
  menu.querySelector('.subtitle-off').addEventListener('click', () => {
    download?.abort();
    selected = session.subtitleTrack = null;
    rememberSubtitleLanguage('');
    showStatus('');
    syncSelection();
  }, { signal });
  async function selectTrack(track, remember = false) {
    download?.abort();
    const progressKey = session.progressKey;
    const request = new AbortController();
    download = request;
    showStatus('Loading subtitles…');
    try {
      const cues = await loadSubtitle(track, AbortSignal.any([signal, request.signal]));
      if (download !== request || request.signal.aborted || signal.aborted || progressKey !== session.progressKey) return;
      selected = session.subtitleTrack = { key: progressKey, url: track.url, cues };
      if (remember) rememberSubtitleLanguage(track.language);
      showStatus('');
      syncSelection();
      return true;
    } catch {
      if (request.signal.aborted || signal.aborted) return;
      showStatus('This track could not load. Try another version.');
      syncSelection();
    }
  }
  choices.addEventListener('click', event => {
    const option = event.target.closest('[data-subtitle-index]');
    if (option) selectTrack(tracks[Number(option.dataset.subtitleIndex)], true);
  }, { signal });
  syncSelection();
  if (!selected && preferredSubtitleLanguage()) listTracks();
  return render;
}

function bindVideoControls(video, player, session, signal) {
  const playback = video || session.embedPlayback;
  const readPosition = () => video || playback.position;
  const controls = player.querySelector('.player-controls');
  const seek = controls.querySelector('.player-seek');
  if (!video) {
    seek.title = 'This video source does not report buffered ranges';
    seek.setAttribute('aria-description', seek.title);
  }
  const jumps = controls.querySelectorAll('.player-jump button');
  const volume = controls.querySelector('.player-volume');
  const audio = controls.querySelector('.player-audio summary');
  const volumeLevel = controls.querySelector('.player-volume-level');
  const speed = controls.querySelectorAll('[data-player-option="player-speed"]');
  const quality = controls.querySelectorAll('[data-player-option="player-quality"]');
  const menus = [...player.querySelectorAll('.player-menu')];
  const elapsed = controls.querySelector('.player-elapsed');
  const total = controls.querySelector('.player-duration');
  const remaining = player.querySelector('.player-remaining');
  const markers = controls.querySelector('.player-markers');
  const preview = controls.querySelector('.player-seek-preview');
  const previewTime = preview.querySelector('.player-preview-time');
  const previewSegment = preview.querySelector('.player-preview-segment');
  const skip = player.querySelector('.player-skip');
  const play = controls.querySelector('[data-player="play"]');
  const mute = controls.querySelector('[data-player="mute"]');
  const subtitleMenu = controls.querySelector('.player-subtitles');
  const fullscreen = controls.querySelector('[data-player="fullscreen"]');
  const track = video?.textTracks[0];
  const updateSubtitles = video ? null : bindEmbedSubtitles(player, subtitleMenu, session, signal);
  if (video) bindNativeSubtitles(subtitleMenu, video, track, signal);
  const preferredQuality = session.preferredQuality ?? preferences.quality ?? '';
  for (const option of quality) option.setAttribute('aria-pressed', String(option.value === preferredQuality));
  let scrubbing = false;
  let idleTimer;
  let controlsHovered = false;
  let lastVolume = playback.volume || .5;

  if (video) bindNativeAudio(video, controls.querySelector('.player-audio select'), signal);

  function setControlsVisible(visible) {
    if (player.classList.contains('controls-active') === visible) return;
    player.classList.toggle('controls-active', visible);
    positionCaptions();
  }
  function positionCaptions() {
    if (!track?.activeCues?.length || !video.videoHeight || !video.clientHeight) return;
    const raised = player.matches('.controls-active, .is-paused, :has(:focus-visible, .player-menu[open])');
    const height = Math.min(video.clientHeight, video.clientWidth * video.videoHeight / video.videoWidth);
    const letterbox = (video.clientHeight - height) / 2;
    const controlsTop = controls.getBoundingClientRect().top - video.getBoundingClientRect().top;
    const captionBottom = (controlsTop - letterbox - Math.max(12, height * .04)) / height * 100;
    for (const cue of track?.activeCues || []) {
      cue.snapToLines = false;
      cue.lineAlign = 'end';
      cue.line = raised ? Math.max(5, Math.min(94, captionBottom)) : 94;
    }
  }

  function updateButton(button, label, glyph) {
    if (button.getAttribute('aria-label') === label) return;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = icon(glyph);
  }
  function updateTime(position = readPosition()?.currentTime ?? 0) {
    const duration = readPosition()?.duration;
    seek.disabled = !(Number.isFinite(duration) && duration > 0);
    for (const jump of jumps) jump.disabled = seek.disabled;
    if (!seek.disabled) seek.max = duration;
    if (!scrubbing) seek.value = position;
    seek.setAttribute('aria-valuetext', seek.disabled ? timeCode(position) : `${timeCode(position)} of ${timeCode(duration)}`);
    seek.style.setProperty('--played', `${seek.disabled ? 0 : position / duration * 100}%`);
    elapsed.textContent = timeCode(position);
    total.textContent = seek.disabled ? '' : ` / ${timeCode(duration)}`;
    if (seek.disabled) preview.hidden = true;
    if (playback.paused) remaining.textContent = seek.disabled ? '' : `${timeCode(Math.max(0, duration - position))} remaining`;
  }
  function updatePlayback() {
    const ended = video ? video.ended : Boolean(session.ended);
    const paused = playback.paused || ended;
    const changed = player.classList.contains('is-paused') !== paused || player.classList.contains('is-ended') !== ended;
    player.classList.toggle('is-paused', paused);
    player.classList.toggle('is-ended', ended);
    if (!video && !paused) player.classList.add('has-played');
    updateButton(play, ended ? 'Replay' : paused ? 'Play' : 'Pause', ended ? 'replay' : paused ? 'play' : 'player-pause');
    if (changed) revealControls();
  }
  function updatePosition() {
    if (!scrubbing) updateTime();
    updateSubtitles?.(readPosition()?.currentTime);
  }
  function updateBuffer() {
    const ranges = bufferedIntervals(video.buffered, video.duration);
    const stops = ranges.map(([start, end]) => `transparent ${start}%, #ffffff80 ${start}% ${end}%, transparent ${end}%`);
    seek.style.setProperty('--buffered-track', stops.length ? `linear-gradient(to right, ${stops.join(', ')})` : 'none');
    seek.classList.toggle('has-buffer-data', ranges.length > 0);
  }
  function showSeekPreview(position) {
    const segment = session.segments.find(entry => position >= entry.start && position < entry.end);
    previewTime.textContent = timeCode(position);
    previewSegment.hidden = !segment;
    if (segment) previewSegment.textContent = segmentNames[segment.kind];
    const offset = markers.offsetLeft + markers.getBoundingClientRect().width * position / readPosition().duration;
    preview.style.setProperty('--preview-position', `${offset}px`);
    preview.hidden = false;
  }
  function updateVolume() {
    const level = playback.volume;
    if (level > 0) lastVolume = level;
    const muted = playback.muted || level === 0;
    const percentage = `${Math.round(level * 100)}%`;
    updateButton(audio, muted ? 'Audio controls (muted)' : 'Audio controls', muted ? 'player-speaker-muted' : 'player-speaker');
    mute.textContent = muted ? 'Unmute' : 'Mute';
    volume.value = level;
    volume.style.setProperty('--volume-fill', percentage);
    volume.setAttribute('aria-valuetext', percentage);
    volumeLevel.textContent = percentage;
  }
  function updateSpeed() {
    for (const option of speed) option.setAttribute('aria-pressed', String(Number(option.value) === playback.playbackRate));
  }
  function setAudio(level, muted) {
    playback.volume = level;
    playback.muted = muted;
    if (!video) {
      playback.pendingAudio = { volume: level, muted };
      clearTimeout(playback.audioTimer);
      playback.audioTimer = setTimeout(() => {
        playback.pendingAudio = null;
        playerCommand('getVolume');
        playerCommand('getMuted');
      }, 600);
      playerCommand('setVolume', level);
      playerCommand('setMuted', muted);
      rememberVolume(level, muted);
    }
    updateVolume();
  }
  function revealControls() {
    setControlsVisible(true);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!scrubbing && !controlsHovered && !controls.querySelector(':focus-visible')) setControlsVisible(false);
    }, 2500);
  }
  session.renderSegments = () => {
    const duration = readPosition()?.duration;
    if (!session.segments.length) skip.hidden = true;
    preview.hidden = true;
    markers.replaceChildren(...session.segments.filter(segment => segment.end <= duration).map(segment => {
      const marker = document.createElement('span');
      marker.className = 'player-marker';
      marker.style.left = `${segment.start / duration * 100}%`;
      marker.style.width = `${(segment.end - segment.start) / duration * 100}%`;
      return marker;
    }));
  };
  fullscreen.hidden = !document.fullscreenEnabled && !video?.webkitSupportsFullscreen && !video?.webkitEnterFullscreen;
  updatePlayback();
  updatePosition();
  updateVolume();
  updateSpeed();
  revealControls();

  bindPictureGestures(player.querySelector('.video-picture'), session, signal, revealControls);
  controls.addEventListener('click', event => {
    const action = event.target.closest('[data-player]')?.dataset.player;
    if (action === 'play') playerCommand(playback.paused || session.ended ? 'play' : 'pause');
    if (action === 'back') jumpPlayback(-10);
    if (action === 'forward') jumpPlayback(10);
    if (action === 'mute') setAudio(playback.volume || lastVolume, !playback.muted && playback.volume > 0);
    if (action === 'fullscreen') toggleFullscreen();
    const option = event.target.closest('[data-player-option]');
    if (!option || option.getAttribute('aria-pressed') === 'true') return;
    if (option.dataset.playerOption === 'player-speed') {
      playback.playbackRate = Number(option.value);
      if (!video) playerCommand('setPlaybackRate', playback.playbackRate);
      updateSpeed();
    }
    if (option.dataset.playerOption === 'player-quality') {
      session.preferredQuality = option.value;
      reloadCineSrc(session);
      player.querySelector('.player-settings summary')?.focus({ preventScroll: true });
    }
  }, { signal });
  seek.addEventListener('input', () => {
    scrubbing = true;
    const position = Number(seek.value);
    updateTime(position);
    if (!seek.disabled) showSeekPreview(position);
  }, { signal });
  seek.addEventListener('change', () => {
    const position = Number(seek.value);
    scrubbing = false;
    playerCommand('seek', position);
    if (!seek.matches(':hover, :focus-visible')) preview.hidden = true;
    revealControls();
  }, { signal });
  seek.addEventListener('pointercancel', () => {
    scrubbing = false;
    updateTime();
    preview.hidden = true;
    revealControls();
  }, { signal });
  seek.addEventListener('pointermove', event => {
    if (seek.disabled || scrubbing || event.pointerType === 'touch') return;
    const { left, width } = markers.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (event.clientX - left) / width));
    showSeekPreview(percent * readPosition().duration);
  }, { signal });
  seek.addEventListener('pointerleave', () => { if (!scrubbing) preview.hidden = true; }, { signal });
  seek.addEventListener('blur', () => { preview.hidden = true; }, { signal });
  volume.addEventListener('input', () => {
    const level = Number(volume.value);
    setAudio(level, level === 0);
  }, { signal });
  for (const menu of menus) {
    menu.addEventListener('toggle', revealControls, { signal });
    menu.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !menu.open) return;
      event.preventDefault();
      menu.open = false;
      menu.querySelector('summary').focus();
    }, { signal });
    menu.addEventListener('focusout', event => {
      if (!menu.contains(event.relatedTarget)) menu.open = false;
    }, { signal });
  }
  document.addEventListener('pointerdown', event => {
    for (const menu of menus) if (menu.open && !menu.contains(event.target)) menu.open = false;
  }, { signal });
  for (const type of ['play', 'pause', 'ended']) video?.addEventListener(type, updatePlayback, { signal });
  video?.addEventListener('playing', () => player.classList.add('has-played'), { once: true, signal });
  for (const type of ['timeupdate', 'seeking', 'loadedmetadata', 'durationchange']) {
    video?.addEventListener(type, updatePosition, { signal });
  }
  for (const type of ['progress', 'loadedmetadata', 'durationchange', 'seeking', 'emptied']) {
    video?.addEventListener(type, updateBuffer, { signal });
  }
  video?.addEventListener('loadedmetadata', session.renderSegments, { signal });
  video?.addEventListener('volumechange', updateVolume, { signal });
  video?.addEventListener('ratechange', updateSpeed, { signal });
  track?.addEventListener('cuechange', positionCaptions, { signal });
  document.addEventListener('fullscreenchange', () => {
    const full = document.fullscreenElement === player.closest('.watch-stage');
    updateButton(fullscreen, full ? 'Exit fullscreen' : 'Fullscreen', full ? 'exit-fullscreen' : 'fullscreen');
    revealControls();
  }, { signal });
  player.addEventListener('pointermove', event => {
    if (event.pointerType !== 'touch') revealControls();
  }, { signal });
  controls.addEventListener('pointerenter', event => {
    if (event.pointerType === 'touch') return;
    controlsHovered = true;
    revealControls();
  }, { signal });
  controls.addEventListener('pointerleave', event => {
    if (event.pointerType === 'touch') return;
    controlsHovered = false;
    revealControls();
  }, { signal });
  player.addEventListener('focusin', revealControls, { signal });
  controls.addEventListener('focusout', revealControls, { signal });
  const size = track ? new ResizeObserver(positionCaptions) : null;
  if (size) size.observe(video);
  signal.addEventListener('abort', () => {
    clearTimeout(idleTimer);
    size?.disconnect();
  }, { once: true });
  return { updatePlayback, updatePosition, updateVolume, updateSpeed };
}

function startVideo(session, direct = false) {
  const { item, episode, media, progressKey } = session;
  const player = titlePage.querySelector('.video-box');
  const sourcePage = media.page || `https://archive.org/details/${encodeURIComponent(media.archive)}`;
  player.innerHTML = `<video playsinline preload="auto" aria-label="${escape(episode?.title || item.title)}" ${item.backdrop ? `poster="${escape(item.backdrop)}"` : ''}></video><div class="video-picture" aria-hidden="true"></div>${videoOverlay(session)}<p class="video-buffering" role="status" hidden>Buffering…</p><div class="video-error" role="status" hidden><p>The video could not load.</p><div class="watch-actions"><button type="button" class="button secondary" data-action="retry-video">Retry</button>${direct ? `<a class="button primary" href="${escape(sourcePage)}" target="_blank" rel="noopener noreferrer">Open source ${icon('external')}</a>` : '<button type="button" class="button primary" data-action="direct-video">Try direct stream</button>'}</div></div>`;
  player.classList.remove('has-played', 'is-ended');
  const video = player.querySelector('video');
  const controller = new AbortController();
  const { signal } = controller;
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
  updateEpisodeNavigation(session);
  video.addEventListener('loadedmetadata', () => {
    const previous = progress[progressKey];
    if (pref('resume') && previous && previous.time > 5 && previous.time < video.duration - 2) video.currentTime = previous.time;
    if (pref('volume')) {
      video.volume = preferences.level ?? 1;
      video.muted = preferences.muted ?? false;
    }
    updateSkip(video, session);
    loadSkipSegments(video, session);
  }, { signal });
  video.addEventListener('timeupdate', () => {
    trackPosition(video, session);
    if (!video.seeking) remember(video, session);
  }, { signal });
  video.addEventListener('seeking', () => { session.tracking.sample = null; }, { signal });
  video.addEventListener('play', () => resumePlayback(session), { signal });
  video.addEventListener('pause', () => {
    session.tracking.sample = null;
    remember(video, session, true);
  }, { signal });
  video.addEventListener('volumechange', () => rememberVolume(video.volume, video.muted), { signal });
  video.addEventListener('ended', () => finishPlayback(session), { signal });
  const buffering = player.querySelector('.video-buffering');
  let bufferingTimer;
  function clearBuffering() {
    clearTimeout(bufferingTimer);
    buffering.hidden = true;
  }
  video.addEventListener('waiting', () => {
    clearTimeout(bufferingTimer);
    bufferingTimer = setTimeout(() => { buffering.hidden = video.paused || video.ended; }, 450);
  }, { signal });
  for (const event of ['playing', 'pause', 'ended', 'error', 'emptied']) video.addEventListener(event, clearBuffering, { signal });
  signal.addEventListener('abort', clearBuffering, { once: true });
  const errorBox = player.querySelector('.video-error');
  video.addEventListener('error', () => { errorBox.hidden = false; }, { signal });
  video.src = direct ? archiveFileUrl(media) : `/stream/${item.key}${episode ? `/${episode.key}` : ''}`;
  video.play().catch(() => { /* The play button remains available when autoplay is blocked. */ });
}

function episodeFromControl(control) {
  return { season: Number(control.dataset.season), number: Number(control.dataset.number), title: control.dataset.episodeTitle };
}

function updateEmbeddedEpisode(session, season, number, internalNavigation) {
  if (!session.episode || !validEpisode({ season, number }) || (session.episode.season === season && session.episode.number === number)) return false;
  const entry = session.season === season && session.seasonData?.find(candidate => candidate.episode_number === number);
  const episode = entry ? episodeCoordinates(entry) : { season, number, title: `Episode ${number}` };
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
  playback.seekTarget = null;
  playback.relativeJump = undefined;
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
  session.history = null;
  session.ended = false;
  session.inCredits = false;
  session.nextEpisode = session.previousEpisode = undefined;
  session.episodeNavigationReady = false;
  session.countdownCancelled = false;
  loadSeason(session, season);
  return true;
}

function cineResumeTime(key, provider = 'cinesrc') {
  const previous = progress[key];
  if ((previous?.provider || 'cinesrc') !== provider) return null;
  return pref('resume') && previous?.time > 5 && previous.time < previous.duration - 2 ? previous.time : null;
}

function creditCineSkip(session, time) {
  const segment = session.segments.find(entry => ['intro', 'recap'].includes(entry.kind) && Math.abs(entry.end - time) <= 2);
  if (segment) session.tracking.skipped = mergeRanges(session.tracking.skipped, segment.start, segment.end);
}

function cineSrcUrl(session, restore) {
  const { item, episode, progressKey } = session;
  const url = new URL(`/embed/${item.type}/${item.id}`, cineSrcOrigin);
  url.searchParams.set('color', getComputedStyle(titlePage).getPropertyValue('--accent').trim());
  url.searchParams.set('controls', String(Boolean(session.providerControls)));
  if (session.providerControls) url.searchParams.set('back', 'close');
  else url.searchParams.set('subtitles', 'off');
  if (episode) {
    url.searchParams.set('s', episode.season);
    url.searchParams.set('e', episode.number);
    url.searchParams.set('autonext', String(Boolean(session.providerControls) && pref('autoplay')));
    url.searchParams.set('autoskip', String(Boolean(session.providerControls) && pref('intro') && pref('recap')));
  }
  if (session.cineSrcServer) {
    url.searchParams.set('prioritize', 'true');
    url.searchParams.set('lastserver', session.cineSrcServer);
  }
  const resumeTime = restore?.time ?? cineResumeTime(progressKey);
  url.searchParams.set('continueprompt', 'false');
  if (resumeTime) url.searchParams.set('t', String(Math.floor(resumeTime)));
  const quality = session.preferredQuality ?? preferences.quality;
  if (quality) url.searchParams.set('quality', quality);
  if (restore?.muted ?? (pref('volume') && preferences.muted)) url.searchParams.set('muted', 'true');
  if (typeof restore?.paused === 'boolean') url.searchParams.set('autoplay', String(!restore.paused));
  return url.href;
}

function startCineSrc(session, restore) {
  const { item, episode } = session;
  const videoBox = titlePage.querySelector('.video-box');
  const frame = document.createElement('iframe');
  frame.title = `${item.title}${episode ? `, ${episodeLabel(episode)}` : ''} video player`;
  frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
  frame.allowFullscreen = true;
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
  frame.referrerPolicy = 'strict-origin';
  const picture = document.createElement('div');
  picture.className = session.providerControls ? 'video-picture embed-picture' : 'video-picture';
  picture.setAttribute('aria-hidden', 'true');
  picture.hidden = true;
  const loading = document.createElement('div');
  loading.className = 'embed-loading';
  loading.innerHTML = `${item.backdrop ? `<img src="${escape(item.backdrop)}" alt="">` : ''}<span role="status">Loading video…</span>`;

  const notice = titlePage.querySelector('.embed-notice');
  const status = notice.querySelector('[role="status"]');
  const retry = notice.querySelector('[data-action="retry-video"]');
  const provider = notice.querySelector('[data-action="cine-options"]');
  const useAnime = notice.querySelector('[data-action="video-provider"]');
  useAnime.hidden = !session.animeEligible;
  useAnime.textContent = 'Use AnimeEmbed';
  provider.hidden = false;
  titlePage.querySelector('[data-playback-source]').textContent = 'Playback by CineSrc';
  provider.textContent = session.providerControls ? 'Use Afterframe controls' : 'Use CineSrc controls';
  const setStatus = (message = '', canRetry = false) => {
    status.textContent = message;
    notice.hidden = !canRetry && !session.providerControls && useAnime.hidden;
    status.hidden = !canRetry;
    retry.hidden = !canRetry;
    if (canRetry || !message) loading.hidden = true;
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
    volume: restore?.volume ?? (pref('volume') ? preferences.level ?? 1 : 1),
    muted: restore?.muted ?? (pref('volume') && Boolean(preferences.muted)),
    playbackRate: restore?.playbackRate ?? 1,
    lastUpdate: 0,
    restoreVolume: true,
    stop() {
      clearTimeout(timer);
      clearTimeout(recoveryTimer);
      clearTimeout(playback.audioTimer);
      controller.abort();
      frame.remove();
      picture.remove();
      loading.remove();
    },
  };
  session.embedPlayback = playback;
  session.renderSegments = null;
  videoBox.classList.remove('has-played', 'is-ended', 'is-paused', 'controls-active');
  const overlay = document.createElement('template');
  overlay.innerHTML = session.providerControls ? '' : videoOverlay(session);
  videoBox.replaceChildren(frame, loading, picture, overlay.content);
  const controls = session.providerControls ? null : bindVideoControls(null, videoBox, session, controller.signal);
  if (session.providerControls) bindPictureGestures(picture, session, controller.signal);
  else {
    controls.updateSpeed();
    updateEpisodeNavigation(session);
  }

  function restoreVolume() {
    if (!playback.restoreVolume) return;
    playback.restoreVolume = false;
    if (restore || pref('volume')) {
      playerCommand('setVolume', playback.volume);
      playerCommand('setMuted', playback.muted);
    }
    if (playback.playbackRate !== 1) playerCommand('setPlaybackRate', playback.playbackRate);
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
    const durationChanged = previousDuration && Math.abs(previousDuration - duration) > 2.5;
    if (durationChanged) {
      session.tracking = viewingSession();
      session.history = null;
      session.segments = [];
      session.segmentRequest = null;
      session.autoSkipped.clear();
      session.sourceRevision = (session.sourceRevision || 0) + 1;
    }
    playback.position = { currentTime: Math.min(currentTime, duration), duration, paused: playback.paused, seeking };
    if (durationChanged) session.renderSegments?.();
    controls?.updatePlayback();
    controls?.updatePosition();
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
        loading.hidden = true;
        restoreVolume();
        break;
      case 'cinesrc:play':
        resumePlayback(session);
        picture.hidden = false;
        playback.paused = false;
        controls?.updatePlayback();
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
          playerCommand('getVolume');
          playerCommand('getMuted');
          playerCommand('getPlaybackRate');
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
        if (data.type === 'cinesrc:seeked' && (!Number.isFinite(playback.seekTarget) || Math.abs(data.currentTime - playback.seekTarget) < 1)) {
          playback.seekStarted = null;
          playback.seekTarget = null;
        }
        readPosition(data.currentTime, data.duration, seeking);
        if (!seeking && !playback.paused && !session.ended && !playback.unidentifiedEpisode) startStreamTimeout();
        break;
      case 'cinesrc:pause':
        playback.paused = true;
        controls?.updatePlayback();
        controls?.updatePosition();
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
      case 'cinesrc:volumechange': {
        const pending = playback.pendingAudio;
        const validLevel = Number.isFinite(data.volume) && data.volume >= 0 && data.volume <= 1;
        if (pending && (!validLevel || Math.abs(data.volume - pending.volume) > .001 || data.muted !== pending.muted)) break;
        playback.pendingAudio = null;
        clearTimeout(playback.audioTimer);
        if (validLevel) playback.volume = data.volume;
        if (typeof data.muted === 'boolean') playback.muted = data.muted;
        controls?.updateVolume();
        rememberVolume(data.volume, data.muted);
        break;
      }
      case 'cinesrc:ratechange':
        if (Number.isFinite(data.playbackRate) && data.playbackRate >= .25 && data.playbackRate <= 2) {
          playback.playbackRate = data.playbackRate;
          controls?.updateSpeed();
        }
        break;
      case 'cinesrc:ended':
        finishPlayback(session);
        clearTimeout(timer);
        if (playback.position) playback.position.currentTime = playback.position.duration;
        playback.paused = true;
        controls?.updatePlayback();
        controls?.updatePosition();
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
        playback.pendingAudio = null;
        clearTimeout(playback.audioTimer);
        if (typeof data.sourceId === 'string' && data.sourceId.length <= 100) session.cineSrcServer = data.sourceId;
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
        session.autoSkipped.clear();
        playback.skippedTo = undefined;
        playback.position = null;
        playback.duration = null;
        playback.lastUpdate = 0;
        playback.seekStarted = null;
        playback.seekTarget = null;
        playback.relativeJump = undefined;
        playback.restoreVolume = true;
        controls?.updatePosition();
        session.renderSegments?.();
        break;
      case 'cinesrc:response':
        if (data.command === 'getPaused' && typeof data.result === 'boolean') {
          playback.paused = data.result;
          controls?.updatePlayback();
        }
        if (data.command === 'getDuration' && Number.isFinite(data.result) && data.result > 0) playback.duration = data.result;
        if (data.command === 'getCurrentTime') {
          const jump = playback.relativeJump;
          if (jump !== undefined && Number.isFinite(data.result) && Number.isFinite(playback.position?.duration)) {
            playback.relativeJump = undefined;
            if (jump) playerCommand('seek', Math.max(0, Math.min(playback.position.duration, data.result + jump)));
          } else if (performance.now() - playback.lastUpdate > 2200) {
            readPosition(data.result, playback.duration, performance.now() - (playback.seekStarted ?? -Infinity) < 1800);
          }
        }
        if (!playback.pendingAudio && data.command === 'getVolume' && Number.isFinite(data.result) && data.result >= 0 && data.result <= 1) {
          playback.volume = data.result;
          controls?.updateVolume();
          rememberVolume(playback.volume, playback.muted);
        }
        if (!playback.pendingAudio && data.command === 'getMuted' && typeof data.result === 'boolean') {
          playback.muted = data.result;
          controls?.updateVolume();
          rememberVolume(playback.volume, playback.muted);
        }
        if (data.command === 'getPlaybackRate' && Number.isFinite(data.result) && data.result >= .25 && data.result <= 2) {
          playback.playbackRate = data.result;
          controls?.updateSpeed();
        }
        break;
      case 'cinesrc:close':
        if (session.providerControls) navigateTitle(session.item);
        break;
      case 'cinesrc:error':
        clearTimeout(timer);
        picture.hidden = true;
        if (playback.position) remember(playback.position, session, true);
        session.tracking.sample = null;
        playback.paused = true;
        controls?.updatePlayback();
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
  if (session.providerControls) frame.addEventListener('load', () => { loading.hidden = true; }, { signal: controller.signal });
  frame.src = cineSrcUrl(session, restore);
}

async function startCatalogPlayback(session) {
  session.sourceRevision = (session.sourceRevision || 0) + 1;
  session.segmentRequest = null;
  session.inCredits = false;
  session.segments = [];
  const provider = session.animeProvider || 'animeembed';
  if (!session.animeEligible || provider === 'cinesrc') {
    if (progress[session.progressKey]?.provider) session.tracking = viewingSession();
    startCineSrc(session);
    return;
  }
  session.animeProvider = provider;
  const { label, origin, next } = animePlayers[provider];
  const controller = new AbortController();
  const { signal } = controller;
  session.videoController = controller;
  const { item, episode } = session;
  const notice = titlePage.querySelector('.embed-notice');
  const status = notice.querySelector('[role="status"]');
  const retry = notice.querySelector('[data-action="retry-video"]');
  const switchPlayer = notice.querySelector('[data-action="video-provider"]');
  const credit = titlePage.querySelector('[data-playback-source]');
  const videoBox = titlePage.querySelector('.video-box');
  notice.hidden = false;
  status.hidden = false;
  status.textContent = 'Loading video…';
  retry.hidden = true;
  notice.querySelector('[data-action="cine-options"]').hidden = true;
  switchPlayer.hidden = false;
  switchPlayer.textContent = `Use ${animePlayers[next].label}`;

  function fallBack(target = next) {
    if (signal.aborted || active !== session) return;
    session.animeProvider = target;
    stopVideo();
    session.embedPlayback = null;
    startCatalogPlayback(session);
  }

  const query = episode ? `?s=${episode.season}&e=${episode.number}` : '';
  let source = session.animeSource;
  try {
    if (!source) ({ source } = await api(`/api/anime/${item.type}/${item.id}${query}`, { signal }));
  } catch {
    return fallBack('cinesrc');
  }
  if (signal.aborted || active !== session) return;
  if (!source) return fallBack('cinesrc');
  session.animeSource = source;
  const preferDub = provider === 'animeembed' && !session.dubFallback && samePlaybackLanguage(preferences.audioLanguage, 'English');

  session.tracking = viewingSession(progress[session.progressKey]?.provider === provider ? progress[session.progressKey] : null);
  session.lastSaved = 0;
  session.providerControls = false;
  const frame = document.createElement('iframe');
  frame.title = `${item.title}${episode ? `, ${episodeLabel(episode)}` : ''} anime player`;
  frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media; screen-wake-lock';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin';
  const overlay = document.createElement('template');
  overlay.innerHTML = episode ? `<div class="player-lower anime-player-overlay">${nextCountdownMarkup(episode)}<button class="player-skip" type="button" data-action="skip-segment" hidden></button></div>` : '';
  videoBox.replaceChildren(frame, overlay.content);
  credit.textContent = `Playback by ${label}`;
  let ready = false;
  let currentEpisode = source.episode;
  let commandId = 0;
  function retrySource() {
    if (preferDub && !playback.position?.currentTime) {
      session.dubFallback = true;
      fallBack(provider);
    } else fallBack();
  }
  const timer = setTimeout(retrySource, 16000);
  const playback = {
    provider, frame, position: null,
    send(cmd, args = {}) {
      const message = provider === 'anipm'
        ? { ns: 'anipm.player', v: 1, cmd, args }
        : { channel: 'animeembed', version: 1, command: cmd, data: args, requestId: String(++commandId) };
      frame.contentWindow?.postMessage(message, origin);
    },
    stop() { clearTimeout(timer); controller.abort(); frame.remove(); },
  };
  session.embedPlayback = playback;
  if (provider === 'anipm') frame.addEventListener('load', () => playback.send('hello'), { signal });
  window.addEventListener('message', event => {
    if (event.origin !== origin || event.source !== frame.contentWindow || active !== session) return;
    const message = event.data;
    const supported = provider === 'anipm' ? message?.ns === 'anipm.player' && message.v === 1
      : message?.channel === 'animeembed' && message.version === 1;
    if (!supported) return;
    const data = message.data || {};
    const state = data.state || data;
    const reportedId = state.anilistId ?? message.animeId;
    if (reportedId != null && Number(reportedId) !== source.id) return;
    const reportedEpisode = state.episode ?? message.episode;
    const episodeNumber = Number(reportedEpisode);
    if (Number.isInteger(episodeNumber) && episodeNumber > 0) currentEpisode = episodeNumber;
    if (currentEpisode !== source.episode) {
      if (message.event !== 'episodechange' && message.event !== 'ready') return;
      const adjacent = currentEpisode === source.episode + 1 ? session.nextEpisode : currentEpisode === source.episode - 1 ? session.previousEpisode : null;
      if (adjacent) playEpisodeChoice(session, adjacent);
      else if (provider === 'anipm') playback.send('loadEpisode', { episode: source.episode, start: playback.position?.currentTime ?? 0 });
      return;
    }
    if (message.event === 'error') {
      if (!ready || (preferDub && !playback.position?.currentTime)) return retrySource();
      status.hidden = false;
      retry.hidden = false;
      status.textContent = 'The anime player lost its video source.';
      return;
    }
    if (['ready', 'autoplayblocked', 'timeupdate', 'progress'].includes(message.event)) {
      status.hidden = true;
      clearTimeout(timer);
      ready = true;
    }
    const { currentTime, duration, paused } = state;
    if (Number.isFinite(currentTime) && Number.isFinite(duration) && currentTime >= 0 && duration > 0 && currentTime <= duration + .5) {
      const previousDuration = playback.position?.duration || progress[session.progressKey]?.duration;
      if (!playback.position && previousDuration && Math.abs(previousDuration - duration) > 2.5) session.tracking = viewingSession();
      const position = { currentTime: Math.min(currentTime, duration), duration,
        paused: paused ?? (message.event === 'pause' || (message.event !== 'play' && message.event !== 'progress' && playback.position?.paused)) };
      playback.position = position;
      if (!position.paused && session.ended && message.event === 'play') resumePlayback(session);
      trackPosition(position, session, ['seeking', 'seeked'].includes(message.event));
      loadSkipSegments(position, session);
      remember(position, session, message.event === 'pause');
    }
    if (message.event === 'ended') finishPlayback(session);
  }, { signal });
  const accent = getComputedStyle(titlePage).getPropertyValue('--accent').trim().replace(/^#/, '');
  const start = Math.floor(cineResumeTime(session.progressKey, provider) || 0);
  const url = new URL(`/embed/ani/${source.id}/${source.episode}${provider === 'anipm' ? '/sub' : ''}`, origin);
  url.search = new URLSearchParams(provider === 'anipm'
    ? { start, color: accent, autonext: '0', episodes: '0', adult: '0', autoskip: '0' }
    : { start, accent, autoPlay: '1', autoNext: '0', autoSkip: '0', hide: 'next' });
  if (preferDub) url.searchParams.set('track', 'dub');
  if (pref('volume') && preferences.muted) url.searchParams.set('muted', '1');
  frame.src = url.href;
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

function reloadCineSrc(session) {
  const { position, paused, volume, muted, playbackRate } = session.embedPlayback;
  const currentTime = pendingCineSeek(session.embedPlayback) ?? position?.currentTime;
  stopVideo();
  startCineSrc(session, { time: session.ended ? 0 : currentTime, paused: position ? paused : undefined, volume, muted, playbackRate });
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
    animeEligible: Boolean(media?.embed) && isAnime(item.originalLanguage, item.genreIds),
  };
  session.tracking = viewingSession(progress[session.progressKey]);
  active = session;
  const sourcePage = source?.page || (source?.archive ? `https://archive.org/details/${encodeURIComponent(source.archive)}` : '');
  const watchSource = sourcePage ? `<div class="watch-source"><span>${escape(item.credit)}</span><a href="${escape(sourcePage)}" target="_blank" rel="noopener noreferrer">${escape(source.source || 'Internet Archive')} ${icon('external')}</a><a href="${escape(item.license[1])}" target="_blank" rel="noopener noreferrer">${escape(item.license[0])}</a></div>` : media?.embed ? '<div class="watch-source" data-playback-source></div>' : '';
  const canPlay = resumed || isArchive(item) || (item.type === 'movie' && hasCineSrcTitle(item) && (!item.date || hasReleased(item)));
  const back = `<a class="plain-link title-back" href="${media ? `#${titlePath(item)}` : escape(browseHash)}">${icon('chevron-left')} ${media ? `Back to ${escape(item.title)}` : 'Back to browse'}</a>`;
  const primary = !media && (item.type === 'tv'
    ? `<button class="button primary" type="button" data-action="series-start" disabled>${icon('play')} <span>Start watching</span></button>`
    : canPlay ? `<button class="button primary" type="button" data-action="${resumed && pref('resume') ? 'resume' : 'watch'}" data-key="${escape(item.key)}">${icon('play')} ${resumed && pref('resume') ? 'Resume' : 'Play'}</button>` : '');
  const about = `<p class="title-about"${item.description ? '' : ' hidden'}>${escape(item.description)}</p>`;
  const hasEpisodes = item.type === 'tv' && !item.archiveId;
  titlePage.classList.toggle('is-playing', Boolean(media));
  titlePage.hidden = false;
  main.hidden = true;
  const playbackNotice = media?.embed ? '<div class="embed-notice" hidden><span role="status"></span><div class="watch-actions"><button type="button" class="button secondary" data-action="video-provider" hidden></button><button type="button" class="button secondary" data-action="cine-options">Use CineSrc controls</button><button type="button" class="button secondary" data-action="retry-video">Reload player</button></div></div>' : '';
  const watchTitle = `<h1 id="title-heading" tabindex="-1">${escape(episode?.title || item.title)}</h1>`;
  titlePage.innerHTML = `${media
    ? `<div class="sr-only">${watchTitle}</div><div class="watch-stage"><div class="video-box"></div>${playbackNotice}</div>`
    : `<section class="details-hero" aria-labelledby="title-heading">
        ${item.backdrop ? `<div class="record-backdrop" aria-hidden="true"><img src="${escape(item.backdrop)}" alt="" fetchpriority="high"></div>` : ''}
        <div class="details-hero-inner">
          <div class="details-back">${back}</div>
          <div class="details-hero-main">
            ${!item.backdrop && item.poster ? `<img class="details-poster" src="${escape(item.poster)}" alt="">` : ''}
            <div class="details-hero-copy">
              <p class="details-format">${item.type === 'tv' ? 'TV series' : 'Movie'}</p>
              ${watchTitle}
              <div class="meta title-facts">${titleFacts(session)}</div>
              ${about}
              <p class="title-byline" hidden></p>
              <div class="watch-actions title-actions">${primary}${saveButton(item)}${watchStatusControl(item)}${item.type === 'movie' ? watchedButton(item) : ''}</div>
              ${item.type === 'tv' ? `<p class="series-tracking" aria-live="polite"></p><p class="details-schedule">${escape(titleSchedule(session.details))}</p>` : ''}
            </div>
          </div>
          <div class="details-hero-footer">
            <nav class="details-nav" aria-label="Title sections">
              ${hasEpisodes ? '<button type="button" data-action="details-section" data-value="details-episodes">Episodes</button>' : ''}
              <button type="button" data-action="details-section" data-value="details-cast" hidden>Cast &amp; crew</button>
              <button type="button" data-action="details-section" data-value="details-related" hidden>Related</button>
            </nav>
            ${ratingControl(item)}
          </div>
        </div>
      </section>`}
    <div class="watch-body${media ? '' : ' details-body'}">
      ${media && !episode ? `<div class="title-overview">${about}${ratingControl(item)}</div>` : ''}
      ${hasEpisodes ? `<section${media ? '' : ' id="details-episodes"'} class="title-episodes episode-list" tabindex="-1" aria-label="Episodes">${episodesMarkup(session)}</section>` : ''}
      ${!media ? '<section id="details-cast" class="cast-section" tabindex="-1" aria-label="Cast and crew" hidden></section><section id="details-related" class="related-section shelf" tabindex="-1" aria-label="Related titles" hidden></section>' : ''}
      ${watchSource}
    </div>`;

  renderNavigation();
  window.scrollTo(0, 0);
  titlePage.querySelector('#title-heading').focus({ preventScroll: true });
  if (media?.embed) startCatalogPlayback(session);
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
    titlePage.querySelector('[data-value="details-related"]').hidden = false;
    const title = session.item.type === 'tv' ? 'Related series' : 'Related films';
    section.innerHTML = `<div class="section-head"><h2>${title}</h2>${railControls(title)}</div><div class="poster-rail">${related.map(item => titleCard(item)).join('')}</div>`;
    observeRails(section);
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
  return `${facts.filter(Boolean).map(value => `<span>${escape(value)}</span>`).join('')}${ratingBadge(item)}${imdbVotes(item)}${session.malRating ? `<span class="catalog-score">MAL ${session.malRating.toFixed(2)}</span>` : ''}`;
}

function titleSchedule(details) {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = details?.next_episode_to_air;
  const upcomingDate = upcoming?.air_date >= today ? formatReleaseDate(upcoming.air_date) : '';
  const scheduledSeason = details?.seasons?.filter(season => season.season_number > 0 && season.air_date > today).sort((a, b) => a.air_date.localeCompare(b.air_date))[0];
  const seasonDate = formatReleaseDate(scheduledSeason?.air_date);
  const nextEpisode = upcomingDate ? `${episodeLabel(upcoming, false) || 'Next episode'} airs ${upcomingDate}` : '';
  const nextSeason = seasonDate && (!nextEpisode || scheduledSeason.season_number !== upcoming.season_number)
    ? `Season ${scheduledSeason.season_number} premieres ${seasonDate}` : '';
  return [nextEpisode, nextSeason].filter(Boolean).join(' · ');
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
  const label = item.type === 'comic' ? 'Reading list' : 'Watchlist';
  if (previous && pref('confirmRemoval') && !confirm(`Remove this title from your ${label.toLowerCase()}?`)) return;
  libraryChange('saved', item.key, previous ? null : { ...libraryTitle(item), added: Date.now(), ...(item.type !== 'comic' ? { watchStatus: 'planned' } : {}) });
  undoToast = { key: item.key, previous, accountId: account?.id };
  showToast(previous ? `Removed from ${label}` : `Added to ${label}`);
  renderLibraryControls();
}

function accountMarkup() {
  if (account) return `<div class="profile-summary"><span class="profile-avatar">${escape(account.username[0].toUpperCase())}</span><div><h3>${escape(account.username)}</h3><p>Your watchlist, ratings, and playback history.</p></div></div><div class="dialog-actions"><button type="button" class="button secondary" data-action="signout">Sign out</button><button type="button" class="button secondary" data-action="account-security" data-value="revoke-other">Sign out other devices</button><button type="button" class="button secondary" data-action="account-security" data-value="recovery-code">Generate recovery code</button></div><p class="form-status" role="status"></p>`;
  const create = accountMode === 'create';
  const reset = accountMode === 'reset';
  return `<form id="account-form"><h3>${reset ? 'Reset your password' : create ? 'Create an account' : 'Sign in to Afterframe'}</h3>
    <label for="account-name">Username</label><input id="account-name" name="username" type="text" autocomplete="username" minlength="3" maxlength="30" pattern="[A-Za-z0-9][A-Za-z0-9_\\-]{2,29}" required>
    ${create ? '<p class="field-help">Use 3–30 letters, numbers, underscores or hyphens.</p>' : ''}
    ${reset ? '<label for="recovery-code">Recovery code</label><input id="recovery-code" name="code" type="password" autocomplete="off" minlength="48" maxlength="48" required>' : ''}
    <label for="account-password">${reset ? 'New password' : 'Password'}</label><input id="account-password" name="password" type="password" autocomplete="${create || reset ? 'new-password' : 'current-password'}" minlength="8" maxlength="128" required>
    ${create ? '<p class="field-help">At least 8 characters.</p>' : ''}
    <p class="form-status" role="status"></p>
    <div class="dialog-actions"><button class="button primary" type="submit">${reset ? 'Reset password' : create ? 'Create account' : 'Sign in'}</button><button class="plain-link" type="button" data-action="account-mode" data-value="${create || reset ? 'signin' : 'create'}">${create || reset ? 'Back to sign in' : 'Create account'}</button>${create || reset ? '' : '<button class="plain-link" type="button" data-action="account-mode" data-value="reset">Use a recovery code</button>'}</div>
  </form>`;
}

function setAccount(user, library) {
  libraryRevision++;
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
      const records = { progress, reading, watched, history: watchHistory }[kind];
      if (records && entry?.at >= (records[key]?.updated || 0)) retry.push([kind, key, entry.value, entry.at]);
      else delete pending[recordKey];
    }
    write(pendingKey, pending);
    for (const change of retry) libraryChange(...change);
  }
  syncPreferences();
  accountButton.innerHTML = `${user ? `<span class="account-initial" aria-hidden="true">${escape(user.username[0].toUpperCase())}</span>` : icon('user')}<span class="account-name">${user ? escape(user.username) : 'Sign in'}</span>`;
  accountButton.setAttribute('aria-label', user ? `Account for ${user.username}` : 'Sign in');
  renderNavigation();
  if (accountDialog.open) accountBody.innerHTML = accountMarkup();
  renderLibraryControls();
  if (!active && state.page === 'home') render();
  if (!active && state.page === 'recommendations') refreshCatalog();
}

function openAccount() {
  if (!accountReady) return;
  accountMode = 'signin';
  accountBody.innerHTML = accountMarkup();
  accountDialog.showModal();
  accountBody.querySelector('input')?.focus();
}

async function syncLibrary() {
  if (!account || active?.media || syncingLibrary || document.hidden || accountDialog.open || settingsDialog.open) return;
  const profile = account.id;
  const revision = libraryRevision;
  syncingLibrary = true;
  try {
    await libraryQueue;
    const { account: user, library } = await api('/api/account');
    if (account?.id !== profile || revision !== libraryRevision || active?.media || accountDialog.open || settingsDialog.open) return;
    if (user?.id === profile) {
      const current = { saved, progress, reading, ratings, watched, preferences, history: watchHistory, notifications };
      if (Object.entries(current).some(([kind, entries]) => JSON.stringify(entries) !== JSON.stringify(library[kind])) || Object.keys(read(`pendingPlayback.${profile}`, {})).length) setAccount(user, library);
    } else if (!user) setAccount(null);
  } catch { /* Retry on the next sync. */ }
  finally { syncingLibrary = false; }
}

async function changeWatchStatus(event) {
  const { watchKey } = event.target.dataset;
  const entry = saved[watchKey];
  const value = event.target.value;
  if (!entry || !Object.hasOwn(watchStatuses, value) || (watchStatus(entry) === value && !(value === 'completed' && entry.type === 'tv' && !entry.completedAt))) return;
  const metadata = titles.get(watchKey);
  if (value === 'completed' && entry.type === 'tv') {
    const control = event.target;
    const accountId = account?.id;
    control.disabled = true;
    try {
      const item = metadata || entry;
      const details = item.episodes ? null : detailsCache.get(item.key) || await api(`/api/tv/${item.id}`);
      const seasons = (details?.seasons || []).filter(season => season.season_number > 0 && season.episode_count > 0 && airedEpisode(season));
      const entries = item.episodes ? [...item.episodes] : [];
      for (let start = 0; start < seasons.length; start += 5) {
        const batch = await Promise.all(seasons.slice(start, start + 5).map(season => getSeason(item, season.season_number)));
        entries.push(...batch.flatMap(season => season.episodes || []));
      }
      const last = details?.last_episode_to_air;
      const today = new Date().toISOString().slice(0, 10);
      const episodes = entries
        .filter(episode => episode.key || (episode.air_date && episode.air_date < today) || ((!episode.air_date || episode.air_date === today) && last
          && (episode.season_number < last.season_number || episode.season_number === last.season_number && episode.episode_number <= last.episode_number)))
        .map(episode => episode.key || `cinesrc-s${episode.season_number}e${episode.episode_number}`);
      if (account?.id !== accountId || saved[watchKey] !== entry) return;
      const totalEpisodes = details?.number_of_episodes || item.episodes?.length || entry.totalEpisodes;
      const update = async () => {
        if (account?.id !== accountId) return;
        const updated = Date.now();
        const result = accountId ? await post('/api/account/complete-series', { accountId, episodes, item: { key: watchKey, type: 'tv', totalEpisodes } })
          : { updated, saved: { ...entry, totalEpisodes, watchStatus: 'completed', completedAt: updated } };
        if (account?.id !== accountId) return;
        libraryRevision++;
        saved[watchKey] = result.saved;
        for (const episode of episodes) {
          const key = `${watchKey}/${episode}`;
          watched[key] ||= { item: libraryTitle(item), updated: result.updated };
          delete progress[key];
        }
        if (!accountId) { write('saved', saved); write('watched', watched); write('progress', progress); }
        renderLibraryControls();
        if (active?.item.key === watchKey) renderEpisodeRows(active);
        showToast(`Completed · ${episodes.length} aired ${episodes.length === 1 ? 'episode' : 'episodes'} marked watched`);
      };
      const pending = libraryQueue.then(update);
      libraryQueue = pending.catch(() => {});
      await pending;
    } catch (error) {
      control.value = watchStatus(saved[watchKey]);
      showToast(error.message || 'Could not complete this series.');
    } finally {
      control.disabled = false;
      document.querySelector(`[data-watch-key="${CSS.escape(watchKey)}"]`)?.focus({ preventScroll: true });
    }
    return;
  }
  libraryChange('saved', watchKey, { ...entry, totalEpisodes: metadata?.totalEpisodes ?? entry.totalEpisodes, watchStatus: value });
  renderLibraryControls();
  document.querySelector(`[data-watch-key="${CSS.escape(watchKey)}"]`)?.focus({ preventScroll: true });
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
    if (value && value !== (name === 'sort' && state.page === 'new' ? 'newest' : defaults[name])) params.set(name === 'category' ? 'genre' : name, value);
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

function refreshTitleRating(session) {
  const { imdb, key } = session.item;
  if (!imdb) return;
  api(`/api/imdb?id=${encodeURIComponent(imdb)}`).then(({ rating }) => {
    if (!rating) return;
    imdbScores.set(imdb, rating);
    imdbScores.set(key, rating);
    const facts = titlePage.querySelector('.title-facts');
    if (active === session && facts) facts.innerHTML = titleFacts(session);
  }).catch(() => {});
}

function updateConnectionForms() {
  const managed = state.managedIntegrations;
  const integrationNote = settingsDialog.querySelector('#integration-note');
  integrationNote.textContent = managed ? 'The server administrator manages these integrations.' : 'Afterframe saves these keys on this computer and uses them for all local profiles.';
  for (const form of connectionForms) {
    form.querySelector('details').hidden = Boolean(managed);
    if (form.elements.credential.disabled) continue;
    const connected = form.dataset.provider === 'tmdb' ? state.connected : state.omdbConnected;
    const status = form.querySelector('.connection-status');
    if (status.dataset.error === 'true' || status.textContent === 'Verified and saved') continue;
    status.textContent = connected ? 'Configured' : managed ? 'Not configured on the server' : 'Key needed';
    status.dataset.connected = connected;
    delete status.dataset.error;
  }
}

function selectSettingsTab(name) {
  for (const tab of settingsTabs) {
    const selected = tab.dataset.value === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    panel.hidden = !selected;
    if (panel.hidden) for (const disclosure of panel.querySelectorAll('details[open]')) disclosure.open = false;
  }
}

function openSettings(tab = 'general') {
  syncPreferences();
  updateConnectionForms();
  selectSettingsTab(tab);
  settingsDialog.showModal();
  settingsTabs.find(button => button.dataset.value === tab)?.focus();
}

document.addEventListener('click', event => {
  const control = event.target.closest('[data-action]');
  if (!control) return;
  const { action, key, value } = control.dataset;
  const item = titles.get(key);
  if (action === 'settings') openSettings(value);
  if (action === 'settings-tab') selectSettingsTab(value);
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
      showToast(titles.get(key)?.type === 'comic' ? 'Reading list change undone' : 'Watchlist change undone');
    } else {
      toast.hidden = true;
    }
  }
  if (action === 'account') openAccount();
  if (action === 'account-mode') {
    accountMode = value;
    accountBody.innerHTML = accountMarkup();
    accountBody.querySelector('input').focus();
  }
  if (action === 'account-security' && account) {
    const status = accountBody.querySelector('.form-status');
    control.disabled = true;
    post(`/api/account/${value}`).then(result => {
      status.textContent = result.code ? `Save this one-time recovery code somewhere safe. Generating another code replaces it. ${result.code}` : 'Other sessions were signed out.';
    }).catch(error => { status.textContent = error.message; }).finally(() => { control.disabled = false; });
  }
  if (action === 'more-history') {
    state.historyPage++;
    render();
  }
  if (action === 'notification-read' && account) {
    const accountId = account.id;
    post('/api/account/notifications-read', { key }).then(() => {
      if (account?.id !== accountId || !notifications[key]) return;
      libraryRevision++;
      notifications[key].read = true;
      renderNavigation();
      if (state.page === 'notifications' && !active) render();
    }).catch(error => showToast(error.message));
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
  if (action === 'episode' && active) playEpisodeChoice(active, active.item.episodes?.find(episode => episode.key === key));
  if (action === 'stream-episode' && active) playEpisodeChoice(active, episodeFromControl(control));
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
    const revealed = !active.revealed.get(key).has('image');
    if (revealed) active.revealed.get(key).add('image');
    else active.revealed.get(key).delete('image');
    control.classList.toggle('is-spoiler', !revealed);
    control.setAttribute('aria-pressed', String(revealed));
    control.title = revealed ? 'Hide thumbnail' : 'Reveal thumbnail';
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
  if (action === 'home-feature' && state.page === 'home' && item) {
    state.featuredKey = key;
    render();
  }
  if (action === 'home-trending' && state.page === 'home' && ['all', 'movie', 'tv'].includes(value)) {
    state.homeTrending = value;
    const rail = control.closest('.shelf').querySelector('.poster-rail');
    if (rail) rail.scrollLeft = 0;
    render();
  }
  if (action === 'details-section' && active && !active.media) {
    const section = titlePage.querySelector(`#${CSS.escape(value)}`);
    if (section && !section.hidden) {
      titlePage.querySelector('.details-nav [aria-current]')?.removeAttribute('aria-current');
      control.setAttribute('aria-current', 'location');
      section.focus({ preventScroll: true });
      section.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }
  if (action === 'rail' && control.getAttribute('aria-disabled') !== 'true') {
    const rail = control.closest('.shelf').querySelector('.poster-rail');
    rail.scrollBy({ left: Number(value) * rail.clientWidth * .8, behavior: pref('reducedMotion') || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  if (action === 'refresh') refreshCatalog();
  if (action === 'more-tmdb' && !state.loading && state.remoteNext) loadTMDB(requestId, state.remoteNext);
  if (action === 'cine-options' && active?.embedPlayback) {
    active.providerControls = !active.providerControls;
    reloadCineSrc(active);
    const focus = active.providerControls ? '.embed-notice [data-action="cine-options"]' : '[data-player="play"]';
    titlePage.querySelector(focus)?.focus({ preventScroll: true });
  }
  if (action === 'video-provider' && active?.media?.embed) {
    stopVideo();
    active.embedPlayback = null;
    active.animeProvider = animePlayers[active.animeProvider || 'cinesrc'].next;
    startCatalogPlayback(active);
  }
  if (['retry-video', 'direct-video'].includes(action) && active?.media) {
    stopVideo();
    if (active.media.embed) {
      active.embedPlayback = null;
      startCatalogPlayback(active);
    }
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
    titlePage.querySelector('.player-transport [data-action="next-episode"], .video-box:not(:has(.player-transport)) iframe')?.focus({ preventScroll: true });
  }
});

main.addEventListener('submit', event => {
  if (event.target.dataset.discoveryForm) {
    event.preventDefault();
    const { discoveryForm } = event.target.dataset;
    if (!discoveryPath.test(discoveryForm)) return;
    const params = new URLSearchParams(new FormData(event.target));
    const hash = `#${discoveryForm}?${params}`;
    if (location.hash === hash) refreshCatalog();
    else location.hash = hash;
    return;
  }
  if (event.target.id === 'watchlist-filters') {
    event.preventDefault();
    state.libraryFilters = Object.fromEntries(new FormData(event.target));
    state.libraryFilters.query = state.libraryFilters.query.trim();
    render();
    return;
  }
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
  if (target.matches('[data-watch-key]')) return changeWatchStatus(event);
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
settingsDialog.addEventListener('close', () => {
  for (const disclosure of settingsDialog.querySelectorAll('details[open]')) disclosure.open = false;
});
settingsDialog.addEventListener('keydown', event => {
  if (!settingsTabs.includes(event.target) || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const first = event.key === 'Home' || (!['Home', 'End'].includes(event.key) && event.target === settingsTabs.at(-1));
  const tab = first ? settingsTabs[0] : settingsTabs.at(-1);
  selectSettingsTab(tab.dataset.value);
  tab.focus();
});
titlePage.addEventListener('change', event => {
  if (!active) return;
  if (event.target.matches('[data-watch-key]')) return changeWatchStatus(event);
  if (event.target.matches('.episode-range') && active.seasonData) {
    active.episodeRange = Number(event.target.value);
    renderEpisodeRows(active);
  }
  if (event.target.matches('[name="personal-rating"]')) {
    const score = Number(event.target.value);
    if (score) libraryChange('ratings', active.item.key, { score, scale: 10, item: libraryTitle(active.item) });
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
    jumpPlayback(key === 'arrowleft' ? -10 : 10);
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
    if (accountMode === 'reset') {
      accountMode = 'signin';
      accountBody.innerHTML = accountMarkup();
      accountBody.querySelector('.form-status').textContent = 'Password reset. Sign in with your new password.';
      accountBody.querySelector('input').focus();
      return;
    }
    setAccount(user, library);
    accountDialog.close();
    showToast(`Signed in as ${user.username}`);
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
});
settingsDialog.addEventListener('change', event => {
  const languagePreference = event.target.dataset.languagePreference;
  if (languagePreference) {
    if (languagePreference === 'subtitleLanguage' && event.target.value && !pref('subtitles')) libraryChange('preferences', 'subtitles', true);
    libraryChange('preferences', languagePreference, event.target.value);
    if (languagePreference === 'subtitleLanguage') {
      syncPreferences();
      document.dispatchEvent(new Event('afterframe-subtitle-preference'));
    }
    return;
  }
  if (event.target.id === 'preferred-quality') {
    libraryChange('preferences', 'quality', event.target.value);
    return;
  }
  const name = event.target.dataset.preference;
  if (!name || !Object.hasOwn(preferenceDefaults, name)) return;
  libraryChange('preferences', name, event.target.checked);
  syncPreferences();
  if (name === 'subtitles') document.dispatchEvent(new Event('afterframe-subtitle-preference'));
  if (name === 'autoplay' && active?.media) {
    if (pref('autoplay')) startCountdown(active);
    else cancelCountdown(active);
  }
});
for (const form of connectionForms) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const provider = form.dataset.provider;
    const button = form.querySelector('button[type="submit"]');
    const input = form.elements.credential;
    const status = form.querySelector('.connection-status');
    if (input.disabled) return;
    const credential = input.value.trim();
    input.disabled = button.disabled = true;
    delete status.dataset.error;
    status.textContent = 'Checking key…';
    try {
      const { connected, omdbConnected } = await post('/api/connection', { provider, credential });
      state.connected ||= connected;
      state.omdbConnected ||= omdbConnected;
      input.value = '';
      status.dataset.connected = 'true';
      status.textContent = 'Verified and saved';
      if (provider === 'omdb') {
        checkedRatings.clear();
        if (active) {
          refreshTitleRating(active);
          const related = titlePage.querySelector('.related-section:not([hidden])');
          if (related) syncCardRatings(related);
        }
      }
      refreshCatalog();
    } catch (error) {
      status.textContent = error.message;
      status.dataset.error = 'true';
    } finally {
      input.disabled = button.disabled = false;
    }
  });
}

document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
document.addEventListener('error', ({ target }) => {
  if (target instanceof HTMLImageElement && target.getAttribute('src')?.startsWith('/comic-cover/')) target.remove();
}, true);
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
  searchTimer = setTimeout(fetchSuggestions, state.page === 'comics' ? 400 : 260);
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
window.addEventListener('focus', syncLibrary);
document.addEventListener('visibilitychange', syncLibrary);
setInterval(syncLibrary, 30000);
window.addEventListener('pagehide', savePlayback);
api('/api/status').then(({ connected, omdbConnected, managedIntegrations }) => {
  state.connected ||= connected;
  state.omdbConnected ||= omdbConnected;
  state.managedIntegrations = managedIntegrations;
  if (settingsDialog.open) updateConnectionForms();
  if (connected) refreshCatalog();
}).catch(() => { /* The local archive catalog works while the connection is unavailable. */ });
accountButton.disabled = true;
const initialAccount = api('/api/account').then(({ account: user, library }) => {
  setAccount(user, library);
}).catch(() => {
  accountReady = true;
}).finally(() => { accountButton.disabled = false; });
const comics = createComics({
  main, titlePage, api, escape, icon, grid, shelf, observeRails, saveButton, titles, read, write,
  getReading: key => reading[key],
  recordReading: (item, entry) => libraryChange('reading', item.key, { ...entry, item: libraryTitle(item), updated: Date.now() }),
});
const discoveryPages = createDiscoveryPages({
  main, api, escape, footer, grid, localizeTitle, syncCardRatings,
  library: () => {
    if (account) return null;
    const take = (entries, limit) => Object.values(entries).slice(-limit);
    const compact = item => ({ key: item.key, id: item.id, title: item.title.slice(0, 120), type: item.type, genreIds: item.genreIds?.slice(0, 12) });
    return {
      history: take(watchHistory, 60).map(({ item, mediaKey, completed, coverage, duration, updated }) => ({ item: compact(item), mediaKey, completed, coverage, duration, updated })),
      saved: Object.fromEntries(take(saved, 75).map(item => [item.key, { ...compact(item), watchStatus: item.watchStatus }])),
      ratings: take(ratings, 50).map(({ score, item }) => ({ score, item: compact(item) })),
      watched: take(watched, 50).filter(({ item }) => item.type === 'movie').map(({ item }) => ({ item: compact(item) })),
    };
  },
});
route();
