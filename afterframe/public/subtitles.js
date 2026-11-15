const subtitleOrigin = 'https://subs.bright67.online';
const cueTiming = /^\s*((?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{1,3})\s+-->\s+((?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{1,3})(?:\s|$)/;

async function subtitleRequest(url, signal) {
  const response = await fetch(url, {
    credentials: 'omit', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  });
  if (!response.ok) throw new Error('Subtitles are temporarily unavailable.');
  return response;
}

export async function findSubtitles(item, episode, signal) {
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
    tracks.set(url.href, { url: url.href, language: language.trim().slice(0, 50), release: release.slice(0, 100) });
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
    const text = lines.slice(timingIndex + 1).join('\n').replace(/<[^>]*>/g, '').trim();
    if (end > start && text) cues.push({ start, end, text });
  }
  if (!cues.length) throw new Error('This subtitle file has no readable captions.');
  return cues;
}
