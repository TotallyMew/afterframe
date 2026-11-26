export interface SkipSegment {
  kind: 'intro' | 'recap' | 'credits';
  start: number;
  end: number;
  autoSkip?: boolean;
  source?: 'verified' | 'aniskip' | 'skipdb' | 'theintrodb' | 'introdb';
}

export interface ViewingSession {
  sample: { time: number; now: number } | null;
  ranges: [number, number][];
  skipped: [number, number][];
}

export interface PlaybackPosition {
  currentTime: number;
  duration: number;
  paused?: boolean;
  seeking?: boolean;
}

export const preferenceDefaults: Readonly<Record<
  'intro' | 'recap' | 'credits' | 'autoplay' | 'resume' | 'autoAddWatching' | 'volume' | 'subtitles' | 'blur' | 'hideSynopsis' |
  'reducedMotion' | 'compact' | 'confirmRemoval' | 'notifyEpisodes' | 'notifySeasonStarts' | 'notifySeasonSchedules',
  boolean
>>;

export function movieDurationMismatch(expectedMinutes: number | undefined, duration: number): boolean;
export function viewingSession(progress?: { ranges?: [number, number][]; skipped?: [number, number][] } | null): ViewingSession;
export function mergeRanges(ranges: [number, number][], start: number, end: number): [number, number][];
export function samplePlayback(tracking: ViewingSession, position: PlaybackPosition, now: number): boolean;
export function watchedSeconds(ranges: [number, number][], length: number): number;
export function activeSkipSegment(segments: SkipSegment[], position: { currentTime: number; duration: number }): SkipSegment | undefined;
export function bufferedIntervals(buffered: TimeRanges | undefined | null, duration: number): [number, number][];
export function completionReached(
  ranges: [number, number][],
  position: { currentTime: number; duration: number },
  credits: SkipSegment[],
  ended?: boolean,
  skipped?: [number, number][],
): boolean;
