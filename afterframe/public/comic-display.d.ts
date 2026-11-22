type Edition = { id: string; number?: string | number | null; groups?: (string | { name?: string })[]; source?: string };
export function comicLanguage(code: string): string;
export function comicEditionCredit(chapter: Edition): string;
export function groupComicEditions<T extends Edition>(chapters: T[]): T[][];
