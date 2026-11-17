import { cacheMetadata } from './metadata.mjs';
import { decodeHtml, normalizedTitle, seriesQueries, sourceHtml, titleMatcher } from './comic-sources.mjs';
import { chapterNumberSource } from './public/comic-ids.js';

const origin = 'https://manga-scans.com';
const minute = 60_000;

function search(query) {
  return cacheMetadata(`comics:scans:search:${query}`, 60 * minute, async () => {
    const result = await sourceHtml(`${origin}/?${new URLSearchParams({ s: query })}`, 'Manga Scans');
    const links = /href="(?:https:\/\/manga-scans\.com)?\/manga\/([a-z\d-]+)\/"/gi;
    return [...new Set(Array.from(result.matchAll(links), ([, slug]) => slug))];
  });
}

function listing(slug) {
  return cacheMetadata(`comics:scans:listing:${slug}`, 10 * minute, async () => {
    const result = await sourceHtml(`${origin}/manga/${slug}/`, 'Manga Scans');
    const title = decodeHtml(result.match(/<h1\b[^>]*class="entry-title"[^>]*>([^<]+)<\/h1>/i)?.[1] || '');
    const format = result.match(/href="https:\/\/manga-scans\.com\/comic-type\/(manga|manhwa|manhua)\/"/i)?.[1]?.toLowerCase();
    const links = new RegExp(`href="(?:https://manga-scans\\.com)?/chapter/${slug}-chapter-(${chapterNumberSource})/"`, 'gi');
    const numbers = [...new Set(Array.from(result.matchAll(links), ([, number]) => number))];
    return { slug, title, format, numbers };
  });
}

function findListing(item) {
  return cacheMetadata(`comics:scans:match:${item.id}`, 15 * minute, async () => {
    const matches = titleMatcher(item);
    for (const query of seriesQueries(item)) {
      const slugs = (await search(query)).filter(matches).slice(0, 3);
      const results = await Promise.allSettled(slugs.map(listing));
      const candidates = results.flatMap(result => {
        const entry = result.value;
        return entry?.format === item.format && entry.numbers.length && matches(entry.title) ? [entry] : [];
      });
      const exact = candidates.filter(entry => normalizedTitle(entry.title) === normalizedTitle(item.title));
      const eligible = exact.length ? exact : candidates;
      if (eligible.length === 1) return eligible[0];
      if (results.length && results.every(result => result.status === 'rejected')) throw results[0].reason;
    }
    return null;
  });
}

export async function scansChapters(item) {
  const match = await findListing(item);
  return (match?.numbers || []).map(number => ({
    id: `scans-${number}`, label: `Chapter ${number}`, number, title: '', language: 'en', groups: [],
  }));
}

export async function scansPageList(item, chapterId) {
  const { slug } = await findListing(item);
  const number = chapterId.slice('scans-'.length);
  return cacheMetadata(`comics:scans:pages:${slug}:${number}`, 10 * minute, async () => {
    const result = await sourceHtml(`${origin}/chapter/${slug}-chapter-${number}/`, 'Manga Scans');
    const directory = `/${slug}/chapter-${number}/`;
    const images = Array.from(result.matchAll(/<img\b[^>]*\ssrc="([^"]+)"/gi), ([, src]) => URL.parse(decodeHtml(src)))
      .filter(url => {
        if (url?.origin !== 'https://cdn.black-clover.org' || url.username || url.password || url.search || url.hash) return false;
        const path = url.pathname.match(/^\/file\/[a-z\d-]+(\/.*)$/i)?.[1];
        return path?.startsWith(directory) && /^\d+\.(?:png|jpe?g|webp)$/i.test(path.slice(directory.length));
      })
      .map(url => url.href);
    if (!images.length) throw new Error('Manga Scans pages are temporarily unavailable.');
    return [...new Set(images)];
  });
}
