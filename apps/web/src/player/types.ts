import type { ArchiveMedia, ArchiveTitle } from '@afterframe/shared/catalog';
import type { EpisodePosition, MediaType, Title } from '../catalog';

export const cineSrcOrigin = 'https://cinesrc.st';

export const animePlayers = {
  emnex: { label: 'EmnexAnime', origin: 'https://api.emnexanime.site', next: 'cinesrc' as const },
  cinesrc: { label: 'CineSrc', origin: cineSrcOrigin, next: 'emnex' as const },
};

export type AnimeProvider = keyof typeof animePlayers;

export interface EmnexSubtitle {
  lang: string;
  url: string;
  default?: boolean;
}

export interface EmnexTimingRange {
  start: number;
  end: number;
}

export interface EmnexServerOption {
  provider: string;
  type: 'sub' | 'dub';
}

export interface EmnexAvailableTypes {
  sub: boolean;
  dub: boolean;
}

export interface EmnexStreamData {
  provider: string;
  type: 'sub' | 'dub';
  hls: string;
  subtitles: EmnexSubtitle[];
  intro: EmnexTimingRange | null;
  outro: EmnexTimingRange | null;
  servers?: EmnexServerOption[];
  availableTypes?: EmnexAvailableTypes;
  fallbackFrom?: 'sub' | 'dub';
}

const animeShowAudioKey = 'afterframe.animeShowAudio';

export function readAnimeAudioPreference(showKey: string): 'sub' | 'dub' | null {
  try {
    const map = JSON.parse(localStorage.getItem(animeShowAudioKey) || 'null');
    if (map && typeof map === 'object') {
      const value = (map as Record<string, unknown>)[showKey];
      if (value === 'sub' || value === 'dub') return value;
    }
  } catch { /* Storage unavailable */ }
  return null;
}

export function writeAnimeAudioPreference(showKey: string, audio: 'sub' | 'dub') {
  try {
    const raw = JSON.parse(localStorage.getItem(animeShowAudioKey) || 'null');
    const map: Record<string, 'sub' | 'dub'> = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
    map[showKey] = audio;
    const keys = Object.keys(map);
    if (keys.length > 100) delete map[keys[0]];
    localStorage.setItem(animeShowAudioKey, JSON.stringify(map));
  } catch { /* Storage unavailable */ }
}

export const cineSrcServers = new Map<string, string>();
export const segmentNames = { intro: 'Intro', recap: 'Recap', credits: 'Credits', preview: 'Preview' } as const;
export const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export const qualityOptions = [['', 'Auto'], ['480', '480p'], ['720', '720p'], ['1080', '1080p']] as const;
export const episodeRangeSize = 15;

export interface NativeAudioTrack {
  enabled: boolean;
  label: string;
  language: string;
}

export interface NativeAudioTrackList extends EventTarget {
  readonly length: number;
  [index: number]: NativeAudioTrack;
}

export type VideoWithAudioTracks = HTMLVideoElement & {
  audioTracks?: NativeAudioTrackList;
  webkitDisplayingFullscreen?: boolean;
  webkitSupportsFullscreen?: boolean;
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
};

export interface CineRestoreState {
  time?: number;
  paused?: boolean;
  volume?: number;
  muted?: boolean;
  playbackRate?: number;
}

export type PlayerRoute =
  | { kind: 'catalog'; type: MediaType; id: number; season?: number; episode?: number }
  | { kind: 'edition'; key: string; watch: boolean; episodeKey?: string };

export interface ActiveMedia {
  item: Title;
  archive?: ArchiveTitle;
  episode?: EpisodePosition & { key?: string; duration?: number };
  nativeMedia?: ArchiveMedia;
  embed: boolean;
  progressKey: string;
}
