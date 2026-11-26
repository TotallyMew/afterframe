import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyAnimeDetailsSchedule,
  applyAnimeDubSchedule,
  applyAnimeSeasonSchedule,
  applyVirtualAnimeSeasons,
  sliceVirtualSeason,
  virtualSeasonsFromTargets,
} from '../catalog/anime.mjs';

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

test('virtualSeasonsFromTargets splits single-season TMDb anime using TVDB seasons without splitting split-cour S1', () => {
  const apothecaryTargets = {
    'anilist:161645': { '1-24': '1-24' },
    'anilist:176301': { '25-48': '1-24' },
    'anilist:195516': { '49-': '1-' },
    'mal:54492': { '1-24': '1-24' },
    'mal:58514': { '25-48': '1-24' },
    'tvdb_show:431162:s1': { '1-24': '1-24' },
    'tvdb_show:431162:s2': { '25-48': '1-24' },
    'tvdb_show:431162:s3': { '49-56': '1-8' },
  };
  const plan = virtualSeasonsFromTargets(apothecaryTargets);
  assert.deepEqual(plan, [
    { season: 1, start: 1, end: 24 },
    { season: 2, start: 25, end: 48 },
    { season: 3, start: 49, end: Infinity },
  ]);

  // Split-cour Season 1 (two AniList entries, single TVDB season) must NOT be split.
  const spyFamilyS1 = {
    'anilist:140960': { '1-12': '1-12' },
    'anilist:142838': { '13-25': '1-13' },
    'tvdb_show:405920:s1': { '1-25': '1-25' },
  };
  assert.equal(virtualSeasonsFromTargets(spyFamilyS1), null);

  const rawS1 = {
    season_number: 1,
    name: 'Season 1',
    episodes: Array.from({ length: 60 }, (_, idx) => ({
      season_number: 1,
      episode_number: idx + 1,
      name: `Ep ${idx + 1}`,
      air_date: idx < 24 ? '2023-10-21' : idx < 48 ? '2025-01-10' : idx < 56 ? '2026-10-02' : '2026-12-04',
    })),
  };
  const details = {
    id: 220542,
    name: 'The Apothecary Diaries',
    number_of_seasons: 1,
    seasons: [
      { season_number: 0, name: 'Specials', episode_count: 58 },
      { season_number: 1, name: 'Season 1', episode_count: 60, air_date: '2023-10-21' },
    ],
    last_episode_to_air: { season_number: 1, episode_number: 56, name: 'Ep 56', air_date: '2026-11-20' },
    next_episode_to_air: { season_number: 1, episode_number: 57, name: 'Ep 57', air_date: '2026-11-27' },
  };
  const { details: split } = applyVirtualAnimeSeasons(details, rawS1, plan);
  assert.equal(split.number_of_seasons, 3);
  assert.deepEqual(split.seasons.map(s => [s.season_number, s.name, s.episode_count]), [
    [0, 'Specials', 58],
    [1, 'Season 1', 24],
    [2, 'Season 2', 24],
    [3, 'Season 3', 12],
  ]);
  assert.deepEqual(split.last_episode_to_air, { season_number: 3, episode_number: 8, name: 'Ep 56', air_date: '2026-11-20' });
  assert.deepEqual(split.next_episode_to_air, { season_number: 3, episode_number: 9, name: 'Ep 57', air_date: '2026-11-27' });

  const s3 = sliceVirtualSeason(rawS1, plan[2]);
  assert.equal(s3.episodes.length, 12);
  assert.equal(s3.episodes[0].season_number, 3);
  assert.equal(s3.episodes[0].episode_number, 1);
  assert.equal(s3.episodes[11].episode_number, 12);
});

test('applyAnimeDubSchedule attaches aired, scheduled, and estimated dub dates on virtual seasons', () => {
  const targets = {
    'anilist:195516': { '49-': '1-' },
  };
  const s3 = {
    season_number: 3,
    episodes: [
      { season_number: 3, episode_number: 6, name: 'Ep 6', air_date: '2026-11-06' },
      { season_number: 3, episode_number: 7, name: 'Ep 7', air_date: '2026-11-13' },
      { season_number: 3, episode_number: 8, name: 'Ep 8', air_date: '2026-11-20' },
    ],
  };
  const dubSchedules = {
    feedByAnilist: new Map([[195516, new Map([[6, '2026-11-20T15:30:00Z']])]]),
    feedByMal: new Map(),
    schedByAnilist: new Map([[195516, { episodeNumber: 7, episodeDate: '2026-11-27T16:00:00Z', episodes: 12 }]]),
    schedByMal: new Map(),
  };
  const result = applyAnimeDubSchedule(s3, targets, { dubInfo: { dubbed: new Set(), incomplete: new Set() }, dubSchedules }, {
    episodeOffset: 48,
    now: new Date('2026-11-26T22:00:00Z'),
  });
  assert.equal(result.dubAvailable, true);
  assert.equal(result.season.dub_available, true);
  assert.equal(result.season.episodes[0].dub_aired, true);
  assert.equal(result.season.episodes[0].dub_air_date, '2026-11-20');
  assert.equal(result.season.episodes[1].dub_aired, false);
  assert.equal(result.season.episodes[1].dub_air_date, '2026-11-27');
  assert.equal(result.season.episodes[1].dub_estimated, undefined);
  assert.equal(result.season.episodes[2].dub_aired, false);
  assert.equal(result.season.episodes[2].dub_air_date, '2026-12-04');
  assert.equal(result.season.episodes[2].dub_estimated, true);
});
