const subtitleOrigin = 'https://subs.bright67.online';
const openSubtitlesOrigin = 'https://opensubtitles-v3.strem.io';
const downloadOrigin = 'https://subs5.strem.io';
const cueTiming = /^\s*((?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{1,3})\s+-->\s+((?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{1,3})(?:\s|$)/;
const languageNames = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });
const languageAliases = {
  pob: 'Portuguese (Brazil)',
  pb: 'Portuguese (Brazil)',
  'pt-br': 'Portuguese (Brazil)',
  'pt-pt': 'Portuguese (Portugal)',
  scc: 'Serbian',
  srp: 'Serbian',
  rum: 'Romanian',
  ron: 'Romanian',
  cze: 'Czech',
  ces: 'Czech',
  dut: 'Dutch',
  nld: 'Dutch',
  fre: 'French',
  fra: 'French',
  ger: 'German',
  deu: 'German',
  gre: 'Greek',
  ell: 'Greek',
  chi: 'Chinese',
  zho: 'Chinese',
  ze: 'Chinese (Bilingual)',
  'zh-cn': 'Chinese (Simplified)',
  'zh-hans': 'Chinese (Simplified)',
  'zh-tw': 'Chinese (Traditional)',
  'zh-hant': 'Chinese (Traditional)',
  'es-419': 'Spanish (Latin America)',
  'es-la': 'Spanish (Latin America)',
  baq: 'Basque',
  bur: 'Burmese',
  geo: 'Georgian',
  ice: 'Icelandic',
  mac: 'Macedonian',
  mao: 'Maori',
  may: 'Malay',
  per: 'Persian',
  slo: 'Slovak',
  tib: 'Tibetan',
  wel: 'Welsh',
  alb: 'Albanian',
  arm: 'Armenian',
  mne: 'Montenegrin',
  spl: 'Spanish (Latin America)',
};

export function playbackLanguage(value) {
  const name = value?.trim() || '';
  if (!name) return '';
  const lower = name.toLowerCase().replace(/_/g, '-');
  if (Object.hasOwn(languageAliases, lower)) return languageAliases[lower];
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(lower)) return name;
  return languageNames.of(lower.split('-')[0]) || name;
}

export function samePlaybackLanguage(first, second) {
  return Boolean(first && second) && playbackLanguage(first).toLowerCase() === playbackLanguage(second).toLowerCase();
}

async function subtitleRequest(url, signal) {
  const response = await fetch(url, {
    credentials: 'omit', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  });
  if (!response.ok) throw new Error('Subtitles are temporarily unavailable.');
  return response;
}

async function openSubtitles(item, episode, signal) {
  let imdb = item.imdb;
  if (!imdb) {
    const response = await fetch(`/api/${item.type}/${item.id}`, { signal });
    if (!response.ok) return [];
    const details = await response.json();
    imdb = details.external_ids?.imdb_id || details.imdb_id;
  }
  if (!/^tt\d{5,12}$/.test(imdb)) return [];
  const id = episode ? `${imdb}:${episode.season}:${episode.number}` : imdb;
  const response = await subtitleRequest(`${openSubtitlesOrigin}/subtitles/${episode ? 'series' : 'movie'}/${id}.json`, signal);
  const { subtitles } = await response.json();
  const seen = new Set();
  return (Array.isArray(subtitles) ? subtitles : []).flatMap(entry => {
    const url = typeof entry?.url === 'string' ? URL.parse(entry.url) : null;
    const language = typeof entry?.lang === 'string' ? playbackLanguage(entry.lang) : '';
    if (!language || url?.origin !== downloadOrigin || url.username || url.password || !/^\/[a-z-]+\/download\//i.test(url.pathname) || seen.has(url.href)) return [];
    seen.add(url.href);
    return [{ url: url.href, language, release: typeof entry.label === 'string' ? entry.label.slice(0, 100) : '' }];
  }).sort((a, b) => a.language.localeCompare(b.language));
}

export async function findSubtitles(item, episode, signal) {
  try {
    const tracks = await openSubtitles(item, episode, signal);
    if (tracks.length || signal.aborted) return tracks;
  } catch (error) {
    if (signal.aborted) throw error;
  }
  const search = new URL('/search', subtitleOrigin);
  search.searchParams.set('id', item.id);
  if (episode) {
    search.searchParams.set('season', episode.season);
    search.searchParams.set('episode', episode.number);
  }
  const response = await subtitleRequest(search, signal);
  const results = await response.json();
  if (!Array.isArray(results)) throw new Error('Subtitles are temporarily unavailable.');
  const tracks = new Map();
  for (const entry of results) {
    if (!['srt', 'vtt'].includes(entry?.format) || typeof entry.url !== 'string') continue;
    const url = URL.parse(entry.url);
    if (!url || url.origin !== subtitleOrigin || url.username || url.password || !/^\/c(?:\/|$)/.test(url.pathname)) continue;
    const language = [entry.display, entry.languageName, entry.language].find(value => typeof value === 'string' && value.trim());
    if (!language || tracks.has(url.href)) continue;
    const release = typeof entry.release === 'string' ? entry.release.split(/[/\\]/).at(-1).trim() : '';
    tracks.set(url.href, { url: url.href, language: playbackLanguage(language).slice(0, 50), release: release.slice(0, 100) });
  }
  return [...tracks.values()].sort((a, b) => a.language.localeCompare(b.language));
}

function cueSeconds(value) {
  return value.replace(',', '.').split(':').reduce((seconds, part) => seconds * 60 + Number(part), 0);
}

export async function loadSubtitle(track, signal) {
  const response = await subtitleRequest(track.url, signal);
  const bytes = await response.text();
  if (bytes.length > 1000000) throw new Error('This subtitle file is too large.');
  const cues = [];
  for (const block of bytes.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex(line => cueTiming.test(line));
    if (timingIndex < 0 || /^(NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0])) continue;
    const [, startTime, endTime] = lines[timingIndex].match(cueTiming);
    const start = cueSeconds(startTime);
    const end = cueSeconds(endTime);
    const text = lines.slice(timingIndex + 1).join('\n')
      .replace(/\{\\[^}]*\}/g, '')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .trim();
    if (end > start && text) cues.push({ start, end, text });
  }
  if (!cues.length) throw new Error('This subtitle file has no readable captions.');
  return cues;
}
