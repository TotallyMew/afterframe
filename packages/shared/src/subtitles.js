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

const forcedPattern = /\b(?:forced|foreign[\s._-]*(?:parts?|audio|dialog(?:ue)?|only|subs?|languages?)|non[\s._-]*english(?:[\s._-]*parts?)?(?:[\s._-]*only)?|signs?\s*(?:&|and|\+)\s*songs?|(?:spanish|french|german|russian|japanese|korean|chinese|mandarin|cantonese|arabic|italian|portuguese|polish|turkish|hindi|latin|elvish|dothraki|valyrian|klingon|na'?vi|alien)[\s._-]+(?:parts?|only|dialog(?:ue)?))\b/i;
const sdhPattern = /\b(?:sdh|hearing[\s._-]*impaired)\b/i;
const hiTagPattern = /(?:^|[.\-_([\s])HI(?=[.\-_)\]\s]|$)/;
const hiExtPattern = /[.\-_]hi\.(?:srt|vtt)$/i;
const openSubFileIdPattern = /\/file\/(\d+)(?:\/|$)/;
const brightGraceMs = 2500;

function stripTitlePrefix(text, title) {
  if (!title) return text;
  const escaped = title.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s._:-]+');
  if (!escaped) return text;
  return text.replace(new RegExp(`^\\s*${escaped}(?=[\\s._:(\\[]|$)`, 'i'), '');
}

function cleanReleaseName(value) {
  if (typeof value !== 'string') return '';
  return value.split(/[/\\]/).at(-1).replace(/\.(?:srt|vtt)$/i, '').trim().slice(0, 100);
}

export function isForcedSubtitle(text, title = '') {
  if (typeof text !== 'string' || !text.trim()) return false;
  return forcedPattern.test(stripTitlePrefix(text, title));
}

export function isHearingImpairedSubtitle(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  return sdhPattern.test(text) || hiTagPattern.test(text) || hiExtPattern.test(text);
}

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

function sortTracks(tracks) {
  return tracks.sort((a, b) => (
    a.language.localeCompare(b.language)
    || Number(Boolean(a.forced)) - Number(Boolean(b.forced))
    || Number(Boolean(a.hearingImpaired)) - Number(Boolean(b.hearingImpaired))
  ));
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
    const metaText = [entry.label, entry.movieReleaseName, entry.subtitleFileName].filter(v => typeof v === 'string' && v.trim()).join(' ');
    const release = cleanReleaseName(
      [entry.label, entry.movieReleaseName, entry.subtitleFileName].find(v => typeof v === 'string' && v.trim()) || '',
    );
    const forced = isForcedSubtitle(metaText, item.title);
    const hearingImpaired = isHearingImpairedSubtitle(metaText);
    const fileId = url.pathname.match(openSubFileIdPattern)?.[1] || '';
    return [{
      url: url.href,
      language,
      release,
      ...(forced ? { forced: true } : {}),
      ...(hearingImpaired ? { hearingImpaired: true } : {}),
      _fileId: fileId,
    }];
  });
}

async function brightSubtitles(item, episode, signal) {
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
    if (Array.isArray(entry.qualityWarnings) && entry.qualityWarnings.includes('no-timed-cues-detected')) continue;
    const url = URL.parse(entry.url);
    if (!url || url.origin !== subtitleOrigin || url.username || url.password || !/^\/c(?:\/|$)/.test(url.pathname)) continue;
    const language = [entry.display, entry.languageName, entry.language].find(value => typeof value === 'string' && value.trim());
    if (!language || tracks.has(url.href)) continue;
    const extraReleases = Array.isArray(entry.releases) ? entry.releases.filter(v => typeof v === 'string') : [];
    const metaText = [entry.release, entry.fileName, ...extraReleases].filter(v => typeof v === 'string' && v.trim()).join(' ');
    const release = cleanReleaseName(entry.release || entry.fileName || '');
    const forced = Boolean(entry.isForced) || isForcedSubtitle(metaText, item.title);
    const hearingImpaired = Boolean(entry.isHearingImpaired) || isHearingImpairedSubtitle(metaText);
    const fileId = typeof entry.id === 'string' || typeof entry.id === 'number' ? String(entry.id) : '';
    tracks.set(url.href, {
      url: url.href,
      language: playbackLanguage(language).slice(0, 50),
      release,
      ...(forced ? { forced: true } : {}),
      ...(hearingImpaired ? { hearingImpaired: true } : {}),
      _fileId: /^\d+$/.test(fileId) ? fileId : '',
    });
  }
  return [...tracks.values()];
}

function stripInternal(track) {
  const { url, language, release, forced, hearingImpaired } = track;
  return {
    url,
    language,
    release,
    ...(forced ? { forced: true } : {}),
    ...(hearingImpaired ? { hearingImpaired: true } : {}),
  };
}

export async function findSubtitles(item, episode, signal) {
  const brightController = new AbortController();
  const brightSignal = AbortSignal.any([signal, brightController.signal]);
  const openPromise = openSubtitles(item, episode, signal)
    .then(tracks => ({ ok: true, tracks }))
    .catch(error => ({ ok: false, error, tracks: [] }));
  const brightPromise = brightSubtitles(item, episode, brightSignal)
    .then(tracks => ({ ok: true, tracks }))
    .catch(error => ({ ok: false, error, tracks: [] }));

  const openResult = await openPromise;
  if (signal.aborted) {
    brightController.abort();
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  }

  let brightResult;
  if (openResult.ok && openResult.tracks.length > 0) {
    let timer;
    brightResult = await Promise.race([
      brightPromise,
      new Promise(resolve => {
        timer = setTimeout(() => {
          brightController.abort();
          resolve({ ok: false, tracks: [] });
        }, brightGraceMs);
      }),
    ]);
    clearTimeout(timer);
  } else {
    brightResult = await brightPromise;
  }

  if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');

  if (!openResult.tracks.length && !brightResult.tracks.length) {
    if (!brightResult.ok && brightResult.error) throw brightResult.error;
    if (!openResult.ok && openResult.error) throw openResult.error;
    return [];
  }

  if (!openResult.tracks.length) {
    return sortTracks(brightResult.tracks.map(stripInternal));
  }

  const brightByFileId = new Map();
  for (const track of brightResult.tracks) {
    if (track._fileId && !brightByFileId.has(track._fileId)) {
      brightByFileId.set(track._fileId, track);
    }
  }

  const coveredFileIds = new Set();
  const merged = openResult.tracks.map(track => {
    const match = track._fileId ? brightByFileId.get(track._fileId) : undefined;
    if (match) {
      coveredFileIds.add(track._fileId);
      const forced = Boolean(track.forced || match.forced);
      const hearingImpaired = Boolean(track.hearingImpaired || match.hearingImpaired);
      return stripInternal({
        ...track,
        release: track.release || match.release,
        ...(forced ? { forced: true } : {}),
        ...(hearingImpaired ? { hearingImpaired: true } : {}),
      });
    }
    return stripInternal(track);
  });

  // Append extra forced tracks from the secondary source that weren't in OpenSubtitles' top slice
  const forcedPerLang = new Map();
  for (const track of merged) {
    if (track.forced) forcedPerLang.set(track.language, (forcedPerLang.get(track.language) ?? 0) + 1);
  }
  for (const track of brightResult.tracks) {
    if (!track.forced) continue;
    if (track._fileId && coveredFileIds.has(track._fileId)) continue;
    const count = forcedPerLang.get(track.language) ?? 0;
    if (count >= 3) continue;
    forcedPerLang.set(track.language, count + 1);
    merged.push(stripInternal(track));
  }

  return sortTracks(merged);
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
