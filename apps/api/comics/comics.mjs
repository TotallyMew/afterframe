import { readFile, stat } from 'node:fs/promises';
import { cacheMetadata, peekMetadata } from '../catalog/metadata.mjs';
import { assertPublicHost, fetchWithRetry } from '../http-client.mjs';
import { lectorChapters, lectorPageList } from './lectormanga.mjs';
import { scansChapters, scansPageList } from './mangascans.mjs';
import { comicChapterIdPattern, comicChapterIdSource, comicIdSource } from '@afterframe/shared/comic-ids';
import { weebChapters, weebPageList } from './weebcentral.mjs';

const comicIdPattern = new RegExp(`^${comicIdSource}$`, 'i');
const mangaRoute = new RegExp(`^/api/comics/(${comicIdSource})(?:/(chapters|related)(?:/(${comicChapterIdSource}))?)?$`, 'i');
const comicPagePath = new RegExp(String.raw`^/comic-page/(${comicIdSource})/(${comicChapterIdSource})/([1-9]\d{0,3})$`);
const chapterSources = [
  { language: 'en', prefix: 'weeb-', chapters: weebChapters, pages: (_item, id) => weebPageList(id) },
  { language: 'en', prefix: 'scans-', chapters: scansChapters, pages: scansPageList },
  { language: 'es', prefix: 'lector-', chapters: lectorChapters, pages: lectorPageList },
];
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const formatLanguages = { manga: ['ja'], manhwa: ['ko'], manhua: ['zh', 'zh-hk'] };
const contentRatings = ['safe', 'suggestive'];
const publicationStatuses = new Set(['ongoing', 'completed', 'hiatus', 'cancelled']);
const coverPath = new RegExp(String.raw`^/comic-cover/(${comicIdSource}/${comicIdSource}\.(?:jpe?g|png|webp)\.(?:256|512)\.jpg)$`, 'i');
const catalogSorts = {
  popular: ['followedCount', 'desc'],
  // MangaDex has no trending order, so rank the most-followed titles added in the trending window.
  trending: ['followedCount', 'desc'],
  updated: ['latestUploadedChapter', 'desc'],
  newest: ['createdAt', 'desc'],
  rating: ['rating', 'desc'],
  year: ['year', 'desc'],
  title: ['title', 'asc'],
  relevance: ['relevance', 'desc'],
};
const trendingWindowDays = 60;
const readableOnlySorts = new Set(['trending', 'newest', 'updated']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const languagePattern = /^[a-z]{2,3}(?:-[a-z]{2,4})?$/;
const chaptersPerPage = 50;
const feedLimit = 500;
const maxFeed = 10_000;
const blockedGroups = new Set((process.env.MANGADEX_BLOCKED_GROUPS || '').toLowerCase().split(/[\s,]+/).filter(Boolean));
const blockedGroupList = [...blockedGroups];
blockedGroupList.sort((a, b) => a.localeCompare(b));
const blockedGroupKey = blockedGroupList.join(',');
const minute = 60_000;
const pageManifests = new Map();
const pendingManifests = new Map();
let nextRequestAt = 0;

function failure(status, message) {
  return Object.assign(new Error(message), { status });
}

async function mangaDex(path, params = new URLSearchParams()) {
  const now = Date.now();
  const startAt = Math.max(now, nextRequestAt);
  if (startAt - now > 10_000) throw failure(503, 'MangaDex is busy. Try again shortly.');
  nextRequestAt = startAt + 260;
  if (startAt > now) await new Promise(resolve => setTimeout(resolve, startAt - now));
  const url = new URL(`https://api.mangadex.org${path}`);
  url.search = params.toString();
  const response = await fetchWithRetry(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Afterframe/1.0' },
  }, { timeoutMs: 10_000, retries: 1 });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 429) throw failure(429, 'MangaDex is rate limiting requests. Try again shortly.');
    if (response.status === 404) throw failure(404, 'MangaDex could not find this title or chapter.');
    throw failure(502, 'MangaDex is temporarily unavailable.');
  }
  const result = await response.json();
  if (result.result !== 'ok') throw failure(502, 'MangaDex is temporarily unavailable.');
  return result;
}

