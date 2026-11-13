import { archiveCatalog } from './public/catalog.js';
import { archiveCategories, matchesCatalog } from './public/discover.js';

export const archiveIdPattern = /^[a-z0-9][a-z0-9_.-]{0,99}$/i;
const origin = 'https://archive.org';
const cachedSearches = new Map();
const cachedEditions = new Map();
const existingIds = new Set(archiveCatalog.flatMap(item => [item.media?.archive, ...(item.episodes || []).map(episode => episode.media.archive)].filter(Boolean)));
const earlyFilm = '(collection:feature_films OR collection:silent_films) AND date:[1888 TO 1930]';
const classicFilm = 'collection:feature_films AND date:[1931 TO 1969] AND publicdate:[* TO 2014-12-31]';
const openFilm = 'collection:open-film-trust';
const vintageTv = 'collection:classic_tv AND publicdate:[* TO 2014-12-31]';
const collections = {
  movie: `((${earlyFilm}) OR (${classicFilm}) OR ${openFilm})`,
  tv: `(${vintageTv})`,
  cc: openFilm,
};
collections.all = `(${collections.movie} OR ${collections.tv})`;

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanText(value, maxLength) {
  return String(first(value) || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function licenseFor(value) {
  const raw = first(value);
  const match = typeof raw === 'string' && raw.trim().match(/^https?:\/\/(?:www\.)?creativecommons\.org\/(licenses\/publicdomain|publicdomain\/(?:zero|mark)\/1\.0|licenses\/(?:by|by-sa|by-nd|by-nc|by-nc-sa|by-nc-nd)\/\d\.\d(?:\/[a-z]{2})?)\/?$/i);
  if (!match) return null;
  const path = match[1].toLowerCase();
  const [, code, version, region] = path.split('/');
  const name = code === 'zero' ? 'CC0 1.0' : code === 'mark' || code === 'publicdomain'
    ? 'Public domain' : `CC ${code.toUpperCase()} ${version}${region ? ` ${region.toUpperCase()}` : ''}`;
  return [name, `https://creativecommons.org/${code === 'publicdomain' ? 'publicdomain/mark/1.0' : path}/`];
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12500), headers: { Accept: 'application/json' } });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('The Internet Archive is temporarily unavailable.');
  }
  return response.json();
}

async function cached(cache, key, loader) {
  const previous = cache.get(key);
  if (previous && previous.expires > Date.now()) return previous.value;
  if (cache.size >= 150) cache.delete(cache.keys().next().value);
  const value = loader();
  cache.set(key, { value, expires: Date.now() + 15 * 60 * 1000 });
  try { return await value; } catch (error) {
    if (cache.get(key)?.value === value) cache.delete(key);
    throw error;
  }
}

function toTitle(document, group) {
  const id = document.identifier;
  const license = licenseFor(document.licenseurl);
  const title = cleanText(document.title, 200);
  if (typeof id !== 'string' || !archiveIdPattern.test(id) || !license || !title || existingIds.has(id)) return null;
  if (group === 'cc' && !license[0].startsWith('CC')) return null;
  const tv = document.collection?.includes('classic_tv') && !document.collection?.includes('open-film-trust');
  if (/\b(trailer|teaser|commercial|featurettes|preview|sampler)\b/i.test(title)) return null;
  const subjects = Array.isArray(document.subject) ? document.subject.join('; ') : String(document.subject || '');
  const categories = Object.entries(archiveCategories).filter(([, words]) => words.some(word => new RegExp(`\\b${word}\\b`, 'i').test(subjects))).map(([name]) => name);
  return {
    key: `archive-${id}`, archiveId: id, title, year: String(first(document.year) || first(document.date) || '').match(/^\d{4}/)?.[0],
    type: tv ? 'tv' : 'movie', credit: cleanText(document.creator, 240), license, categories,
    poster: `https://archive.org/services/img/${encodeURIComponent(id)}`,
  };
}

