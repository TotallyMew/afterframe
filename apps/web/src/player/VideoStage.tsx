import { archiveFileUrl } from '@afterframe/shared/catalog';
import { isAnime } from '@afterframe/shared/discover';
import {
  activeSkipSegment, bufferedIntervals, completionReached, mergeRanges, movieDurationMismatch,
  preferenceDefaults, samplePlayback, viewingSession, watchedSeconds, type PlaybackPosition, type SkipSegment, type ViewingSession,
} from '@afterframe/shared/playback';
import { findSubtitles, isForcedSubtitle, isHearingImpairedSubtitle, loadSubtitle, playbackLanguage, samePlaybackLanguage, type SubtitleCue, type SubtitleTrack } from '@afterframe/shared/subtitles';
import type Hls from 'hls.js';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { imagePath, navigate, request, type EpisodePosition, type Title } from '../catalog';
import { Artwork, Icon } from '../components';
import type { LibraryControls } from '../library';
import { EmbedNoticeBar } from './EmbedNoticeBar';
import { PlayerControls } from './PlayerControls';
import { PlayerGlyph } from './PlayerGlyph';
import { formatClock, rememberCineServer } from './route';
import { readCaptionStyle, writeCaptionStyle, type CaptionStyle } from './SubtitleMenu';
import {
  animePlayers, cineSrcOrigin, cineSrcServers, readAnimeAudioPreference, segmentNames, writeAnimeAudioPreference,
  type ActiveMedia, type AnimeProvider, type CineRestoreState,
  type EmnexAvailableTypes, type EmnexServerOption, type EmnexStreamData, type VideoWithAudioTracks,
} from './types';
import { useMediaQuery } from '../UiControls';

function endSegmentReachesEnd(segment: SkipSegment | undefined, allSegments: SkipSegment[], duration: number): boolean {
  if (!segment || !Number.isFinite(duration) || duration <= 0) return false;
  if (segment.kind !== 'credits' && segment.kind !== 'preview') return false;
  if (segment.end >= duration - 8) return true;
  if (segment.kind === 'credits') {
    return allSegments.some(other => other.kind === 'preview' && other.start <= segment.end + 5 && other.end >= duration - 8);
  }
  return false;
}

function clampEmnexSegments(intro: { start: number; end: number } | null, outro: { start: number; end: number } | null, duration: number): SkipSegment[] {
  const out: SkipSegment[] = [];
  const push = (kind: 'intro' | 'credits', range: { start: number; end: number } | null) => {
    if (!range) return;
    if (duration > 0) {
      if (range.start >= duration - 2 || range.end > duration + 20) return;
      const clampedEnd = Math.min(range.end, duration);
      if (clampedEnd <= range.start + 3) return;
      out.push({ kind, start: range.start, end: clampedEnd, autoSkip: true });
    } else if (range.end > range.start + 3) {
      out.push({ kind, start: range.start, end: range.end, autoSkip: true });
    }
  };
  push('intro', intro);
  push('credits', outro);
  return out;
}

function collapseDashParen(raw: string): string {
  const parts = raw.split('(');
  let out = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const stripped = part.trimStart();
    if (stripped.startsWith('-')) {
      out = `${out.trimEnd()} (${stripped.slice(1).trimStart()}`;
    } else {
      out += `(${part}`;
    }
  }
  return out;
}

function cleanEmnexSubtitleLang(raw: string): string {
  let cleaned = collapseDashParen(raw);
  while (cleaned.endsWith('))')) cleaned = cleaned.slice(0, -1);
  return cleaned.trim();
}

function formatEmnexSubtitleTrack(entry: { lang: string; url: string }): SubtitleTrack {
  const cleaned = cleanEmnexSubtitleLang(entry.lang);
  const parenIdx = cleaned.indexOf('(');
  const base = (parenIdx > 0 ? cleaned.slice(0, parenIdx) : cleaned).trim();
  const language = playbackLanguage(base) || cleaned;
  const forced = isForcedSubtitle(cleaned);
  const hearingImpaired = isHearingImpairedSubtitle(cleaned);
  return {
    url: entry.url,
    language,
    release: cleaned !== language ? cleaned : '',
    ...(forced ? { forced: true } : {}),
    ...(hearingImpaired ? { hearingImpaired: true } : {}),
  };
}

function resolvePreferredSubtitleLang(prefs: LibraryControls['library']['preferences']): string {
  if (!(prefs.subtitles ?? preferenceDefaults.subtitles)) return '';
  if (prefs.subtitleLanguage !== undefined) return prefs.subtitleLanguage;
  return prefs.captions ? 'English' : '';
}

function resolveEmnexFallbackNotice(fallbackFrom?: string): string {
  if (fallbackFrom === 'dub') return 'Dub unavailable for this episode · Playing Sub.';
  if (fallbackFrom === 'sub') return 'Sub unavailable for this episode · Playing Dub.';
  return '';
}

function resolveWantedEmnexSubtitleLang(
  dataType: 'sub' | 'dub',
  defaultLang: string,
  curPrefs: LibraryControls['library']['preferences'],
): string {
  const allowSubs = curPrefs.subtitles ?? preferenceDefaults.subtitles;
  if (!allowSubs) return '';
  if (curPrefs.subtitleLanguage !== undefined) return curPrefs.subtitleLanguage;
  if (dataType === 'sub') return defaultLang || 'English';
  return curPrefs.captions ? 'English' : '';
}

function pickInitialSubLang(tracks: SubtitleTrack[], wantedLang: string): string {
  const langs = [...new Set(tracks.map(t => t.language))];
  const matched = langs.find(l => samePlaybackLanguage(l, wantedLang));
  if (matched) return matched;
  if (langs.includes('English')) return 'English';
  return langs[0] || '';
}

function pickInitialEmnexSubTrack(
  tracks: SubtitleTrack[],
  wantedLang: string,
  dataType: 'sub' | 'dub',
  defaultEntryUrl?: string,
): SubtitleTrack | undefined {
  if (!wantedLang || !tracks.length) return undefined;
  const langTracks = tracks.filter(t => samePlaybackLanguage(t.language, wantedLang));
  const preferred = langTracks.find(t => !t.forced) ?? langTracks[0];
  if (preferred) return preferred;
  if (dataType === 'sub' && defaultEntryUrl) {
    return tracks.find(t => t.url === defaultEntryUrl);
  }
  return undefined;
}

function resolveReloadTime(ended: boolean, pending: number | undefined, pos: PlaybackPosition): number | undefined {
  if (ended) return 0;
  if (pending !== undefined) return pending;
  return pos.duration > 0 ? pos.currentTime : undefined;
}

function resolveNativeSrc(media: ActiveMedia, direct: boolean): string {
  if (!media.nativeMedia) return '';
  if (direct) return archiveFileUrl(media.nativeMedia);
  const itemPart = encodeURIComponent(media.item.key);
  const epSuffix = media.episode?.key ? `/${encodeURIComponent(media.episode.key)}` : '';
  return `/stream/${itemPart}${epSuffix}`;
}

function formatStageSubtitle(
  displayItem: Title,
  displayEpisode?: EpisodePosition & { key?: string; duration?: number },
): string | undefined {
  if (!displayEpisode) return displayItem.description;
  const durationSuffix = displayEpisode.duration ? ` · ${displayEpisode.duration} min` : '';
  return `${displayItem.title} · S${displayEpisode.season} E${displayEpisode.number}${durationSuffix}`;
}

function formatBufferedGradient(ranges: [number, number][]): string {
  if (!ranges.length) return '';
  const stops = ranges.map(([s, e]) => `transparent ${s}%, #ffffff80 ${s}% ${e}%, transparent ${e}%`).join(', ');
  return `linear-gradient(to right, ${stops})`;
}

function tapRegionSide(ratio: number): 'left' | 'center' | 'right' {
  if (ratio < 0.35) return 'left';
  if (ratio > 0.65) return 'right';
  return 'center';
}

function findActiveCaptionText(cues: SubtitleCue[] | undefined, lookupTime: number): string {
  if (!cues?.length) return '';
  let low = 0;
  let high = cues.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (cues[mid].start <= lookupTime) low = mid + 1;
    else high = mid;
  }
  const matched: string[] = [];
  for (let i = Math.max(0, low - 8); i < low; i++) {
    const c = cues[i];
    if (lookupTime >= c.start && lookupTime < c.end) matched.push(c.text);
  }
  return matched.join('\n');
}

function resolveArchiveSourceUrl(nativeMedia: ActiveMedia['nativeMedia']): string {
  if (!nativeMedia) return '';
  if (nativeMedia.page) return nativeMedia.page;
  return nativeMedia.archive ? `https://archive.org/details/${encodeURIComponent(nativeMedia.archive)}` : '';
}

function applyNativeVideoCommand(
  video: VideoWithAudioTracks | null,
  command: string,
  args: unknown[],
  tracking: ViewingSession,
) {
  if (!video) return;
  switch (command) {
    case 'play':
      void video.play().catch(() => {});
      break;
    case 'pause':
      video.pause();
      break;
    case 'seek':
      if (Number.isFinite(Number(args[0])) && Number.isFinite(video.duration)) {
        tracking.sample = null;
        video.currentTime = Math.max(0, Math.min(video.duration, Number(args[0])));
      }
      break;
    case 'setVolume':
      video.volume = Number(args[0]);
      break;
    case 'setMuted':
      video.muted = Boolean(args[0]);
      break;
    case 'setPlaybackRate':
      video.playbackRate = Number(args[0]);
      break;
  }
}

function resolveCineResumeTime(
  restore: CineRestoreState | null,
  saved: LibraryControls['library']['progress'][string] | undefined,
  initPrefs: LibraryControls['library']['preferences'],
  item: Title,
): number {
  if (restore?.time !== undefined) return restore.time;
  const allowResume = initPrefs.resume ?? preferenceDefaults.resume;
  const savedMatchesProvider = (saved?.provider || 'cinesrc') === 'cinesrc';
  if (!allowResume || !savedMatchesProvider || !saved) return 0;
  if (saved.time <= 5 || saved.time >= saved.duration - 2) return 0;
  if (item.type === 'movie' && movieDurationMismatch(item.duration, saved.duration)) return 0;
  return saved.time;
}

function buildCineSrcEmbedUrl(opts: {
  item: Title;
  epSeason?: number;
  epNumber?: number;
  providerControls: boolean;
  quality: string;
  autoPlayEpisode?: boolean;
  restore: CineRestoreState | null;
  saved: LibraryControls['library']['progress'][string] | undefined;
  initPrefs: LibraryControls['library']['preferences'];
}): string {
  const { item, epSeason, epNumber, providerControls, quality, autoPlayEpisode, restore, saved, initPrefs } = opts;
  const allowVolume = initPrefs.volume ?? preferenceDefaults.volume;
  const resumeTime = resolveCineResumeTime(restore, saved, initPrefs, item);

  const url = new URL(`/embed/${item.type}/${item.id}`, cineSrcOrigin);
  url.searchParams.set('color', '#efb09d');
  url.searchParams.set('controls', String(providerControls));
  url.searchParams.set(providerControls ? 'back' : 'subtitles', providerControls ? 'close' : 'off');
  if (epSeason !== undefined && epNumber !== undefined) {
    const autoNext = providerControls && (initPrefs.autoplay ?? preferenceDefaults.autoplay);
    const autoSkip = providerControls && (initPrefs.intro ?? preferenceDefaults.intro) && (initPrefs.recap ?? preferenceDefaults.recap);
    url.searchParams.set('s', String(epSeason));
    url.searchParams.set('e', String(epNumber));
    url.searchParams.set('autonext', String(autoNext));
    url.searchParams.set('autoskip', String(autoSkip));
  }
  const serverId = cineSrcServers.get(item.key);
  if (serverId) {
    url.searchParams.set('prioritize', 'true');
    url.searchParams.set('lastserver', serverId);
  }
  url.searchParams.set('continueprompt', 'false');
  if (resumeTime > 0) url.searchParams.set('t', String(Math.floor(resumeTime)));
  if (quality) url.searchParams.set('quality', quality);
  if (restore?.muted ?? (allowVolume && Boolean(initPrefs.muted))) url.searchParams.set('muted', 'true');
  if (typeof restore?.paused === 'boolean') url.searchParams.set('autoplay', String(!restore.paused));
  else if (autoPlayEpisode) url.searchParams.set('autoplay', 'true');
  return url.href;
}

function orderAutoSubtitleCandidates(list: SubtitleTrack[], lang: string): SubtitleTrack[] {
  return list
    .filter(t => samePlaybackLanguage(t.language, lang))
    .sort((a, b) => Number(Boolean(a.forced)) - Number(Boolean(b.forced)));
}

async function trySubtitleCandidates(
  candidates: SubtitleTrack[],
  index: number,
  chooseSubtitleTrack: (track: SubtitleTrack, remember: boolean) => Promise<boolean>,
): Promise<boolean> {
  if (index >= candidates.length) return false;
  if (await chooseSubtitleTrack(candidates[index], false)) return true;
  return trySubtitleCandidates(candidates, index + 1, chooseSubtitleTrack);
}

interface CineMessageContext {
  mediaItemKey: string;
  mediaItemType: 'movie' | 'tv';
  hasEpisode: boolean;
  epSeason?: number;
  epNumber?: number;
  controlsRef: RefObject<LibraryControls>;
  displayItemRef: RefObject<Title>;
  positionRef: RefObject<PlaybackPosition>;
  segmentsRef: RefObject<SkipSegment[]>;
  trackingRef: RefObject<ViewingSession>;
  historyRef: RefObject<{ id: string; started: number; tracking: ViewingSession; lastSaved: number; lastCoverage: number } | null>;
  completedRef: RefObject<boolean>;
  endedRef: RefObject<boolean>;
  pausedRef: RefObject<boolean>;
  durationMismatchRef: RefObject<boolean>;
  unidentifiedEpisodeRef: RefObject<boolean>;
  restoreVolumeRef: RefObject<boolean>;
  cineDurationRef: RefObject<number | null>;
  lastUpdateRef: RefObject<number>;
  seekTargetRef: RefObject<number | null>;
  seekStartedRef: RefObject<number>;
  relativeJumpRef: RefObject<number | undefined>;
  resumeTimeRef: RefObject<number | null>;
  skippedToRef: RefObject<number | undefined>;
  sourceIdRef: RefObject<string | null>;
  sourceRevisionRef: RefObject<number>;
  segmentDurationRef: RefObject<number | null>;
  autoSkippedRef: RefObject<Set<SkipSegment>>;
  pendingAudioRef: RefObject<{ volume: number; muted: boolean } | null>;
  pendingAudioTimerRef: RefObject<number | undefined>;
  volumeRef: RefObject<number>;
  mutedRef: RefObject<boolean>;
  providerControlsRef: RefObject<boolean>;
  onNavigateEpisodeRef: RefObject<(target: EpisodePosition & { key?: string }) => void>;
  backHrefRef: RefObject<string>;
  clearTimers: () => void;
  startStallTimeout: () => void;
  waitForCineStream: (message?: string, restart?: boolean) => void;
  restoreAudioAndRate: () => void;
  checkMovieDuration: (duration: number) => boolean;
  resumeAfterSourceChange: (duration: number) => void;
  readCinePosition: (currentTime: number, duration: number, seeking?: boolean) => void;
  sendCommand: (command: string, ...args: unknown[]) => void;
  persistPlayback: (pos: PlaybackPosition, force?: boolean, markCompleted?: boolean) => void;
  checkForCompletion: (pos: PlaybackPosition, isEnded?: boolean) => void;
  revealControls: () => void;
  rememberAudioPref: (nextVol: number, nextMuted: boolean) => void;
  setPictureVisible: (v: boolean) => void;
  setHasPlayed: (v: boolean) => void;
  setEnded: (v: boolean) => void;
  setCountdownCancelled: (v: boolean) => void;
  setPosition: (updater: PlaybackPosition | ((prev: PlaybackPosition) => PlaybackPosition)) => void;
  setEmbedStatus: (status: { message: string; canRetry: boolean }) => void;
  setVolume: (v: number) => void;
  setMuted: (v: boolean) => void;
  setSpeed: (v: number) => void;
  setSegments: (segments: SkipSegment[]) => void;
}

