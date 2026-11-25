export interface SubtitleTrack {
  url: string;
  language: string;
  release: string;
}

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export function playbackLanguage(value?: string): string;
export function samePlaybackLanguage(first?: string, second?: string): boolean;
export function findSubtitles(
  item: { id: number; type: 'movie' | 'tv'; imdb?: string },
  episode: { season: number; number: number } | null | undefined,
  signal: AbortSignal,
): Promise<SubtitleTrack[]>;
export function loadSubtitle(track: SubtitleTrack, signal: AbortSignal): Promise<SubtitleCue[]>;
