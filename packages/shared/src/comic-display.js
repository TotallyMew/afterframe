const languageNames = new Intl.DisplayNames(undefined, { type: 'language', fallback: 'code' });
const providers = new Map([
  ['weeb', 'Weeb Central'],
  ['scans', 'Manga Scans'],
  ['lector', 'Lector Manga'],
]);

export function comicLanguage(code) {
  try { return languageNames.of(code.toLowerCase() === 'es-la' ? 'es-419' : code) || code; }
  catch { return code; }
}

export function comicEditionCredit(chapter) {
  const group = chapter.groups?.map(entry => typeof entry === 'string' ? entry : entry?.name).filter(Boolean).join(' · ');
  return providers.get(chapter.id.split('-')[0]) || group || chapter.source || '';
}

export function groupComicEditions(chapters) {
  const groups = new Map();
  for (const chapter of chapters) {
    const key = String(chapter.number ?? chapter.id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(chapter);
  }
  return [...groups.values()];
}