function handleCineLoadedMetadata(data: Record<string, unknown>, ctx: CineMessageContext) {
  const dur = Number(data.duration);
  if (!Number.isFinite(dur) || dur <= 0 || !ctx.checkMovieDuration(dur)) return;
  ctx.cineDurationRef.current = dur;
  ctx.trackingRef.current.sample = null;
  ctx.seekStartedRef.current = -Infinity;
  ctx.restoreAudioAndRate();
  ctx.resumeAfterSourceChange(dur);
  ctx.readCinePosition(0, dur, true);
  ctx.sendCommand('getVolume');
  ctx.sendCommand('getMuted');
  ctx.sendCommand('getPlaybackRate');
}

function handleCinePlay(_data: Record<string, unknown>, ctx: CineMessageContext) {
  if (ctx.durationMismatchRef.current) {
    ctx.sendCommand('pause');
    return;
  }
  if (ctx.endedRef.current) {
    ctx.endedRef.current = false;
    ctx.setEnded(false);
    ctx.setCountdownCancelled(false);
    ctx.trackingRef.current.sample = null;
    if (ctx.completedRef.current) {
      ctx.completedRef.current = false;
      ctx.trackingRef.current = viewingSession();
    }
    ctx.historyRef.current = null;
  }
  ctx.pausedRef.current = false;
  ctx.setPictureVisible(true);
  ctx.setHasPlayed(true);
  ctx.setPosition(prev => {
    const next = { ...prev, paused: false };
    ctx.positionRef.current = next;
    return next;
  });
  if (!ctx.unidentifiedEpisodeRef.current && ctx.positionRef.current.duration > 0) {
    ctx.clearTimers();
    ctx.setEmbedStatus({ message: '', canRetry: false });
    ctx.startStallTimeout();
  }
  ctx.revealControls();
}

function handleCineTimeUpdate(data: Record<string, unknown>, ctx: CineMessageContext) {
  const ct = Number(data.currentTime);
  const dur = Number(data.duration);
  const inRange = Number.isFinite(ct) && Number.isFinite(dur) && dur > 0 && ct >= 0 && ct <= dur;
  if (!inRange || !ctx.checkMovieDuration(dur)) return;
  ctx.lastUpdateRef.current = performance.now();
  ctx.cineDurationRef.current = dur;
  if (ct > 0) {
    ctx.setPictureVisible(true);
    ctx.setHasPlayed(true);
  }
  const isSeeked = data.type === 'cinesrc:seeked';
  if (!isSeeked && ctx.resumeTimeRef.current !== null) ctx.resumeAfterSourceChange(dur);
  const seeking = isSeeked || performance.now() - ctx.seekStartedRef.current < 1800;
  if (!seeking && ctx.positionRef.current.duration > 0 && ct > ctx.positionRef.current.currentTime + 0.05) {
    ctx.pausedRef.current = false;
    ctx.setHasPlayed(true);
    if (ctx.sourceIdRef.current) rememberCineServer(ctx.mediaItemKey, ctx.sourceIdRef.current);
  }
  const targetSettled = ctx.seekTargetRef.current === null || Math.abs(ct - ctx.seekTargetRef.current) < 1;
  if (isSeeked && targetSettled) {
    ctx.seekStartedRef.current = -Infinity;
    ctx.seekTargetRef.current = null;
  }
  ctx.readCinePosition(ct, dur, seeking);
}

function handleCinePause(_data: Record<string, unknown>, ctx: CineMessageContext) {
  ctx.pausedRef.current = true;
  if (ctx.positionRef.current.duration > 0) ctx.clearTimers();
  ctx.trackingRef.current.sample = null;
  ctx.setPosition(prev => {
    const next = { ...prev, paused: true };
    ctx.positionRef.current = next;
    if (next.duration > 0) ctx.persistPlayback(next, true);
    return next;
  });
  ctx.revealControls();
}

function handleCineSkipIntro(data: Record<string, unknown>, ctx: CineMessageContext) {
  const time = Number(data.time);
  if (!Number.isFinite(time) || time < 0) return;
  ctx.skippedToRef.current = time;
  const seg = ctx.segmentsRef.current.find(entry => ['intro', 'recap'].includes(entry.kind) && Math.abs(entry.end - time) <= 2);
  if (seg) ctx.trackingRef.current.skipped = mergeRanges(ctx.trackingRef.current.skipped, seg.start, seg.end);
  ctx.trackingRef.current.sample = null;
}

function handleCineVolumeChange(data: Record<string, unknown>, ctx: CineMessageContext) {
  const pending = ctx.pendingAudioRef.current;
  const vol = Number(data.volume);
  const validLevel = Number.isFinite(vol) && vol >= 0 && vol <= 1;
  const isMuted = typeof data.muted === 'boolean' ? data.muted : ctx.mutedRef.current;
  if (pending && (!validLevel || Math.abs(vol - pending.volume) > 0.001 || isMuted !== pending.muted)) return;
  ctx.pendingAudioRef.current = null;
  clearTimeout(ctx.pendingAudioTimerRef.current);
  const nextVol = validLevel ? vol : ctx.volumeRef.current;
  ctx.setVolume(nextVol);
  ctx.setMuted(isMuted);
  ctx.rememberAudioPref(nextVol, isMuted);
}

function handleCineEnded(_data: Record<string, unknown>, ctx: CineMessageContext) {
  if (ctx.durationMismatchRef.current) return;
  ctx.clearTimers();
  ctx.endedRef.current = true;
  ctx.pausedRef.current = true;
  ctx.setEnded(true);
  ctx.setPosition(prev => {
    const next = { ...prev, paused: true, currentTime: prev.duration };
    ctx.positionRef.current = next;
    return next;
  });
  if (ctx.positionRef.current.duration > 0) {
    ctx.checkForCompletion({ currentTime: ctx.positionRef.current.duration, duration: ctx.positionRef.current.duration }, true);
  }
}

function handleCineNextEpisode(data: Record<string, unknown>, ctx: CineMessageContext) {
  const nextS = Number(data.season);
  const nextE = Number(data.episode);
  const valid = Number.isSafeInteger(nextS) && nextS >= 0 && Number.isSafeInteger(nextE) && nextE > 0;
  if (valid && (nextS !== ctx.epSeason || nextE !== ctx.epNumber)) {
    ctx.onNavigateEpisodeRef.current({ season: nextS, number: nextE, title: `Episode ${nextE}` });
  }
}

function handleCineSourceUsed(data: Record<string, unknown>, ctx: CineMessageContext) {
  ctx.pendingAudioRef.current = null;
  clearTimeout(ctx.pendingAudioTimerRef.current);
  const hadSource = Boolean(ctx.positionRef.current.duration > 0 || ctx.durationMismatchRef.current);
  ctx.sourceIdRef.current = typeof data.sourceId === 'string' && data.sourceId.length <= 100 ? data.sourceId : null;
  ctx.durationMismatchRef.current = false;
  const cur = ctx.positionRef.current;
  if (cur.duration > 0) {
    ctx.persistPlayback(cur, true);
    const validMovieDur = ctx.mediaItemType !== 'movie' || !movieDurationMismatch(ctx.displayItemRef.current.duration, cur.duration);
    if (cur.currentTime > 5 && cur.currentTime < cur.duration - 2 && validMovieDur) {
      ctx.resumeTimeRef.current = cur.currentTime;
    }
  }
  const allowAutoplay = ctx.controlsRef.current.library.preferences.autoplay ?? preferenceDefaults.autoplay;
  if (ctx.endedRef.current && ctx.hasEpisode && allowAutoplay) {
    ctx.unidentifiedEpisodeRef.current = true;
    ctx.setEmbedStatus({ message: 'Playback changed without an episode update. Select the episode below to reconnect your progress.', canRetry: true });
  } else {
    ctx.waitForCineStream('Connecting to the video source…', hadSource);
  }
  ctx.trackingRef.current.sample = null;
  ctx.sourceRevisionRef.current += 1;
  ctx.segmentDurationRef.current = null;
  ctx.setSegments([]);
  ctx.autoSkippedRef.current.clear();
  ctx.skippedToRef.current = undefined;
  ctx.cineDurationRef.current = null;
  ctx.lastUpdateRef.current = 0;
  ctx.seekStartedRef.current = -Infinity;
  ctx.seekTargetRef.current = null;
  ctx.relativeJumpRef.current = undefined;
  ctx.restoreVolumeRef.current = true;
  ctx.setPosition({ currentTime: 0, duration: 0, paused: ctx.pausedRef.current });
}

const cineResponseHandlers: Record<string, (result: unknown, ctx: CineMessageContext) => void> = {
  getPaused(result, ctx) {
    if (typeof result !== 'boolean') return;
    if (result && !ctx.pausedRef.current && ctx.positionRef.current.duration > 0) ctx.clearTimers();
    ctx.pausedRef.current = result;
    ctx.setPosition(prev => {
      const next = { ...prev, paused: result };
      ctx.positionRef.current = next;
      return next;
    });
  },
  getDuration(result, ctx) {
    const dur = Number(result);
    if (Number.isFinite(dur) && dur > 0 && ctx.checkMovieDuration(dur)) ctx.cineDurationRef.current = dur;
  },
  getCurrentTime(result, ctx) {
    const cur = Number(result);
    const jump = ctx.relativeJumpRef.current;
    if (jump !== undefined && Number.isFinite(cur) && ctx.positionRef.current.duration > 0) {
      ctx.relativeJumpRef.current = undefined;
      if (jump) ctx.sendCommand('seek', Math.max(0, Math.min(ctx.positionRef.current.duration, cur + jump)));
    } else if (performance.now() - ctx.lastUpdateRef.current > 2200 && ctx.cineDurationRef.current) {
      ctx.readCinePosition(cur, ctx.cineDurationRef.current, performance.now() - ctx.seekStartedRef.current < 1800);
    }
  },
  getVolume(result, ctx) {
    if (ctx.pendingAudioRef.current) return;
    const vol = Number(result);
    if (Number.isFinite(vol) && vol >= 0 && vol <= 1) {
      ctx.setVolume(vol);
      ctx.rememberAudioPref(vol, ctx.mutedRef.current);
    }
  },
  getMuted(result, ctx) {
    if (ctx.pendingAudioRef.current || typeof result !== 'boolean') return;
    ctx.setMuted(result);
    ctx.rememberAudioPref(ctx.volumeRef.current, result);
  },
  getPlaybackRate(result, ctx) {
    const rate = Number(result);
    if (Number.isFinite(rate) && rate >= 0.25 && rate <= 2) ctx.setSpeed(rate);
  },
};

function handleCineError(_data: Record<string, unknown>, ctx: CineMessageContext) {
  if (ctx.durationMismatchRef.current) return;
  ctx.clearTimers();
  ctx.setPictureVisible(false);
  if (ctx.positionRef.current.duration > 0) ctx.persistPlayback(ctx.positionRef.current, true);
  ctx.trackingRef.current.sample = null;
  ctx.pausedRef.current = true;
  ctx.setPosition(prev => ({ ...prev, paused: true }));
  ctx.setEmbedStatus({ message: 'CineSrc could not play this source. Try another server in the player or retry.', canRetry: true });
}

const cineMessageHandlers: Record<string, (data: Record<string, unknown>, ctx: CineMessageContext) => void> = {
  'cinesrc:ready': (_data, ctx) => {
    ctx.restoreAudioAndRate();
    ctx.sendCommand('getDuration');
    ctx.sendCommand('getCurrentTime');
  },
  'cinesrc:loadedmetadata': handleCineLoadedMetadata,
  'cinesrc:play': handleCinePlay,
  'cinesrc:timeupdate': handleCineTimeUpdate,
  'cinesrc:seeked': handleCineTimeUpdate,
  'cinesrc:pause': handleCinePause,
  'cinesrc:seeking': (_data, ctx) => {
    ctx.seekStartedRef.current = performance.now();
    ctx.trackingRef.current.sample = null;
  },
  'cinesrc:skipintro': handleCineSkipIntro,
  'cinesrc:volumechange': handleCineVolumeChange,
  'cinesrc:ratechange': (data, ctx) => {
    const rate = Number(data.playbackRate);
    if (Number.isFinite(rate) && rate >= 0.25 && rate <= 2) ctx.setSpeed(rate);
  },
  'cinesrc:ended': handleCineEnded,
  'cinesrc:nextepisode': handleCineNextEpisode,
  'cinesrc:sourceused': handleCineSourceUsed,
  'cinesrc:response': (data, ctx) => {
    if (typeof data.command === 'string') cineResponseHandlers[data.command]?.(data.result, ctx);
  },
  'cinesrc:error': handleCineError,
  'cinesrc:close': (_data, ctx) => {
    if (ctx.providerControlsRef.current) navigate(ctx.backHrefRef.current);
  },
};

interface KeyboardShortcutContext {
  singleKeyEnabled: boolean;
  activeSegment: SkipSegment | undefined;
  activeCues: { url: string; cues: SubtitleCue[] } | null;
  nativeCaptionsOn: boolean;
  mediaEmbed: boolean;
  hasNativeCaptions: boolean;
  preferredSubtitleLang: string;
  hasEpisodesDrawer?: boolean;
  positionRef: RefObject<PlaybackPosition>;
  endedRef: RefObject<boolean>;
  mutedRef: RefObject<boolean>;
  volumeRef: RefObject<number>;
  lastVolumeRef: RefObject<number>;
  adjacentRef: RefObject<{ previous?: EpisodePosition & { key?: string }; next?: EpisodePosition & { key?: string }; ready: boolean }>;
  onNavigateEpisodeRef: RefObject<(target: EpisodePosition & { key?: string }) => void>;
  subDownloadRef: RefObject<AbortController | null>;
  videoRef: RefObject<VideoWithAudioTracks | null>;
  sendCommand: (command: string, ...args: unknown[]) => void;
  jumpPlayback: (delta: number) => void;
  updateAudio: (nextVol: number, nextMuted: boolean) => void;
  showFeedback: (label: string) => void;
  skipSegment: (segment: SkipSegment) => void;
  toggleFullscreen: () => void;
  onToggleTheatre?: () => void;
  onToggleEpisodes?: () => void;
  setActiveCues: (cues: { url: string; cues: SubtitleCue[] } | null) => void;
  setNativeCaptionsOn: (on: boolean) => void;
  loadEmbedSubtitles: (autoSelectLang?: string) => Promise<void>;
}

function isShortcutBlocked(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return true;
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return true;
  return event.target instanceof HTMLElement
    && Boolean(event.target.closest('button, a, input, textarea, select, summary, iframe, [contenteditable]'));
}

function handleCoreShortcutKey(event: KeyboardEvent, key: string, ctx: KeyboardShortcutContext): boolean {
  const hasDuration = ctx.positionRef.current.duration > 0;
  if (key === ' ' && hasDuration) {
    event.preventDefault();
    const playing = !(ctx.positionRef.current.paused || ctx.endedRef.current);
    ctx.sendCommand(playing ? 'pause' : 'play');
    ctx.showFeedback(playing ? 'Paused' : 'Playing');
    return true;
  }
  if ((key === 'arrowleft' || key === 'arrowright') && hasDuration) {
    event.preventDefault();
    const delta = key === 'arrowleft' ? -10 : 10;
    ctx.jumpPlayback(delta);
    ctx.showFeedback(delta < 0 ? '−10s' : '+10s');
    return true;
  }
  if ((key === 'arrowup' || key === 'arrowdown') && hasDuration) {
    event.preventDefault();
    const delta = key === 'arrowup' ? 0.1 : -0.1;
    const base = ctx.mutedRef.current ? 0 : ctx.volumeRef.current;
    const nextVol = Math.max(0, Math.min(1, Math.round((base + delta) * 20) / 20));
    ctx.updateAudio(nextVol, nextVol === 0);
    ctx.showFeedback(nextVol === 0 ? 'Muted' : `Volume ${Math.round(nextVol * 100)}%`);
    return true;
  }
  return handleShiftEpisodeShortcut(event, key, ctx);
}

function handleShiftEpisodeShortcut(event: KeyboardEvent, key: string, ctx: KeyboardShortcutContext): boolean {
  if (!event.shiftKey) return false;
  if (key === 'n' && ctx.adjacentRef.current.next) {
    event.preventDefault();
    ctx.onNavigateEpisodeRef.current(ctx.adjacentRef.current.next);
    return true;
  }
  if (key === 'p' && ctx.adjacentRef.current.previous) {
    event.preventDefault();
    ctx.onNavigateEpisodeRef.current(ctx.adjacentRef.current.previous);
    return true;
  }
  return false;
}

