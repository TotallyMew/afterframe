import { cacheMetadata } from './metadata.mjs';
import { decodeHtml, normalizedTitle, seriesQueries, sourceHtml, titleMatcher } from './comic-sources.mjs';
import { weebIdSource } from './public/comic-ids.js';

const origin = 'https://weebcentral.com';
const minute = 60_000;
const imageHosts = new Set(['hot.planeptune.us', 'official.lowee.us']);
const seriesLink = new RegExp(`href="(?:https://weebcentral\\.com)?/series/(${weebIdSource})(?:/[^"/]*)?"`, 'i');
const chapterLink = new RegExp(`<a\\b[^>]*\\bhref="(?:https://weebcentral\\.com)?/chapters/(${weebIdSource})"[^>]*>([\\s\\S]*?)</a>`, 'gi');
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
      const id = card.match(seriesLink)?.[1];
      const title = card.match(/\balt="([^"]+?) cover"/i)?.[1];
      const format = card.match(/<strong>Type:<\/strong>\s*<span>\s*(Manga|Manhwa|Manhua)\s*<\/span>/i)?.[1]?.toLowerCase();
      const year = card.match(/<strong>Year:<\/strong>\s*<span>\s*(\d{4})\s*<\/span>/i)?.[1];
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

export async function weebChapters(item) {
  if (item.format === 'comic') return [];
  const series = await findSeries(item);
  if (!series) return [];
  return cacheMetadata(`comics:weeb:chapters:${series}`, 5 * minute, async () => {
    const result = await html(`/series/${series}/full-chapter-list`);
    const chapters = Array.from(result.matchAll(chapterLink)).flatMap(([, id, row]) => {
      const rawLabel = row.match(/<span\b[^>]*class="[^"]*\bgrow\s+flex\b[^"]*"[^>]*>\s*<span\b[^>]*>([^<]+)<\/span>/i)?.[1];
      if (!rawLabel) return [];
      const label = decodeHtml(rawLabel);
      const numbered = label.match(/^(?:chapter|episode)\s+(\d+(?:\.\d+)?)(?:\s*:\s*(.*))?$/i);
      return [{ id: `weeb-${id.toLowerCase()}`, label, number: numbered?.[1] ?? null, title: numbered?.[2] || '', language: 'en', groups: [] }];
    });
    if (!chapters.length && result.match(chapterLink)?.length) throw new Error('Weeb Central chapters are temporarily unavailable.');
    return chapters.reverse();
  });
}

export function weebPageList(chapterId) {
  return cacheMetadata(`comics:weeb:pages:${chapterId}`, 10 * minute, async () => {
    const result = await html(`/chapters/${chapterId.slice(5).toUpperCase()}/images?is_prev=False&reading_style=long_strip`);
    const images = Array.from(result.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*\balt="Page \d+"[^>]*>/gi), ([, src]) => {
      const url = URL.parse(decodeHtml(src));
      return url?.protocol === 'https:' && !url.port && !url.username && !url.password && !url.search && !url.hash
        && imageHosts.has(url.hostname) && httpsImage.test(url.pathname) ? url.href : null;
    });
    if (!images.length || images.some(url => !url)) throw new Error('Weeb Central pages are temporarily unavailable.');
    return images;
  });
}

