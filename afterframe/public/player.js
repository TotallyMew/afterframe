import { withGuestLibraryLock, writeGuestRecords } from './guest-storage.js';
import { archiveCatalog, archiveFileUrl } from './catalog.js';
import { categories, isAnime } from './discover.js';
import { preferenceDefaults, viewingSession, mergeRanges, samplePlayback, completionReached, watchedSeconds, activeSkipSegment, bufferedIntervals, movieDurationMismatch } from './playback.js';
import { findSubtitles, loadSubtitle, playbackLanguage, samePlaybackLanguage } from './subtitles.js';
import { ratingOnTen, watchStatus, watchStatuses } from './library.js';

const icons = {
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4m-4 6h4m10-6h4m-4 6h4"/>',
  tv: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="m8 2 4 4 4-4M8 22h8"/>',
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
  fullscreen: '<path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"/>',
  'exit-fullscreen': '<path d="M4 8h4V4m12 4h-4V4M8 20v-4H4m12 4v-4h4"/>',
  'chevron-left': '<path d="m15 6-6 6 6 6"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  'previous-episode': '<path d="M5 5v14m14-14-11 7 11 7z"/>',
  'next-episode': '<path d="M19 5v14M5 5l11 7-11 7z"/>',
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

const titlePage = document.querySelector('#title-page');
const toast = document.querySelector('#toast');
const backControl = document.querySelector('#player-return');
const requestedReturn = new URLSearchParams(location.search).get('return');
const returnTo = requestedReturn && /^\/#[-/?&=%.a-z0-9_]+$/i.test(requestedReturn) ? requestedReturn : '';
const titles = new Map(archiveCatalog.map(item => [item.key, item]));
const detailsCache = new Map();
const seasonCache = new Map();
const imdbScores = new Map();
const completingSeries = new Set();

let saved;
let progress;
let ratings;
let watched;
let watchHistory;
let preferences;
let account = null;
let accountReady = false;
let accountLibraryVerified = false;
let libraryQueue = Promise.resolve();
let libraryRevision = 0;
let syncingLibrary = false;
let active = null;
let openingId = 0;
let episodeChoice;
let toastTimer;
let undoToast;

const cineSrcOrigin = 'https://cinesrc.st';

const cineSrcServers = new Map();

const animePlayers = {
  animeembed: { label: 'AnimeEmbed', origin: 'https://animeembed.com', next: 'anipm' },
  anipm: { label: 'Ani.pm', origin: 'https://ani.pm', next: 'cinesrc' },
  cinesrc: { label: 'CineSrc', origin: cineSrcOrigin, next: 'animeembed' },
};

function libraryTitle(item) {
  const { key, id, archiveId, title, year, date, type, poster, backdrop, genre, genreIds, categories, originalLanguage, totalEpisodes } = item;
  return { key, id, archiveId, title, year, date, type, poster, backdrop, genre, genreIds, categories, originalLanguage, totalEpisodes };
}

function useLibrary(library = null) {
  saved = Object.assign(Object.create(null), library?.saved || read('saved', {}));
  progress = Object.assign(Object.create(null), library?.progress || read('progress', {}));
  ratings = Object.assign(Object.create(null), Object.fromEntries(Object.entries(library ? library.ratings || {} : read('ratings', {})).map(([key, entry]) => [key, ratingOnTen(entry)])));
  watched = Object.assign(Object.create(null), library ? library.watched : read('watched', {}));
  preferences = Object.assign(Object.create(null), library ? library.preferences : read('preferences', {}));
  watchHistory = Object.assign(Object.create(null), library ? library.history : read('history', {}));
  const tracked = [progress, ratings, watched, watchHistory].flatMap(records => Object.values(records).map(entry => entry.item));
  for (const item of [...Object.values(saved), ...tracked]) {
    if (item?.key && !titles.has(item.key)) titles.set(item.key, item);
  }
}

async function api(path, options) {
  const deadline = AbortSignal.timeout(30_000);
  const signal = options?.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  let response;
  try { response = await fetch(path, { ...options, signal }); }
  catch (error) {
    if (deadline.aborted) throw new Error('The request took too long. Try again.');
    throw error;
  }
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: response.status });
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
  if (active?.seasonData) renderEpisodeRows(active);
}

function guestCommit(changes) {
  return withGuestLibraryLock(() => {
    const records = new Map();
    for (const { kind, key, value, expected, requireSaved } of changes) {
      if (!records.has(kind)) records.set(kind, { ...read(kind, {}) });
      const next = records.get(kind);
      if (requireSaved && !next[key]) throw new Error('Save the series before completing it.');
      if (expected && JSON.stringify(next[key] ?? null) !== JSON.stringify(expected.value)) throw new Error('This item changed after your edit. Its newer state was kept.');
      if (value === null) delete next[key];
      else next[key] = value;
    }
    writeGuestRecords(records);
  });
}

