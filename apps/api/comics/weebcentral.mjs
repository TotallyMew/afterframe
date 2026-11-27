import { cacheMetadata } from '../catalog/metadata.mjs';
import { decodeHtml, normalizedTitle, seriesQueries, sourceHtml, titleMatcher } from './comic-sources.mjs';
import { weebIdSource } from '@afterframe/shared/comic-ids';

const origin = 'https://weebcentral.com';
const minute = 60_000;
const imageHosts = new Set(['hot.planeptune.us', 'official.lowee.us']);
const seriesLink = new RegExp(String.raw`href="(?:https://weebcentral\.com)?/series/(${weebIdSource})(?:/[^"/]*)?"`, 'i');
const chapterLink = new RegExp(String.raw`<a\b[^>]*\bhref="(?:https://weebcentral\.com)?/chapters/(${weebIdSource})"[^>]*>([\s\S]*?)</a>`, 'gi');
const httpsImage = /^\/manga\/(?:[^/]+\/)+[^/]+\.(?:png|jpe?g|webp|gif|avif)$/i;
let nextRequestAt = 0;

async function html(path) {
  const now = Date.now();
  const startAt = Math.max(now, nextRequestAt);
  if (startAt - now > 4500) throw new Error('Weeb Central is busy.');
  nextRequestAt = startAt + 1250;
  if (startAt > now) await new Promise(resolve => setTimeout(resolve, startAt - now));
  return sourceHtml(new URL(path, origin), 'Weeb Central');
}

function searchSeries(query) {
  const text = query.replace(/[!#:(),-]/g, ' ').trim();
  return cacheMetadata(`comics:weeb:search:v2:${text}`, 60 * minute, async () => {
    const params = new URLSearchParams({ text, adult: 'False', display_mode: 'Full Display', sort: 'Popularity', order: 'Descending', official: 'Any', offset: '0' });
    const result = await html(`/search/data?${params}`);
    return result.split(/<article\b[^>]*class="bg-base-300\b[^>]*>/i).slice(1).flatMap(card => {
      const id = seriesLink.exec(card)?.[1];
      const title = /\balt="([^"]+?) cover"/i.exec(card)?.[1];
      const format = /<strong>Type:<\/strong>\s*<span>\s*(Manga|Manhwa|Manhua)\s*<\/span>/i.exec(card)?.[1]?.toLowerCase();
      const year = /<strong>Year:<\/strong>\s*<span>\s*(\d{4})\s*<\/span>/i.exec(card)?.[1];
      return id && title && format ? [{ id, title: decodeHtml(title), format, year: Number(year) || null }] : [];
    });
  });
}

function findSeries(item) {
  return cacheMetadata(`comics:weeb:match:v2:${item.id}`, 12 * 60 * minute, async () => {
    const titleKey = normalizedTitle(item.title);
    const matchesTitle = titleMatcher(item);
    // The index may only search the romanized title and use different spellings of particles.
    // Search a shorter prefix too, while still matching the full title, format, and year.
    for (const query of seriesQueries(item)) {
      const matches = (await searchSeries(query)).filter(candidate => matchesTitle(candidate.title)
        && candidate.format === item.format && (!item.year || item.year === candidate.year));
      const exact = matches.filter(candidate => normalizedTitle(candidate.title) === titleKey);
      const candidates = exact.length ? exact : matches;
      if (candidates.length === 1) return candidates[0].id;
      if (candidates.length > 1) return null;
    }
    return null;
  });
}

function parseChapterLabel(label) {
  const prefix = /^(?:chapter|episode)\s+(\d+(?:\.\d+)?)/i.exec(label);
  if (!prefix) return null;
  const rest = label.slice(prefix[0].length);
  if (!rest) return { number: prefix[1], title: '' };
  const trimmed = rest.trimStart();
  if (!trimmed.startsWith(':')) return null;
  const title = trimmed.slice(1).trimStart();
  if (/[\r\n]/.test(title)) return null;
  return { number: prefix[1], title };
}

export async function weebChapters(item) {
  if (item.format === 'comic') return [];
  const series = await findSeries(item);
  if (!series) return [];
  return cacheMetadata(`comics:weeb:chapters:${series}`, 5 * minute, async () => {
    const result = await html(`/series/${series}/full-chapter-list`);
    const matches = Array.from(result.matchAll(chapterLink));
    const chapters = matches.flatMap(([, id, row]) => {
      const rawLabel = /<span\b[^>]*class="[^"]*\bgrow\s+flex\b[^"]*"[^>]*>\s*<span\b[^>]*>([^<]+)<\/span>/i.exec(row)?.[1];
      if (!rawLabel) return [];
      const label = decodeHtml(rawLabel);
      const numbered = parseChapterLabel(label);
      return [{ id: `weeb-${id.toLowerCase()}`, label, number: numbered?.number ?? null, title: numbered?.title || '', language: 'en', groups: [] }];
    });
    if (!chapters.length && matches.length) throw new Error('Weeb Central chapters are temporarily unavailable.');
    return chapters.reverse();
  });
}

export function weebPageList(chapterId) {
  return cacheMetadata(`comics:weeb:pages:${chapterId}`, 10 * minute, async () => {
    const result = await html(`/chapters/${chapterId.slice(5).toUpperCase()}/images?is_prev=False&reading_style=long_strip`);
    const images = [];
    for (const [tag] of result.matchAll(/<img\b[^<>]{1,1000}>/gi)) {
      if (!/\balt="Page \d+"/i.test(tag)) continue;
      const src = /\bsrc="([^"]+)"/i.exec(tag)?.[1];
      if (!src) { images.push(null); continue; }
      const url = URL.parse(decodeHtml(src));
      images.push(url?.protocol === 'https:' && !url.port && !url.username && !url.password && !url.search && !url.hash
        && imageHosts.has(url.hostname) && httpsImage.test(url.pathname) ? url.href : null);
    }
    if (!images.length || images.some(url => !url)) throw new Error('Weeb Central pages are temporarily unavailable.');
    return images;
  });
}

