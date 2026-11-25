import { fetchWithRetry } from '../http-client.mjs';

const entities = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ' };

export function decodeHtml(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|apos|quot|lt|gt|nbsp);/gi, (entity, code) => {
    if (code[0] !== '#') return entities[code.toLowerCase()] || entity;
    const number = /^#x/i.test(code) ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
    return number <= 0x10ffff ? String.fromCodePoint(number) : entity;
  }).trim();
}

export function normalizedTitle(value) {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function romanizedJapanese(value) {
  return normalizedTitle(value.toLowerCase().replace(/\bha\b/g, 'wa').replace(/\bwo\b/g, 'o'));
}

export function titleMatcher(item) {
  const aliases = new Set([item.title, ...item.aliases].map(normalizedTitle).filter(Boolean));
  const romanized = new Set(item.format === 'manga' ? item.romanized.map(romanizedJapanese) : []);
  return title => aliases.has(normalizedTitle(title)) || romanized.has(romanizedJapanese(title));
}

export function seriesQueries(item, preferred = []) {
  const romanized = item.romanized[0] || '';
  const words = romanized.trim().split(/\s+/);
  const prefix = words.length >= 5 ? words.slice(0, 3).join(' ') : romanized;
  const distinct = new Set();
  return [...preferred, item.title, prefix, romanized, ...item.aliases].filter(name => {
    const key = normalizedTitle(name);
    if (!key || distinct.has(key)) return false;
    distinct.add(key);
    return true;
  }).slice(0, 4);
}

export async function sourceHtml(url, provider) {
  const response = await fetchWithRetry(url, {
    headers: { Accept: 'text/html', 'User-Agent': 'Afterframe/1.0' },
    redirect: 'error',
  }, { timeoutMs: 7000, retries: 1, hostKey: provider, circuitThreshold: 4, circuitCooldownMs: 60_000 });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('text/html')) {
    await response.body?.cancel();
    throw new Error(`${provider} is temporarily unavailable.`);
  }
  return response.text();
}
