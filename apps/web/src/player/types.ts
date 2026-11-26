import type { ArchiveMedia, ArchiveTitle } from '@afterframe/shared/catalog';
import type { EpisodePosition, MediaType, Title } from '../catalog';

export const cineSrcOrigin = 'https://cinesrc.st';

export const animePlayers = {
  animeembed: { label: 'AnimeEmbed', origin: 'https://animeembed.com', next: 'anipm' as const },
  anipm: { label: 'Ani.pm', origin: 'https://ani.pm', next: 'cinesrc' as const },
  cinesrc: { label: 'CineSrc', origin: cineSrcOrigin, next: 'animeembed' as const },
};

export type AnimeProvider = keyof typeof animePlayers;

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
