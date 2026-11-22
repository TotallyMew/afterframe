import { readFile } from 'node:fs/promises';
import { cacheMetadata } from '../catalog/metadata.mjs';
import { lectorChapters, lectorPageList } from './lectormanga.mjs';
import { scansChapters, scansPageList } from './mangascans.mjs';
import { comicChapterIdPattern, comicChapterIdSource, comicIdSource } from '../../../afterframe/public/comic-ids.js';
import { weebChapters, weebPageList } from './weebcentral.mjs';

const mangaRoute = new RegExp(`^/api/comics/(${comicIdSource})(?:/chapters(?:/(${comicChapterIdSource}))?)?$`, 'i');
const comicPagePath = new RegExp(`^/comic-page/(${comicIdSource})/(${comicChapterIdSource})/([1-9]\\d{0,3})$`);
const chapterSources = [
  { language: 'en', prefix: 'weeb-', chapters: weebChapters, pages: (_item, id) => weebPageList(id) },
  { language: 'en', prefix: 'scans-', chapters: scansChapters, pages: scansPageList },
  { language: 'es', prefix: 'lector-', chapters: lectorChapters, pages: lectorPageList },
];
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const formatLanguages = { manga: ['ja'], manhwa: ['ko'], manhua: ['zh', 'zh-hk'] };
const contentRatings = ['safe', 'suggestive'];
const publicationStatuses = ['ongoing', 'completed', 'hiatus', 'cancelled'];
const coverPath = new RegExp(`^/comic-cover/(${comicIdSource}/${comicIdSource}\\.(?:jpe?g|png|webp)\\.(?:256|512)\\.jpg)$`, 'i');
const catalogSorts = { popular: ['followedCount', 'desc'], updated: ['latestUploadedChapter', 'desc'], newest: ['year', 'desc'], title: ['title', 'asc'], relevance: ['relevance', 'desc'] };
const languagePattern = /^[a-z]{2,3}(?:-[a-z]{2,4})?$/;
const chaptersPerPage = 50;
const feedLimit = 500;
const maxFeed = 10_000;
const blockedGroups = new Set((process.env.MANGADEX_BLOCKED_GROUPS || '').toLowerCase().split(/[\s,]+/).filter(Boolean));
const blockedGroupKey = [...blockedGroups].sort().join(',');
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
  nextRequestAt = startAt + 260;
  if (startAt > now) await new Promise(resolve => setTimeout(resolve, startAt - now));
  const url = new URL(`https://api.mangadex.org${path}`);
  url.search = params;
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Afterframe/1.0' },
    signal: AbortSignal.timeout(10_000),
  });
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
  return {
    id, key: `comic-${id}`, type: 'comic', format, poster,
    malId: /^[1-9]\d{0,9}$/.test(attributes.links?.mal) ? Number(attributes.links.mal) : null,
    title: attributes.title.en || attributes.altTitles?.find(title => title.en)?.en || englishText(attributes.title, original),
    year: attributes.year, status: attributes.status, author,
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
    params.set('limit', limit);
    for (let offset = 0; offset + limit <= 10_000; offset += limit) {
      params.set('offset', offset);
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
  const pagination = paging(search, 12);
  const query = search.get('q')?.trim().slice(0, 180);
  const format = search.get('type');
  const genre = search.get('genre');
  const status = search.get('status');
  const sort = search.get('sort');
  const params = catalogParams(['cover_art']);
  params.set('offset', pagination.offset);
  params.set('limit', pagination.limit);
  const [order, direction] = Object.hasOwn(catalogSorts, sort) ? catalogSorts[sort] : query ? catalogSorts.relevance : catalogSorts.popular;
  params.set(`order[${order}]`, direction);
  if (query) params.set('title', query);
  if (new RegExp(`^${comicIdSource}$`, 'i').test(genre)) params.set('includedTags[]', genre);
  if (publicationStatuses.includes(status)) params.set('status[]', status);
  for (const language of Object.hasOwn(formatLanguages, format) ? formatLanguages[format] : []) params.append('originalLanguage[]', language);
  const result = await cacheMetadata(`comics:browse:${params}`, 15 * minute, () => mangaDex('/manga', params));
  const results = result.data.map(comic);
  if (order === 'relevance') {
    const exact = results.findIndex(item => item.title.toLowerCase() === query?.toLowerCase());
    if (exact > 0) results.unshift(...results.splice(exact, 1));
  }
  return { results, nextPage: nextPage(pagination, result.total) };
}

async function genres() {
  const result = await cacheMetadata('comics:genres', 24 * 60 * minute, () => mangaDex('/manga/tag'));
  return result.data.filter(tag => tag.attributes.group === 'genre' && tag.attributes.name.en)
    .map(tag => ({ id: tag.id, name: tag.attributes.name.en })).sort((a, b) => a.name.localeCompare(b.name));
}

async function recentComics() {
  const params = readableFeedParams('en');
  params.set('limit', 100);
  params.set('order[readableAt]', 'desc');
  const feed = await mangaDex('/chapter', params);
  const ids = [...new Set(feed.data.filter(entry => chapter(entry))
    .map(entry => entry.relationships.find(rel => rel.type === 'manga')?.id).filter(Boolean))].slice(0, 12);
  if (!ids.length) return [];
  const covers = catalogParams(['cover_art']);
  covers.set('limit', ids.length);
  for (const id of ids) covers.append('ids[]', id);
  const result = await mangaDex('/manga', covers);
  const items = new Map(result.data.map(entry => [entry.id, comic(entry)]));
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

function chapterNumber(value) {
  const number = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!number) return value;
  const [, whole, fraction] = number;
  const integer = whole.replace(/^0+(?=\d)/, '');
  return fraction && /[1-9]/.test(fraction) ? `${integer}.${fraction}` : integer;
}

function chapter({ id, attributes, relationships }) {
  const groups = relationships.filter(entry => entry.type === 'scanlation_group');
  if (attributes.externalUrl || !(attributes.pages > 0) || attributes.isUnavailable
    || groups.some(group => blockedGroups.has(group.id.toLowerCase()))) return null;
  const label = attributes.chapter == null ? attributes.title || 'Oneshot' : `Chapter ${attributes.chapter}`;
  return {
    id, label, title: attributes.chapter == null ? '' : attributes.title,
    number: attributes.chapter, language: attributes.translatedLanguage,
    groups: groups.map(group => ({ name: group.attributes?.name || 'Scanlation group', id: group.id })),
  };
}

function nativeChapterFeed(id, language, offset = 0) {
  const params = readableFeedParams(language);
  params.set('includes[]', 'scanlation_group');
  params.set('order[chapter]', 'asc');
  params.set('order[createdAt]', 'asc');
  params.set('limit', feedLimit);
  params.set('offset', offset);
  return cacheMetadata(`comics:feed:${id}:${language}:${offset}:${blockedGroupKey}`, 5 * minute, async () => {
    const result = await mangaDex(`/manga/${id}/feed`, params);
    return { entries: result.data.map(chapter).filter(Boolean), total: result.total, count: result.data.length };
  });
}

function nativeChapters(id, language) {
  return cacheMetadata(`comics:native-chapters:${id}:${language}:${blockedGroupKey}`, 5 * minute, async () => {
    const entries = [];
    for (let offset = 0; offset + feedLimit <= maxFeed; offset += feedLimit) {
      const result = await nativeChapterFeed(id, language, offset);
      entries.push(...result.entries);
      if (!result.count || offset + feedLimit >= result.total) break;
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
  const order = number => number != null && Number.isFinite(Number(number)) ? Number(number) : Infinity;
  return [...groups.values()].sort(([a], [b]) => order(a.number) - order(b.number)).slice(0, maxFeed);
}

async function chapterCollection(item, language) {
  const sources = item.format === 'comic' ? [] : chapterSources.filter(source => source.language === language);
  const [native, ...extra] = await Promise.allSettled([
    nativeChapters(item.id, language),
    ...sources.map(source => source.chapters(item)),
  ]);
  return {
    groups: combineChapters(native.value || [], extra.flatMap(result => result.value || [])),
    error: native.reason || (extra.some(result => result.status === 'rejected') && failure(502, 'The chapter sources are temporarily unavailable.')),
  };
}

async function chapters(item, search) {
  const requested = search.get('lang');
  let language = requested || 'en';
  if (!languagePattern.test(language)) throw failure(400, 'Choose a valid chapter language.');
  if (search.get('scope') === 'native') {
    const { entries } = await nativeChapterFeed(item.id, language);
    return { results: combineChapters(entries, []).slice(0, chaptersPerPage).flat(), language, preview: true };
  }
  let { page } = paging(search, chaptersPerPage);
  let { groups, error } = await chapterCollection(item, language);
  if (!groups.length && !requested && item.languages.some(code => code !== language)) {
    const available = await sampleChapter(item.id);
    if (available && available !== language) {
      language = available;
      ({ groups, error } = await chapterCollection(item, language));
    }
  }
  if (!groups.length && error) throw error;
  const focus = search.get('chapter');
  const focusedIndex = focus && comicChapterIdPattern.test(focus)
    ? groups.findIndex(group => group.some(entry => entry.id === focus)) : -1;
  const pageOf = index => Math.floor(index / chaptersPerPage) + 1;
  if (focusedIndex >= 0) page = pageOf(focusedIndex);
  const pageCount = Math.ceil(groups.length / chaptersPerPage);
  page = Math.min(page, pageCount || 1);
  const offset = (page - 1) * chaptersPerPage;
  const rangeLabel = ([entry]) => entry.number ?? entry.label;
  const ranges = Array.from({ length: pageCount }, (_, index) => {
    const first = index * chaptersPerPage;
    const last = Math.min(first + chaptersPerPage, groups.length) - 1;
    return { start: rangeLabel(groups[first]), end: rangeLabel(groups[last]) };
  });
  const chapterLink = index => groups[index] ? { entry: groups[index][0], page: pageOf(index) } : null;
  return {
    results: groups.slice(offset, offset + chaptersPerPage).flat(),
    language, page, pageCount, ranges, totalChapters: groups.length, nextPage: page < pageCount ? page + 1 : null,
    mainChapters: groups.filter(([entry]) => /^\d+$/.test(entry.number ?? '')).length,
    neighbors: focusedIndex >= 0 ? { previous: chapterLink(focusedIndex - 1), next: chapterLink(focusedIndex + 1) } : null,
    partial: Boolean(error),
  };
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
    if (!source) return nativePages(id, chapterId);
    const item = await details(id).catch(error => {
      if (error.status === 404) return null;
      throw error;
    });
    if (!item) return null;
    return alternateChapter(item, chapterId, source);
  });
  const url = entry?.pages[Number(page) - 1];
  if (!url) return null;
  let valid = false;
  try {
    const response = await fetch(url, {
      headers: { Accept: 'image/*', 'User-Agent': 'Afterframe/1.0' },
      redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    valid = response.ok && imageTypes.has(response.headers.get('content-type')?.split(';')[0]);
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

async function chapterTranscript(id, chapterId, pageCount) {
  const file = process.env.AFTERFRAME_COMIC_TRANSCRIPTS_FILE;
  if (!file) return undefined;
  try {
    const entries = JSON.parse(await readFile(file, 'utf8'));
    const entry = entries?.[`${id}/${chapterId}`];
    if (!entry || !Array.isArray(entry.pages)) return undefined;
    const pages = entry.pages.slice(0, pageCount).map(page => typeof page === 'string' ? page.trim().slice(0, 20_000) : '');
    if (!pages.some(Boolean)) return undefined;
    const source = typeof entry.source === 'string' ? URL.parse(entry.source) : null;
    return { pages, ...(source?.protocol === 'https:' && !source.username && !source.password ? { source: source.href } : {}) };
  } catch {
    // A transcript is optional enrichment. Reading the licensed images still works.
    return undefined;
  }
}

async function chapterPayload(id, chapterId, body) {
  const transcript = await chapterTranscript(id, chapterId, body.pages.length);
  return { status: 200, body: transcript ? { ...body, transcript } : body };
}

export async function comicsApi(pathname, search) {
  try {
    if (pathname === '/api/comics') return { status: 200, body: await browse(search) };
    if (pathname === '/api/comics/genres') return { status: 200, body: { genres: await genres() } };
    if (pathname === '/api/comics/updates') return { status: 200, body: { results: await cacheMetadata(`comics:readable-updates:${blockedGroupKey}`, 5 * minute, recentComics) } };
    const match = pathname.match(mangaRoute);
    if (!match) throw failure(404, 'Comics route unavailable.');
    const [, id, chapterId] = match.map(value => value?.toLowerCase());
    const source = chapterId && chapterSource(chapterId);
    if (chapterId && !source) {
      const [, body] = await Promise.all([details(id), pages(id, chapterId)]);
      return chapterPayload(id, chapterId, body);
    }
    const item = await details(id);
    if (chapterId) {
      return chapterPayload(id, chapterId, await alternatePages(item, chapterId, source));
    }
    if (pathname.endsWith('/chapters')) return { status: 200, body: await chapters(item, search) };
    const { aliases, romanized, spanish, ...body } = item;
    const languages = new Set(['en', ...body.languages]);
    if (item.format !== 'comic') languages.add('es');
    return { status: 200, body: { ...body, languages: [...languages], defaultLanguage: 'en' } };
  } catch (error) {
    return { status: error.status || 502, body: { error: error.status ? error.message : 'The comic source is temporarily unavailable.' } };
  }
}

export async function comicCoverResponse(pathname) {
  const cover = pathname.match(coverPath)?.[1];
  if (!cover) return null;
  const response = await fetch(`https://uploads.mangadex.org/covers/${cover}`, {
    headers: { Accept: 'image/jpeg', 'User-Agent': 'Afterframe/1.0' },
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  if (response.ok && response.headers.get('content-type') === 'image/jpeg') return response;
  await response.body?.cancel();
  return null;
}

export async function reportComicPage(request) {
  if (request.headers.origin !== `http://${request.headers.host}` || request.headers['content-type'] !== 'application/json') return 403;
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 4096) return 413;
  }
  let report;
  try { report = JSON.parse(raw); } catch { return 400; }
  const url = typeof report?.url === 'string' && URL.parse(report.url);
  if (!url || url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash
    || !url.hostname.endsWith('.mangadex.network') || !/\/(?:data|data-saver)\/[a-f0-9]{32}\/[\w-]+\.(?:png|jpe?g|gif|webp)$/i.test(url.pathname)
    || typeof report.success !== 'boolean' || typeof report.cached !== 'boolean'
    || !Number.isSafeInteger(report.bytes) || report.bytes < 0 || !Number.isFinite(report.duration) || report.duration < 0) return 400;
  try {
    const response = await fetch('https://api.mangadex.network/report', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Afterframe/1.0' },
      body: JSON.stringify({ url: url.href, success: report.success, cached: report.cached, bytes: report.bytes, duration: report.duration }),
      signal: AbortSignal.timeout(4000),
    });
    await response.body?.cancel();
    return response.ok ? 204 : 502;
  } catch {
    return 502;
  }
}