function englishText(value, original) {
  if (!value) return '';
  return value.en || value[`${original}-ro`] || value[original] || Object.values(value).find(Boolean) || '';
}

function comic({ id, attributes, relationships }) {
  const original = attributes.originalLanguage;
  const format = Object.entries(formatLanguages).find(([, languages]) => languages.includes(original))?.[0] || 'comic';
  const cover = relationships.find(entry => entry.type === 'cover_art')?.attributes?.fileName;
  const poster = /^[\w-]+\.(?:jpg|png|webp|jpeg)$/i.test(cover) ? `https://uploads.mangadex.org/covers/${id}/${cover}.512.jpg` : '';
  const author = [...new Set(relationships.filter(entry => ['author', 'artist'].includes(entry.type)).map(entry => entry.attributes?.name).filter(Boolean))];
  const tags = (attributes.tags || []).filter(tag => tag.attributes.name.en);
  const rawLastChapter = typeof attributes.lastChapter === 'string' ? attributes.lastChapter.trim() : '';
  const lastChapter = /^\d+(?:\.\d+)?$/.test(rawLastChapter) ? rawLastChapter : undefined;
  const cachedChapterCount = !lastChapter ? peekMetadata(`comics:chcount:v1:${id}`) : undefined;
  const chapterCount = typeof cachedChapterCount === 'string' && cachedChapterCount ? cachedChapterCount : undefined;
  const malId = /^[1-9]\d{0,9}$/.test(attributes.links?.mal) ? Number(attributes.links.mal) : null;
  const cachedMal = malId ? peekMetadata(`mal:manga:${malId}`) : undefined;
  const mal = typeof cachedMal === 'number' && cachedMal > 0 ? cachedMal : undefined;
  return {
    id, key: `comic-${id}`, type: 'comic', format, poster, malId,
    ...(mal ? { mal } : {}),
    title: attributes.title.en || attributes.altTitles?.find(title => title.en)?.en || englishText(attributes.title, original),
    year: attributes.year, status: attributes.status, author,
    ...(lastChapter ? { lastChapter } : {}),
    ...(chapterCount ? { chapterCount } : {}),
    synopsis: englishText(attributes.description, original), longStrip: tags.some(tag => tag.attributes.name.en === 'Long Strip'),
    genres: tags.filter(tag => tag.attributes.group === 'genre').map(tag => ({ id: tag.id, name: tag.attributes.name.en })),
    languages: [...new Set((attributes.availableTranslatedLanguages || []).filter(language => languagePattern.test(language)))],
  };
}

function catalogParams(includes) {
  return new URLSearchParams([
    ...contentRatings.map(rating => ['contentRating[]', rating]),
    ...includes.map(type => ['includes[]', type]),
  ]);
}

function readableFeedParams(translation) {
  const params = catalogParams([]);
  params.set('includeExternalUrl', '0');
  params.set('includeUnavailable', '0');
  if (translation) params.set('translatedLanguage[]', translation);
  return params;
}

function sampleChapter(id, translation = '') {
  return cacheMetadata(`comics:sample:${id}:${translation}:${blockedGroupKey}`, 20 * minute, async () => {
    const params = readableFeedParams(translation);
    const limit = blockedGroups.size ? 25 : 1;
    params.set('limit', String(limit));
    for (let offset = 0; offset + limit <= 10_000; offset += limit) {
      params.set('offset', String(offset));
      const result = await mangaDex(`/manga/${id}/feed`, params).catch(error => {
        if (error.status === 404) return { data: [], total: 0 };
        throw error;
      });
      const sample = result.data.map(chapter).find(Boolean);
      if (sample) return sample.language;
      if (offset + limit >= result.total) return null;
    }
    return null;
  });
}

function paging(search, limit) {
  const page = Number(search.get('page') || 1);
  const offset = (page - 1) * limit;
  if (!Number.isInteger(page) || page < 1 || offset + limit > 10_000) throw failure(400, 'That catalog page is unavailable.');
  return { page, offset, limit };
}

function nextPage({ page, offset, limit }, total) {
  return offset + limit < total && offset + 2 * limit <= 10_000 ? page + 1 : null;
}