function retainLibraryChange(change) {
  try {
    const key = 'afterframe.deferred-edits';
    const stored = JSON.parse(sessionStorage.getItem(key) || '[]');
    const edits = Array.isArray(stored) ? stored : [];
    const next = edits.filter(entry => entry?.at > Date.now() - 15 * 60_000 &&
      (entry.accountId !== change.accountId || entry.kind !== change.kind || entry.key !== change.key));
    sessionStorage.setItem(key, JSON.stringify([...next, change]));
    return true;
  } catch { return false; }
}

function expiredLibraryChange(change) {
  accountLibraryVerified = false;
  const kept = change && retainLibraryChange(change);
  showToast(kept ? 'Your session expired. Sign in to recover your change.' : 'Your session expired. Sign in before making another change.', null, 'signin');
}

function rejectedLibraryChange(error, change) {
  if (error.status === 401) expiredLibraryChange(change);
  else if (error.status === 403) showToast('This account does not have permission to make the change.');
  else if (change && (!error.status || error.status === 429 || error.status >= 500) && retainLibraryChange(change)) {
    showToast(`Could not save this change. Open Library to retry “${change.label}”.`, null, 'library');
  } else showToast(error.message || 'Could not save this change. Try again.');
}

function libraryChange(kind, key, value, at = Date.now(), expected) {
  if (!accountLibraryVerified) {
    if (['saved', 'watched', 'ratings', 'preferences'].includes(kind)) showToast('Reconnect or sign in before changing your library.');
    return Promise.resolve(false);
  }
  libraryRevision++;
  const records = { saved, progress, ratings, watched, preferences, history: watchHistory }[kind];
  const previous = records[key];
  if (value === null) delete records[key];
  else records[key] = value;
  if (!account) {
    return guestCommit([{ kind, key, value, expected }]).then(() => true, error => {
      if (records[key] === value || value === null && !Object.hasOwn(records, key)) {
        if (previous === undefined) delete records[key];
        else records[key] = previous;
      }
      renderLibraryControls();
      if (kind === 'preferences') syncPreferences();
      showToast(expected ? error.message : 'This browser could not store your change.');
      return false;
    });
  }
  const accountId = account.id;
  const pendingKey = `pendingPlayback.${accountId}`;
  const recordKey = `${kind}/${key}`;
  const queued = ['progress', 'history'].includes(kind) ? { value, at } : null;
  if (queued) write(pendingKey, { ...read(pendingKey, {}), [recordKey]: queued });
  return libraryQueue = libraryQueue.catch(() => {}).then(async () => {
    if (account?.id !== accountId) return;
    try {
      const result = await post('/api/account/library', { accountId, kind, key, value, at, expectedAt: expected?.revision }, true);
      if (queued) {
        const pending = read(pendingKey, {});
        if (pending[recordKey]?.at === queued.at && JSON.stringify(pending[recordKey].value) === JSON.stringify(value)) {
          delete pending[recordKey];
          write(pendingKey, pending);
        }
      }
      if (result.stale && expected) throw new Error('This item changed after your edit. Its newer state was kept.');
      if (result.stale) { void syncLibrary(); return false; }
      return result;
    } catch (error) {
      const expired = error.status === 401;
      if (queued) {
        if (expired) expiredLibraryChange();
        return false;
      }
      if (account?.id === accountId && (records[key] === value || (value === null && !Object.hasOwn(records, key)))) {
        if (previous === undefined) delete records[key];
        else records[key] = previous;
        if (kind === 'saved' && undoToast?.key === key) undoToast = null;
        renderLibraryControls();
        if (kind === 'preferences') syncPreferences();
      }
      const title = value?.title || value?.item?.title || previous?.title || previous?.item?.title || titles.get(key)?.title;
      const labels = { saved: value ? 'Save' : 'Remove', watched: 'Update watched status for', ratings: 'Update rating for' };
      if (expected && !expired && !error.status) showToast(error.message);
      else rejectedLibraryChange(error, !expected && labels[kind] && { accountId, kind, key, value, at, label: `${labels[kind]} ${title || 'title'}` });
      return false;
    }
  });
}

function imagePath(path, size = 'w500') {
  return /^\/[a-z0-9]+\.(jpg|png|webp)$/i.test(path || '') ? `https://image.tmdb.org/t/p/${size}${path}` : '';
}