function toggleCaptionShortcut(ctx: KeyboardShortcutContext) {
  if (ctx.activeCues || ctx.nativeCaptionsOn) {
    ctx.subDownloadRef.current?.abort();
    ctx.setActiveCues(null);
    ctx.setNativeCaptionsOn(false);
    if (ctx.videoRef.current?.textTracks[0]) ctx.videoRef.current.textTracks[0].mode = 'disabled';
    ctx.showFeedback('Subtitles off');
    return;
  }
  if (!ctx.mediaEmbed && ctx.videoRef.current?.textTracks[0]) {
    ctx.videoRef.current.textTracks[0].mode = 'showing';
    ctx.setNativeCaptionsOn(true);
    ctx.showFeedback('Subtitles on');
    return;
  }
  void ctx.loadEmbedSubtitles(ctx.preferredSubtitleLang || 'English');
  ctx.showFeedback('Subtitles on');
}

function handleSingleKeyToggle(event: KeyboardEvent, key: string, ctx: KeyboardShortcutContext): boolean {
  if (key === 's' && ctx.activeSegment) {
    event.preventDefault();
    ctx.skipSegment(ctx.activeSegment);
    return true;
  }
  if (key === 'f' && document.fullscreenEnabled) {
    event.preventDefault();
    ctx.toggleFullscreen();
    return true;
  }
  if (key === 't' && ctx.onToggleTheatre && !document.fullscreenElement) {
    event.preventDefault();
    ctx.onToggleTheatre();
    return true;
  }
  if (key === 'e' && ctx.hasEpisodesDrawer && ctx.onToggleEpisodes) {
    event.preventDefault();
    ctx.onToggleEpisodes();
    return true;
  }
  return false;
}

function handleSingleKeyShortcut(event: KeyboardEvent, key: string, ctx: KeyboardShortcutContext) {
  if (handleSingleKeyToggle(event, key, ctx)) return;
  if (key === 'm') {
    event.preventDefault();
    const nextMuted = !(ctx.mutedRef.current || ctx.volumeRef.current === 0);
    const nextVol = nextMuted ? ctx.volumeRef.current : (ctx.volumeRef.current || ctx.lastVolumeRef.current);
    ctx.updateAudio(nextVol, nextMuted);
    ctx.showFeedback(nextMuted ? 'Muted' : `Volume ${Math.round(nextVol * 100)}%`);
    return;
  }
  if (key === 'c' && (ctx.mediaEmbed || ctx.hasNativeCaptions)) {
    event.preventDefault();
    toggleCaptionShortcut(ctx);
    return;
  }
  if (ctx.positionRef.current.duration <= 0) return;
  if (key === 'j' || key === 'l') {
    event.preventDefault();
    const delta = key === 'j' ? -10 : 10;
    ctx.jumpPlayback(delta);
    ctx.showFeedback(delta < 0 ? '−10s' : '+10s');
    return;
  }
  if (/^\d$/.test(key)) {
    event.preventDefault();
    const target = (Number(key) / 10) * ctx.positionRef.current.duration;
    ctx.sendCommand('seek', target);
    ctx.showFeedback(`${Number(key) * 10}%`);
  }
}

function mobilePlayMeta(ended: boolean, paused?: boolean) {
  if (ended) return { label: 'Replay', icon: <PlayerGlyph name="replay" /> };
  if (paused) return { label: 'Play', icon: <Icon name="play" /> };
  return { label: 'Pause', icon: <PlayerGlyph name="pause" /> };
}