async function browse(search) {
  const pagination = paging(search, 20);
  const query = search.get('q')?.trim().slice(0, 180);
  const format = search.get('type');
  const genre = search.get('genre');
  const status = search.get('status');
  const sort = search.get('sort');
  const params = catalogParams(['cover_art']);
  params.set('offset', String(pagination.offset));
  params.set('limit', String(pagination.limit));
  const defaultSort = query ? catalogSorts.relevance : catalogSorts.popular;
  const [order, direction] = Object.hasOwn(catalogSorts, sort) ? catalogSorts[sort] : defaultSort;
  params.set(`order[${order}]`, direction);
  if (sort === 'trending') {
    // Round to the day so the cache key stays stable.
    const since = new Date(Date.now() - trendingWindowDays * 24 * 60 * minute);
    params.set('createdAtSince', `${since.toISOString().slice(0, 10)}T00:00:00`);
  }
  if (readableOnlySorts.has(sort)) params.set('hasAvailableChapters', 'true');
  if (query) params.set('title', query);
  if (new RegExp(`^${comicIdSource}$`, 'i').test(genre)) params.set('includedTags[]', genre);
  if (publicationStatuses.has(status)) params.set('status[]', status);
  for (const language of Object.hasOwn(formatLanguages, format) ? formatLanguages[format] : []) params.append('originalLanguage[]', language);
  const result = await cacheMetadata(`comics:browse:${params}`, 15 * minute, () => mangaDex('/manga', params));
  const latest = await latestChapters(result.data).catch(() => ({}));
  const results = result.data.map(entry => withLatest(comic(entry), latest[entry.attributes.latestUploadedChapter]));
  if (order === 'relevance') {
    const exact = results.findIndex(item => item.title.toLowerCase() === query?.toLowerCase());
    if (exact > 0) results.unshift(...results.splice(exact, 1));
  }
  return { results, nextPage: nextPage(pagination, result.total) };
}

function latestRelease(attributes) {
  const at = attributes?.readableAt || attributes?.publishAt || attributes?.createdAt;
  if (!at || Number.isNaN(Date.parse(at))) return null;
  const number = typeof attributes.chapter === 'string' && /^\d+(?:\.\d+)?$/.test(attributes.chapter.trim())
    ? chapterNumber(attributes.chapter.trim()) : null;
  return { at: new Date(at).toISOString(), ...(number ? { chapter: number } : {}) };
}

function withLatest(item, release) {
  if (!release) return item;
  return { ...item, latestAt: release.at, ...(release.chapter ? { latestChapter: release.chapter } : {}) };
}

// One batched lookup resolves the release date and number of each title's newest chapter.
async function latestChapters(entries) {
  const ids = [...new Set(entries.map(entry => entry.attributes.latestUploadedChapter).filter(id => uuidPattern.test(id ?? '')))];
  ids.sort((a, b) => a.localeCompare(b));
  if (!ids.length) return {};
  return cacheMetadata(`comics:latest:${ids.join(',')}`, 10 * minute, async () => {
    const params = catalogParams([]);
    params.set('limit', String(ids.length));
    for (const id of ids) params.append('ids[]', id);
    const result = await mangaDex('/chapter', params);
    return Object.fromEntries(result.data.map(entry => [entry.id, latestRelease(entry.attributes)]).filter(([, release]) => release));
  });
}

async function genres() {
  const result = await cacheMetadata('comics:genres', 24 * 60 * minute, () => mangaDex('/manga/tag'));
  return result.data.filter(tag => tag.attributes.group === 'genre' && tag.attributes.name.en)
    .map(tag => ({ id: tag.id, name: tag.attributes.name.en })).sort((a, b) => a.name.localeCompare(b.name));
}

async function recentComics() {
  const params = readableFeedParams('en');
  params.set('limit', '100');
  params.set('order[readableAt]', 'desc');
  const feed = await mangaDex('/chapter', params);
  const releases = new Map();
  for (const entry of feed.data) {
    if (!chapter(entry)) continue;
    const id = entry.relationships.find(rel => rel.type === 'manga')?.id;
    if (id && !releases.has(id)) releases.set(id, latestRelease(entry.attributes));
  }
  const ids = [...releases.keys()].slice(0, 18);
  if (!ids.length) return [];
  const covers = catalogParams(['cover_art']);
  covers.set('limit', String(ids.length));
  for (const id of ids) covers.append('ids[]', id);
  const result = await mangaDex('/manga', covers);
  const items = new Map(result.data.map(entry => [entry.id, withLatest(comic(entry), releases.get(entry.id))]));
  return ids.map(id => items.get(id)).filter(Boolean);
}

