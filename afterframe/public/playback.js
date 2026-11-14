export const preferenceDefaults = {
  intro: true, recap: true, credits: true, autoplay: true, resume: true,
  volume: true, subtitles: true, blur: true, hideSynopsis: false,
  reducedMotion: false, compact: false, confirmRemoval: true,
};

export function viewingSession(progress) {
  return { sample: null, ranges: progress?.ranges || [], skipped: progress?.skipped || [] };
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

export function completionReached(ranges, position, credits, ended = false, skipped = []) {
  const terminal = credits.find(segment => segment.end >= position.duration - .25 && segment.start >= position.duration * .65);
  const boundary = terminal ? terminal.start : position.duration * .9;
  const creditable = skipped.reduce((coverage, [start, end]) => mergeRanges(coverage, start, end), ranges);
  const viewed = creditable.reduce((sum, [start, end]) => sum + Math.max(0, Math.min(end, boundary) - start), 0);
  const watched = ranges.reduce((sum, [start, end]) => sum + Math.max(0, Math.min(end, boundary) - start), 0);
  return position.currentTime >= boundary - .25 && watched >= boundary * .65 && viewed >= boundary * (ended ? .9 : .95);
}