function useOutsideMenuClose(
  audioMenuRef: RefObject<HTMLDetailsElement | null>,
  subtitleMenuRef: RefObject<HTMLDetailsElement | null>,
  settingsMenuRef: RefObject<HTMLDetailsElement | null>,
) {
  useEffect(() => {
    const menus = () => [audioMenuRef.current, subtitleMenuRef.current, settingsMenuRef.current]
      .filter((m): m is HTMLDetailsElement => Boolean(m));
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      for (const menu of menus()) {
        if (menu.open && (!target || !menu.contains(target))) menu.open = false;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      for (const menu of menus()) {
        if (menu.open) {
          event.preventDefault();
          menu.open = false;
          menu.querySelector('summary')?.focus();
        }
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [audioMenuRef, subtitleMenuRef, settingsMenuRef]);
}

function useLiveAnnouncements(
  activeSegment: SkipSegment | undefined,
  singleKeyEnabled: boolean,
  countdown: number | null,
  nextEpisode: (EpisodePosition & { key?: string }) | undefined,
  actionFeedback: { label: string; nonce: number } | null,
  undoSkip: { from: number; kind: SkipSegment['kind'] } | null,
): string {
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const prevSegmentKeyRef = useRef('');
  const prevCountdownActiveRef = useRef(false);

  useEffect(() => {
    const segKey = activeSegment ? `${activeSegment.kind}:${activeSegment.start}` : '';
    if (segKey && segKey !== prevSegmentKeyRef.current) {
      setLiveAnnouncement(`Skip ${segmentNames[activeSegment!.kind].toLowerCase()} available${singleKeyEnabled ? ', press S' : ''}`);
    }
    prevSegmentKeyRef.current = segKey;
  }, [activeSegment, singleKeyEnabled]);

  useEffect(() => {
    const active = countdown !== null && Boolean(nextEpisode);
    if (active && !prevCountdownActiveRef.current && nextEpisode) {
      setLiveAnnouncement(`Up next: Episode ${nextEpisode.number} starting in ${countdown} seconds`);
    }
    prevCountdownActiveRef.current = active;
  }, [countdown, nextEpisode]);

  useEffect(() => {
    if (actionFeedback?.label) setLiveAnnouncement(actionFeedback.label);
  }, [actionFeedback]);

  useEffect(() => {
    if (undoSkip) setLiveAnnouncement(`Skipped ${segmentNames[undoSkip.kind].toLowerCase()}. Undo available.`);
  }, [undoSkip]);

  return liveAnnouncement;
}

function buildVideoBoxClassName(opts: {
  controlsActive: boolean;
  paused?: boolean;
  ended: boolean;
  hasPlayed: boolean;
  autoplayBlocked: boolean;
}): string {
  return [
    'af-video-box',
    opts.controlsActive ? 'controls-active' : '',
    opts.paused || opts.ended ? 'is-paused' : '',
    opts.ended ? 'is-ended' : '',
    opts.hasPlayed ? 'has-played' : '',
    opts.autoplayBlocked ? 'is-autoplay-blocked' : '',
  ].filter(Boolean).join(' ');
}

function EmbedRecoveryCard({
  backdrop,
  message,
  isCineSrc,
  animeEligible,
  provider,
  onTryCineControls,
  onSwitchProvider,
  onReload,
}: Readonly<{
  backdrop?: string;
  message: string;
  isCineSrc: boolean;
  animeEligible: boolean;
  provider: AnimeProvider;
  onTryCineControls: () => void;
  onSwitchProvider: (next: AnimeProvider) => void;
  onReload: () => void;
}>) {
  const nextProvider = animePlayers[provider].next;
  return <div className="af-embed-recovery" role="alert">
    {backdrop && <img src={backdrop} alt="" />}
    <div className="af-embed-recovery-card">
      <strong>Stream needs attention</strong>
      <p>{message}</p>
      <div className="af-actions">
        {isCineSrc && <button type="button" className="af-button af-primary" onClick={onTryCineControls}>
          Try CineSrc controls
        </button>}
        {animeEligible && <button type="button" className={`af-button ${isCineSrc ? 'af-secondary' : 'af-primary'}`}
          onClick={() => onSwitchProvider(nextProvider)}>
          Switch to {animePlayers[nextProvider].label}
        </button>}
        <button type="button" className="af-button af-secondary" onClick={onReload}>
          Reload player
        </button>
      </div>
    </div>
  </div>;
}

function VideoErrorOverlay({
  direct,
  sourcePage,
  onRetry,
  onTryDirect,
}: Readonly<{
  direct: boolean;
  sourcePage: string;
  onRetry: () => void;
  onTryDirect: () => void;
}>) {
  return <div className="af-video-error" role="alert">
    <p>The video could not load.</p>
    <div className="af-actions">
      <button type="button" className="af-button af-secondary" onClick={onRetry}>Retry</button>
      {!direct
        ? <button type="button" className="af-button af-primary" onClick={onTryDirect}>Try direct stream</button>
        : sourcePage && <a className="af-button af-primary" href={sourcePage} target="_blank" rel="noopener noreferrer">Open source</a>}
    </div>
  </div>;
}

function PlayerPauseOverlay({
  titleText,
  subTitleText,
  position,
  displayTime,
  ended,
  autoplayBlocked,
  mediaEmbed,
  onPlay,
}: Readonly<{
  titleText: string;
  subTitleText?: string;
  position: PlaybackPosition;
  displayTime: number;
  ended: boolean;
  autoplayBlocked: boolean;
  mediaEmbed: boolean;
  onPlay: () => void;
}>) {
  const showPlayBtn = (position.paused || ended || autoplayBlocked) && (position.duration > 0 || !mediaEmbed);
  return <div className="af-player-pause">
    <div className="af-player-pause-copy" aria-hidden="true">
      <p className="af-player-pause-status">Paused</p>
      <p className="af-player-pause-title">{titleText}</p>
      {subTitleText && <p className="af-player-pause-desc">{subTitleText}</p>}
      {position.duration > 0 && <p className="af-player-remaining af-tabular">{formatClock(Math.max(0, position.duration - displayTime))} remaining</p>}
    </div>
    {showPlayBtn && <button
      type="button"
      className="af-pause-center-play"
      aria-label={ended ? 'Replay video' : 'Resume playback'}
      onClick={onPlay}
    >
      {ended ? <PlayerGlyph name="replay" /> : <Icon name="play" />}
    </button>}
  </div>;
}

function MobileTransportControls({
  adjacent,
  position,
  ended,
  onNavigateEpisode,
  onJumpPlayback,
  onTogglePlay,
}: Readonly<{
  adjacent: { previous?: EpisodePosition & { key?: string }; next?: EpisodePosition & { key?: string }; ready: boolean };
  position: PlaybackPosition;
  ended: boolean;
  onNavigateEpisode: (target: EpisodePosition & { key?: string }) => void;
  onJumpPlayback: (delta: number) => void;
  onTogglePlay: () => void;
}>) {
  const noDuration = position.duration <= 0;
  const playMeta = mobilePlayMeta(ended, position.paused);
  return <fieldset className="af-mobile-transport" aria-label="Touch playback controls">
    {adjacent.previous && <button type="button" className="af-mobile-touch-btn" aria-label="Previous episode" onClick={() => onNavigateEpisode(adjacent.previous!)}><PlayerGlyph name="prev" /></button>}
    <button type="button" className="af-mobile-touch-btn" aria-label="Back 10 seconds" disabled={noDuration} onClick={() => onJumpPlayback(-10)}><PlayerGlyph name="back10" /></button>
    <button type="button" className="af-mobile-touch-btn af-mobile-touch-play" aria-label={playMeta.label} onClick={onTogglePlay}>
      {playMeta.icon}
    </button>
    <button type="button" className="af-mobile-touch-btn" aria-label="Forward 10 seconds" disabled={noDuration} onClick={() => onJumpPlayback(10)}><PlayerGlyph name="fwd10" /></button>
    {adjacent.next && <button type="button" className="af-mobile-touch-btn" aria-label="Next episode" onClick={() => onNavigateEpisode(adjacent.next!)}><PlayerGlyph name="next" /></button>}
  </fieldset>;
}

function NextEpisodeCountdownCard({
  nextEpisode,
  countdown,
  nextStillUrl,
  blurNextStill,
  onPlayNow,
  onCancel,
}: Readonly<{
  nextEpisode: EpisodePosition & { key?: string };
  countdown: number;
  nextStillUrl?: string;
  blurNextStill: boolean;
  onPlayNow: () => void;
  onCancel: () => void;
}>) {
  const countdownRingDash = `${Math.round((countdown / 10) * 100)} 100`;
  return <section className="af-next-countdown" aria-label="Next episode">
    <div className="af-next-countdown-top">
      {nextStillUrl && <span className="af-next-countdown-thumb">
        <Artwork src={nextStillUrl} className={blurNextStill ? 'af-blurred' : undefined} loading="lazy" fallback={<Icon name="film" />} />
      </span>}
      <div className="af-next-countdown-meta">
        <span className="af-next-countdown-kicker">Up next · S{nextEpisode.season} E{nextEpisode.number}</span>
        <strong>{nextEpisode.title || `Episode ${nextEpisode.number}`}</strong>
        <p className="af-tabular">Starting in {countdown}s</p>
      </div>
      <svg className="af-countdown-ring" viewBox="0 0 36 36" width="32" height="32" aria-hidden="true">
        <circle className="af-countdown-ring-track" cx="18" cy="18" r="15.9" />
        <circle className="af-countdown-ring-fill" cx="18" cy="18" r="15.9" strokeDasharray={countdownRingDash} />
      </svg>
    </div>
    <div className="af-actions">
      <button type="button" className="af-button af-primary" onClick={onPlayNow}>Play now</button>
      <button type="button" className="af-button af-secondary" onClick={onCancel}>Cancel</button>
    </div>
  </section>;
}

function computeStageVisibility(opts: {
  mediaEmbed: boolean;
  isNativeVideo: boolean;
  isCineSrc: boolean;
  isEmnex: boolean;
  providerControls: boolean;
  embedStatus: { message: string; canRetry: boolean };
  pictureVisible: boolean;
  animeEligible: boolean;
  provider: AnimeProvider;
  emnexStream: EmnexStreamData | null;
}) {
  const hasMsg = Boolean(opts.embedStatus.message);
  const cineActive = opts.isCineSrc && !opts.providerControls;
  const showCineLoading = hasMsg && !opts.embedStatus.canRetry && (cineActive || (opts.isEmnex && !opts.pictureVisible));
  const showCineRecovery = hasMsg && opts.embedStatus.canRetry && !opts.pictureVisible && (cineActive || opts.isEmnex);
  const showPictureLayer = opts.isNativeVideo || (opts.isCineSrc && opts.pictureVisible);
  const showEmbedNotice = opts.mediaEmbed && (opts.embedStatus.canRetry || opts.providerControls || opts.animeEligible || opts.provider !== 'cinesrc');
  const emnexStreamMeta = opts.isEmnex && opts.emnexStream
    ? `${opts.emnexStream.provider} · ${opts.emnexStream.type.toUpperCase()}`
    : undefined;
  return { showCineLoading, showCineRecovery, showPictureLayer, showEmbedNotice, emnexStreamMeta };
}

function StageStatusOverlays({
  showCineLoading,
  showCineRecovery,
  showPictureLayer,
  externalControls,
  backdrop,
  embedStatusMessage,
  isCineSrc,
  animeEligible,
  provider,
  tapSeek,
  buffering,
  showVideoError,
  direct,
  sourcePage,
  actionFeedback,
  onTryCineControls,
  onSwitchProvider,
  onReload,
  onPictureClick,
  onPictureDoubleClick,
  onRetryVideo,
  onTryDirect,
}: Readonly<{
  showCineLoading: boolean;
  showCineRecovery: boolean;
  showPictureLayer: boolean;
  externalControls: boolean;
  backdrop?: string;
  embedStatusMessage: string;
  isCineSrc: boolean;
  animeEligible: boolean;
  provider: AnimeProvider;
  tapSeek: { side: 'left' | 'right'; seconds: number; nonce: number } | null;
  buffering: boolean;
  showVideoError: boolean;
  direct: boolean;
  sourcePage: string;
  actionFeedback: { label: string; nonce: number } | null;
  onTryCineControls: () => void;
  onSwitchProvider: (next: AnimeProvider) => void;
  onReload: () => void;
  onPictureClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onPictureDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onRetryVideo: () => void;
  onTryDirect: () => void;
}>) {
  return <>
    {showCineLoading && <div className="af-embed-loading">
      {backdrop && <img src={backdrop} alt="" />}
      <output className="af-embed-loading-pill">
        <span className="af-spinner" aria-hidden="true" />
        <span>{embedStatusMessage}</span>
      </output>
    </div>}

    {showCineRecovery && <EmbedRecoveryCard
      backdrop={backdrop}
      message={embedStatusMessage}
      isCineSrc={isCineSrc}
      animeEligible={animeEligible}
      provider={provider}
      onTryCineControls={onTryCineControls}
      onSwitchProvider={onSwitchProvider}
      onReload={onReload}
    />}

    {showPictureLayer && <div
      className={`af-video-picture ${externalControls ? 'is-embed-passthrough' : ''}`}
      aria-hidden="true"
      onClick={onPictureClick}
      onDoubleClick={onPictureDoubleClick}
    />}

    {tapSeek && <div
      key={tapSeek.nonce}
      className={`af-tap-seek af-tap-seek-${tapSeek.side}`}
      aria-hidden="true"
    >
      <span>{tapSeek.side === 'left' ? `« ${tapSeek.seconds}s` : `${tapSeek.seconds}s »`}</span>
    </div>}

    {buffering && <output className="af-video-buffering">Buffering…</output>}

    {showVideoError && <VideoErrorOverlay
      direct={direct}
      sourcePage={sourcePage}
      onRetry={onRetryVideo}
      onTryDirect={onTryDirect}
    />}

    {actionFeedback && <div key={actionFeedback.nonce} className="af-action-feedback" aria-hidden="true">
      <span>{actionFeedback.label}</span>
    </div>}
  </>;
}

function StagePlayerOverlay({
  showOverlay,
  titleText,
  subTitleText,
  hasDisplayEpisode,
  backHref,
  position,
  displayTime,
  ended,
  autoplayBlocked,
  mediaEmbed,
  adjacent,
  activeCaptionText,
  captionStyle,
  countdown,
  nextStillUrl,
  blurNextStill,
  activeSegment,
  undoSkip,
  onPlay,
  onTogglePlay,
  onNavigateEpisode,
  onJumpPlayback,
  onPlayNextNow,
  onCancelCountdown,
  onSkipSegment,
  onRevertSkip,
  controlsNode,
}: Readonly<{
  showOverlay: boolean;
  titleText: string;
  subTitleText?: string;
  hasDisplayEpisode: boolean;
  backHref: string;
  position: PlaybackPosition;
  displayTime: number;
  ended: boolean;
  autoplayBlocked: boolean;
  mediaEmbed: boolean;
  adjacent: { previous?: EpisodePosition & { key?: string }; next?: EpisodePosition & { key?: string }; ready: boolean };
  activeCaptionText: string;
  captionStyle: CaptionStyle;
  countdown: number | null;
  nextStillUrl?: string;
  blurNextStill: boolean;
  activeSegment: SkipSegment | undefined;
  undoSkip: { from: number; kind: SkipSegment['kind'] } | null;
  onPlay: () => void;
  onTogglePlay: () => void;
  onNavigateEpisode: (target: EpisodePosition & { key?: string }) => void;
  onJumpPlayback: (delta: number) => void;
  onPlayNextNow: () => void;
  onCancelCountdown: () => void;
  onSkipSegment: (segment: SkipSegment) => void;
  onRevertSkip: () => void;
  controlsNode: ReactNode;
}>) {
  if (!showOverlay) return null;

  return <>
    <PlayerPauseOverlay
      titleText={titleText}
      subTitleText={subTitleText}
      position={position}
      displayTime={displayTime}
      ended={ended}
      autoplayBlocked={autoplayBlocked}
      mediaEmbed={mediaEmbed}
      onPlay={onPlay}
    />

    <MobileTransportControls
      adjacent={adjacent}
      position={position}
      ended={ended}
      onNavigateEpisode={onNavigateEpisode}
      onJumpPlayback={onJumpPlayback}
      onTogglePlay={onTogglePlay}
    />

    <div className="af-player-header">
      <div className="af-player-ident">
        <a className="af-player-back" href={backHref}><Icon name="left" /><span>Back to details</span></a>
        <div className="af-player-context" aria-hidden="true">
          <p className="af-player-context-title">{titleText}</p>
          {hasDisplayEpisode && subTitleText && <p className="af-player-context-ep">{subTitleText}</p>}
        </div>
      </div>
    </div>

    {mediaEmbed && activeCaptionText && <div className="af-player-caption" data-size={captionStyle.size} data-bg={captionStyle.bg} aria-hidden="true"><span>{activeCaptionText}</span></div>}

    <div className="af-player-lower">
      {countdown !== null && adjacent.next && <NextEpisodeCountdownCard
        nextEpisode={adjacent.next}
        countdown={countdown}
        nextStillUrl={nextStillUrl}
        blurNextStill={blurNextStill}
        onPlayNow={onPlayNextNow}
        onCancel={onCancelCountdown}
      />}

      {activeSegment && <button type="button" className="af-player-skip" data-kind={activeSegment.kind} onClick={() => onSkipSegment(activeSegment)}>
        <span>Skip {segmentNames[activeSegment.kind].toLowerCase()}</span>
        <kbd className="af-kbd af-skip-kbd">S</kbd>
      </button>}

      {!activeSegment && undoSkip && <output className="af-player-undo-skip">
        <span>Skipped {segmentNames[undoSkip.kind].toLowerCase()}</span>
        <button type="button" className="af-text-link" onClick={onRevertSkip}>Undo</button>
      </output>}

      {controlsNode}
    </div>
  </>;
}

function deriveStageFlags(opts: {
  media: ActiveMedia;
  provider: AnimeProvider;
  animeEligible: boolean;
  isEmnex: boolean;
  isCineSrc: boolean;
  isNativeVideo: boolean;
  providerControls: boolean;
  displayItem: Title;
  displayEpisode?: EpisodePosition & { key?: string; duration?: number };
  position: PlaybackPosition;
  displayTime: number;
  volume: number;
  controlsActive: boolean;
  ended: boolean;
  hasPlayed: boolean;
  autoplayBlocked: boolean;
  embedStatus: { message: string; canRetry: boolean };
  pictureVisible: boolean;
  emnexStream: EmnexStreamData | null;
  emnexServer: string;
  nextStillPath?: string | null;
  blurPref: boolean | undefined;
}) {
  const showNativeVideo = opts.isEmnex || (!opts.media.embed && Boolean(opts.media.nativeMedia));
  const playedPct = opts.position.duration > 0 ? `${(opts.displayTime / opts.position.duration) * 100}%` : '0%';
  const volumePct = `${Math.round(opts.volume * 100)}%`;
  const titleText = opts.displayEpisode?.title || opts.displayItem.title;
  const subTitleText = formatStageSubtitle(opts.displayItem, opts.displayEpisode);
  const sourcePage = resolveArchiveSourceUrl(opts.media.nativeMedia);
  const nextStillUrl = imagePath(opts.nextStillPath, 'w300');
  const blurNextStill = Boolean(nextStillUrl && opts.blurPref !== false);
  const videoBoxClassName = buildVideoBoxClassName({
    controlsActive: opts.controlsActive,
    paused: opts.position.paused,
    ended: opts.ended,
    hasPlayed: opts.hasPlayed,
    autoplayBlocked: opts.autoplayBlocked,
  });
  const visibility = computeStageVisibility({
    mediaEmbed: opts.media.embed,
    isNativeVideo: opts.isNativeVideo,
    isCineSrc: opts.isCineSrc,
    isEmnex: opts.isEmnex,
    providerControls: opts.providerControls,
    embedStatus: opts.embedStatus,
    pictureVisible: opts.pictureVisible,
    animeEligible: opts.animeEligible,
    provider: opts.provider,
    emnexStream: opts.emnexStream,
  });
  const activeEmnexServer = opts.emnexServer || opts.emnexStream?.provider || '';
  const captionsSrc = opts.media.embed ? undefined : opts.media.nativeMedia?.captions;
  return {
    showNativeVideo,
    playedPct,
    volumePct,
    titleText,
    subTitleText,
    sourcePage,
    nextStillUrl,
    blurNextStill,
    videoBoxClassName,
    activeEmnexServer,
    captionsSrc,
    ...visibility,
  };
}

function StageNativeVideo({
  show,
  videoRef,
  src,
  crossOrigin,
  poster,
  titleText,
  captionsSrc,
  onLoadedMetadata,
  onDurationChange,
  onTimeUpdate,
  onSeeking,
  onProgress,
  onPlay,
  onPause,
  onWaiting,
  onPlaying,
  onVolumeChange,
  onRateChange,
  onEnded,
  onError,
}: Readonly<{
  show: boolean;
  videoRef: RefObject<VideoWithAudioTracks | null>;
  src?: string;
  crossOrigin?: 'anonymous';
  poster?: string;
  titleText: string;
  captionsSrc?: string;
  onLoadedMetadata: (event: React.SyntheticEvent<HTMLVideoElement>) => void;
  onDurationChange: (event: React.SyntheticEvent<HTMLVideoElement>) => void;
  onTimeUpdate: (event: React.SyntheticEvent<HTMLVideoElement>) => void;
  onSeeking: () => void;
  onProgress: (event: React.SyntheticEvent<HTMLVideoElement>) => void;
  onPlay: () => void;
  onPause: (event: React.SyntheticEvent<HTMLVideoElement>) => void;
  onWaiting: (event: React.SyntheticEvent<HTMLVideoElement>) => void;
  onPlaying: () => void;
  onVolumeChange: (event: React.SyntheticEvent<HTMLVideoElement>) => void;
  onRateChange: (event: React.SyntheticEvent<HTMLVideoElement>) => void;
  onEnded: (event: React.SyntheticEvent<HTMLVideoElement>) => void;
  onError: () => void;
}>) {
  if (!show) return null;
  return (
    <video
      ref={videoRef}
      src={src}
      crossOrigin={crossOrigin}
      playsInline
      preload="auto"
      poster={poster}
      aria-label={titleText}
      onLoadedMetadata={onLoadedMetadata}
      onDurationChange={onDurationChange}
      onTimeUpdate={onTimeUpdate}
      onSeeking={onSeeking}
      onProgress={onProgress}
      onPlay={onPlay}
      onPause={onPause}
      onWaiting={onWaiting}
      onPlaying={onPlaying}
      onVolumeChange={onVolumeChange}
      onRateChange={onRateChange}
      onEnded={onEnded}
      onError={onError}
    >
      {captionsSrc
        ? <track kind="captions" label="English (auto-generated)" srcLang="en" src={captionsSrc} />
        : <track kind="captions" />}
    </video>
  );
}

interface VideoStageProps {
  stageRef: RefObject<HTMLDivElement | null>;
  media: ActiveMedia;
  displayItem: Title;
  displayEpisode?: EpisodePosition & { key?: string; duration?: number };
  backHref: string;
  adjacent: { previous?: EpisodePosition & { key?: string }; next?: EpisodePosition & { key?: string }; ready: boolean };
  nextStillPath?: string | null;
  controls: LibraryControls;
  initialProvider: AnimeProvider | null;
  onProviderChange: (provider: AnimeProvider) => void;
  initialAnimeAudio?: 'sub' | 'dub' | null;
  onAnimeAudioChange?: (audio: 'sub' | 'dub') => void;
  autoPlayEpisode?: boolean;
  providerControls: boolean;
  onProviderControlsChange: (next: boolean) => void;
  preferredQuality: string | undefined;
  onPreferredQualityChange: (quality: string) => void;
  onNavigateEpisode: (target: EpisodePosition & { key?: string }) => void;
  theatreMode?: boolean;
  onToggleTheatre?: () => void;
  hasEpisodesDrawer?: boolean;
  episodesOpen?: boolean;
  onToggleEpisodes?: () => void;
  episodesDrawer?: ReactNode;
}

export function VideoStage({
  stageRef, media, displayItem, displayEpisode, backHref, adjacent, nextStillPath, controls,
  initialProvider, onProviderChange, initialAnimeAudio, onAnimeAudioChange, autoPlayEpisode,
  providerControls, onProviderControlsChange,
  preferredQuality, onPreferredQualityChange, onNavigateEpisode,
  theatreMode, onToggleTheatre, hasEpisodesDrawer, episodesOpen, onToggleEpisodes, episodesDrawer,
}: Readonly<VideoStageProps>) {
  const animeEligible = media.embed && isAnime(media.item.originalLanguage, media.item.genreIds);
  const initialSelectedProvider: AnimeProvider = animeEligible ? (initialProvider ?? 'emnex') : 'cinesrc';

  const prefs = controls.library.preferences;
  const pref = useCallback(<K extends keyof typeof preferenceDefaults>(name: K) => prefs[name] ?? preferenceDefaults[name], [prefs]);
  const preferredSubtitleLang = resolvePreferredSubtitleLang(prefs);

  const [provider, setProvider] = useState<AnimeProvider>(initialSelectedProvider);
  const isEmnex = Boolean(media.embed && provider === 'emnex');
  const isCineSrc = Boolean(media.embed && provider === 'cinesrc');
  const isNativeVideo = !media.embed || isEmnex;
  const quality = preferredQuality ?? prefs.quality ?? '';

  const selectProvider = useCallback((next: AnimeProvider) => {
    setProvider(next);
    onProviderChange(next);
  }, [onProviderChange]);

  useEffect(() => {
    onProviderChange(provider);
  }, [provider, onProviderChange]);

  const videoBoxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<VideoWithAudioTracks>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const controlsBarRef = useRef<HTMLFieldSetElement>(null);
  const markersRef = useRef<HTMLDivElement>(null);
  const audioMenuRef = useRef<HTMLDetailsElement>(null);
  const subtitleMenuRef = useRef<HTMLDetailsElement>(null);
  const settingsMenuRef = useRef<HTMLDetailsElement>(null);

  // Snapshot initial saved progress once for this session so live saves never recompute embedSrc
  const initialProgressRef = useRef(controls.library.progress[media.progressKey]);
  const initialPrefsRef = useRef(prefs);
  const restoreStateRef = useRef<CineRestoreState | null>(null);

  const trackingRef = useRef<ViewingSession>(viewingSession(
    !media.embed || (initialProgressRef.current?.provider || 'cinesrc') === initialSelectedProvider
      ? initialProgressRef.current
      : null,
  ));
  const historyRef = useRef<{ id: string; started: number; tracking: ViewingSession; lastSaved: number; lastCoverage: number } | null>(null);
  const lastProgressSavedRef = useRef(0);
  const lastProgressTimeRef = useRef<number>(-1);
  const completedRef = useRef(false);
  const endedRef = useRef(false);
  const autoSkippedRef = useRef(new Set<SkipSegment>());
  const segmentDurationRef = useRef<number | null>(null);
  const sourceRevisionRef = useRef(0);
  const idleTimerRef = useRef<number | undefined>(undefined);
  const bufferingTimerRef = useRef<number | undefined>(undefined);
  const volumeTimerRef = useRef<number | undefined>(undefined);
  const clickTimerRef = useRef<number | undefined>(undefined);
  const controlsHoveredRef = useRef(false);
  const pointerScrubbingRef = useRef(false);
  const scrubTimeRef = useRef<number | null>(null);

  // CineSrc protocol refs (kept in refs so postMessage listener never restarts mid-playback)
  const seekTargetRef = useRef<number | null>(null);
  const seekStartedRef = useRef<number>(-Infinity);
  const relativeJumpRef = useRef<number | undefined>(undefined);
  const lastUpdateRef = useRef<number>(0);
  const cineDurationRef = useRef<number | null>(null);
  const pausedRef = useRef<boolean>(true);
  const durationMismatchRef = useRef<boolean>(false);
  const sourceIdRef = useRef<string | null>(null);
  const resumeTimeRef = useRef<number | null>(null);
  const restoreVolumeRef = useRef<boolean>(true);
  const pendingAudioRef = useRef<{ volume: number; muted: boolean } | null>(null);
  const pendingAudioTimerRef = useRef<number | undefined>(undefined);
  const skippedToRef = useRef<number | undefined>(undefined);
  const unidentifiedEpisodeRef = useRef<boolean>(false);
  const hlsRef = useRef<Hls | null>(null);
  const emnexResumeTimeRef = useRef<number | null>(null);
  const emnexServersLoadingRef = useRef(false);
  const emnexServersRef = useRef<EmnexServerOption[] | null>(null);
  const failedEmnexServersRef = useRef(new Set<string>());
  const emnexTimingsRef = useRef<{ intro: { start: number; end: number } | null; outro: { start: number; end: number } | null }>({ intro: null, outro: null });

  const [direct, setDirect] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [dubFallback, setDubFallback] = useState(false);
  const [animeSourceData, setAnimeSourceData] = useState<{ id: number; episode: number; idType?: 'anilist' | 'mal' } | null>(null);
  const [emnexAudio, setEmnexAudio] = useState<'sub' | 'dub'>(() => (
    initialAnimeAudio
    ?? readAnimeAudioPreference(media.item.key)
    ?? (samePlaybackLanguage(initialPrefsRef.current.audioLanguage, 'English') ? 'dub' : 'sub')
  ));
  const activeEmnexAudioRef = useRef<'sub' | 'dub'>(emnexAudio);
  const [emnexServer, setEmnexServer] = useState('');
  const [emnexStream, setEmnexStream] = useState<EmnexStreamData | null>(null);
  const [emnexServers, setEmnexServers] = useState<EmnexServerOption[] | null>(null);
  const [emnexAvailableTypes, setEmnexAvailableTypes] = useState<EmnexAvailableTypes | null>(null);
  const [emnexFallbackNotice, setEmnexFallbackNotice] = useState('');
  const [hlsLevels, setHlsLevels] = useState<{ index: number; label: string }[]>([]);
  const [hlsLevel, setHlsLevel] = useState(-1);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [embedStatus, setEmbedStatus] = useState<{ message: string; canRetry: boolean }>({ message: media.embed ? 'Loading player…' : '', canRetry: false });
  const [pictureVisible, setPictureVisible] = useState(!media.embed);
  const [position, setPosition] = useState<PlaybackPosition>({ currentTime: 0, duration: 0, paused: true });
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [seekPreview, setSeekPreview] = useState<{ time: number; offset: number; segment?: string } | null>(null);
  const [ended, setEnded] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [controlsActive, setControlsActive] = useState(true);
  const [volume, setVolume] = useState(() => pref('volume') ? (prefs.level ?? 1) : 1);
  const [muted, setMuted] = useState(() => pref('volume') ? Boolean(prefs.muted) : false);
  const [speed, setSpeed] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement && document.fullscreenElement === stageRef.current));
  const isMobileViewport = useMediaQuery('(max-width: 720px)');
  const useMobileSheets = isMobileViewport && !isFullscreen;
  const [segments, setSegments] = useState<SkipSegment[]>(() => media.nativeMedia?.segments ?? []);
  const [undoSkip, setUndoSkip] = useState<{ from: number; kind: SkipSegment['kind'] } | null>(null);
  const undoSkipTimerRef = useRef<number | undefined>(undefined);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [countdownCancelled, setCountdownCancelled] = useState(false);
  const [bufferedCss, setBufferedCss] = useState('');
  const [nativeAudioTracks, setNativeAudioTracks] = useState<{ index: number; label: string; language: string; enabled: boolean }[]>([]);
  const [subTracks, setSubTracks] = useState<SubtitleTrack[] | null>(null);
  const [subLang, setSubLang] = useState('');
  const [subStatus, setSubStatus] = useState('');
  const [activeCues, setActiveCues] = useState<{ url: string; cues: SubtitleCue[] } | null>(null);
  const [nativeCaptionsOn, setNativeCaptionsOn] = useState(false);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(() => readCaptionStyle());
  const [actionFeedback, setActionFeedback] = useState<{ label: string; nonce: number } | null>(null);
  const actionFeedbackTimerRef = useRef<number | undefined>(undefined);
  const [tapSeek, setTapSeek] = useState<{ side: 'left' | 'right'; seconds: number; nonce: number } | null>(null);
  const lastTapRef = useRef<{ time: number; side: 'left' | 'center' | 'right'; count: number } | null>(null);
  const tapSeekTimerRef = useRef<number | undefined>(undefined);

  const showFeedback = useCallback((label: string) => {
    clearTimeout(actionFeedbackTimerRef.current);
    setActionFeedback(prev => ({ label, nonce: (prev?.nonce ?? 0) + 1 }));
    actionFeedbackTimerRef.current = window.setTimeout(() => setActionFeedback(null), 900);
  }, []);

  const handleCaptionStyleChange = useCallback((next: CaptionStyle) => {
    setCaptionStyle(next);
    writeCaptionStyle(next);
  }, []);

  const lastVolumeRef = useRef(volume > 0 ? volume : 0.5);
  if (volume > 0) lastVolumeRef.current = volume;

  // Keep fresh refs to latest props/state for stable callbacks and event listeners
  const controlsRef = useRef(controls);
  controlsRef.current = controls;
  const displayItemRef = useRef(displayItem);
  displayItemRef.current = displayItem;
  const displayEpisodeRef = useRef(displayEpisode);
  displayEpisodeRef.current = displayEpisode;
  const positionRef = useRef(position);
  positionRef.current = position;
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const providerRef = useRef(provider);
  providerRef.current = provider;
  const providerControlsRef = useRef(providerControls);
  providerControlsRef.current = providerControls;
  const adjacentRef = useRef(adjacent);
  adjacentRef.current = adjacent;
  const onNavigateEpisodeRef = useRef(onNavigateEpisode);
  onNavigateEpisodeRef.current = onNavigateEpisode;
  const backHrefRef = useRef(backHref);
  backHrefRef.current = backHref;
  const subTracksRef = useRef(subTracks);
  subTracksRef.current = subTracks;
  const subLoadingRef = useRef(false);
  const subDownloadRef = useRef<AbortController | null>(null);

  const positionNativeCaptions = useCallback(() => {
    const video = videoRef.current;
    const box = videoBoxRef.current;
    const bar = controlsBarRef.current;
    const track = video?.textTracks?.[0];
    if (!video || !box || !bar || !track?.activeCues?.length || !video.videoHeight || !video.clientHeight) return;
    const raised = box.matches('.controls-active, .is-paused, :has(:focus-visible, .af-player-menu[open])');
    const height = Math.min(video.clientHeight, (video.clientWidth * video.videoHeight) / video.videoWidth);
    const letterbox = (video.clientHeight - height) / 2;
    const controlsTop = bar.getBoundingClientRect().top - video.getBoundingClientRect().top;
    const captionBottom = ((controlsTop - letterbox - Math.max(12, height * 0.04)) / height) * 100;
    for (const activeCue of Array.from(track.activeCues)) {
      const cue = activeCue as VTTCue;
      if ('line' in cue) {
        cue.snapToLines = false;
        cue.lineAlign = 'end';
        cue.line = raised ? Math.max(5, Math.min(94, captionBottom)) : 94;
      }
    }
  }, []);

  const revealControls = useCallback(() => {
    setControlsActive(true);
    clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      if (pointerScrubbingRef.current || controlsHoveredRef.current || controlsBarRef.current?.querySelector(':focus-visible')) return;
      setControlsActive(false);
    }, 2500);
  }, []);

  useEffect(() => {
    positionNativeCaptions();
  }, [controlsActive, position.paused, positionNativeCaptions]);

  useEffect(() => () => {
    clearTimeout(idleTimerRef.current);
    clearTimeout(bufferingTimerRef.current);
    clearTimeout(volumeTimerRef.current);
    clearTimeout(clickTimerRef.current);
    clearTimeout(pendingAudioTimerRef.current);
    clearTimeout(undoSkipTimerRef.current);
    clearTimeout(actionFeedbackTimerRef.current);
    subDownloadRef.current?.abort();
  }, []);

  const persistPlayback = useCallback((pos: PlaybackPosition, force = false, markCompleted = false) => {
    const lib = controlsRef.current;
    if (!lib.ready || unidentifiedEpisodeRef.current || !Number.isFinite(pos.duration) || pos.duration <= 0 || !Number.isFinite(pos.currentTime)) return;
    const now = Date.now();
    const item = displayItemRef.current;
    const episode = displayEpisodeRef.current;

    if (historyRef.current) {
      const cov = Math.min(pos.duration, watchedSeconds(historyRef.current.tracking.ranges, pos.duration));
      const historyChanged = markCompleted || (force ? cov > historyRef.current.lastCoverage : now - historyRef.current.lastSaved >= 8000);
      if (cov >= Math.min(5, pos.duration / 2) && historyChanged) {
        historyRef.current.lastSaved = now;
        historyRef.current.lastCoverage = cov;
        lib.recordHistory(historyRef.current.id, {
          item,
          mediaKey: media.progressKey,
          episode,
          started: historyRef.current.started,
          updated: now,
          duration: pos.duration,
          time: Math.max(0, Math.min(pos.duration, pos.currentTime)),
          coverage: cov,
          completed: markCompleted || completedRef.current,
        });
      }
    }

    if (completedRef.current || endedRef.current || pos.currentTime < 5 || pos.currentTime >= pos.duration) return;
    if (!trackingRef.current.ranges.some(([start, end]) => pos.currentTime >= start && pos.currentTime <= end + 0.5)) return;
    if (!force && now - lastProgressSavedRef.current < 8000) return;
    if (force && Math.abs(lastProgressTimeRef.current - pos.currentTime) < 0.5) return;
    lastProgressSavedRef.current = now;
    lastProgressTimeRef.current = pos.currentTime;
    lib.recordProgress(media.progressKey, {
      item,
      episode,
      time: pos.currentTime,
      duration: pos.duration,
      updated: now,
      ranges: trackingRef.current.ranges.slice(-40),
      skipped: trackingRef.current.skipped.slice(-20),
      ...(media.embed && providerRef.current !== 'cinesrc' ? { provider: providerRef.current } : {}),
    });
  }, [media.progressKey, media.embed]);

  const checkForCompletion = useCallback((pos: PlaybackPosition, isEnded = false) => {
    if (completedRef.current || unidentifiedEpisodeRef.current || !Number.isFinite(pos.duration) || pos.duration <= 0) return;
    const credits = segmentsRef.current.filter(s => s.kind === 'credits');
    if (!completionReached(trackingRef.current.ranges, pos, credits, isEnded, trackingRef.current.skipped)) return;
    completedRef.current = true;
    persistPlayback(pos, true, true);
    const watchedKey = media.episode ? media.progressKey : media.item.key;
    void controlsRef.current.toggleWatched(displayItemRef.current, watchedKey, { force: true, skipConfirm: true });
    controlsRef.current.recordProgress(media.progressKey, null);
  }, [persistPlayback, media.episode, media.progressKey, media.item.key]);

  const sendCommand = useCallback((command: string, ...args: unknown[]) => {
    if (!media.embed || providerRef.current === 'emnex') {
      applyNativeVideoCommand(videoRef.current, command, args, trackingRef.current);
      return;
    }
    const targetWindow = frameRef.current?.contentWindow;
    if (!targetWindow) return;
    if (durationMismatchRef.current && ['play', 'seek'].includes(command)) return;
    if (command === 'seek') {
      const target = Number(args[0]);
      if (!Number.isFinite(target)) return;
      relativeJumpRef.current = undefined;
      seekTargetRef.current = target;
      seekStartedRef.current = performance.now();
      trackingRef.current.sample = null;
    }
    targetWindow.postMessage({ type: 'cinesrc:command', command, args }, cineSrcOrigin);
  }, [media.embed]);

  const jumpPlayback = useCallback((delta: number) => {
    const pos = positionRef.current;
    if (!Number.isFinite(pos.duration) || pos.duration <= 0) return;
    if (media.embed && providerRef.current === 'cinesrc') {
      const pending = seekTargetRef.current !== null && performance.now() - seekStartedRef.current < 1800
        ? seekTargetRef.current : undefined;
      if (pending === undefined) {
        const waiting = relativeJumpRef.current !== undefined;
        relativeJumpRef.current = (relativeJumpRef.current ?? 0) + delta;
        if (!waiting) sendCommand('getCurrentTime');
        return;
      }
      sendCommand('seek', Math.max(0, Math.min(pos.duration, pending + delta)));
      return;
    }
    sendCommand('seek', Math.max(0, Math.min(pos.duration, pos.currentTime + delta)));
  }, [media.embed, sendCommand]);

  const loadSegmentsForDuration = useCallback(async (duration: number) => {
    if (!media.item.id || !Number.isFinite(duration) || duration <= 0) return;
    const rounded = Math.round(duration);
    if (segmentDurationRef.current !== null && Math.abs(segmentDurationRef.current - rounded) <= 1) return;
    const durationChanged = segmentDurationRef.current !== null && Math.abs(segmentDurationRef.current - rounded) > 1;
    segmentDurationRef.current = rounded;
    if (durationChanged) {
      setSegments(media.nativeMedia?.segments ?? []);
      autoSkippedRef.current.clear();
    }
    if (providerRef.current === 'emnex') {
      const clamped = clampEmnexSegments(emnexTimingsRef.current.intro, emnexTimingsRef.current.outro, duration);
      if (clamped.length) {
        setSegments(current => {
          const otherKinds = current.filter(s => !clamped.some(c => c.kind === s.kind));
          return [...clamped, ...otherKinds];
        });
      }
    }
    const revision = sourceRevisionRef.current;
    const params = new URLSearchParams({ id: String(media.item.id), type: media.item.type, duration: String(Math.round(duration * 1000)) });
    if (media.embed) params.set('source', providerRef.current);
    if (media.item.type === 'tv' && media.episode) {
      params.set('season', String(media.episode.season));
      params.set('episode', String(media.episode.number));
    }
    try {
      const { segments: found } = await request<{ segments: SkipSegment[] }>(`/api/segments?${params}`);
      if (sourceRevisionRef.current !== revision || segmentDurationRef.current !== rounded || !found.length) return;
      setSegments(current => {
        const existingKinds = new Set(current.map(s => s.kind));
        const additions = found
          .filter(s => !existingKinds.has(s.kind))
          .map(s => ({ ...s, end: Math.min(s.end, duration) }));
        if (!additions.length) return current;
        const next = [...current, ...additions];
        if (skippedToRef.current !== undefined) {
          const credited = next.find(entry => ['intro', 'recap'].includes(entry.kind) && Math.abs(entry.end - skippedToRef.current!) <= 2);
          if (credited) trackingRef.current.skipped = mergeRanges(trackingRef.current.skipped, credited.start, credited.end);
        }
        return next;
      });
    } catch { /* Bundled timings remain usable. */ }
  }, [media.item.id, media.item.type, media.episode, media.embed, media.nativeMedia]);

  const handleSample = useCallback((pos: PlaybackPosition, seeking = false) => {
    positionRef.current = pos;
    setPosition(pos);
    if (pos.duration > 0) void loadSegmentsForDuration(pos.duration);
    if (seeking) trackingRef.current.sample = null;
    const advanced = samplePlayback(trackingRef.current, pos, performance.now());
    if (!endedRef.current && !unidentifiedEpisodeRef.current) {
      historyRef.current ??= { id: crypto.randomUUID(), started: Date.now(), tracking: viewingSession(), lastSaved: 0, lastCoverage: 0 };
      if (seeking) historyRef.current.tracking.sample = null;
      samplePlayback(historyRef.current.tracking, pos, performance.now());
    }
    if (advanced && !endedRef.current) checkForCompletion(pos);
    if (!seeking) persistPlayback(pos);
  }, [loadSegmentsForDuration, checkForCompletion, persistPlayback]);

  // Resolve anime AniList source once per episode (does NOT re-run when title/details hydrate)
  const epSeason = media.episode?.season;
  const epNumber = media.episode?.number;
  useEffect(() => {
    if (!isEmnex || !animeEligible) {
      setAnimeSourceData(null);
      setEmnexStream(null);
      setEmnexServers(null);
      emnexServersLoadingRef.current = false;
      return;
    }
    const controller = new AbortController();
    const query = epSeason !== undefined && epNumber !== undefined ? `?s=${epSeason}&e=${epNumber}` : '';
    setEmbedStatus({ message: 'Loading stream…', canRetry: false });
    setPictureVisible(false);
    request<{ source: { id: number; episode: number; idType?: 'anilist' | 'mal' } | null; emnex?: boolean }>(`/api/anime/${media.item.type}/${media.item.id}${query}`, { signal: controller.signal })
      .then(({ source, emnex }) => {
        if (controller.signal.aborted) return;
        if (source && emnex !== false) setAnimeSourceData(source);
        else selectProvider('cinesrc');
      }).catch(() => {
        if (!controller.signal.aborted) selectProvider('cinesrc');
      });
    return () => controller.abort();
  }, [isEmnex, animeEligible, media.item.type, media.item.id, epSeason, epNumber, selectProvider]);

  // Resolve EmnexAnime HLS stream when AniList coordinates, audio type, or server change
  useEffect(() => {
    if (!isEmnex || !animeSourceData) {
      setEmnexStream(null);
      return;
    }
    const controller = new AbortController();
    sourceRevisionRef.current += 1;
    segmentDurationRef.current = null;
    autoSkippedRef.current.clear();
    subDownloadRef.current?.abort();
    emnexTimingsRef.current = { intro: null, outro: null };
    setSegments([]);
    setActiveCues(null);
    setSubTracks(null);
    subTracksRef.current = null;
    setEmnexStream(null);
    setEmnexFallbackNotice('');
    setHlsLevels([]);
    setHlsLevel(-1);
    setBufferedCss('');
    setAutoplayBlocked(false);
    setPictureVisible(false);
    setEmbedStatus({ message: 'Loading stream…', canRetry: false });
    trackingRef.current = viewingSession(
      initialProgressRef.current?.provider === 'emnex' ? initialProgressRef.current : null,
    );

    const requestType = emnexServer ? activeEmnexAudioRef.current : emnexAudio;
    const params = new URLSearchParams({ type: requestType });
    if (animeSourceData.idType === 'mal') params.set('idType', 'mal');
    if (emnexServer) params.set('provider', emnexServer);
    if (reloadNonce > 0) params.set('refresh', '1');

    const loadInitialEmnexSubtitle = async (match: SubtitleTrack) => {
      subDownloadRef.current?.abort();
      const subCtrl = new AbortController();
      subDownloadRef.current = subCtrl;
      try {
        const cues = await loadSubtitle(match, AbortSignal.any([subCtrl.signal, AbortSignal.timeout(10_000)]));
        if (!subCtrl.signal.aborted && subDownloadRef.current === subCtrl) {
          setActiveCues({ url: match.url, cues });
          setSubStatus('');
        }
      } catch {
        // Subtitle download failed; stream remains playable without subtitles.
      }
    };

    const applyEmnexStream = (data: EmnexStreamData) => {
      activeEmnexAudioRef.current = data.type;
      setEmnexStream(data);
      if (Array.isArray(data.servers)) {
        emnexServersRef.current = data.servers;
        setEmnexServers(data.servers);
      }
      if (data.availableTypes) setEmnexAvailableTypes(data.availableTypes);
      setEmnexFallbackNotice(resolveEmnexFallbackNotice(data.fallbackFrom));
      emnexTimingsRef.current = { intro: data.intro, outro: data.outro };
      const initialSegments = clampEmnexSegments(data.intro, data.outro, positionRef.current.duration);
      if (initialSegments.length) setSegments(initialSegments);

      const tracks = data.subtitles.map(formatEmnexSubtitleTrack);
      if (tracks.length) {
        setSubTracks(tracks);
        subTracksRef.current = tracks;
      }
      const defaultEntry = data.subtitles.find(entry => entry.default);
      const defaultLang = defaultEntry ? formatEmnexSubtitleTrack(defaultEntry).language : '';
      const wantedLang = resolveWantedEmnexSubtitleLang(data.type, defaultLang, controlsRef.current.library.preferences);
      setSubLang(pickInitialSubLang(tracks, wantedLang));
      setSubStatus('');

      const match = pickInitialEmnexSubTrack(tracks, wantedLang, data.type, defaultEntry?.url);
      if (match) void loadInitialEmnexSubtitle(match);
    };

    const handleEmnexStreamError = () => {
      if (emnexAudio === 'dub' && !dubFallback) {
        setDubFallback(true);
        setEmnexAvailableTypes(prev => ({ sub: prev?.sub ?? true, dub: false }));
        setEmnexFallbackNotice('Dub unavailable for this episode · Playing Sub.');
        failedEmnexServersRef.current.clear();
        setEmnexServer('');
        setEmnexAudio('sub');
      } else if (emnexServer) {
        failedEmnexServersRef.current.add(emnexServer);
        setEmnexServer('');
      } else {
        selectProvider('cinesrc');
      }
    };

    const fetchStream = async () => {
      try {
        const data = await request<EmnexStreamData>(
          `/api/anime/stream/${animeSourceData.id}/${animeSourceData.episode}?${params}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) applyEmnexStream(data);
      } catch {
        if (!controller.signal.aborted) handleEmnexStreamError();
      }
    };

    void fetchStream();
    return () => controller.abort();
  }, [isEmnex, animeSourceData, emnexAudio, emnexServer, reloadNonce, dubFallback, selectProvider]);

  const tryNextEmnexServerOrFail = useCallback(async (failedProvider: string) => {
    failedEmnexServersRef.current.add(failedProvider);
    if (animeSourceData) {
      let list = emnexServersRef.current;
      if (!list) {
        try {
          const srvQuery = animeSourceData.idType === 'mal' ? '?idType=mal' : '';
          const fetched = await request<{ servers: EmnexServerOption[] }>(`/api/anime/servers/${animeSourceData.id}/${animeSourceData.episode}${srvQuery}`);
          list = fetched.servers;
          emnexServersRef.current = list;
          setEmnexServers(list);
        } catch {
          list = [];
        }
      }
      const next = list.find(entry => entry.type === activeEmnexAudioRef.current && !failedEmnexServersRef.current.has(entry.provider));
      if (next) {
        const pos = positionRef.current;
        if (pos.duration > 0 && pos.currentTime > 2) emnexResumeTimeRef.current = pos.currentTime;
        setEmnexServer(next.provider);
        return;
      }
    }
    setPictureVisible(false);
    setEmbedStatus({ message: 'EmnexAnime stream could not play. Try reloading, another server, or CineSrc.', canRetry: true });
  }, [animeSourceData]);

  // Attach EmnexAnime HLS stream to the native <video> element via hls.js (or native HLS on Safari)
  useEffect(() => {
    if (!isEmnex || !emnexStream?.hls) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let networkRecovered = false;
    let mediaRecovered = false;

    const startPlayback = () => {
      void video.play().catch(err => {
        if (!cancelled && err?.name === 'NotAllowedError') setAutoplayBlocked(true);
      });
    };

    const attach = async () => {
      try {
        const { default: Hls } = await import('hls.js');
        if (cancelled || videoRef.current !== video) return;
        if (Hls.isSupported()) {
          const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
          hlsRef.current = hls;
          hls.loadSource(emnexStream.hls);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (cancelled) return;
            const seenHeights = new Set<number>();
            const levels = hls.levels
              .map((lvl, index) => ({ index, height: lvl.height || 0 }))
              .filter(lvl => lvl.height > 0)
              .sort((a, b) => b.height - a.height)
              .filter(lvl => {
                if (seenHeights.has(lvl.height)) return false;
                seenHeights.add(lvl.height);
                return true;
              })
              .map(lvl => ({ index: lvl.index, label: `${lvl.height}p` }));
            setHlsLevels(levels);
            setHlsLevel(-1);
            startPlayback();
          });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (cancelled || !data.fatal) return;
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !networkRecovered) {
              networkRecovered = true;
              hls.startLoad();
              return;
            }
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecovered) {
              mediaRecovered = true;
              hls.recoverMediaError();
              return;
            }
            hls.destroy();
            if (hlsRef.current === hls) hlsRef.current = null;
            void tryNextEmnexServerOrFail(emnexStream.provider);
          });
          return;
        }
      } catch {
        // Fall through to native HLS if supported
      }
      if (cancelled || videoRef.current !== video) return;
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = emnexStream.hls;
        startPlayback();
      } else {
        setPictureVisible(false);
        setEmbedStatus({ message: 'HLS playback is unsupported in this browser. Switch to CineSrc.', canRetry: true });
      }
    };

    void attach();
    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      setHlsLevels([]);
      setHlsLevel(-1);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [isEmnex, emnexStream?.hls, emnexStream?.provider, tryNextEmnexServerOrFail]);

  const loadEmnexServers = useCallback(() => {
    if (!isEmnex || !animeSourceData || emnexServersRef.current !== null || emnexServersLoadingRef.current) return;
    emnexServersLoadingRef.current = true;
    const srvQuery = animeSourceData.idType === 'mal' ? '?idType=mal' : '';
    request<{ servers: EmnexServerOption[] }>(`/api/anime/servers/${animeSourceData.id}/${animeSourceData.episode}${srvQuery}`)
      .then(({ servers }) => {
        emnexServersRef.current = servers;
        setEmnexServers(servers);
      })
      .catch(() => {})
      .finally(() => { emnexServersLoadingRef.current = false; });
  }, [isEmnex, animeSourceData]);

  const handleEmnexAudioChange = useCallback((nextAudio: 'sub' | 'dub') => {
    const activeAudio = emnexStream?.type ?? emnexAudio;
    if (nextAudio === activeAudio && nextAudio === emnexAudio) return;
    if (emnexAvailableTypes && !emnexAvailableTypes[nextAudio]) return;
    const pos = positionRef.current;
    if (pos.duration > 0 && pos.currentTime > 2) emnexResumeTimeRef.current = pos.currentTime;
    failedEmnexServersRef.current.clear();
    setDubFallback(false);
    setEmnexFallbackNotice('');
    setEmnexServer('');
    activeEmnexAudioRef.current = nextAudio;
    setEmnexAudio(nextAudio);
    onAnimeAudioChange?.(nextAudio);
    writeAnimeAudioPreference(media.item.key, nextAudio);
    void controlsRef.current.setPreference('audioLanguage', nextAudio === 'dub' ? 'English' : 'Japanese', 'Preferred audio');
  }, [emnexAudio, emnexStream?.type, emnexAvailableTypes, onAnimeAudioChange, media.item.key]);

  const handleEmnexServerChange = useCallback((nextServer: string) => {
    if (nextServer === (emnexServer || emnexStream?.provider)) return;
    const pos = positionRef.current;
    if (pos.duration > 0 && pos.currentTime > 2) emnexResumeTimeRef.current = pos.currentTime;
    failedEmnexServersRef.current.delete(nextServer);
    setEmnexServer(nextServer);
  }, [emnexServer, emnexStream?.provider]);

  const handleHlsLevelChange = useCallback((level: number) => {
    setHlsLevel(level);
    if (hlsRef.current) hlsRef.current.currentLevel = level;
  }, []);

  // Compute iframe src ONLY when CineSrc config/source intentionally changes
  const embedSrc = useMemo(() => {
    if (!isCineSrc || reloadNonce < 0) return '';
    return buildCineSrcEmbedUrl({
      item: media.item,
      epSeason,
      epNumber,
      providerControls,
      quality,
      autoPlayEpisode,
      restore: restoreStateRef.current,
      saved: initialProgressRef.current,
      initPrefs: initialPrefsRef.current,
    });
  }, [isCineSrc, media.item, epSeason, epNumber, providerControls, quality, reloadNonce, autoPlayEpisode]);

  const reloadCineWithState = useCallback((nextProviderControls: boolean, nextQuality: string) => {
    const pos = positionRef.current;
    const pending = seekTargetRef.current !== null && performance.now() - seekStartedRef.current < 1800
      ? seekTargetRef.current : undefined;
    const currentTime = resolveReloadTime(endedRef.current, pending, pos);
    restoreStateRef.current = {
      time: currentTime,
      paused: pos.duration > 0 ? Boolean(pos.paused) : undefined,
      volume: volumeRef.current,
      muted: mutedRef.current,
      playbackRate: speedRef.current,
    };
    if (nextProviderControls !== providerControlsRef.current) onProviderControlsChange(nextProviderControls);
    if (nextQuality !== quality) onPreferredQualityChange(nextQuality);
  }, [onProviderControlsChange, onPreferredQualityChange, quality]);

  const rememberAudioPref = useCallback((nextVol: number, nextMuted: boolean) => {
    const curPrefs = controlsRef.current.library.preferences;
    if ((curPrefs.volume ?? preferenceDefaults.volume) === false) return;
    if (!Number.isFinite(nextVol) || nextVol < 0 || nextVol > 1) return;
    clearTimeout(volumeTimerRef.current);
    volumeTimerRef.current = window.setTimeout(() => {
      const latest = controlsRef.current.library.preferences;
      if ((latest.volume ?? preferenceDefaults.volume) === false) return;
      if (latest.level !== nextVol) void controlsRef.current.setPreference('level', nextVol, 'Remember volume');
      if (latest.muted !== nextMuted) void controlsRef.current.setPreference('muted', nextMuted, 'Remember mute');
    }, 350);
  }, []);

  // Listen to CineSrc postMessage events (stable deps — ONLY resets when embedSrc changes!)
  useEffect(() => {
    if (!isCineSrc || !embedSrc) return;
    const saved = initialProgressRef.current;
    if (!trackingRef.current.ranges.length && !completedRef.current && saved && (saved.provider || 'cinesrc') === 'cinesrc') {
      trackingRef.current = viewingSession(saved);
    }
    sourceRevisionRef.current += 1;
    segmentDurationRef.current = null;
    durationMismatchRef.current = false;
    unidentifiedEpisodeRef.current = false;
    restoreVolumeRef.current = true;
    lastUpdateRef.current = 0;
    cineDurationRef.current = null;
    relativeJumpRef.current = undefined;
    seekTargetRef.current = null;
    seekStartedRef.current = -Infinity;
    skippedToRef.current = undefined;
    setPictureVisible(false);
    setEmbedStatus({ message: 'Loading player…', canRetry: false });

    let slowTimer: number | undefined;
    let failTimer: number | undefined;

    const clearTimers = () => {
      clearTimeout(slowTimer);
      clearTimeout(failTimer);
      slowTimer = failTimer = undefined;
    };

    const startStallTimeout = () => {
      clearTimeout(slowTimer);
      clearTimeout(failTimer);
      slowTimer = undefined;
      failTimer = window.setTimeout(() => {
        setEmbedStatus({ message: 'The video stopped responding. Try a source in the player or reload it here.', canRetry: true });
      }, 20000);
    };

    const waitForCineStream = (message = 'Loading player…', restart = true) => {
      if (!restart && failTimer !== undefined) {
        if (slowTimer !== undefined) setEmbedStatus({ message, canRetry: false });
        return;
      }
      clearTimeout(slowTimer);
      clearTimeout(failTimer);
      setEmbedStatus({ message, canRetry: false });
      slowTimer = window.setTimeout(() => {
        slowTimer = undefined;
        setEmbedStatus({ message: 'Still connecting to the video source. You can try another source.', canRetry: true });
      }, 8000);
      failTimer = window.setTimeout(() => {
        setEmbedStatus({ message: 'The player is taking longer than expected. Try a source in the player or reload it here.', canRetry: true });
      }, 20000);
    };

    waitForCineStream();

    const restoreAudioAndRate = () => {
      if (!restoreVolumeRef.current) return;
      restoreVolumeRef.current = false;
      const shouldRestore = Boolean(restoreStateRef.current) || (controlsRef.current.library.preferences.volume ?? preferenceDefaults.volume);
      if (shouldRestore) {
        sendCommand('setVolume', volumeRef.current);
        sendCommand('setMuted', mutedRef.current);
      }
      if (speedRef.current !== 1) sendCommand('setPlaybackRate', speedRef.current);
    };

    const checkMovieDuration = (duration: number) => {
      if (durationMismatchRef.current) return false;
      const expected = displayItemRef.current.duration;
      if (media.item.type !== 'movie' || !movieDurationMismatch(expected, duration)) return true;
      durationMismatchRef.current = true;
      pausedRef.current = true;
      cineSrcServers.delete(media.item.key);
      trackingRef.current.sample = null;
      clearTimers();
      sendCommand('pause');
      setPosition({ currentTime: 0, duration: 0, paused: true });
      setEmbedStatus({
        message: `This source reports ${Math.round(duration / 60)} min; the catalog lists ${expected} min. Choose another source.`,
        canRetry: true,
      });
      return false;
    };

    const resumeAfterSourceChange = (duration: number) => {
      const target = resumeTimeRef.current;
      resumeTimeRef.current = null;
      if (target !== null && target > 5 && target < duration - 2) {
        seekStartedRef.current = performance.now();
        sendCommand('seek', target);
      }
    };

    const readCinePosition = (currentTime: number, duration: number, seeking = false) => {
      if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0 || currentTime < 0 || currentTime > duration + 0.5) return;
      if (!checkMovieDuration(duration)) return;
      const prev = positionRef.current.duration > 0 ? positionRef.current : null;
      const prevDur = prev?.duration || initialProgressRef.current?.duration;
      if (prevDur && Math.abs(prevDur - duration) > 2.5 && !prev) {
        trackingRef.current = viewingSession();
        historyRef.current = null;
        setSegments([]);
        segmentDurationRef.current = null;
        autoSkippedRef.current.clear();
        sourceRevisionRef.current += 1;
      }
      const nextPos: PlaybackPosition = {
        currentTime: Math.min(currentTime, duration),
        duration,
        paused: pausedRef.current,
        seeking,
      };
      if (!unidentifiedEpisodeRef.current && !endedRef.current) {
        if (!prev || (!seeking && currentTime > prev.currentTime + 0.05)) {
          clearTimers();
          setEmbedStatus({ message: '', canRetry: false });
          if (!pausedRef.current) startStallTimeout();
        }
        handleSample(nextPos, seeking);
      } else {
        positionRef.current = nextPos;
        setPosition(nextPos);
      }
    };

    const cineCtx: CineMessageContext = {
      mediaItemKey: media.item.key,
      mediaItemType: media.item.type,
      hasEpisode: Boolean(media.episode),
      epSeason,
      epNumber,
      controlsRef,
      displayItemRef,
      positionRef,
      segmentsRef,
      trackingRef,
      historyRef,
      completedRef,
      endedRef,
      pausedRef,
      durationMismatchRef,
      unidentifiedEpisodeRef,
      restoreVolumeRef,
      cineDurationRef,
      lastUpdateRef,
      seekTargetRef,
      seekStartedRef,
      relativeJumpRef,
      resumeTimeRef,
      skippedToRef,
      sourceIdRef,
      sourceRevisionRef,
      segmentDurationRef,
      autoSkippedRef,
      pendingAudioRef,
      pendingAudioTimerRef,
      volumeRef,
      mutedRef,
      providerControlsRef,
      onNavigateEpisodeRef,
      backHrefRef,
      clearTimers,
      startStallTimeout,
      waitForCineStream,
      restoreAudioAndRate,
      checkMovieDuration,
      resumeAfterSourceChange,
      readCinePosition,
      sendCommand,
      persistPlayback,
      checkForCompletion,
      revealControls,
      rememberAudioPref,
      setPictureVisible,
      setHasPlayed,
      setEnded,
      setCountdownCancelled,
      setPosition,
      setEmbedStatus,
      setVolume,
      setMuted,
      setSpeed,
      setSegments,
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== cineSrcOrigin) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data.type !== 'string') return;
      cineMessageHandlers[data.type]?.(data, cineCtx);
    };

    window.addEventListener('message', onMessage);
    const poll = window.setInterval(() => {
      if (endedRef.current || performance.now() - lastUpdateRef.current < 2200) return;
      sendCommand('getDuration');
      sendCommand('getPaused');
      sendCommand('getCurrentTime');
    }, 2500);

    return () => {
      clearTimers();
      clearInterval(poll);
      window.removeEventListener('message', onMessage);
    };
  }, [isCineSrc, media.item.key, media.item.type, media.episode, epSeason, epNumber, embedSrc, reloadNonce, sendCommand, persistPlayback, handleSample, checkForCompletion, revealControls, rememberAudioPref]);

  // Auto-play native video when source loads or switches to direct stream
  const nativeSrc = resolveNativeSrc(media, direct);

  useEffect(() => {
    if (media.embed || !nativeSrc) return;
    const video = videoRef.current;
    if (!video) return;
    void video.play().catch(() => { /* Play button remains available if autoplay is blocked. */ });
  }, [media.embed, nativeSrc]);

  // Sync native video textTracks cuechange / change / ResizeObserver & audioTracks
  useEffect(() => {
    if (media.embed) return;
    const video = videoRef.current;
    if (!video) return;
    const track = video.textTracks?.[0];
    const syncTextTrack = () => {
      if (track) setNativeCaptionsOn(track.mode === 'showing');
    };
    const resize = track ? new ResizeObserver(positionNativeCaptions) : null;
    if (resize) resize.observe(video);
    track?.addEventListener('cuechange', positionNativeCaptions);
    video.textTracks?.addEventListener('change', syncTextTrack);

    const audioList = video.audioTracks;
    const syncAudioTracks = () => {
      if (!audioList || audioList.length < 2) {
        setNativeAudioTracks([]);
        return;
      }
      const list = Array.from({ length: audioList.length }, (_, i) => {
        const t = audioList[i];
        return { index: i, label: t.label || playbackLanguage(t.language) || `Track ${i + 1}`, language: playbackLanguage(t.language) || t.label, enabled: t.enabled };
      });
      const preferred = list.findIndex(t => samePlaybackLanguage(t.language, controlsRef.current.library.preferences.audioLanguage));
      if (preferred >= 0 && !list[preferred].enabled) {
        for (let i = 0; i < audioList.length; i++) audioList[i].enabled = i === preferred;
        list.forEach((t, i) => { t.enabled = i === preferred; });
      }
      setNativeAudioTracks(list);
    };
    if (audioList) {
      audioList.addEventListener('addtrack', syncAudioTracks);
      audioList.addEventListener('removetrack', syncAudioTracks);
      audioList.addEventListener('change', syncAudioTracks);
      syncAudioTracks();
    }

    return () => {
      resize?.disconnect();
      track?.removeEventListener('cuechange', positionNativeCaptions);
      video.textTracks?.removeEventListener('change', syncTextTrack);
      if (audioList) {
        audioList.removeEventListener('addtrack', syncAudioTracks);
        audioList.removeEventListener('removetrack', syncAudioTracks);
        audioList.removeEventListener('change', syncAudioTracks);
      }
    };
  }, [media.embed, nativeSrc, positionNativeCaptions]);

  // Apply subtitle preference changes to native video track dynamically
  useEffect(() => {
    if (media.embed) return;
    const track = videoRef.current?.textTracks?.[0];
    if (!track) return;
    const lang = playbackLanguage(track.language) || track.label;
    const want = samePlaybackLanguage(lang, preferredSubtitleLang);
    track.mode = want ? 'showing' : 'disabled';
    setNativeCaptionsOn(want);
  }, [media.embed, preferredSubtitleLang]);

  // Save on unmount / pagehide
  useEffect(() => {
    const saveNow = () => persistPlayback(positionRef.current, true);
    window.addEventListener('pagehide', saveNow);
    return () => {
      window.removeEventListener('pagehide', saveNow);
      saveNow();
    };
  }, [persistPlayback]);

  // Fullscreen listener
  useEffect(() => {
    const onFs = () => {
      setIsFullscreen(Boolean(document.fullscreenElement && document.fullscreenElement === stageRef.current));
      revealControls();
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, [stageRef, revealControls]);

  const toggleFullscreen = useCallback(() => {
    const stage = stageRef.current;
    const video = videoRef.current;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else if (video?.webkitDisplayingFullscreen) video.webkitExitFullscreen?.();
    else if (stage && document.fullscreenEnabled) void stage.requestFullscreen().catch(() => {});
    else video?.webkitEnterFullscreen?.();
  }, [stageRef]);

  const togglePip = useCallback(() => {
    const video = videoRef.current;
    if (!video || !isNativeVideo || !document.pictureInPictureEnabled) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
    else void video.requestPictureInPicture?.().catch(() => {});
  }, [isNativeVideo]);

  // Close player popup menus on outside click or Escape
  useOutsideMenuClose(audioMenuRef, subtitleMenuRef, settingsMenuRef);

  const closeOtherMenus = (opened: HTMLDetailsElement) => {
    for (const ref of [audioMenuRef, subtitleMenuRef, settingsMenuRef]) {
      if (ref.current && ref.current !== opened && ref.current.open) ref.current.open = false;
    }
    revealControls();
  };

  // Auto-skip segments & auto-next 10s countdown
  const externalControls = isCineSrc && providerControls;
  const activeSegment = !externalControls ? activeSkipSegment(segments, position) : undefined;
  const allowAutoplay = pref('autoplay');
  const skipSegment = useCallback((segment: SkipSegment) => {
    const reachesEnd = endSegmentReachesEnd(segment, segmentsRef.current, positionRef.current.duration);
    if (reachesEnd && adjacentRef.current.next) {
      checkForCompletion(positionRef.current, endedRef.current);
      onNavigateEpisodeRef.current(adjacentRef.current.next);
      return;
    }
    const previousTime = positionRef.current.currentTime;
    autoSkippedRef.current.add(segment);
    trackingRef.current.skipped = mergeRanges(trackingRef.current.skipped, segment.start, segment.end);
    trackingRef.current.sample = null;
    sendCommand('seek', segment.end);
    clearTimeout(undoSkipTimerRef.current);
    setUndoSkip({ from: previousTime, kind: segment.kind });
    undoSkipTimerRef.current = window.setTimeout(() => setUndoSkip(null), 6000);
  }, [checkForCompletion, sendCommand]);

  const revertSkip = useCallback(() => {
    if (!undoSkip) return;
    clearTimeout(undoSkipTimerRef.current);
    const target = Math.max(0, undoSkip.from);
    setUndoSkip(null);
    sendCommand('seek', target);
  }, [undoSkip, sendCommand]);

  useEffect(() => {
    if (!activeSegment || position.paused || position.seeking || autoSkippedRef.current.has(activeSegment)) return;
    if (activeSegment.autoSkip === false) return;
    const isEndKind = activeSegment.kind === 'credits' || activeSegment.kind === 'preview';
    const reachesEnd = endSegmentReachesEnd(activeSegment, segments, position.duration);
    const countdownWillHandle = allowAutoplay && !countdownCancelled
      && (Boolean(adjacent.next) || (Boolean(media.episode) && !adjacent.ready));
    const endWithNext = isEndKind && reachesEnd && countdownWillHandle;
    const prefKind = activeSegment.kind === 'preview' ? 'credits' : activeSegment.kind;
    if (!endWithNext && pref(prefKind)) {
      skipSegment(activeSegment);
      if (isEndKind && reachesEnd) checkForCompletion(positionRef.current);
    }
  }, [activeSegment, segments, position.paused, position.seeking, position.duration, adjacent.next, adjacent.ready, media.episode, allowAutoplay, countdownCancelled, pref, skipSegment, checkForCompletion]);

  const inEndingForNext = endSegmentReachesEnd(activeSegment, segments, position.duration)
    && !position.paused && !position.seeking && !unidentifiedEpisodeRef.current;
  useEffect(() => {
    if (!adjacent.next || externalControls || !allowAutoplay || countdownCancelled || (!ended && !inEndingForNext)) {
      setCountdown(null);
      return;
    }
    setCountdown(10);
    const deadline = performance.now() + 10_000;
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
      setCountdown(left);
      if (left === 0) {
        clearInterval(timer);
        if (adjacentRef.current.next) {
          checkForCompletion(positionRef.current, endedRef.current);
          onNavigateEpisodeRef.current(adjacentRef.current.next);
        }
      }
    }, 250);
    return () => clearInterval(timer);
  }, [adjacent.next, externalControls, ended, inEndingForNext, countdownCancelled, allowAutoplay, checkForCompletion]);

  const updateAudio = useCallback((nextVol: number, nextMuted: boolean) => {
    if (nextVol > 0) lastVolumeRef.current = nextVol;
    setVolume(nextVol);
    setMuted(nextMuted);
    if (media.embed && providerRef.current === 'cinesrc') {
      pendingAudioRef.current = { volume: nextVol, muted: nextMuted };
      clearTimeout(pendingAudioTimerRef.current);
      pendingAudioTimerRef.current = window.setTimeout(() => { pendingAudioRef.current = null; }, 600);
    }
    sendCommand('setVolume', nextVol);
    sendCommand('setMuted', nextMuted);
    rememberAudioPref(nextVol, nextMuted);
  }, [media.embed, sendCommand, rememberAudioPref]);

  const chooseSubtitleTrack = useCallback(async (track: SubtitleTrack, remember = true) => {
    subDownloadRef.current?.abort();
    const controller = new AbortController();
    subDownloadRef.current = controller;
    setSubStatus('Loading subtitles…');
    try {
      const cues = await loadSubtitle(track, AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]));
      if (subDownloadRef.current !== controller || controller.signal.aborted) return false;
      setActiveCues({ url: track.url, cues });
      if (remember && (controlsRef.current.library.preferences.subtitles ?? preferenceDefaults.subtitles)) {
        void controlsRef.current.setPreference('subtitleLanguage', track.language, 'Preferred subtitles');
      }
      setSubStatus('');
      return true;
    } catch {
      if (controller.signal.aborted) return false;
      setSubStatus('This track could not load. Try another version.');
      return false;
    }
  }, []);

  const autoSelectSubtitlesFromTracks = useCallback(async (tracks: SubtitleTrack[], lang: string) => {
    const candidates = orderAutoSubtitleCandidates(tracks, lang);
    const loaded = await trySubtitleCandidates(candidates, 0, chooseSubtitleTrack);
    if (!loaded && tracks.length && !candidates.length) {
      setSubStatus(`${lang} subtitles are unavailable for this video.`);
    }
  }, [chooseSubtitleTrack]);

  const loadEmbedSubtitles = useCallback(async (autoSelectLang?: string) => {
    if (subTracksRef.current !== null) {
      if (autoSelectLang) await autoSelectSubtitlesFromTracks(subTracksRef.current, autoSelectLang);
      return;
    }
    if (subLoadingRef.current) return;
    subLoadingRef.current = true;
    setSubStatus('Loading subtitle tracks…');
    try {
      const tracks = await findSubtitles(displayItemRef.current, media.episode, AbortSignal.timeout(10_000));
      setSubTracks(tracks);
      subTracksRef.current = tracks;
      setSubLang(pickInitialSubLang(tracks, autoSelectLang || preferredSubtitleLang));
      setSubStatus(tracks.length ? '' : 'No subtitle tracks available.');
      if (autoSelectLang) await autoSelectSubtitlesFromTracks(tracks, autoSelectLang);
    } catch {
      setSubStatus('Subtitle tracks could not load. Reopen the menu to retry.');
    } finally {
      subLoadingRef.current = false;
    }
  }, [media.episode, preferredSubtitleLang, autoSelectSubtitlesFromTracks]);

  // Keyboard shortcuts (Space, Left/Right, J/L, Up/Down, M, C, S, T, E, F, Shift+N/P, 0-9)
  const singleKeyEnabled = controls.library.preferences.singleKeyShortcuts !== false;
  useEffect(() => {
    const ctx: KeyboardShortcutContext = {
      singleKeyEnabled,
      activeSegment,
      activeCues,
      nativeCaptionsOn,
      mediaEmbed: media.embed,
      hasNativeCaptions: Boolean(media.nativeMedia?.captions),
      preferredSubtitleLang,
      hasEpisodesDrawer,
      positionRef,
      endedRef,
      mutedRef,
      volumeRef,
      lastVolumeRef,
      adjacentRef,
      onNavigateEpisodeRef,
      subDownloadRef,
      videoRef,
      sendCommand,
      jumpPlayback,
      updateAudio,
      showFeedback,
      skipSegment,
      toggleFullscreen,
      onToggleTheatre,
      onToggleEpisodes,
      setActiveCues,
      setNativeCaptionsOn,
      loadEmbedSubtitles,
    };
    const onKey = (event: KeyboardEvent) => {
      if (isShortcutBlocked(event)) return;
      const key = event.key.toLowerCase();
      if (handleCoreShortcutKey(event, key, ctx) || !singleKeyEnabled) return;
      handleSingleKeyShortcut(event, key, ctx);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [singleKeyEnabled, activeSegment, skipSegment, toggleFullscreen, onToggleTheatre, hasEpisodesDrawer, onToggleEpisodes, updateAudio, sendCommand, jumpPlayback, showFeedback, activeCues, nativeCaptionsOn, media.embed, media.nativeMedia, loadEmbedSubtitles, preferredSubtitleLang]);

  // Commit seek if pointer is released anywhere while dragging
  useEffect(() => {
    const finishScrub = () => {
      if (!pointerScrubbingRef.current) return;
      pointerScrubbingRef.current = false;
      const target = scrubTimeRef.current;
      scrubTimeRef.current = null;
      setScrubTime(null);
      setSeekPreview(null);
      if (target !== null) sendCommand('seek', target);
      revealControls();
    };
    window.addEventListener('pointerup', finishScrub);
    window.addEventListener('pointercancel', finishScrub);
    return () => {
      window.removeEventListener('pointerup', finishScrub);
      window.removeEventListener('pointercancel', finishScrub);
    };
  }, [sendCommand, revealControls]);

  // Auto-load preferred subtitles on CineSrc and when subtitle preference changes
  const showOverlay = isNativeVideo || (isCineSrc && !providerControls);
  useEffect(() => {
    if (!isCineSrc || !showOverlay) return;
    if (!preferredSubtitleLang) {
      subDownloadRef.current?.abort();
      setActiveCues(null);
      setSubStatus('');
      return;
    }
    void loadEmbedSubtitles(preferredSubtitleLang);
  }, [isCineSrc, showOverlay, preferredSubtitleLang, loadEmbedSubtitles]);

  const computeSeekPreview = (time: number) => {
    if (position.duration <= 0 || !markersRef.current) return;
    const rect = markersRef.current.getBoundingClientRect();
    const offset = markersRef.current.offsetLeft + (rect.width * time) / position.duration;
    const seg = segments.find(entry => time >= entry.start && time < entry.end);
    setSeekPreview({ time, offset, segment: seg ? segmentNames[seg.kind] : undefined });
  };

  const triggerTapSeek = (side: 'left' | 'right', delta: number) => {
    jumpPlayback(delta);
    clearTimeout(tapSeekTimerRef.current);
    setTapSeek(prev => ({
      side,
      seconds: prev?.side === side ? prev.seconds + Math.abs(delta) : Math.abs(delta),
      nonce: (prev?.nonce ?? 0) + 1,
    }));
    tapSeekTimerRef.current = window.setTimeout(() => setTapSeek(null), 700);
  };

  useEffect(() => () => clearTimeout(tapSeekTimerRef.current), []);

  const togglePlayOrPause = () => {
    if (positionRef.current.duration > 0 || endedRef.current || !media.embed) {
      sendCommand(endedRef.current || positionRef.current.paused ? 'play' : 'pause');
    }
  };

  const handleCoarsePictureTap = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
    const side = tapRegionSide(ratio);
    const now = Date.now();
    const previous = lastTapRef.current;
    if (previous?.side === side && now - previous.time < 340 && side !== 'center') {
      lastTapRef.current = { time: now, side, count: previous.count + 1 };
      if (positionRef.current.duration > 0 || !media.embed) {
        triggerTapSeek(side, side === 'left' ? -10 : 10);
      }
      return;
    }
    lastTapRef.current = { time: now, side, count: 1 };
    clickTimerRef.current = window.setTimeout(() => {
      if (!controlsActive && !positionRef.current.paused) revealControls();
      else togglePlayOrPause();
    }, 280);
  };

  const handlePictureClick = (event: React.MouseEvent<HTMLDivElement>) => {
    clearTimeout(clickTimerRef.current);
    if (window.matchMedia?.('(pointer: coarse)').matches && showOverlay) {
      handleCoarsePictureTap(event);
      return;
    }
    if (event.detail !== 1) return;
    clickTimerRef.current = window.setTimeout(togglePlayOrPause, 260);
  };

  const handlePictureDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    clearTimeout(clickTimerRef.current);
    event.preventDefault();
    if (window.matchMedia?.('(pointer: coarse)').matches && showOverlay) {
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
      if (ratio < 0.35 || ratio > 0.65) return;
    }
    toggleFullscreen();
  };

  const handleSwitchProvider = (next: AnimeProvider) => {
    restoreStateRef.current = null;
    subDownloadRef.current?.abort();
    setActiveCues(null);
    setSubTracks(null);
    subTracksRef.current = null;
    failedEmnexServersRef.current.clear();
    emnexServersRef.current = null;
    setDubFallback(false);
    selectProvider(next);
  };

  const handleReloadPlayer = () => {
    cineSrcServers.delete(media.item.key);
    restoreStateRef.current = null;
    failedEmnexServersRef.current.clear();
    if (isEmnex && positionRef.current.duration > 0 && positionRef.current.currentTime > 2) {
      emnexResumeTimeRef.current = positionRef.current.currentTime;
    }
    setReloadNonce(n => n + 1);
  };

  const displayTime = scrubTime ?? position.currentTime;
  const activeCaptionText = findActiveCaptionText(activeCues?.cues, position.currentTime - captionStyle.offset);
  const lastRevealMoveRef = useRef(0);
  const liveAnnouncement = useLiveAnnouncements(activeSegment, singleKeyEnabled, countdown, adjacent.next, actionFeedback, undoSkip);
  const {
    showNativeVideo,
    playedPct,
    volumePct,
    titleText,
    subTitleText,
    sourcePage,
    nextStillUrl,
    blurNextStill,
    videoBoxClassName,
    activeEmnexServer,
    captionsSrc,
    showCineLoading,
    showCineRecovery,
    showPictureLayer,
    showEmbedNotice,
    emnexStreamMeta,
  } = deriveStageFlags({
    media,
    provider,
    animeEligible,
    isEmnex,
    isCineSrc,
    isNativeVideo,
    providerControls,
    displayItem,
    displayEpisode,
    position,
    displayTime,
    volume,
    controlsActive,
    ended,
    hasPlayed,
    autoplayBlocked,
    embedStatus,
    pictureVisible,
    emnexStream,
    emnexServer,
    nextStillPath,
    blurPref: controls.library.preferences.blur,
  });

  const playerControlsNode = (
    <PlayerControls
      media={media}
      useNativeVideo={isNativeVideo}
      isEmnex={isEmnex}
      emnexAudio={emnexStream?.type ?? emnexAudio}
      emnexAvailableTypes={emnexAvailableTypes}
      emnexServer={activeEmnexServer}
      emnexServers={emnexServers}
      hlsLevels={hlsLevels}
      hlsLevel={hlsLevel}
      controls={controls}
      position={position}
      displayTime={displayTime}
      playedPct={playedPct}
      bufferedCss={bufferedCss}
      segments={segments}
      seekPreview={seekPreview}
      ended={ended}
      volume={volume}
      muted={muted}
      volumePct={volumePct}
      lastVolume={lastVolumeRef.current}
      speed={speed}
      quality={quality}
      isFullscreen={isFullscreen}
      useMobileSheets={useMobileSheets}
      theatreMode={theatreMode}
      hasEpisodesDrawer={hasEpisodesDrawer}
      episodesOpen={episodesOpen}
      adjacent={adjacent}
      nativeAudioTracks={nativeAudioTracks}
      activeCues={activeCues}
      nativeCaptionsOn={nativeCaptionsOn}
      subTracks={subTracks}
      subLang={subLang}
      subStatus={subStatus}
      rememberSubtitles={pref('subtitles')}
      preferredSubtitleLang={preferredSubtitleLang}
      captionStyle={captionStyle}
      controlsBarRef={controlsBarRef}
      markersRef={markersRef}
      audioMenuRef={audioMenuRef}
      subtitleMenuRef={subtitleMenuRef}
      settingsMenuRef={settingsMenuRef}
      videoRef={videoRef}
      onControlsHoverChange={hovered => { controlsHoveredRef.current = hovered; }}
      onRevealControls={revealControls}
      onScrubStart={() => { pointerScrubbingRef.current = true; }}
      onSeekChange={nextVal => {
        if (pointerScrubbingRef.current) {
          scrubTimeRef.current = nextVal;
          setScrubTime(nextVal);
          computeSeekPreview(nextVal);
        } else {
          sendCommand('seek', nextVal);
        }
      }}
      onSeekHover={clientX => {
        if (position.duration <= 0 || pointerScrubbingRef.current || !markersRef.current) return;
        const { left, width } = markersRef.current.getBoundingClientRect();
        if (width <= 0) return;
        const pct = Math.max(0, Math.min(1, (clientX - left) / width));
        computeSeekPreview(pct * position.duration);
      }}
      onSeekPreviewClear={() => { if (!pointerScrubbingRef.current) setSeekPreview(null); }}
      onSendCommand={sendCommand}
      onJumpPlayback={jumpPlayback}
      onUpdateAudio={updateAudio}
      onCloseOtherMenus={closeOtherMenus}
      onOpenSubtitles={target => {
        if (target) closeOtherMenus(target);
        if (media.embed) void loadEmbedSubtitles();
      }}
      onTurnOffSubtitles={() => {
        subDownloadRef.current?.abort();
        setActiveCues(null);
        setNativeCaptionsOn(false);
        setSubStatus('');
      }}
      onEnableNativeSubtitles={() => setNativeCaptionsOn(true)}
      onSelectSubLang={setSubLang}
      onChooseSubTrack={track => void chooseSubtitleTrack(track, true)}
      onChangeCaptionStyle={handleCaptionStyleChange}
      onSpeedChange={val => { setSpeed(val); sendCommand('setPlaybackRate', val); showFeedback(`${val}×`); }}
      onQualityChange={val => { if (val !== quality) reloadCineWithState(providerControls, val); }}
      onEmnexAudioChange={handleEmnexAudioChange}
      onEmnexServerChange={handleEmnexServerChange}
      onHlsLevelChange={handleHlsLevelChange}
      onOpenSettings={loadEmnexServers}
      onOpenProviderSources={() => {
        if (settingsMenuRef.current) settingsMenuRef.current.open = false;
        reloadCineWithState(true, quality);
      }}
      onTogglePip={togglePip}
      onToggleTheatre={onToggleTheatre}
      onToggleEpisodes={onToggleEpisodes}
      onToggleFullscreen={toggleFullscreen}
      onNavigateEpisode={onNavigateEpisode}
    />
  );

  return <>
    <div
      ref={videoBoxRef}
      className={videoBoxClassName}
      onPointerMove={event => {
        if (event.pointerType === 'touch') return;
        const now = performance.now();
        if (now - lastRevealMoveRef.current < 150) return;
        lastRevealMoveRef.current = now;
        revealControls();
      }}
      onFocus={revealControls}
    >
      <output className="sr-only" aria-live="polite" aria-atomic="true">{liveAnnouncement}</output>
      <StageNativeVideo
        show={showNativeVideo}
        videoRef={videoRef}
        src={media.embed ? undefined : nativeSrc}
        crossOrigin={isEmnex ? 'anonymous' : undefined}
        poster={displayItem.backdrop}
        titleText={titleText}
        captionsSrc={captionsSrc}
        onLoadedMetadata={event => {
          const video = event.currentTarget;
          const saved = initialProgressRef.current;
          const savedMatches = !isEmnex || saved?.provider === 'emnex';
          const emnexResume = emnexResumeTimeRef.current;
          emnexResumeTimeRef.current = null;
          if (emnexResume !== null && emnexResume > 2 && emnexResume < video.duration - 2) {
            video.currentTime = emnexResume;
          } else if (pref('resume') && savedMatches && saved && saved.time > 5 && saved.time < video.duration - 2) {
            video.currentTime = saved.time;
          }
          if (pref('volume')) {
            video.volume = volumeRef.current;
            video.muted = mutedRef.current;
          }
          if (speedRef.current !== 1) video.playbackRate = speedRef.current;
          if (!isEmnex) {
            const track = video.textTracks[0];
            if (track) {
              const want = samePlaybackLanguage(playbackLanguage(track.language) || track.label, preferredSubtitleLang);
              track.mode = want ? 'showing' : 'disabled';
              setNativeCaptionsOn(want);
            }
          } else {
            setPictureVisible(true);
            setEmbedStatus({ message: '', canRetry: false });
          }
          pausedRef.current = video.paused;
          handleSample({ currentTime: video.currentTime, duration: video.duration, paused: video.paused }, true);
        }}
        onDurationChange={event => {
          const video = event.currentTarget;
          if (Number.isFinite(video.duration) && video.duration > 0) {
            setPosition(prev => ({ ...prev, duration: video.duration }));
          }
        }}
        onTimeUpdate={event => {
          const video = event.currentTarget;
          pausedRef.current = video.paused;
          handleSample({ currentTime: video.currentTime, duration: video.duration, paused: video.paused, seeking: video.seeking }, video.seeking);
        }}
        onSeeking={() => { trackingRef.current.sample = null; }}
        onProgress={event => {
          const video = event.currentTarget;
          setBufferedCss(formatBufferedGradient(bufferedIntervals(video.buffered, video.duration)));
        }}
        onPlay={() => {
          clearTimeout(bufferingTimerRef.current);
          setBuffering(false);
          setAutoplayBlocked(false);
          if (isEmnex) {
            setPictureVisible(true);
            setEmbedStatus({ message: '', canRetry: false });
          }
          if (endedRef.current) {
            endedRef.current = false;
            setEnded(false);
            setCountdownCancelled(false);
            trackingRef.current.sample = null;
            if (completedRef.current) {
              completedRef.current = false;
              trackingRef.current = viewingSession();
            }
            historyRef.current = null;
          }
          pausedRef.current = false;
          setHasPlayed(true);
          setPosition(p => {
            const next = { ...p, paused: false };
            positionRef.current = next;
            return next;
          });
          revealControls();
        }}
        onPause={event => {
          const video = event.currentTarget;
          clearTimeout(bufferingTimerRef.current);
          setBuffering(false);
          pausedRef.current = true;
          trackingRef.current.sample = null;
          const pos = { currentTime: video.currentTime, duration: video.duration, paused: true };
          positionRef.current = pos;
          setPosition(pos);
          persistPlayback(pos, true);
          revealControls();
        }}
        onWaiting={event => {
          const video = event.currentTarget;
          clearTimeout(bufferingTimerRef.current);
          bufferingTimerRef.current = window.setTimeout(() => {
            if (!video.paused && !video.ended) setBuffering(true);
          }, 450);
        }}
        onPlaying={() => {
          clearTimeout(bufferingTimerRef.current);
          setBuffering(false);
          setAutoplayBlocked(false);
          setHasPlayed(true);
          if (isEmnex) {
            setPictureVisible(true);
            setEmbedStatus({ message: '', canRetry: false });
          }
        }}
        onVolumeChange={event => {
          const video = event.currentTarget;
          setVolume(video.volume);
          setMuted(video.muted);
          rememberAudioPref(video.volume, video.muted);
        }}
        onRateChange={event => setSpeed(event.currentTarget.playbackRate)}
        onEnded={event => {
          const video = event.currentTarget;
          clearTimeout(bufferingTimerRef.current);
          setBuffering(false);
          endedRef.current = true;
          pausedRef.current = true;
          setEnded(true);
          const pos = { currentTime: video.duration, duration: video.duration, paused: true };
          positionRef.current = pos;
          setPosition(pos);
          checkForCompletion(pos, true);
        }}
        onError={() => {
          clearTimeout(bufferingTimerRef.current);
          setBuffering(false);
          if (isEmnex) {
            if (!hlsRef.current && emnexStream?.hls && videoRef.current?.src) {
              void tryNextEmnexServerOrFail(emnexStream.provider);
            }
          } else {
            setVideoError(true);
          }
        }}
      />

      {isCineSrc && embedSrc && <iframe
        key={`${provider}:${providerControls}:${quality}:${dubFallback}:${reloadNonce}`}
        ref={frameRef}
        src={embedSrc}
        title={`${titleText} video player`}
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        sandbox="allow-scripts allow-same-origin allow-presentation"
        referrerPolicy="no-referrer"
      />}

      <StageStatusOverlays
        showCineLoading={showCineLoading}
        showCineRecovery={showCineRecovery}
        showPictureLayer={showPictureLayer}
        externalControls={externalControls}
        backdrop={displayItem.backdrop}
        embedStatusMessage={embedStatus.message}
        isCineSrc={isCineSrc}
        animeEligible={animeEligible}
        provider={provider}
        tapSeek={tapSeek}
        buffering={buffering}
        showVideoError={videoError && Boolean(media.nativeMedia)}
        direct={direct}
        sourcePage={sourcePage}
        actionFeedback={actionFeedback}
        onTryCineControls={() => reloadCineWithState(true, quality)}
        onSwitchProvider={handleSwitchProvider}
        onReload={handleReloadPlayer}
        onPictureClick={handlePictureClick}
        onPictureDoubleClick={handlePictureDoubleClick}
        onRetryVideo={() => {
          setVideoError(false);
          videoRef.current?.load();
          void videoRef.current?.play().catch(() => {});
        }}
        onTryDirect={() => { setVideoError(false); setDirect(true); }}
      />

      <StagePlayerOverlay
        showOverlay={showOverlay}
        titleText={titleText}
        subTitleText={subTitleText}
        hasDisplayEpisode={Boolean(displayEpisode)}
        backHref={backHref}
        position={position}
        displayTime={displayTime}
        ended={ended}
        autoplayBlocked={autoplayBlocked}
        mediaEmbed={media.embed}
        adjacent={adjacent}
        activeCaptionText={activeCaptionText}
        captionStyle={captionStyle}
        countdown={countdown}
        nextStillUrl={nextStillUrl}
        blurNextStill={blurNextStill}
        activeSegment={activeSegment}
        undoSkip={undoSkip}
        onPlay={() => sendCommand('play')}
        onTogglePlay={() => sendCommand(ended || position.paused ? 'play' : 'pause')}
        onNavigateEpisode={onNavigateEpisode}
        onJumpPlayback={jumpPlayback}
        onPlayNextNow={() => { checkForCompletion(positionRef.current, endedRef.current); onNavigateEpisode(adjacent.next!); }}
        onCancelCountdown={() => { setCountdownCancelled(true); setCountdown(null); }}
        onSkipSegment={skipSegment}
        onRevertSkip={revertSkip}
        controlsNode={playerControlsNode}
      />

      {episodesDrawer}
    </div>

    {showEmbedNotice && <EmbedNoticeBar
      provider={provider}
      providerControls={providerControls}
      animeEligible={animeEligible}
      embedStatus={embedStatus}
      streamMeta={emnexStreamMeta}
      fallbackNotice={isEmnex ? emnexFallbackNotice : undefined}
      onSwitchProvider={handleSwitchProvider}
      onToggleProviderControls={() => reloadCineWithState(!providerControls, quality)}
      onReload={handleReloadPlayer}
    />}
  </>;
}

