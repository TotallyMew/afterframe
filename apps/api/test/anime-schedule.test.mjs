import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAnimeDetailsSchedule, applyAnimeSeasonSchedule } from '../catalog/anime.mjs';

const overgearedTargets = { 'anilist:212888': { '1-12': '1-12' } };

const overgearedSchedules = {
  212888: {
    1: Date.parse('2026-09-27T14:30:00Z') / 1000,
    8: Date.parse('2026-11-15T14:30:00Z') / 1000,
    9: Date.parse('2026-11-22T14:30:00Z') / 1000,
    10: Date.parse('2026-11-29T14:30:00Z') / 1000,
    11: Date.parse('2026-12-06T14:30:00Z') / 1000,
    12: Date.parse('2026-12-13T14:30:00Z') / 1000,
  },
};

const overgearedSeason = {
  season_number: 1,
  episodes: [
    { season_number: 1, episode_number: 1, name: 'Legendary Class', air_date: '2026-10-02' },
    { season_number: 1, episode_number: 8, name: "Yatan's High Priest", air_date: '2026-11-20' },
    { season_number: 1, episode_number: 9, name: 'Comrades in the Guild', air_date: '2026-11-27' },
    { season_number: 1, episode_number: 10, name: 'Episode 10', air_date: '2026-12-04' },
    { season_number: 1, episode_number: 11, name: 'Episode 11', air_date: '2026-12-11' },
    { season_number: 1, episode_number: 12, name: 'Episode 12', air_date: '2026-12-18' },
  ],
};

const overgearedDetails = {
  id: 324502,
  name: 'Overgeared',
  original_language: 'ja',
  genres: [{ id: 16, name: 'Animation' }],
  first_air_date: '2026-10-02',
  last_air_date: '2026-11-20',
  last_episode_to_air: overgearedSeason.episodes[1],
  next_episode_to_air: overgearedSeason.episodes[2],
  seasons: [{ season_number: 1, name: 'Season 1', episode_count: 12, air_date: '2026-10-02' }],
};

test('early AniList streaming dates override later TMDB TV broadcast dates without mutating cached inputs', () => {
  const seasonResult = applyAnimeSeasonSchedule(overgearedSeason, overgearedTargets, overgearedSchedules);
  assert.equal(seasonResult.changed, true);
  assert.equal(overgearedSeason.episodes[2].air_date, '2026-11-27');
  assert.equal(seasonResult.season.episodes[2].air_date, '2026-11-22');
  assert.equal(seasonResult.season.episodes[3].air_date, '2026-11-29');

  const now = new Date('2026-11-25T17:45:00Z');
  const details = applyAnimeDetailsSchedule(overgearedDetails, 1, seasonResult, now);
  assert.equal(overgearedDetails.next_episode_to_air.episode_number, 9);
  assert.equal(details.last_episode_to_air.episode_number, 9);
  assert.equal(details.last_episode_to_air.air_date, '2026-11-22');
  assert.equal(details.last_air_date, '2026-11-22');
  assert.equal(details.next_episode_to_air.episode_number, 10);
  assert.equal(details.next_episode_to_air.air_date, '2026-11-29');
  assert.equal(details.seasons[0].air_date, '2026-09-27');
  assert.equal(details.first_air_date, '2026-09-27');
});

test('same-day airing advances next_episode_to_air once the AniList timestamp passes', () => {
  const seasonResult = applyAnimeSeasonSchedule(overgearedSeason, overgearedTargets, overgearedSchedules);
  const beforeDrop = applyAnimeDetailsSchedule(overgearedDetails, 1, seasonResult, new Date('2026-11-29T10:00:00Z'));
  assert.equal(beforeDrop.last_episode_to_air.episode_number, 9);
  assert.equal(beforeDrop.next_episode_to_air.episode_number, 10);

  const afterDrop = applyAnimeDetailsSchedule(overgearedDetails, 1, seasonResult, new Date('2026-11-29T15:00:00Z'));
  assert.equal(afterDrop.last_episode_to_air.episode_number, 10);
  assert.equal(afterDrop.next_episode_to_air.episode_number, 11);
  assert.equal(afterDrop.next_episode_to_air.air_date, '2026-12-06');
});

test('season finale streaming early clears next_episode_to_air and advances last_episode_to_air', () => {
  const seasonResult = applyAnimeSeasonSchedule(overgearedSeason, overgearedTargets, overgearedSchedules);
  const afterFinale = applyAnimeDetailsSchedule(overgearedDetails, 1, seasonResult, new Date('2026-12-14T12:00:00Z'));
  assert.equal(afterFinale.last_episode_to_air.episode_number, 12);
  assert.equal(afterFinale.last_episode_to_air.air_date, '2026-12-13');
  assert.equal(afterFinale.next_episode_to_air, null);
});

test('later AniList dates never push back or un-air episodes that already aired on TMDB', () => {
  const targets = { 'anilist:999': { '1-2': '1-2' } };
  const season = {
    season_number: 1,
    episodes: [
      { season_number: 1, episode_number: 1, name: 'Ep 1', air_date: '2026-11-20' },
      { season_number: 1, episode_number: 2, name: 'Ep 2', air_date: '2026-11-27' },
    ],
  };
  const schedules = {
    999: {
      1: Date.parse('2026-11-26T12:00:00Z') / 1000,
      2: Date.parse('2026-12-03T12:00:00Z') / 1000,
    },
  };
  const seasonResult = applyAnimeSeasonSchedule(season, targets, schedules);
  assert.equal(seasonResult.changed, false);
  assert.equal(seasonResult.season.episodes[0].air_date, '2026-11-20');
  assert.equal(seasonResult.season.episodes[1].air_date, '2026-11-27');

  const details = {
    last_episode_to_air: season.episodes[0],
    next_episode_to_air: season.episodes[1],
    seasons: [{ season_number: 1, air_date: '2026-11-20' }],
  };
  const updated = applyAnimeDetailsSchedule(details, 1, seasonResult, new Date('2026-11-25T12:00:00Z'));
  assert.equal(updated.last_episode_to_air.episode_number, 1);
  assert.equal(updated.next_episode_to_air.episode_number, 2);
});

test('split-cour seasons map across multiple AniList entries', () => {
  const targets = {
    'anilist:101': { '1-12': '1-12' },
    'anilist:102': { '13-24': '1-12' },
  };
  const season = {
    season_number: 1,
    episodes: [
      { season_number: 1, episode_number: 12, name: 'Cour 1 Finale', air_date: '2026-11-20' },
      { season_number: 1, episode_number: 13, name: 'Cour 2 Premiere', air_date: '2026-11-27' },
    ],
  };
  const schedules = {
    101: { 12: Date.parse('2026-11-15T14:00:00Z') / 1000 },
    102: { 1: Date.parse('2026-11-22T14:00:00Z') / 1000 },
  };
  const seasonResult = applyAnimeSeasonSchedule(season, targets, schedules);
  assert.equal(seasonResult.changed, true);
  assert.equal(seasonResult.season.episodes[0].air_date, '2026-11-15');
  assert.equal(seasonResult.season.episodes[1].air_date, '2026-11-22');
});
