import { cacheMetadata } from '../catalog/metadata.mjs';
import { decodeHtml, seriesQueries, sourceHtml, titleMatcher } from './comic-sources.mjs';
import { chapterNumberSource } from '@afterframe/shared/comic-ids';

const origin = 'https://lector-mangas.lat';
const minute = 60_000;
const readerImagePath = /^\/capitulos\/\d+\/[a-z\d]{26}\/page_\d+\.(?:webp|png|jpe?g)$/i;

function search(query) {
  return cacheMetadata(`comics:lector:search:${query}`, 60 * minute, async () => {
    const params = new URLSearchParams({ search: query });
    const result = await sourceHtml(`${origin}/comics?${params}`, 'Lector Manga');
    const cards = /href="\/comics\/([a-z\d-]+)"\s+class="card-cover-link"\s+title="([^"]+)"/gi;
    return Array.from(result.matchAll(cards), ([, slug, title]) => ({ slug, title: decodeHtml(title) }));
  });
}

function listing(slug) {
  return cacheMetadata(`comics:lector:listing:${slug}`, 10 * minute, async () => {
    const result = await sourceHtml(`${origin}/comics/${slug}`, 'Lector Manga');
    const format = result.match(/alt="Portada de [^"]+?\s*(?:—|&mdash;)\s*(Manga|Manhwa|Manhua)"/i)?.[1]?.toLowerCase();
    const list = result.match(/id="chapters-list"[\s\S]*?<nav\b[^>]*id="chapters-pagination"/i)?.[0];
    const links = new RegExp(`href="/comics/${slug}/capitulo-(${chapterNumberSource})"`, 'gi');
    const numbers = [...new Set(Array.from((list || '').matchAll(links), ([, number]) => number))];
    return { slug, format, numbers };
  });
}

function findListing(item) {
  return cacheMetadata(`comics:lector:match:${item.id}`, 30 * minute, async () => {
    const matches = titleMatcher(item);
    const candidates = new Set();
    for (const query of seriesQueries(item, item.spanish)) {
      for (const entry of await search(query)) {
        if (matches(entry.title)) candidates.add(entry.slug);
      }
    }
    const checked = await Promise.allSettled([...candidates].slice(0, 4).map(listing));
    const matchesFormat = checked.flatMap(result => result.status === 'fulfilled' && result.value?.format === item.format ? [result.value] : []);
    if (!matchesFormat.length && checked.length && checked.every(result => result.status === 'rejected')) throw checked[0].reason;
    // Duplicate listings can have different chapter coverage for the same title.
    return matchesFormat.sort((a, b) => b.numbers.length - a.numbers.length)[0] || null;
  });
}

export async function lectorChapters(item) {
  const match = await findListing(item);
  return (match?.numbers || []).map(number => ({
    id: `lector-${number}`, label: `Chapter ${number}`, number, title: '', language: 'es', groups: [],
  }));
}

export async function lectorPageList(item, chapterId) {
  const { slug } = await findListing(item);
  const number = chapterId.slice('lector-'.length);
  return cacheMetadata(`comics:lector:pages:${slug}:${number}`, 10 * minute, async () => {
    const result = await sourceHtml(`${origin}/comics/${slug}/capitulo-${number}`, 'Lector Manga');
    const images = [...result.matchAll(/<img\b[^>]*\bclass="[^"]*\breader-page-img\b[^"]*"[^>]*>/gi)].map(([tag]) => {
      const url = URL.parse(tag.match(/\bsrc="([^"]+)"/i)?.[1] || '');
      return url?.origin === 'https://media.lector-mangas.lat' && !url.username && !url.password && !url.search
        && !url.hash && readerImagePath.test(url.pathname) ? url.href : null;
    });
    if (!images.length || images.some(url => !url)) throw new Error('Lector Manga pages are temporarily unavailable.');
    return images;
  });
}
