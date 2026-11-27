import { readFile } from 'node:fs/promises';
import { releaseSnapshot, releaseTargets, storeReleaseEvents } from '../accounts/accounts.mjs';

const checkInterval = 15 * 60000;

export function releaseEvents(seriesId, last, previous, now = new Date(), confirmed = []) {
  if (last === null && !previous) return { snapshot: { date: '', season: 0, episode: 0 }, events: [] };
  const date = last?.air_date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || date >= now.toISOString().slice(0, 10)
    || !Number.isSafeInteger(last.season_number) || last.season_number < 1 || !Number.isSafeInteger(last.episode_number) || last.episode_number < 1) return { snapshot: previous, events: [] };
  const { season_number: season, episode_number: episode } = last;
  const snapshot = { date, season, episode };
  if (!previous) return { snapshot, events: [] };
  if (date < previous.date || season < previous.season || (season === previous.season && episode <= previous.episode)) return { snapshot: previous, events: [] };
  const prefix = `tmdb-${seriesId}-s${season}`;
  const episodes = new Map();
  for (const entry of [...confirmed, last]) {
    const number = entry.episode_number;
    if (entry.season_number !== season || !Number.isSafeInteger(number) || number < 1 || number > episode || (season === previous.season && number <= previous.episode)
      || !/^\d{4}-\d{2}-\d{2}$/.test(entry.air_date || '') || entry.air_date < previous.date || entry.air_date > date) continue;
    episodes.set(number, entry.air_date);
  }
  const events = [...episodes].map(([number, airDate]) => ({ key: `${prefix}e${number}`, message: `Season ${season}, episode ${number} aired on ${airDate}.`, preference: 'notifyEpisodes' }));
  if (season > previous.season) events.push({ key: `${prefix}-start`, message: `Season ${season} has started airing.`, preference: 'notifySeasonStarts' });
  return { snapshot, events };
}

async function verifiedAnnouncements() {
  const file = process.env.AFTERFRAME_ANNOUNCEMENTS_FILE;
  if (!file) return [];
  const input = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(input)) throw new Error('Expected an array of verified announcements.');
  return input.filter(entry => {
    const source = typeof entry?.source === 'string' ? URL.parse(entry.source) : null;
    return source?.protocol === 'https:' && !source.username && !source.password && Number.isSafeInteger(entry.seriesId) && entry.seriesId > 0
      && Number.isInteger(entry.season) && entry.season > 0;
  });
}

async function processAnnouncements(announcements, targets, index = 0) {
  if (index >= announcements.length) return;
  const { seriesId, season, source } = announcements[index];
  const followers = targets.get(seriesId);
  if (followers) {
    await storeReleaseEvents(seriesId, followers, previous => ({
      snapshot: previous,
      events: [{
        key: `verified-${seriesId}-s${season}`,
        message: `Season ${season} was announced.`,
        preference: 'notifySeasonSchedules',
        source,
      }],
    }));
  }
  await processAnnouncements(announcements, targets, index + 1);
}

async function checkSeriesRelease(seriesId, followers, loadDetails, loadSeason) {
  try {
    const details = await loadDetails(seriesId);
    const now = new Date();
    const last = details.last_episode_to_air;
    const baseline = await releaseSnapshot(seriesId);
    const change = releaseEvents(seriesId, last, baseline, now);
    const crossedMultiple = change.events.length && last.episode_number > (last.season_number === baseline.season ? baseline.episode + 1 : 1);
    const confirmed = crossedMultiple ? (await loadSeason(seriesId, last.season_number).catch(() => null))?.episodes || [] : [];
    await storeReleaseEvents(seriesId, followers, previous => releaseEvents(seriesId, last, previous, now, confirmed));
  } catch { /* Keep the previous baseline on a provider failure. */ }
}

async function checkSeriesBatch(batch, targets, loadDetails, loadSeason, index = 0) {
  if (index >= batch.length) return;
  const seriesId = batch[index];
  await checkSeriesRelease(seriesId, targets.get(seriesId), loadDetails, loadSeason);
  await checkSeriesBatch(batch, targets, loadDetails, loadSeason, index + 1);
}

export function monitorReleases(loadDetails, canLoad, loadSeason) {
  let cursor = 0;
  let running = false;
  async function check() {
    if (running) return;
    running = true;
    try {
      const targets = await releaseTargets();
      const series = [...targets.keys()].sort((a, b) => a - b);
      const announcements = await verifiedAnnouncements().catch(() => {
        console.error('Unable to load the verified announcement feed.');
        return [];
      });
      await processAnnouncements(announcements, targets);
      if (!canLoad() || !series.length) return;
      if (cursor >= series.length) cursor = 0;
      await checkSeriesBatch(series.slice(cursor, cursor + 20), targets, loadDetails, loadSeason);
      cursor += 20;
    } finally { running = false; }
  }
  const run = () => {
    void check().catch(() => console.error('Unable to check followed series releases.'));
  };
  const timer = setInterval(run, checkInterval);
  timer.unref();
  run();
  return () => clearInterval(timer);
}