async function details(id) {
  const result = await cacheMetadata(`comics:title:${id}`, 30 * minute, () => mangaDex(`/manga/${id}`, catalogParams(['cover_art', 'author', 'artist'])));
  if (!contentRatings.includes(result.data.attributes.contentRating)) throw failure(404, 'This title is unavailable in the comics catalog.');
  const { title, altTitles = [], originalLanguage } = result.data.attributes;
  const names = [title, ...altTitles];
  const romanized = names.map(name => name[`${originalLanguage}-ro`]).filter(Boolean);
  const spanish = names.flatMap(name => [name.es, name['es-la']]).filter(Boolean);
  const aliases = [...new Set([
    ...romanized,
    ...names.map(name => name.en),
    ...names.flatMap(Object.values),
  ].filter(value => typeof value === 'string' && value.trim()))];
  return { ...comic(result.data), aliases, romanized, spanish };
}

function trimTrailingZeros(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === '0') end--;
  return value.slice(0, end);
}

function chapterNumber(value) {
  const number = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!number) return value;
  const [, whole, fraction] = number;
  const integer = whole.replace(/^0+(?=\d)/, '');
  const trimmedFraction = fraction ? trimTrailingZeros(fraction) : '';
  return trimmedFraction ? `${integer}.${trimmedFraction}` : integer;
}

function chapter({ id, attributes, relationships }) {
  const groups = relationships.filter(entry => entry.type === 'scanlation_group');
  const pages = Number(attributes.pages);
  if (attributes.externalUrl || Number.isNaN(pages) || pages <= 0 || attributes.isUnavailable
    || groups.some(group => blockedGroups.has(group.id.toLowerCase()))) return null;
  const label = attributes.chapter == null ? attributes.title || 'Oneshot' : `Chapter ${attributes.chapter}`;
  const released = attributes.readableAt || attributes.publishAt;
  return {
    id, label, title: attributes.chapter == null ? '' : attributes.title,
    number: attributes.chapter, language: attributes.translatedLanguage,
    ...(released && !Number.isNaN(Date.parse(released)) ? { releasedAt: new Date(released).toISOString() } : {}),
    groups: groups.map(group => ({ name: group.attributes?.name || 'Scanlation group', id: group.id })),
  };
}

function nativeChapterFeed(id, language, offset = 0) {
  const params = readableFeedParams(language);
  params.set('includes[]', 'scanlation_group');
  params.set('order[chapter]', 'asc');
  params.set('order[createdAt]', 'asc');
  params.set('limit', String(feedLimit));
  params.set('offset', String(offset));
  return cacheMetadata(`comics:feed:${id}:${language}:${offset}:${blockedGroupKey}`, 5 * minute, async () => {
    const result = await mangaDex(`/manga/${id}/feed`, params);
    return { entries: result.data.map(chapter).filter(Boolean), total: result.total, count: result.data.length };
  });
}

function nativeChapters(id, language) {
  return cacheMetadata(`comics:native-chapters:${id}:${language}:${blockedGroupKey}`, 5 * minute, async () => {
    const first = await nativeChapterFeed(id, language, 0);
    const entries = [...first.entries];
    if (!first.count || feedLimit >= first.total) return entries;
    const offsets = [];
    for (let offset = feedLimit; offset < Math.min(first.total, maxFeed) && offset + feedLimit <= maxFeed; offset += feedLimit) {
      offsets.push(offset);
    }
    const pages = new Array(offsets.length);
    let cursor = 0;
    const worker = async () => {
      if (cursor >= offsets.length) return;
      const idx = cursor++;
      pages[idx] = await nativeChapterFeed(id, language, offsets[idx]);
      return worker();
    };
    await Promise.all(Array.from({ length: Math.min(4, offsets.length) }, worker));
    for (const page of pages) {
      if (page?.entries?.length) entries.push(...page.entries);
    }
    return entries;
  });
}

