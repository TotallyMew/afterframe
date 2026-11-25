export const comicIdSource = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
export const weebIdSource = '[0-7][0-9a-hjkmnp-tv-z]{25}';
export const chapterNumberSource = '[0-9]{1,5}(?:\\.[0-9]{1,4})?';
export const comicChapterIdSource = `(?:${comicIdSource}|weeb-${weebIdSource}|(?:lector|scans)-${chapterNumberSource})`;
export const comicIdPattern = new RegExp(`^${comicIdSource}$`);
export const comicChapterIdPattern = new RegExp(`^${comicChapterIdSource}$`);
