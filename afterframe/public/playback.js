export const preferenceDefaults = {
  intro: true, recap: true, credits: true, autoplay: true, resume: true,
  volume: true, subtitles: true, blur: true, hideSynopsis: true,
  reducedMotion: false, compact: false, confirmRemoval: true,
  notifyEpisodes: true, notifySeasonStarts: true, notifySeasonSchedules: true,
};

export function movieDurationMismatch(expectedMinutes, duration) {
  const expected = expectedMinutes * 60;
  return Number.isFinite(expected) && expected > 0 && Number.isFinite(duration) && duration > 0
    && Math.abs(expected - duration) > Math.max(20 * 60, expected * .3);
}

export function viewingSession(progress) {
  return { sample: null, ranges: Array.isArray(progress?.ranges) ? progress.ranges : [], skipped: Array.isArray(progress?.skipped) ? progress.skipped : [] };
}

export function mergeRanges(ranges, start, end) {
  if (end <= start) return ranges;
  const merged = [];
  for (const range of [...ranges, [start, end]].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1] + .12) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

export function samplePlayback(tracking, position, now) {
  const previous = tracking.sample;
  tracking.sample = { time: position.currentTime, now };
  if (!previous || position.paused || position.seeking) return false;
  const elapsed = (now - previous.now) / 1000;
  const advanced = position.currentTime - previous.time;
  if (elapsed <= 0 || advanced <= 0 || advanced > elapsed * 3 + .45) return false;
  tracking.ranges = mergeRanges(tracking.ranges, previous.time, position.currentTime);
  return true;
}

export function watchedSeconds(ranges, length) {
  return ranges.reduce((sum, [start, end]) => sum + Math.max(0, Math.min(end, length) - start), 0);
}

export function activeSkipSegment(segments, { currentTime, duration }) {
  return segments.find(segment => currentTime >= segment.start && currentTime < segment.end && segment.end <= duration);
}

export function bufferedIntervals(buffered, duration) {
  if (!buffered || !Number.isFinite(duration) || duration <= 0) return [];
  const intervals = [];
  for (let index = 0; index < buffered.length; index++) {
    const start = Math.max(0, buffered.start(index)) / duration;
    const end = Math.min(duration, buffered.end(index)) / duration;
    if (end > start) intervals.push([start * 100, end * 100]);
  }
  return intervals;
}

export function completionReached(ranges, position, credits, ended = false, skipped = []) {
  const terminal = credits.find(segment => segment.end >= position.duration - .25 && segment.start >= position.duration * .65);
  const boundary = terminal ? terminal.start : position.duration * .9;
  const creditable = skipped.reduce((coverage, [start, end]) => mergeRanges(coverage, start, end), ranges);
  const viewed = watchedSeconds(creditable, boundary);
  const watched = watchedSeconds(ranges, boundary);
  return position.currentTime >= boundary - .25 && watched >= boundary * .65 && viewed >= boundary * (ended ? .9 : .95);
}
