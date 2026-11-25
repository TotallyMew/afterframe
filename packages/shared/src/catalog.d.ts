export interface ArchiveMedia {
  archive?: string;
  file?: string;
  url?: string;
  source?: string;
  page?: string;
  captions?: string;
  segments?: { kind: 'intro' | 'recap' | 'credits'; start: number; end: number }[];
}

export interface ArchiveEpisode {
  key: string;
  title: string;
  number?: number;
  season?: number;
  duration?: number;
  media: ArchiveMedia;
}

export interface ArchiveTitle {
  key: string;
  id: number | null;
  archiveId?: string;
  title: string;
  year: number | string;
  genre?: string;
  categories?: string[];
  duration?: number | null;
  description?: string;
  credit?: string;
  media?: ArchiveMedia | null;
  type: 'movie' | 'tv';
  poster?: string;
  backdrop?: string;
  license?: [string, string];
  episodes?: ArchiveEpisode[];
}

export const archiveCatalog: ArchiveTitle[];
export function archiveFileUrl(media: ArchiveMedia): string;
