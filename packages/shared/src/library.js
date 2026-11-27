import { watchedSeconds } from './playback.js';

export const watchStatuses = {
  planned: 'Plan to Watch', watching: 'Watching', completed: 'Completed', hold: 'On Hold', dropped: 'Dropped',
};

export function ratingOnTen(entry) {
  return entry.scale === 10 ? entry : { ...entry, score: entry.score * 2, scale: 10 };
}

export function watchStatus(entry) {
  return Object.hasOwn(watchStatuses, entry?.watchStatus) ? entry.watchStatus : 'planned';
}

export function titleProgress({ key, type, totalEpisodes }, progress, watched) {
  if (watched[key]) return 100;
  const completed = Object.keys(watched).filter(id => id.startsWith(`${key}/`) && !id.startsWith(`${key}/cinesrc-s0e`)).length;
  const entries = Object.entries(progress).filter(([id]) => !watched[id] && (id === key || id.startsWith(`${key}/`)));
  const current = entries.toSorted(([, a], [, b]) => b.updated - a.updated)[0]?.[1];
  const ranges = Array.isArray(current?.ranges) ? current.ranges : [];
  const coverage = current?.duration > 0 ? Math.min(1, watchedSeconds(ranges, current.duration) / current.duration) : 0;
  if (type === 'tv' && totalEpisodes > 0) return completed || coverage ? Math.max(1, Math.min(100, Math.floor((completed + coverage) / totalEpisodes * 100))) : 0;
  if (coverage) {
    const cap = type === 'tv' ? 99 : 100;
    return Math.max(1, Math.min(cap, Math.floor(coverage * 100)));
  }
  return completed ? 1 : 0;
}

function addActivity(activity, item, weight, updated = 0) {
  if (!item?.key || !['movie', 'tv'].includes(item.type)) return;
  const previous = activity.get(item.key);
  activity.set(item.key, {
    item,
    weight: Math.min(12, (previous?.weight || 0) + weight),
    updated: Math.max(previous?.updated || 0, updated),
  });
}

function isMeaningfulHistoryEntry(entry) {
  if (!entry?.item?.key || typeof entry.mediaKey !== 'string') return false;
  if (!Number.isFinite(entry.coverage) || !Number.isFinite(entry.duration)) return false;
  return Boolean(entry.completed) || entry.coverage >= Math.min(entry.duration * 0.4, 600);
}

function collectHistorySignals(history, activity, excluded, meaningful) {
  for (const entry of Object.values(history || {})) {
    if (!isMeaningfulHistoryEntry(entry) || meaningful.has(entry.mediaKey)) continue;
    meaningful.add(entry.mediaKey);
    addActivity(activity, entry.item, entry.completed ? 3 : 1, entry.updated);
    if (entry.completed && entry.item.type === 'movie') excluded.add(entry.item.key);
  }
}

function collectWatchedSignals(watched, activity, excluded, completedSeries) {
  const finishedEpisodes = new Map();
  for (const [key, entry] of Object.entries(watched || {})) {
    if (entry?.item?.type === 'movie') excluded.add(entry.item.key);
    if (entry?.item?.type !== 'tv' || !key.startsWith(`${entry.item.key}/`) || key.startsWith(`${entry.item.key}/cinesrc-s0e`)) continue;
    const count = (finishedEpisodes.get(entry.item.key) || 0) + 1;
    finishedEpisodes.set(entry.item.key, count);
    if (entry.item.totalEpisodes > 0 && count === entry.item.totalEpisodes) {
      completedSeries.add(entry.item.key);
      excluded.add(entry.item.key);
      addActivity(activity, entry.item, 3, entry.updated);
    }
  }
}

function collectRatingSignals(ratings, activity, excluded, disliked) {
  for (const entry of Object.values(ratings || {})) {
    const score = entry?.score != null ? ratingOnTen(entry).score : 0;
    if (score >= 7) addActivity(activity, entry.item, (score - 6) * 2);
    if (score > 0 && score <= 3 && entry.item?.key) {
      excluded.add(entry.item.key);
      disliked.add(entry.item.key);
    }
  }
}

function collectSavedSignals(saved, activity, excluded, completedSeries) {
  for (const entry of Object.values(saved || {})) {
    const status = watchStatus(entry);
    if (status === 'watching') addActivity(activity, entry, 2);
    if (status === 'completed') {
      if (entry.type === 'tv' && entry.key) completedSeries.add(entry.key);
      addActivity(activity, entry, 3, entry.completedAt);
    }
    if (['completed', 'dropped'].includes(status)) excluded.add(entry.key);
  }
}

export function recommendationProfile(library = {}) {
  const activity = new Map();
  const excluded = new Set();
  const disliked = new Set();
  const meaningful = new Set();
  const completedSeries = new Set();
  collectHistorySignals(library.history, activity, excluded, meaningful);
  collectWatchedSignals(library.watched, activity, excluded, completedSeries);
  collectRatingSignals(library.ratings, activity, excluded, disliked);
  collectSavedSignals(library.saved, activity, excluded, completedSeries);
  const seeds = [...activity.values()]
    .filter(({ item }) => watchStatus(library.saved?.[item.key]) !== 'dropped' && !disliked.has(item.key))
    .toSorted((a, b) => b.weight - a.weight || b.updated - a.updated);
  return { personalized: meaningful.size >= 3 || completedSeries.size >= 2, seeds, excluded, completedSeries };
}