function combineChapters(native, extra) {
  const groups = new Map();
  const releases = new Set();
  for (const entry of [...native, ...extra]) {
    if (releases.has(entry.id)) continue;
    releases.add(entry.id);
    const number = chapterNumber(entry.number);
    const key = number ?? entry.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...entry, number });
  }
  const order = number => number != null && number !== '' && Number.isFinite(Number(number)) ? Number(number) : Infinity;
  return [...groups.values()].sort(([a], [b]) => order(a.number) - order(b.number)).slice(0, maxFeed);
}

async function chapterCollection(item, language) {
  const sources = item.format === 'comic' ? [] : chapterSources.filter(source => source.language === language);
  const [native, ...extra] = await Promise.allSettled([
    nativeChapters(item.id, language),
    ...sources.map(source => source.chapters(item)),
  ]);
  return {
    groups: combineChapters(
      native.status === 'fulfilled' ? native.value : [],
      extra.flatMap(result => result.status === 'fulfilled' ? result.value : []),
    ),
    error: (native.status === 'rejected' ? native.reason : null) || (extra.some(result => result.status === 'rejected') && failure(502, 'The chapter sources are temporarily unavailable.')),
  };
}

async function resolveChapterCollection(item, requested, initialLanguage) {
  let language = initialLanguage;
  let { groups, error } = await chapterCollection(item, language);
  if (!groups.length && !requested && item.languages.some(code => code !== language)) {
    const available = await sampleChapter(item.id);
    if (available && available !== language) {
      language = available;
      ({ groups, error } = await chapterCollection(item, language));
    }
  }
  if (!groups.length && error) throw error;
  return { groups, language, error };
}

function chapterPageOf(index) {
  return Math.floor(index / chaptersPerPage) + 1;
}

function buildChapterRanges(groups, pageCount, all) {
  if (all) return [];
  const rangeLabel = ([entry]) => entry.number ?? entry.label;
  return Array.from({ length: pageCount }, (_, index) => {
    const first = index * chaptersPerPage;
    const last = Math.min(first + chaptersPerPage, groups.length) - 1;
    return { start: rangeLabel(groups[first]), end: rangeLabel(groups[last]) };
  });
}

function buildChapterNeighbors(groups, focusedIndex, all) {
  if (focusedIndex < 0) return null;
  const chapterLink = index => {
    if (!groups[index]) return null;
    return { entry: groups[index][0], page: all ? 1 : chapterPageOf(index) };
  };
  return { previous: chapterLink(focusedIndex - 1), next: chapterLink(focusedIndex + 1) };
}

function findFocusedChapterIndex(groups, focus) {
  if (!focus || !comicChapterIdPattern.test(focus)) return -1;
  return groups.findIndex(group => group.some(entry => entry.id === focus));
}

function formatChapterPage({ groups, language, error, requestedPage, focus, all }) {
  const focusedIndex = findFocusedChapterIndex(groups, focus);
  const pageCount = Math.ceil(groups.length / chaptersPerPage);
  const activePage = focusedIndex >= 0 ? chapterPageOf(focusedIndex) : requestedPage;
  const page = Math.min(activePage, pageCount || 1);
  const offset = (page - 1) * chaptersPerPage;
  const visibleGroups = all ? groups : groups.slice(offset, offset + chaptersPerPage);
  return {
    results: visibleGroups.flat(),
    language,
    page: all ? 1 : page,
    pageCount: all ? 1 : pageCount,
    ranges: buildChapterRanges(groups, pageCount, all),
    totalChapters: groups.length,
    nextPage: !all && page < pageCount ? page + 1 : null,
    mainChapters: groups.filter(([entry]) => /^\d+$/.test(entry.number ?? '')).length,
    neighbors: buildChapterNeighbors(groups, focusedIndex, all),
    partial: Boolean(error),
  };
}

