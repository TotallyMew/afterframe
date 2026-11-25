export const watchStatuses: {
  readonly planned: 'Plan to Watch';
  readonly watching: 'Watching';
  readonly completed: 'Completed';
  readonly hold: 'On Hold';
  readonly dropped: 'Dropped';
};

export function ratingOnTen<T extends { score: number; scale?: number }>(entry: T): T & { scale: 10 };
export function watchStatus(entry?: { watchStatus?: string } | null): keyof typeof watchStatuses;
export function titleProgress(
  item: { key: string; type: 'movie' | 'tv'; totalEpisodes?: number },
  progress: Record<string, { updated: number; duration?: number; ranges?: [number, number][] }>,
  watched: Record<string, unknown>,
): number;
export function recommendationProfile(library?: Record<string, unknown>): {
  personalized: boolean;
  seeds: { item: Record<string, unknown>; weight: number; updated: number }[];
  excluded: Set<string>;
  completedSeries: Set<string>;
};