export function searchArchive({ group = 'all', query = '', page = 1, filters = {} }) {
  const scope = Object.hasOwn(collections, group) ? group : 'all';
  const words = query.normalize('NFKC').match(/[\p{L}\p{N}]+/gu)?.slice(0, 12) || [];
  if (query && !words.length) return { results: [], nextPage: null };
  return cached(cachedSearches, JSON.stringify([scope, words, page, filters]), async () => {
    const terms = words.map(word => `title:"${word}"`);
    if (filters.decade) terms.push(`date:[${filters.decade}-01-01 TO ${filters.decade + 9}-12-31]`);
    const subjects = archiveCategories[filters.category];
    if (subjects) terms.push(`(${subjects.map(word => `subject:"${word}"`).join(' OR ')})`);
    const url = new URL('/advancedsearch.php', origin);
    url.searchParams.set('q', ['mediatype:movies', 'licenseurl:*', collections[scope], ...terms].join(' AND '));
    for (const field of ['identifier', 'title', 'year', 'date', 'creator', 'collection', 'licenseurl', 'subject']) url.searchParams.append('fl[]', field);
    url.searchParams.append('sort[]', { newest: 'date desc', oldest: 'date asc' }[filters.sort] || 'downloads desc');
    url.searchParams.append('sort[]', 'identifier asc');
    const rows = 36;
    url.searchParams.set('rows', rows);
    url.searchParams.set('page', page);
    url.searchParams.set('output', 'json');
    const { response } = await fetchJson(url);
    if (!Array.isArray(response?.docs)) throw new Error('The Internet Archive search is temporarily unavailable.');
    return {
      results: response.docs.map(document => toTitle(document, scope)).filter(item => item && matchesCatalog(item, filters)),
      nextPage: page * rows < Math.min(response.numFound, 10000) ? page + 1 : null,
    };
  });
}

export function archiveEdition(id) {
  return cached(cachedEditions, id, async () => {
    const { metadata, files, is_dark: dark } = await fetchJson(new URL(`/metadata/${encodeURIComponent(id)}`, origin));
    if (!metadata || dark || metadata['access-restricted-item'] === 'true') return null;
    const title = toTitle(metadata, 'all');
    if (!title || metadata.identifier !== id || metadata.mediatype !== 'movies') return null;
    const groups = Array.isArray(metadata.collection) ? metadata.collection : [metadata.collection];
    const year = Number(title.year);
    const legacy = String(metadata.publicdate || '').slice(0, 10);
    const olderUpload = /^\d{4}-\d{2}-\d{2}$/.test(legacy) && legacy <= '2014-12-31';
    const accepted = groups.includes('open-film-trust')
      || (groups.includes('classic_tv') && olderUpload)
      || (year >= 1888 && year <= 1930 && groups.some(group => group === 'feature_films' || group === 'silent_films'))
      || (year >= 1931 && year <= 1969 && groups.includes('feature_films') && olderUpload);
    if (!accepted) return null;

    const videos = (Array.isArray(files) ? files : []).filter(file => typeof file.name === 'string'
      && file.name.toLowerCase().endsWith('.mp4') && !/h\.?(?:265)|hevc/i.test(`${file.name} ${file.format}`)
      && file.private !== 'true' && file.private !== true && Number(file.length) >= 60
      && file.name.split('/').every(part => part && part !== '.' && part !== '..')
      && !/(?:\b|_)(trailer|teaser|featurette|preview|sample)(?:\b|_)/i.test(file.name));
    const longest = Math.max(0, ...videos.map(file => Number(file.length)));
    const video = videos.filter(file => Number(file.length) >= longest * .95)
      .sort((a, b) => Number(b.size) - Number(a.size))[0];
    if (!video) return null;
    return {
      ...title, description: cleanText(metadata.description, 620), duration: Math.round(Number(video.length) / 60),
      media: { archive: id, file: video.name },
    };
  });
}