async function chapters(item, search) {
  const requested = search.get('lang');
  const all = search.get('all') === '1';
  const initialLanguage = requested || 'en';
  if (!languagePattern.test(initialLanguage)) throw failure(400, 'Choose a valid chapter language.');
  if (search.get('scope') === 'native') {
    const { entries } = await nativeChapterFeed(item.id, initialLanguage);
    const combined = combineChapters(entries, []);
    const visible = all ? combined : combined.slice(0, chaptersPerPage);
    return { results: visible.flat(), totalChapters: combined.length, language: initialLanguage, preview: true };
  }
  const { page } = paging(search, chaptersPerPage);
  const { groups, language, error } = await resolveChapterCollection(item, requested, initialLanguage);
  return formatChapterPage({ groups, language, error, requestedPage: page, focus: search.get('chapter'), all });
}

function chapterSource(id) {
  return chapterSources.find(source => id.startsWith(source.prefix));
}

async function alternateChapter(item, id, source) {
  const chapter = (await source.chapters(item)).find(entry => entry.id === id);
  if (!chapter) return null;
  return { chapter: { ...chapter, number: chapterNumber(chapter.number) }, pages: await source.pages(item, id) };
}

async function alternatePages(item, id, source) {
  const entry = await pageManifest(item.id, id, () => alternateChapter(item, id, source));
  if (!entry) throw failure(404, 'This chapter is unavailable for this title.');
  return {
    chapter: entry.chapter,
    pages: entry.pages.map((_, index) => `/comic-page/${item.id}/${id}/${index + 1}`),
  };
}