function localizeTitle(item) {
  const key = `${item.media_type}-${item.id}`;
  if (item.catalog_facts?.rating) imdbScores.set(key, item.catalog_facts.rating);
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

function seriesStatus(status) {
  return ({ 'Returning Series': 'Ongoing', Ended: 'Ended', Canceled: 'Canceled', 'In Production': 'In production', Planned: 'Planned', Pilot: 'Pilot' })[status] || '';
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

function saveButton(item) {
  const isSaved = Object.hasOwn(saved, item.key);
  const label = 'Watchlist';
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
  const pending = completingSeries.has(item.key);
  return `<label class="watch-status"${entry ? '' : ' hidden'}><select data-watch-key="${escape(item.key)}" aria-label="Watch status for ${escape(item.title)}"${pending ? ' disabled aria-busy="true"' : ''}>${Object.entries(watchStatuses).map(([value, label]) => `<option value="${value}"${watchStatus(entry) === value ? ' selected' : ''}>${label}</option>`).join('')}</select><small class="watch-status-message" role="status">${pending ? 'Marking aired episodes…' : ''}</small></label>`;
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
    const label = 'Watchlist';
    button.innerHTML = `${icon(isSaved ? 'check' : 'plus')} ${isSaved ? `In ${label}` : label}`;
  }
  for (const button of titlePage.querySelectorAll('[data-action="mark-watched"]')) {
    const marked = Object.hasOwn(watched, button.dataset.watchedKey);
    button.setAttribute('aria-pressed', marked);
    if (button.classList.contains('episode-status')) {
      button.title = marked ? 'Mark episode unwatched' : 'Mark episode watched';
      const label = marked ? 'Watched' : 'Mark watched';
      button.setAttribute('aria-label', `${label}: ${button.dataset.episodeTitle}`);
      button.querySelector('small').textContent = label;
    } else button.innerHTML = marked ? `${icon('check')} Watched` : 'Mark watched';
  }
  if (active) updateSeriesTracking(active);
}

function hasReleased(item) {
  return Boolean(item.date && item.date <= new Date().toISOString().slice(0, 10));
}

function detailsHref(item) {
  return isArchive(item) ? "#" + titlePath(item) : "/#" + titlePath(item);
}

function fallbackHref(type, id, key, playing = true) {
  if (returnTo) return returnTo;
  if (type) return "/#" + type + "/" + id;
  return key && playing ? "#edition/" + encodeURIComponent(key) : "/#home";
}

function route() {
  const match = location.hash.slice(1).match(/^(?:(movie|tv)\/([1-9]\d{0,9})|edition\/([\w.-]+))(?:\/(watch|s(\d{1,4})e([1-9]\d{0,3}))(?:\/([\w-]+))?)?$/);
  if (!match) {
    openingId++;
    stopVideo();
    active = null;
    titlePage.className = "title-page";
    titlePage.innerHTML = '<div class="title-status"><h1 tabindex="-1">Title unavailable</h1><p>This playback link is incomplete.</p><a class="button secondary" href="/#home">Browse Afterframe</a></div>';
    titlePage.querySelector("h1").focus();
    return;
  }
  if (!match[3] && !match[4]) {
    location.replace("/#" + match[1] + "/" + match[2]);
    return;
  }
  routeTitle(match);
}

function navigateTitle(item, suffix = '') {
  const hash = `#${titlePath(item)}${suffix}`;
  if (location.hash === hash) route();
  else location.hash = hash;
}

function titleFailure(error, back = returnTo || '/#home', alternate) {
  titlePage.innerHTML = `<div class="title-status"><h1 id="title-heading" tabindex="-1">Title unavailable</h1><p role="alert">${escape(error.message)}</p>
    <button class="button secondary" type="button" data-action="retry-title">Retry</button>
    <a class="button secondary" href="${escape(back)}">Back</a>
    ${alternate ? `<a class="button secondary" href="#${titlePath(alternate)}/watch">Play licensed Archive edition</a>` : ''}</div>`;
  titlePage.querySelector('h1').focus();
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
  titlePage.hidden = false;
  titlePage.className = 'title-page';
  titlePage.innerHTML = `<div class="title-status" role="status">Loading title…</div>`;
  let item = titles.get(itemKey);
  const playback = Boolean(episode || (type === 'movie' && mode === 'watch'));
  if (playback && !document.querySelector('link[data-video-preconnect]')) {
    const connection = document.createElement('link');
    connection.rel = 'preconnect';
    connection.href = cineSrcOrigin;
    connection.dataset.videoPreconnect = '';
    document.head.append(connection);
  }
  let playbackDetails;
  try {
    if (type && (playback || !item || (!item.originalLanguage && !isArchive(item)))) {
      const details = detailsCache.get(itemKey) || await api(`/api/${type}/${id}${playback ? '/playback' : ''}`);
      if (opening !== openingId) return;
      if (playback) playbackDetails = details;
      else detailsCache.set(itemKey, details);
      item = localizeTitle({ ...details, media_type: type });
    } else if (key?.startsWith('archive-') && !item?.media) {
      item = await api(`/api/archive/${encodeURIComponent(key.slice(8))}`);
      if (opening !== openingId) return;
      titles.set(item.key, item);
    }
    if (!item) throw new Error('This title could not be found.');
    if (episode) {
      openTitle(item, false, undefined, { embed: true, episode, details: playbackDetails, progressKey: cineSrcKey(item, episode) });
    } else if (mode === 'watch') {
      if (type === 'movie') openTitle(item, false, undefined, { embed: true, details: playbackDetails, progressKey: cineSrcKey(item) });
      else if (isArchive(item)) openTitle(item, true, editionEpisode);
      else openTitle(item);
    } else openTitle(item);
  } catch (error) {
    if (opening !== openingId) return;
    const alternate = type === 'movie' && playback ? archiveCatalog.find(entry => entry.type === type && entry.id === Number(id) && entry.media) : undefined;
    titleFailure(error, fallbackHref(type, id, key, Boolean(mode)), alternate);
  }
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
  document.title = `${session.episode.title} · Afterframe`;
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
  if (episode) return `<button class="icon-button episode-status" type="button" ${data} data-episode-title="${escape(episode.title)}" aria-label="${marked ? 'Watched' : 'Mark watched'}: ${escape(episode.title)}" title="${label}"><span class="episode-check" aria-hidden="true">${icon('check')}</span><small aria-hidden="true">${marked ? 'Watched' : 'Mark watched'}</small></button>`;
  return `<button class="button secondary" type="button" ${data}>${marked ? `${icon('check')} Watched` : 'Mark watched'}</button>`;
}

function recordWatched(item, key, marked = true) {
  const value = marked ? { item: libraryTitle(item), updated: Date.now() } : null;
  const commit = libraryChange('watched', key, value);
  renderLibraryControls();
  if (active?.seasonData && active.item.key === item.key) {
    const focused = document.activeElement?.dataset.watchedKey;
    if (!marked) active.revealed?.delete(key);
    renderEpisodeRows(active);
    if (focused === key) titlePage.querySelector(`.episode-status[data-watched-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  }
  return commit;
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
    ${protectImage ? `<button class="episode-image episode-reveal${blurred ? ' is-spoiler' : ''}" type="button" data-action="reveal-episode" aria-label="${blurred ? 'Reveal' : 'Hide'} thumbnail for ${escape(coordinates.title)}" aria-pressed="${!blurred}" title="${blurred ? 'Reveal' : 'Hide'} thumbnail">${thumbnail}<span class="episode-reveal-icon" aria-hidden="true">${icon('eye')}${blurred ? 'Reveal' : 'Hide'}</span></button>` : `<div class="episode-image">${thumbnail}</div>`}
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
    if (playback.durationMismatch && ['play', 'seek'].includes(command)) return;
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
      <a class="player-button player-back" href="${escape(returnTo || detailsHref(item))}" aria-label="${returnTo ? 'Back to Afterframe' : `Back to ${escape(item.title)}`}">${icon('chevron-left')}<span>${returnTo ? 'Back' : 'Back to details'}</span></a>
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
              <div class="player-popup-heading"><span>Afterframe subtitles</span><button class="player-popup-action subtitle-off" type="button" aria-pressed="true">Off</button></div>
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
              ${session.media.embed ? `<button class="player-provider" type="button" data-action="cine-options">Provider video sources ${icon('chevron-right')}</button>` : ''}
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
  const previousDuration = progress[progressKey]?.duration;
  const resumeTime = item.type === 'movie' && movieDurationMismatch(item.duration, previousDuration)
    ? null : restore?.time ?? cineResumeTime(progressKey);
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
  loading.innerHTML = `${item.backdrop ? `<img src="${escape(item.backdrop)}" alt="">` : ''}<span role="status"></span>`;
  const loadingLabel = loading.querySelector('span');

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
    const pending = Boolean(message) && !canRetry;
    status.textContent = message;
    notice.hidden = !canRetry && !session.providerControls && useAnime.hidden;
    status.hidden = !canRetry && !(session.providerControls && pending);
    retry.hidden = !canRetry;
    loading.hidden = !pending || session.providerControls;
    loadingLabel.textContent = pending ? message : '';
  };
  let timer;
  let slowTimer;
  let recoveryTimer;
  const clearStreamTimeout = () => {
    clearTimeout(timer);
    clearTimeout(slowTimer);
    timer = slowTimer = undefined;
  };
  const waitForStream = (message = 'Loading player…', restart = true) => {
    if (!restart && timer !== undefined) {
      if (slowTimer !== undefined) setStatus(message);
      return;
    }
    clearStreamTimeout();
    setStatus(message);
    slowTimer = setTimeout(() => {
      slowTimer = undefined;
      setStatus('Still connecting to the video source. You can try another source.', true);
    }, 8000);
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
      clearStreamTimeout();
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
    if (!checkMovieDuration(duration)) return;
    const previous = playback.position;
    const previousDuration = previous?.duration || progress[session.progressKey]?.duration;
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
      if (!previous || (!seeking && currentTime > previous.currentTime + .05)) {
        clearStreamTimeout();
        setStatus();
        if (!playback.paused) startStreamTimeout();
      }
      trackPosition(playback.position, session, seeking);
      loadSkipSegments(playback.position, session);
      if (!seeking) remember(playback.position, session);
    }
  }

  function checkMovieDuration(duration) {
    if (playback.durationMismatch) return false;
    if (item.type !== 'movie' || !movieDurationMismatch(item.duration, duration)) return true;
    playback.durationMismatch = true;
    playback.position = null;
    playback.paused = true;
    session.cineSrcServer = null;
    cineSrcServers.delete(item.key);
    session.tracking.sample = null;
    clearStreamTimeout();
    playerCommand('pause');
    controls?.updatePlayback();
    controls?.updatePosition();
    setStatus(`This source reports ${Math.round(duration / 60)} min; the catalogue lists ${item.duration} min. Choose another source.`, true);
    return false;
  }

  function startStreamTimeout() {
    clearStreamTimeout();
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
        playerCommand('getDuration');
        playerCommand('getCurrentTime');
        break;
      case 'cinesrc:play':
        if (playback.durationMismatch) { playerCommand('pause'); break; }
        resumePlayback(session);
        picture.hidden = false;
        playback.paused = false;
        controls?.updatePlayback();
        if (playback.position) {
          playback.position.paused = false;
          trackPosition(playback.position, session);
        }
        if (!playback.unidentifiedEpisode && playback.position) {
          setStatus();
          startStreamTimeout();
        }
        break;
      case 'cinesrc:loadedmetadata':
        if (Number.isFinite(data.duration) && data.duration > 0) {
          if (!checkMovieDuration(data.duration)) break;
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
        if (!checkMovieDuration(data.duration)) break;
        playback.lastUpdate = performance.now();
        if (data.currentTime > 0) picture.hidden = false;
        if (playback.resumeTime && data.type === 'cinesrc:timeupdate') resumeEmbeddedEpisode(data.duration);
        const seeking = data.type === 'cinesrc:seeked' || performance.now() - (playback.seekStarted ?? -Infinity) < 1800;
        if (!seeking && playback.position && data.currentTime > playback.position.currentTime + .05) {
          playback.paused = false;
          if (playback.sourceId && cineSrcServers.get(item.key) !== playback.sourceId) {
            cineSrcServers.delete(item.key);
            if (cineSrcServers.size >= 32) cineSrcServers.delete(cineSrcServers.keys().next().value);
            cineSrcServers.set(item.key, playback.sourceId);
            session.cineSrcServer = playback.sourceId;
          }
        }
        if (data.type === 'cinesrc:seeked' && (!Number.isFinite(playback.seekTarget) || Math.abs(data.currentTime - playback.seekTarget) < 1)) {
          playback.seekStarted = null;
          playback.seekTarget = null;
        }
        readPosition(data.currentTime, data.duration, seeking);
        break;
      case 'cinesrc:pause':
        playback.paused = true;
        controls?.updatePlayback();
        controls?.updatePosition();
        if (playback.position) clearStreamTimeout();
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
        if (playback.durationMismatch) break;
        finishPlayback(session);
        clearStreamTimeout();
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
        const hadSource = Boolean(playback.position || playback.durationMismatch);
        playback.sourceId = typeof data.sourceId === 'string' && data.sourceId.length <= 100 ? data.sourceId : null;
        playback.durationMismatch = false;
        if (playback.position) {
          remember(playback.position, session, true);
          if (item.type !== 'movie' || !movieDurationMismatch(item.duration, progress[session.progressKey]?.duration)) {
            playback.resumeTime = cineResumeTime(session.progressKey);
          }
        }
        if (session.ended && session.episode && pref('autoplay')) {
          playback.unidentifiedEpisode = true;
          setStatus('Playback changed without an episode update. Select the episode below to reconnect your progress.', true);
        } else {
          waitForStream('Connecting to the video source…', hadSource);
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
          if (data.result && !playback.paused && playback.position) clearStreamTimeout();
          playback.paused = data.result;
          controls?.updatePlayback();
        }
        if (data.command === 'getDuration' && Number.isFinite(data.result) && data.result > 0 && checkMovieDuration(data.result)) {
          playback.duration = data.result;
        }
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
        if (playback.durationMismatch) break;
        clearStreamTimeout();
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
      if (opening === openingId) titleFailure(error);
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
    details: selection?.details || detailsCache.get(item.key),
    cineSrcServer: cineSrcServers.get(item.key),
    animeEligible: Boolean(media?.embed) && isAnime(item.originalLanguage, item.genreIds),
  };
  session.tracking = viewingSession(progress[session.progressKey]);
  active = session;
  const sourcePage = source?.page || (source?.archive ? `https://archive.org/details/${encodeURIComponent(source.archive)}` : '');
  const watchSource = sourcePage ? `<div class="watch-source"><span>${escape(item.credit)}</span><a href="${escape(sourcePage)}" target="_blank" rel="noopener noreferrer">${escape(source.source || 'Internet Archive')} ${icon('external')}</a><a href="${escape(item.license[1])}" target="_blank" rel="noopener noreferrer">${escape(item.license[0])}</a></div>` : media?.embed ? '<div class="watch-source" data-playback-source></div>' : '';
  const canPlay = resumed || isArchive(item) || (item.type === 'movie' && hasCineSrcTitle(item) && (!item.date || hasReleased(item)));
  const back = `<a class="plain-link title-back" href="${escape(returnTo || '/#home')}">${icon('chevron-left')} ${media && !returnTo ? `Back to ${escape(item.title)}` : 'Back'}</a>`;
  const primary = !media && (item.type === 'tv'
    ? `<button class="button primary" type="button" data-action="series-start" disabled>${icon('play')} <span>Start watching</span></button>`
    : canPlay ? `<button class="button primary" type="button" data-action="${resumed && pref('resume') ? 'resume' : 'watch'}" data-key="${escape(item.key)}">${icon('play')} ${resumed && pref('resume') ? 'Resume' : 'Play'}</button>` : '');
  const about = `<p class="title-about"${item.description ? '' : ' hidden'}>${escape(item.description)}</p>`;
  const hasEpisodes = item.type === 'tv' && !item.archiveId;
  titlePage.classList.toggle('is-playing', Boolean(media));
  titlePage.hidden = false;
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
            </nav>
            ${ratingControl(item)}
          </div>
        </div>
      </section>`}
    <div class="watch-body${media ? '' : ' details-body'}">
      ${media && !episode ? `<div class="title-overview">${about}${ratingControl(item)}</div>` : ''}
      ${hasEpisodes ? `<section${media ? '' : ' id="details-episodes"'} class="title-episodes episode-list" tabindex="-1" aria-label="Episodes">${episodesMarkup(session)}</section>` : ''}
      ${!media ? '<section id="details-cast" class="cast-section" tabindex="-1" aria-label="Cast and crew" hidden></section>' : ''}
      ${watchSource}
    </div>`;

  document.title = (episode?.title || item.title) + ' · Afterframe';
  backControl.href = returnTo || (media ? detailsHref(item) : '/#home');
  window.scrollTo(0, 0);
  titlePage.querySelector('#title-heading').focus({ preventScroll: true });
  if (media?.embed) startCatalogPlayback(session);
  else if (media) startVideo(session);
  loadTitle(session);
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

function showToast(message, inverse = null, recovery = '') {
  undoToast = inverse;
  toast.querySelector('[role="status"]').textContent = message;
  const button = toast.querySelector('[data-action="undo"]');
  button.hidden = !undoToast;
  toast.querySelector('[data-player-signin]').hidden = recovery !== 'signin';
  toast.querySelector('[data-recover-library]').hidden = recovery !== 'library';
  toast.hidden = false;
  clearTimeout(toastTimer);
  if (recovery) return;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
    undoToast = null;
  }, undoToast ? 6500 : 3000);
}

function toggleSaved(item) {
  const previous = saved[item.key] ?? null;
  const label = 'Watchlist';
  if (previous && pref('confirmRemoval') && !confirm(`Remove this title from your ${label.toLowerCase()}?`)) return;
  const owner = account?.id;
  showToast('Saving…');
  const value = previous ? null : { ...libraryTitle(item), added: Date.now(), watchStatus: 'planned' };
  libraryChange('saved', item.key, value)?.then(committed => {
    if (committed && account?.id === owner) showToast(previous ? `Removed from ${label}` : `Added to ${label}`,
      { kind: 'saved', key: item.key, previous: Object.hasOwn(committed, 'prior') ? committed.prior : previous, value, revision: committed.revision, accountId: owner, label: `${label} change undone` });
  });
  renderLibraryControls();
}

function setAccount(user, library) {
  libraryRevision++;
  account = user;
  accountReady = true;
  accountLibraryVerified = true;
  useLibrary(library);
  if (user) {
    const pendingKey = `pendingPlayback.${user.id}`;
    const pending = read(pendingKey, {});
    const retry = [];
    for (const [recordKey, entry] of Object.entries(pending)) {
      const separator = recordKey.indexOf('/');
      const kind = recordKey.slice(0, separator);
      const key = recordKey.slice(separator + 1);
      const records = { progress, watched, history: watchHistory }[kind];
      if (records && entry?.at >= (records[key]?.updated || 0)) retry.push([kind, key, entry.value, entry.at]);
      else delete pending[recordKey];
    }
    write(pendingKey, pending);
    for (const change of retry) libraryChange(...change);
  }
  syncPreferences();
  renderLibraryControls();
}

async function syncLibrary() {
  if (!account || !accountLibraryVerified || active?.media || syncingLibrary || document.hidden) return;
  const profile = account.id;
  const revision = libraryRevision;
  syncingLibrary = true;
  try {
    await libraryQueue;
    const { account: user, library } = await api('/api/account');
    if (account?.id !== profile || revision !== libraryRevision || active?.media) return;
    if (user?.id === profile) {
      const current = { saved, progress, ratings, watched, preferences, history: watchHistory };
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
    if (completingSeries.has(watchKey)) return;
    if (!accountLibraryVerified) { renderLibraryControls(); showToast('Reconnect or sign in to update your library.'); return; }
    const accountId = account?.id;
    const item = metadata || entry;
    const controls = `[data-watch-key="${CSS.escape(watchKey)}"]`;
    function setPending(pending) {
      if (pending) completingSeries.add(watchKey);
      else completingSeries.delete(watchKey);
      for (const select of document.querySelectorAll(controls)) {
        select.disabled = pending;
        if (pending) select.setAttribute('aria-busy', 'true');
        else {
          select.removeAttribute('aria-busy');
          select.value = watchStatus(saved[watchKey]);
        }
        select.parentElement.querySelector('.watch-status-message').textContent = pending ? 'Marking aired episodes…' : '';
      }
    }
    setPending(true);
    try {
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
      if (!episodes.length) throw new Error('No aired episodes are available to mark watched.');
      const positions = episodes.filter(episode => progress[`${watchKey}/${episode}`]).length;
      if (!confirm(`Mark ${episodes.length} aired ${episodes.length === 1 ? 'episode' : 'episodes'} of “${item.title}” as watched and clear ${positions} saved playback ${positions === 1 ? 'position' : 'positions'}?`)) return;
      const totalEpisodes = details?.number_of_episodes || item.episodes?.length || entry.totalEpisodes;
      const update = async () => {
        if (account?.id !== accountId) return;
        const updated = Date.now();
        const series = { episodes, item: { key: watchKey, type: 'tv', totalEpisodes } };
        let result = { updated, saved: { ...entry, totalEpisodes, watchStatus: 'completed', completedAt: updated } };
        if (accountId) {
          try { result = await post('/api/account/complete-series', { accountId, ...series }); }
          catch (error) {
            rejectedLibraryChange(error, { accountId, key: watchKey, kind: 'complete-series', at: updated, label: `Complete ${item.title}`, value: series });
            return;
          }
        }
        if (account?.id !== accountId) return;
        if (!accountId) await guestCommit([
          { kind: 'saved', key: watchKey, value: result.saved, requireSaved: true },
          ...episodes.flatMap(episode => {
            const key = `${watchKey}/${episode}`;
            return [{ kind: 'watched', key, value: watched[key] || { item: libraryTitle(item), updated: result.updated } },
              { kind: 'progress', key, value: null }];
          }),
        ]);
        libraryRevision++;
        saved[watchKey] = result.saved;
        for (const episode of episodes) {
          const key = `${watchKey}/${episode}`;
          watched[key] ||= { item: libraryTitle(item), updated: result.updated };
          delete progress[key];
        }

        renderLibraryControls();
        if (active?.item.key === watchKey) renderEpisodeRows(active);
        showToast(`Completed · ${episodes.length} aired ${episodes.length === 1 ? 'episode' : 'episodes'} marked watched`);
      };
      const pending = libraryQueue.then(update);
      libraryQueue = pending.catch(() => {});
      await pending;
    } catch (error) {
      showToast(`Could not complete “${item.title}”. ${error.message} Choose Completed to retry.`);
    } finally {
      setPending(false);
      if (document.activeElement === document.body || document.activeElement === event.target) {
        document.querySelector(controls)?.focus({ preventScroll: true });
      }
    }
    return;
  }
  libraryChange('saved', watchKey, { ...entry, totalEpisodes: metadata?.totalEpisodes ?? entry.totalEpisodes, watchStatus: value });
  renderLibraryControls();
  document.querySelector(`[data-watch-key="${CSS.escape(watchKey)}"]`)?.focus({ preventScroll: true });
}

document.addEventListener('click', event => {
  const control = event.target instanceof Element && event.target.closest('[data-action]');
  const { action, key, value } = control.dataset;
  const item = titles.get(key);
  if (action === 'retry-title') route();
  if (action === 'undo' && undoToast) {
    const { kind, key, previous, value, revision, accountId, label } = undoToast;
    undoToast = null;
    const current = (kind === 'saved' ? saved : watched)[key] ?? null;
    if (accountId === account?.id && current === value) {
      libraryChange(kind, key, previous ?? null, Date.now(), { value, revision })?.then(committed => { if (committed) showToast(label); });
      renderLibraryControls();
    } else {
      toast.hidden = true;
    }
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
    const previous = watched[watchedKey];
    const owner = account?.id;
    showToast('Saving…');
    const commit = recordWatched(item, watchedKey, marked);
    const next = watched[watchedKey] ?? null;
    commit?.then(committed => {
      if (committed && account?.id === owner) showToast(marked ? 'Marked as watched' : 'Marked as unwatched',
        { kind: 'watched', key: watchedKey, previous: Object.hasOwn(committed, 'prior') ? committed.prior : previous, value: next, revision: committed.revision, accountId: owner, label: 'Watched change undone' });
    });
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
  if (action === 'details-section' && active && !active.media) {
    const section = titlePage.querySelector(`#${CSS.escape(value)}`);
    if (section && !section.hidden) {
      titlePage.querySelector('.details-nav [aria-current]')?.removeAttribute('aria-current');
      control.setAttribute('aria-current', 'location');
      section.focus({ preventScroll: true });
      section.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }
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
      cineSrcServers.delete(active.item.key);
      active.cineSrcServer = null;
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
  if (event.defaultPrevented || !active?.media || event.altKey || event.ctrlKey || event.metaKey || event.target.closest('button, a, input, select, summary, iframe, [contenteditable]')) return;
  const key = event.key.toLowerCase();
  if (key === 's' && titlePage.contains(event.target)) {
    const control = titlePage.querySelector('[data-action="skip-segment"]:not([hidden])');
    if (control) { event.preventDefault(); control.click(); }
    return;
  }
  if (key === 'f' && titlePage.contains(event.target) && document.fullscreenEnabled) { event.preventDefault(); toggleFullscreen(); return; }
  const position = playbackPosition(active);
  if (!Number.isFinite(position?.duration)) return;
  if (key === ' ') { event.preventDefault(); playerCommand(position.paused ? 'play' : 'pause'); }
  if (key === 'arrowleft' || key === 'arrowright') {
    event.preventDefault();
    jumpPlayback(key === 'arrowleft' ? -10 : 10);
  }
});
window.addEventListener('storage', event => {
  if (account || !/^afterframe\.(?:saved|watched|ratings|preferences|progress|history)$/.test(event.key || '')) return;
  // Read the changed collection without disturbing the actively playing title.
  const kind = event.key.slice('afterframe.'.length);
  const records = { saved, progress, ratings, watched, preferences, history: watchHistory }[kind];
  const latest = read(kind, {});
  for (const key of Object.keys(records)) if (!Object.hasOwn(latest, key)) delete records[key];
  Object.assign(records, latest);
  for (const item of Object.values(saved)) if (item?.key && !titles.has(item.key)) titles.set(item.key, item);
  if (kind === 'preferences') syncPreferences();
  if (kind === 'saved' || kind === 'watched' || kind === 'ratings') renderLibraryControls();
});
window.addEventListener('hashchange', route);
window.addEventListener('focus', syncLibrary);
document.addEventListener('visibilitychange', syncLibrary);
setInterval(syncLibrary, 30_000);
window.addEventListener('pagehide', savePlayback);
document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  titlePage.focus();
});
toast.querySelector('[data-player-signin]').href = '/?panel=account&return=' + encodeURIComponent(returnTo || '/#home');
useLibrary();
syncPreferences();
const initialAccount = api('/api/account').then(({ account: user, library }) => {
  setAccount(user, library);
}).catch(() => {
  accountReady = true;
});
route();