export async function comicPageResponse(pathname, signal) {
  const match = pathname.match(comicPagePath);
  if (!match) return null;
  const [, id, chapterId, page] = match;
  const source = chapterSource(chapterId);
  const key = `${id}/${chapterId}`;
  const entry = await pageManifest(id, chapterId, async () => {
    const item = await details(id).catch(error => {
      if (error.status === 404) return null;
      throw error;
    });
    if (!item) return null;
    if (!source) return nativePages(id, chapterId);
    return alternateChapter(item, chapterId, source);
  });
  const url = entry?.pages[Number(page) - 1];
  if (!url) return null;
  let valid = false;
  try {
    await assertPublicHost(new URL(url).hostname);
    const response = await fetch(url, {
      headers: { Accept: 'image/*', 'User-Agent': 'Afterframe/1.0' },
      redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    const contentLength = Number(response.headers.get('content-length'));
    const tooLarge = Number.isFinite(contentLength) && contentLength > 25 * 1024 * 1024;
    valid = response.ok && imageTypes.has(contentType) && !tooLarge;
    if (valid) return response;
    await response.body?.cancel();
    return null;
  } finally {
    if (!valid && !signal.aborted && pageManifests.get(key)?.entry === entry) pageManifests.delete(key);
  }
}

function pageManifest(id, chapterId, load) {
  const key = `${id}/${chapterId}`;
  const cached = pageManifests.get(key);
  if (cached?.expires > Date.now()) return cached.entry;
  if (pendingManifests.has(key)) return pendingManifests.get(key);
  const request = load().then(entry => {
    pageManifests.delete(key);
    if (entry) {
      if (pageManifests.size >= 128) pageManifests.delete(pageManifests.keys().next().value);
      pageManifests.set(key, { entry, expires: Date.now() + 2 * minute });
    }
    return entry;
  }).finally(() => pendingManifests.delete(key));
  pendingManifests.set(key, request);
  return request;
}

async function nativePages(id, chapterId) {
  const result = await mangaDex(`/chapter/${chapterId}`, catalogParams(['scanlation_group']));
  if (!result.data.relationships.some(entry => entry.type === 'manga' && entry.id === id)) {
    throw failure(404, 'This chapter belongs to a different title.');
  }
  const entry = chapter(result.data);
  if (!entry) throw failure(404, 'This chapter is unavailable in the Afterframe reader.');
  const images = await mangaDex(`/at-home/server/${chapterId}`, new URLSearchParams({ forcePort443: 'true' }));
  const base = URL.parse(images.baseUrl);
  if (base?.protocol !== 'https:' || base.port || base.username || base.password || base.search || base.hash
    || (base.hostname !== 'uploads.mangadex.org' && !base.hostname.endsWith('.mangadex.network'))) {
    throw failure(502, 'MangaDex could not provide a compatible image server.');
  }
  const { hash, data, dataSaver } = images.chapter;
  const compressed = dataSaver?.length > 0 && dataSaver.length === data?.length;
  const files = compressed ? dataSaver : data;
  if (!/^[a-f0-9]{32}$/i.test(hash) || !files?.length || !files.every(file => /^[\w-]+\.(?:png|jpe?g|gif|webp)$/i.test(file))) {
    throw failure(502, 'MangaDex returned an unavailable page list.');
  }
  const directory = `${base.href.replace(/\/$/, '')}/${compressed ? 'data-saver' : 'data'}/${hash}`;
  return { chapter: { ...entry, number: chapterNumber(entry.number) }, pages: files.map(file => `${directory}/${file}`) };
}

async function pages(id, chapterId) {
  const result = await pageManifest(id, chapterId, () => nativePages(id, chapterId));
  return { ...result, pages: result.pages.map((_, index) => `/comic-page/${id}/${chapterId}/${index + 1}`) };
}

let cachedTranscripts = null;

async function readTranscriptCatalog(file) {
  const info = await stat(file);
  if (cachedTranscripts && cachedTranscripts.file === file && cachedTranscripts.mtimeMs === info.mtimeMs && cachedTranscripts.size === info.size) {
    return cachedTranscripts.entries;
  }
  const entries = JSON.parse(await readFile(file, 'utf8'));
  cachedTranscripts = { file, mtimeMs: info.mtimeMs, size: info.size, entries };
  return entries;
}

async function chapterTranscript(id, chapterId, pageCount) {
  const file = process.env.AFTERFRAME_COMIC_TRANSCRIPTS_FILE;
  if (!file) return undefined;
  try {
    const entries = await readTranscriptCatalog(file);
    const entry = entries?.[`${id}/${chapterId}`];
    if (!entry || !Array.isArray(entry.pages)) return undefined;
    const pages = entry.pages.slice(0, pageCount).map(page => typeof page === 'string' ? page.trim().slice(0, 20_000) : '');
    if (!pages.some(Boolean)) return undefined;
    const source = typeof entry.source === 'string' ? URL.parse(entry.source) : null;
    return { pages, ...(source?.protocol === 'https:' && !source.username && !source.password ? { source: source.href } : {}) };
  } catch {
    // A transcript is optional enrichment. Reading the licensed images still works.
    cachedTranscripts = null;
    return undefined;
  }
}

async function chapterPayload(id, chapterId, body) {
  const transcript = await chapterTranscript(id, chapterId, body.pages.length);
  return { status: 200, body: transcript ? { ...body, transcript } : body };
}

async function relatedComics(item) {
  return cacheMetadata(`comics:related:${item.id}`, 30 * minute, async () => {
    const params = catalogParams(['cover_art']);
    params.set('limit', '12');
    params.set('order[followedCount]', 'desc');
    const firstGenre = item.genres?.[0]?.id;
    if (firstGenre) params.append('includedTags[]', firstGenre);
    for (const language of Object.hasOwn(formatLanguages, item.format) ? formatLanguages[item.format] : []) {
      params.append('originalLanguage[]', language);
    }
    const result = await mangaDex('/manga', params);
    return result.data.filter(entry => entry.id !== item.id).slice(0, 8).map(comic);
  });
}

function parseChapterCandidate(entry, key) {
  const candidate = typeof entry?.chapter === 'string' ? entry.chapter.trim() : key.trim();
  if (!/^\d+(?:\.\d+)?$/.test(candidate)) return 0;
  const numeric = Number(candidate);
  return Number.isFinite(numeric) ? numeric : 0;
}

function scanVolumeChapters(volume) {
  if (!volume?.chapters || typeof volume.chapters !== 'object') return { entries: 0, maxChapter: 0 };
  let maxChapter = 0;
  const chapterEntries = Object.entries(volume.chapters);
  for (const [key, entry] of chapterEntries) {
    const numeric = parseChapterCandidate(entry, key);
    if (numeric > maxChapter) maxChapter = numeric;
  }
  return { entries: chapterEntries.length, maxChapter };
}

function extractAggregateChapterCount(aggregate) {
  const volumes = aggregate?.volumes && typeof aggregate.volumes === 'object' ? Object.values(aggregate.volumes) : [];
  let maxChapter = 0;
  let chapterEntries = 0;
  for (const volume of volumes) {
    const stats = scanVolumeChapters(volume);
    chapterEntries += stats.entries;
    if (stats.maxChapter > maxChapter) maxChapter = stats.maxChapter;
  }
  if (maxChapter >= 1) return String(Math.floor(maxChapter));
  return chapterEntries > 0 ? String(chapterEntries) : null;
}

function mangaChapterCount(id) {
  return cacheMetadata(`comics:chcount:v1:${id}`, 12 * 60 * minute, async () => {
    const result = await mangaDex(`/manga/${id}/aggregate`).catch(error => {
      if (error.status === 404) return null;
      throw error;
    });
    return result ? extractAggregateChapterCount(result) : null;
  });
}

async function chapterCounts(search) {
  const raw = (search.get('ids') || '').split(',').map(value => value.trim().toLowerCase());
  const ids = [...new Set(raw.filter(id => comicIdPattern.test(id)))].slice(0, 24);
  const counts = {};
  let cursor = 0;
  let rateLimited = false;
  const worker = async () => {
    if (cursor >= ids.length || rateLimited) return;
    const id = ids[cursor++];
    try {
      const count = await mangaChapterCount(id);
      if (count) counts[id] = count;
    } catch (error) {
      if (error?.status === 429) rateLimited = true;
    }
    return worker();
  };
  await Promise.all(Array.from({ length: Math.min(3, ids.length) }, worker));
  return { counts };
}

async function handleComicItemRoute(match, search) {
  const [, id, subroute, chapterId] = match.map(value => value?.toLowerCase());
  if (subroute === 'related' && chapterId) throw failure(404, 'Comics route unavailable.');
  const source = chapterId && chapterSource(chapterId);
  if (subroute === 'chapters' && chapterId && !source) {
    const [, body] = await Promise.all([details(id), pages(id, chapterId)]);
    return chapterPayload(id, chapterId, body);
  }
  const item = await details(id);
  if (subroute === 'related') {
    return { status: 200, body: { results: await relatedComics(item) } };
  }
  if (subroute === 'chapters' && chapterId) {
    return chapterPayload(id, chapterId, await alternatePages(item, chapterId, source));
  }
  if (subroute === 'chapters') return { status: 200, body: await chapters(item, search) };
  const { aliases, romanized, spanish, ...body } = item;
  const languages = new Set(['en', ...body.languages]);
  if (item.format !== 'comic') languages.add('es');
  return { status: 200, body: { ...body, languages: [...languages], defaultLanguage: 'en' } };
}

export async function comicsApi(pathname, search) {
  try {
    if (pathname === '/api/comics') return { status: 200, body: await browse(search) };
    if (pathname === '/api/comics/genres') return { status: 200, body: { genres: await genres() } };
    if (pathname === '/api/comics/updates') return { status: 200, body: { results: await cacheMetadata(`comics:readable-updates:${blockedGroupKey}`, 5 * minute, recentComics) } };
    if (pathname === '/api/comics/counts') return { status: 200, body: await chapterCounts(search) };
    const match = mangaRoute.exec(pathname);
    if (!match) throw failure(404, 'Comics route unavailable.');
    return await handleComicItemRoute(match, search);
  } catch (error) {
    return { status: error.status || 502, body: { error: error.status ? error.message : 'The comic source is temporarily unavailable.' } };
  }
}

export async function comicCoverResponse(pathname, signal) {
  const cover = pathname.match(coverPath)?.[1];
  if (!cover) return null;
  const timeout = AbortSignal.timeout(10_000);
  const response = await fetch(`https://uploads.mangadex.org/covers/${cover}`, {
    headers: { Accept: 'image/jpeg', 'User-Agent': 'Afterframe/1.0' },
    redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const contentLength = Number(response.headers.get('content-length'));
  const tooLarge = Number.isFinite(contentLength) && contentLength > 10 * 1024 * 1024;
  if (response.ok && !tooLarge && response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() === 'image/jpeg') return response;
  await response.body?.cancel();
  return null;
}
