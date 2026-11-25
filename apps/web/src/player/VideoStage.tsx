import { archiveFileUrl } from '@afterframe/shared/catalog';
import { isAnime } from '@afterframe/shared/discover';
import {
  activeSkipSegment, bufferedIntervals, completionReached, mergeRanges, movieDurationMismatch,
  preferenceDefaults, samplePlayback, viewingSession, watchedSeconds, type PlaybackPosition, type SkipSegment, type ViewingSession,
} from '@afterframe/shared/playback';
import { findSubtitles, loadSubtitle, playbackLanguage, samePlaybackLanguage, type SubtitleCue, type SubtitleTrack } from '@afterframe/shared/subtitles';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { navigate, request, type EpisodePosition, type Title } from '../catalog';
import { Icon } from '../components';
import type { LibraryControls } from '../library';
import { EmbedNoticeBar } from './EmbedNoticeBar';
import { PlayerControls } from './PlayerControls';
import { formatClock, rememberCineServer } from './route';
import { animePlayers, cineSrcOrigin, cineSrcServers, segmentNames, type ActiveMedia, type AnimeProvider, type CineRestoreState, type VideoWithAudioTracks } from './types';

export function VideoStage({
  stageRef, media, displayItem, displayEpisode, backHref, adjacent, controls,
  initialProvider, onProviderChange, providerControls, onProviderControlsChange,
  preferredQuality, onPreferredQualityChange, onNavigateEpisode,
}: {
  stageRef: RefObject<HTMLDivElement | null>;
  media: ActiveMedia;
  displayItem: Title;
  displayEpisode?: EpisodePosition & { key?: string; duration?: number };
  backHref: string;
  adjacent: { previous?: EpisodePosition & { key?: string }; next?: EpisodePosition & { key?: string }; ready: boolean };
  controls: LibraryControls;
  initialProvider: AnimeProvider | null;
  onProviderChange: (provider: AnimeProvider) => void;
  providerControls: boolean;
  onProviderControlsChange: (next: boolean) => void;
  preferredQuality: string | undefined;
  onPreferredQualityChange: (quality: string) => void;
  onNavigateEpisode: (target: EpisodePosition & { key?: string }) => void;
}) {
  const animeEligible = media.embed && isAnime(media.item.originalLanguage, media.item.genreIds);
  const initialSelectedProvider: AnimeProvider = animeEligible ? (initialProvider ?? 'animeembed') : 'cinesrc';

  const prefs = controls.library.preferences;
  const pref = useCallback(<K extends keyof typeof preferenceDefaults>(name: K) => prefs[name] ?? preferenceDefaults[name], [prefs]);
  const preferredSubtitleLang = pref('subtitles') ? (prefs.subtitleLanguage ?? (prefs.captions ? 'English' : '')) : '';

  const [provider, setProviderState] = useState<AnimeProvider>(initialSelectedProvider);
  const quality = preferredQuality ?? prefs.quality ?? '';

  const setProvider = useCallback((next: AnimeProvider) => {
    setProviderState(next);
    onProviderChange(next);
  }, [onProviderChange]);

  useEffect(() => {
    onProviderChange(provider);
  }, [provider, onProviderChange]);

  const videoBoxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<VideoWithAudioTracks>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const controlsBarRef = useRef<HTMLDivElement>(null);
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
  const commandIdRef = useRef(0);
  const animeReadyRef = useRef(false);

  const [direct, setDirect] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [dubFallback, setDubFallback] = useState(false);
  const [animeSourceData, setAnimeSourceData] = useState<{ id: number; episode: number } | null>(null);
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
  const [isFullscreen, setIsFullscreen] = useState(() => document.fullscreenElement === stageRef.current);
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
  const [tapSeek, setTapSeek] = useState<{ side: 'left' | 'right'; seconds: number; nonce: number } | null>(null);
  const lastTapRef = useRef<{ time: number; side: 'left' | 'center' | 'right'; count: number } | null>(null);
  const tapSeekTimerRef = useRef<number | undefined>(undefined);

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
    for (let i = 0; i < track.activeCues.length; i++) {
      const cue = track.activeCues[i] as VTTCue;
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
    if (!media.embed) {
      const video = videoRef.current;
      if (!video) return;
      if (command === 'play') void video.play().catch(() => {});
      if (command === 'pause') video.pause();
      if (command === 'seek' && Number.isFinite(Number(args[0])) && Number.isFinite(video.duration)) {
        trackingRef.current.sample = null;
        video.currentTime = Math.max(0, Math.min(video.duration, Number(args[0])));
      }
      if (command === 'setVolume') video.volume = Number(args[0]);
      if (command === 'setMuted') video.muted = Boolean(args[0]);
      if (command === 'setPlaybackRate') video.playbackRate = Number(args[0]);
      return;
    }
    const targetWindow = frameRef.current?.contentWindow;
    if (!targetWindow) return;
    const activeProv = providerRef.current;
    if (activeProv === 'cinesrc') {
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
    } else if (activeProv === 'anipm') {
      targetWindow.postMessage({ ns: 'anipm.player', v: 1, cmd: command, args: command === 'seek' ? { time: args[0] } : (args[0] ?? {}) }, animePlayers.anipm.origin);
    } else {
      targetWindow.postMessage({
        channel: 'animeembed',
        version: 1,
        command,
        data: command === 'seek' ? { time: args[0] } : (args[0] ?? {}),
        requestId: String(++commandIdRef.current),
      }, animePlayers.animeembed.origin);
    }
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
      const isAnimeEmbed = media.embed && providerRef.current !== 'cinesrc';
      setSegments(current => {
        const existingKinds = new Set(current.map(s => s.kind));
        const additions = found
          .filter(s => !existingKinds.has(s.kind) && (!isAnimeEmbed || s.kind === 'credits'))
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

  // Resolve anime embed source once per episode (does NOT re-run when title/details hydrate)
  const epSeason = media.episode?.season;
  const epNumber = media.episode?.number;
  useEffect(() => {
    if (!media.embed || !animeEligible || provider === 'cinesrc') {
      setAnimeSourceData(null);
      return;
    }
    const controller = new AbortController();
    const query = epSeason !== undefined && epNumber !== undefined ? `?s=${epSeason}&e=${epNumber}` : '';
    request<{ source: { id: number; episode: number } | null }>(`/api/anime/${media.item.type}/${media.item.id}${query}`, { signal: controller.signal })
      .then(({ source }) => {
        if (controller.signal.aborted) return;
        if (source) setAnimeSourceData(source);
        else setProvider('cinesrc');
      }).catch(() => {
        if (!controller.signal.aborted) setProvider('cinesrc');
      });
    return () => controller.abort();
  }, [media.embed, animeEligible, provider, media.item.type, media.item.id, epSeason, epNumber, setProvider]);

  const preferDub = provider === 'animeembed' && !dubFallback && samePlaybackLanguage(initialPrefsRef.current.audioLanguage, 'English');

  // Compute iframe src ONLY when player config/source intentionally changes
  const embedSrc = useMemo(() => {
    if (!media.embed || reloadNonce < 0) return '';
    const restore = restoreStateRef.current;
    const saved = initialProgressRef.current;
    const initPrefs = initialPrefsRef.current;
    const allowResume = initPrefs.resume ?? preferenceDefaults.resume;
    const allowVolume = initPrefs.volume ?? preferenceDefaults.volume;
    const savedMatchesProvider = (saved?.provider || 'cinesrc') === provider;
    const savedResumeTime = allowResume && savedMatchesProvider && saved && saved.time > 5 && saved.time < saved.duration - 2
      && !(media.item.type === 'movie' && movieDurationMismatch(media.item.duration, saved.duration))
      ? saved.time : 0;
    const resumeTime = restore?.time !== undefined ? restore.time : savedResumeTime;

    if (provider === 'cinesrc') {
      const url = new URL(`/embed/${media.item.type}/${media.item.id}`, cineSrcOrigin);
      url.searchParams.set('color', '#efb09d');
      url.searchParams.set('controls', String(providerControls));
      if (providerControls) url.searchParams.set('back', 'close');
      else url.searchParams.set('subtitles', 'off');
      if (epSeason !== undefined && epNumber !== undefined) {
        url.searchParams.set('s', String(epSeason));
        url.searchParams.set('e', String(epNumber));
        url.searchParams.set('autonext', String(providerControls && (initPrefs.autoplay ?? preferenceDefaults.autoplay)));
        url.searchParams.set('autoskip', String(providerControls && (initPrefs.intro ?? preferenceDefaults.intro) && (initPrefs.recap ?? preferenceDefaults.recap)));
      }
      const serverId = cineSrcServers.get(media.item.key);
      if (serverId) {
        url.searchParams.set('prioritize', 'true');
        url.searchParams.set('lastserver', serverId);
      }
      url.searchParams.set('continueprompt', 'false');
      if (resumeTime > 0) url.searchParams.set('t', String(Math.floor(resumeTime)));
      if (quality) url.searchParams.set('quality', quality);
      if (restore?.muted ?? (allowVolume && Boolean(initPrefs.muted))) url.searchParams.set('muted', 'true');
      if (typeof restore?.paused === 'boolean') url.searchParams.set('autoplay', String(!restore.paused));
      return url.href;
    }

    if (!animeSourceData) return '';
    const origin = animePlayers[provider].origin;
    const url = new URL(`/embed/ani/${animeSourceData.id}/${animeSourceData.episode}${provider === 'anipm' ? '/sub' : ''}`, origin);
    url.search = new URLSearchParams(provider === 'anipm'
      ? { start: String(Math.floor(resumeTime)), color: 'efb09d', autonext: '0', episodes: '0', adult: '0', autoskip: '0' }
      : { start: String(Math.floor(resumeTime)), accent: 'efb09d', autoPlay: '1', autoNext: '0', autoSkip: '0', hide: 'next' }).toString();
    if (preferDub) url.searchParams.set('track', 'dub');
    if (allowVolume && initPrefs.muted) url.searchParams.set('muted', '1');
    return url.href;
  }, [media.embed, media.item.key, media.item.type, media.item.id, media.item.duration, epSeason, epNumber, provider, providerControls, quality, reloadNonce, animeSourceData, preferDub]);

  const reloadCineWithState = useCallback((nextProviderControls: boolean, nextQuality: string) => {
    const pos = positionRef.current;
    const pending = seekTargetRef.current !== null && performance.now() - seekStartedRef.current < 1800
      ? seekTargetRef.current : undefined;
    const currentTime = endedRef.current ? 0 : (pending ?? (pos.duration > 0 ? pos.currentTime : undefined));
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

  // Listen to CineSrc / AnimeEmbed / Ani.pm postMessage events (stable deps — ONLY resets when embedSrc changes!)
  useEffect(() => {
    if (!media.embed || !embedSrc) return;
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
    animeReadyRef.current = false;
    setPictureVisible(false);

    if (provider !== 'cinesrc') {
      trackingRef.current = viewingSession(
        initialProgressRef.current?.provider === provider ? initialProgressRef.current : null,
      );
      setEmbedStatus({ message: 'Loading video…', canRetry: false });
    } else {
      setEmbedStatus({ message: 'Loading player…', canRetry: false });
    }

    let slowTimer: number | undefined;
    let failTimer: number | undefined;
    let animeFallbackTimer: number | undefined;

    const clearTimers = () => {
      clearTimeout(slowTimer);
      clearTimeout(failTimer);
      clearTimeout(animeFallbackTimer);
      slowTimer = failTimer = animeFallbackTimer = undefined;
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

    const retryAnimeProvider = () => {
      if (preferDub && !positionRef.current.currentTime) {
        setDubFallback(true);
      } else {
        setProvider(animePlayers[provider].next);
      }
    };

    if (provider === 'cinesrc') {
      waitForCineStream();
    } else {
      animeFallbackTimer = window.setTimeout(retryAnimeProvider, 16000);
    }

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

    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;

      if (provider === 'cinesrc' && event.origin === cineSrcOrigin) {
        const data = event.data as Record<string, unknown> | null;
        if (!data || typeof data.type !== 'string') return;
        switch (data.type) {
          case 'cinesrc:ready':
            restoreAudioAndRate();
            sendCommand('getDuration');
            sendCommand('getCurrentTime');
            break;
          case 'cinesrc:loadedmetadata': {
            const dur = Number(data.duration);
            if (Number.isFinite(dur) && dur > 0) {
              if (!checkMovieDuration(dur)) break;
              cineDurationRef.current = dur;
              trackingRef.current.sample = null;
              seekStartedRef.current = -Infinity;
              restoreAudioAndRate();
              resumeAfterSourceChange(dur);
              readCinePosition(0, dur, true);
              sendCommand('getVolume');
              sendCommand('getMuted');
              sendCommand('getPlaybackRate');
            }
            break;
          }
          case 'cinesrc:play':
            if (durationMismatchRef.current) { sendCommand('pause'); break; }
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
            setPictureVisible(true);
            setHasPlayed(true);
            setPosition(prev => {
              const next = { ...prev, paused: false };
              positionRef.current = next;
              return next;
            });
            if (!unidentifiedEpisodeRef.current && positionRef.current.duration > 0) {
              clearTimers();
              setEmbedStatus({ message: '', canRetry: false });
              startStallTimeout();
            }
            revealControls();
            break;
          case 'cinesrc:timeupdate':
          case 'cinesrc:seeked': {
            const ct = Number(data.currentTime);
            const dur = Number(data.duration);
            if (!Number.isFinite(ct) || !Number.isFinite(dur) || dur <= 0 || ct < 0 || ct > dur) break;
            if (!checkMovieDuration(dur)) break;
            lastUpdateRef.current = performance.now();
            cineDurationRef.current = dur;
            if (ct > 0) {
              setPictureVisible(true);
              setHasPlayed(true);
            }
            if (resumeTimeRef.current !== null && data.type === 'cinesrc:timeupdate') {
              resumeAfterSourceChange(dur);
            }
            const seeking = data.type === 'cinesrc:seeked' || performance.now() - seekStartedRef.current < 1800;
            if (!seeking && positionRef.current.duration > 0 && ct > positionRef.current.currentTime + 0.05) {
              pausedRef.current = false;
              setHasPlayed(true);
              if (sourceIdRef.current) rememberCineServer(media.item.key, sourceIdRef.current);
            }
            if (data.type === 'cinesrc:seeked' && (seekTargetRef.current === null || Math.abs(ct - seekTargetRef.current) < 1)) {
              seekStartedRef.current = -Infinity;
              seekTargetRef.current = null;
            }
            readCinePosition(ct, dur, seeking);
            break;
          }
          case 'cinesrc:pause':
            pausedRef.current = true;
            if (positionRef.current.duration > 0) clearTimers();
            trackingRef.current.sample = null;
            setPosition(prev => {
              const next = { ...prev, paused: true };
              positionRef.current = next;
              if (next.duration > 0) persistPlayback(next, true);
              return next;
            });
            revealControls();
            break;
          case 'cinesrc:seeking':
            seekStartedRef.current = performance.now();
            trackingRef.current.sample = null;
            break;
          case 'cinesrc:skipintro': {
            const time = Number(data.time);
            if (!Number.isFinite(time) || time < 0) break;
            skippedToRef.current = time;
            const seg = segmentsRef.current.find(entry => ['intro', 'recap'].includes(entry.kind) && Math.abs(entry.end - time) <= 2);
            if (seg) trackingRef.current.skipped = mergeRanges(trackingRef.current.skipped, seg.start, seg.end);
            trackingRef.current.sample = null;
            break;
          }
          case 'cinesrc:volumechange': {
            const pending = pendingAudioRef.current;
            const vol = Number(data.volume);
            const validLevel = Number.isFinite(vol) && vol >= 0 && vol <= 1;
            const isMuted = typeof data.muted === 'boolean' ? data.muted : mutedRef.current;
            if (pending && (!validLevel || Math.abs(vol - pending.volume) > 0.001 || isMuted !== pending.muted)) break;
            pendingAudioRef.current = null;
            clearTimeout(pendingAudioTimerRef.current);
            const nextVol = validLevel ? vol : volumeRef.current;
            setVolume(nextVol);
            setMuted(isMuted);
            rememberAudioPref(nextVol, isMuted);
            break;
          }
          case 'cinesrc:ratechange': {
            const rate = Number(data.playbackRate);
            if (Number.isFinite(rate) && rate >= 0.25 && rate <= 2) setSpeed(rate);
            break;
          }
          case 'cinesrc:ended':
            if (durationMismatchRef.current) break;
            clearTimers();
            endedRef.current = true;
            pausedRef.current = true;
            setEnded(true);
            setPosition(prev => {
              const next = { ...prev, paused: true, currentTime: prev.duration };
              positionRef.current = next;
              return next;
            });
            if (positionRef.current.duration > 0) {
              checkForCompletion({ currentTime: positionRef.current.duration, duration: positionRef.current.duration }, true);
            }
            break;
          case 'cinesrc:nextepisode': {
            const nextS = Number(data.season);
            const nextE = Number(data.episode);
            if (Number.isSafeInteger(nextS) && nextS >= 0 && Number.isSafeInteger(nextE) && nextE > 0
              && (nextS !== epSeason || nextE !== epNumber)) {
              onNavigateEpisodeRef.current({ season: nextS, number: nextE, title: `Episode ${nextE}` });
            }
            break;
          }
          case 'cinesrc:sourceused': {
            pendingAudioRef.current = null;
            clearTimeout(pendingAudioTimerRef.current);
            const hadSource = Boolean(positionRef.current.duration > 0 || durationMismatchRef.current);
            sourceIdRef.current = typeof data.sourceId === 'string' && data.sourceId.length <= 100 ? data.sourceId : null;
            durationMismatchRef.current = false;
            if (positionRef.current.duration > 0) {
              persistPlayback(positionRef.current, true);
              const cur = positionRef.current;
              if (cur.currentTime > 5 && cur.currentTime < cur.duration - 2
                && !(media.item.type === 'movie' && movieDurationMismatch(displayItemRef.current.duration, cur.duration))) {
                resumeTimeRef.current = cur.currentTime;
              }
            }
            if (endedRef.current && media.episode && (controlsRef.current.library.preferences.autoplay ?? preferenceDefaults.autoplay)) {
              unidentifiedEpisodeRef.current = true;
              setEmbedStatus({ message: 'Playback changed without an episode update. Select the episode below to reconnect your progress.', canRetry: true });
            } else {
              waitForCineStream('Connecting to the video source…', hadSource);
            }
            trackingRef.current.sample = null;
            sourceRevisionRef.current += 1;
            segmentDurationRef.current = null;
            setSegments([]);
            autoSkippedRef.current.clear();
            skippedToRef.current = undefined;
            cineDurationRef.current = null;
            lastUpdateRef.current = 0;
            seekStartedRef.current = -Infinity;
            seekTargetRef.current = null;
            relativeJumpRef.current = undefined;
            restoreVolumeRef.current = true;
            setPosition({ currentTime: 0, duration: 0, paused: pausedRef.current });
            break;
          }
          case 'cinesrc:response': {
            if (data.command === 'getPaused' && typeof data.result === 'boolean') {
              if (data.result && !pausedRef.current && positionRef.current.duration > 0) clearTimers();
              pausedRef.current = data.result;
              setPosition(prev => {
                const next = { ...prev, paused: data.result as boolean };
                positionRef.current = next;
                return next;
              });
            }
            if (data.command === 'getDuration') {
              const dur = Number(data.result);
              if (Number.isFinite(dur) && dur > 0 && checkMovieDuration(dur)) cineDurationRef.current = dur;
            }
            if (data.command === 'getCurrentTime') {
              const cur = Number(data.result);
              const jump = relativeJumpRef.current;
              if (jump !== undefined && Number.isFinite(cur) && positionRef.current.duration > 0) {
                relativeJumpRef.current = undefined;
                if (jump) sendCommand('seek', Math.max(0, Math.min(positionRef.current.duration, cur + jump)));
              } else if (performance.now() - lastUpdateRef.current > 2200 && cineDurationRef.current) {
                readCinePosition(cur, cineDurationRef.current, performance.now() - seekStartedRef.current < 1800);
              }
            }
            if (!pendingAudioRef.current && data.command === 'getVolume') {
              const vol = Number(data.result);
              if (Number.isFinite(vol) && vol >= 0 && vol <= 1) {
                setVolume(vol);
                rememberAudioPref(vol, mutedRef.current);
              }
            }
            if (!pendingAudioRef.current && data.command === 'getMuted' && typeof data.result === 'boolean') {
              setMuted(data.result);
              rememberAudioPref(volumeRef.current, data.result);
            }
            if (data.command === 'getPlaybackRate') {
              const rate = Number(data.result);
              if (Number.isFinite(rate) && rate >= 0.25 && rate <= 2) setSpeed(rate);
            }
            break;
          }
          case 'cinesrc:error':
            if (durationMismatchRef.current) break;
            clearTimers();
            setPictureVisible(false);
            if (positionRef.current.duration > 0) persistPlayback(positionRef.current, true);
            trackingRef.current.sample = null;
            pausedRef.current = true;
            setPosition(prev => ({ ...prev, paused: true }));
            setEmbedStatus({ message: 'CineSrc could not play this source. Try another server in the player or retry.', canRetry: true });
            break;
          case 'cinesrc:close':
            if (providerControlsRef.current) navigate(backHrefRef.current);
            break;
        }
      } else if (provider !== 'cinesrc' && event.origin === animePlayers[provider].origin) {
        const msg = event.data as Record<string, unknown> | null;
        const supported = provider === 'anipm'
          ? msg?.ns === 'anipm.player' && msg.v === 1
          : msg?.channel === 'animeembed' && msg.version === 1;
        if (!supported) return;
        const data = (msg?.data as Record<string, unknown>) || {};
        const state = (data.state as Record<string, unknown>) || data;
        const reportedId = state.anilistId ?? msg?.animeId;
        if (animeSourceData && reportedId != null && Number(reportedId) !== animeSourceData.id) return;
        const reportedEp = Number(state.episode ?? msg?.episode);
        if (animeSourceData && Number.isInteger(reportedEp) && reportedEp > 0 && reportedEp !== animeSourceData.episode) {
          if (msg?.event !== 'episodechange' && msg?.event !== 'ready') return;
          const target = reportedEp === animeSourceData.episode + 1 ? adjacentRef.current.next
            : reportedEp === animeSourceData.episode - 1 ? adjacentRef.current.previous : undefined;
          if (target) onNavigateEpisodeRef.current(target);
          else if (provider === 'anipm') sendCommand('loadEpisode', { episode: animeSourceData.episode, start: positionRef.current.currentTime ?? 0 });
          return;
        }
        if (msg?.event === 'error') {
          if (!animeReadyRef.current || (preferDub && !positionRef.current.currentTime)) {
            clearTimers();
            retryAnimeProvider();
            return;
          }
          setEmbedStatus({ message: 'The anime player lost its video source.', canRetry: true });
          return;
        }
        if (['ready', 'autoplayblocked', 'timeupdate', 'progress'].includes(String(msg?.event))) {
          clearTimers();
          animeReadyRef.current = true;
          setEmbedStatus({ message: '', canRetry: false });
        }
        const ct = Number(state.currentTime);
        const dur = Number(state.duration);
        if (Number.isFinite(ct) && Number.isFinite(dur) && dur > 0 && ct >= 0 && ct <= dur + 0.5) {
          const prevDur = positionRef.current.duration || initialProgressRef.current?.duration;
          if (!positionRef.current.duration && prevDur && Math.abs(prevDur - dur) > 2.5) {
            trackingRef.current = viewingSession();
          }
          const isPaused = typeof state.paused === 'boolean'
            ? state.paused
            : (msg?.event === 'pause' || (msg?.event !== 'play' && msg?.event !== 'progress' && pausedRef.current));
          pausedRef.current = isPaused;
          if (!isPaused && endedRef.current && msg?.event === 'play') {
            endedRef.current = false;
            setEnded(false);
            setCountdownCancelled(false);
          }
          const isSeeking = ['seeking', 'seeked'].includes(String(msg?.event));
          handleSample({ currentTime: Math.min(ct, dur), duration: dur, paused: isPaused, seeking: isSeeking }, isSeeking);
          if (msg?.event === 'pause') persistPlayback({ currentTime: Math.min(ct, dur), duration: dur, paused: true }, true);
        }
        if (msg?.event === 'ended') {
          endedRef.current = true;
          pausedRef.current = true;
          setEnded(true);
          if (positionRef.current.duration > 0) {
            checkForCompletion({ currentTime: positionRef.current.duration, duration: positionRef.current.duration }, true);
          }
        }
      }
    };

    window.addEventListener('message', onMessage);
    const poll = provider === 'cinesrc'
      ? window.setInterval(() => {
        if (endedRef.current || performance.now() - lastUpdateRef.current < 2200) return;
        sendCommand('getDuration');
        sendCommand('getPaused');
        sendCommand('getCurrentTime');
      }, 2500)
      : undefined;

    return () => {
      clearTimers();
      clearInterval(poll);
      window.removeEventListener('message', onMessage);
    };
  }, [media.embed, media.item.key, media.item.type, media.episode, epSeason, epNumber, embedSrc, reloadNonce, provider, animeSourceData, preferDub, sendCommand, persistPlayback, handleSample, checkForCompletion, revealControls, rememberAudioPref, setProvider]);

  // Auto-play native video when source loads or switches to direct stream
  const nativeSrc = media.nativeMedia
    ? (direct ? archiveFileUrl(media.nativeMedia) : `/stream/${encodeURIComponent(media.item.key)}${media.episode?.key ? `/${encodeURIComponent(media.episode.key)}` : ''}`)
    : '';

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
      setIsFullscreen(document.fullscreenElement === stageRef.current);
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

  // Close player popup menus on outside click or Escape
  useEffect(() => {
    const menus = () => [audioMenuRef.current, subtitleMenuRef.current, settingsMenuRef.current].filter((m): m is HTMLDetailsElement => Boolean(m));
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
  }, []);

  const closeOtherMenus = (opened: HTMLDetailsElement) => {
    for (const ref of [audioMenuRef, subtitleMenuRef, settingsMenuRef]) {
      if (ref.current && ref.current !== opened && ref.current.open) ref.current.open = false;
    }
    revealControls();
  };

  // Auto-skip segments & auto-next 10s countdown
  const activeSegment = !providerControls ? activeSkipSegment(segments, position) : undefined;
  const skipSegment = useCallback((segment: SkipSegment) => {
    if (segment.kind === 'credits' && adjacentRef.current.next) {
      checkForCompletion(positionRef.current);
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
    const creditsWithNext = activeSegment.kind === 'credits' && (Boolean(adjacent.next) || (Boolean(media.episode) && !adjacent.ready));
    if (!creditsWithNext && pref(activeSegment.kind)) {
      skipSegment(activeSegment);
      if (activeSegment.kind === 'credits') checkForCompletion(positionRef.current);
    }
  }, [activeSegment, position.paused, position.seeking, adjacent.next, adjacent.ready, media.episode, pref, skipSegment, checkForCompletion]);

  const inCredits = activeSegment?.kind === 'credits' && !position.paused && !position.seeking && !unidentifiedEpisodeRef.current;
  useEffect(() => {
    if (!adjacent.next || providerControls || !pref('autoplay') || countdownCancelled || (!ended && !inCredits)) {
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
        if (adjacentRef.current.next) onNavigateEpisodeRef.current(adjacentRef.current.next);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [adjacent.next, providerControls, ended, inCredits, countdownCancelled, pref]);

  // Keyboard shortcuts (Space, Left/Right, F, S)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.target instanceof HTMLElement && event.target.closest('button, a, input, select, summary, iframe, [contenteditable]')) return;
      const key = event.key.toLowerCase();
      if (key === 's' && activeSegment) {
        event.preventDefault();
        skipSegment(activeSegment);
      } else if (key === 'f' && document.fullscreenEnabled) {
        event.preventDefault();
        toggleFullscreen();
      } else if (key === ' ' && positionRef.current.duration > 0) {
        event.preventDefault();
        sendCommand(positionRef.current.paused || endedRef.current ? 'play' : 'pause');
      } else if ((key === 'arrowleft' || key === 'arrowright') && positionRef.current.duration > 0) {
        event.preventDefault();
        jumpPlayback(key === 'arrowleft' ? -10 : 10);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [activeSegment, skipSegment, toggleFullscreen, sendCommand, jumpPlayback]);

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

  const updateAudio = (nextVol: number, nextMuted: boolean) => {
    if (nextVol > 0) lastVolumeRef.current = nextVol;
    setVolume(nextVol);
    setMuted(nextMuted);
    if (media.embed && provider === 'cinesrc') {
      pendingAudioRef.current = { volume: nextVol, muted: nextMuted };
      clearTimeout(pendingAudioTimerRef.current);
      pendingAudioTimerRef.current = window.setTimeout(() => { pendingAudioRef.current = null; }, 600);
    }
    sendCommand('setVolume', nextVol);
    sendCommand('setMuted', nextMuted);
    rememberAudioPref(nextVol, nextMuted);
  };

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

  const loadEmbedSubtitles = useCallback(async (autoSelectLang?: string) => {
    if (subTracksRef.current !== null) {
      if (autoSelectLang) {
        const candidates = subTracksRef.current.filter(t => samePlaybackLanguage(t.language, autoSelectLang));
        for (const candidate of candidates) {
          if (await chooseSubtitleTrack(candidate, false)) return;
        }
        if (subTracksRef.current.length && !candidates.length) {
          setSubStatus(`${autoSelectLang} subtitles are unavailable for this video.`);
        }
      }
      return;
    }
    if (subLoadingRef.current) return;
    subLoadingRef.current = true;
    setSubStatus('Loading subtitle tracks…');
    try {
      const tracks = await findSubtitles(displayItemRef.current, media.episode, AbortSignal.timeout(10_000));
      setSubTracks(tracks);
      subTracksRef.current = tracks;
      const langs = [...new Set(tracks.map(t => t.language))];
      const initial = langs.find(l => samePlaybackLanguage(l, autoSelectLang || preferredSubtitleLang))
        || (langs.includes('English') ? 'English' : langs[0] || '');
      setSubLang(initial);
      setSubStatus(tracks.length ? '' : 'No subtitle tracks available.');
      if (autoSelectLang) {
        const candidates = tracks.filter(t => samePlaybackLanguage(t.language, autoSelectLang));
        for (const candidate of candidates) {
          if (await chooseSubtitleTrack(candidate, false)) return;
        }
        if (tracks.length && !candidates.length) {
          setSubStatus(`${autoSelectLang} subtitles are unavailable for this video.`);
        }
      }
    } catch {
      setSubStatus('Subtitle tracks could not load. Reopen the menu to retry.');
    } finally {
      subLoadingRef.current = false;
    }
  }, [media.episode, preferredSubtitleLang, chooseSubtitleTrack]);

  // Auto-load preferred subtitles on CineSrc and when subtitle preference changes
  const showOverlay = !media.embed || (provider === 'cinesrc' && !providerControls);
  useEffect(() => {
    if (!media.embed || !showOverlay) return;
    if (!preferredSubtitleLang) {
      subDownloadRef.current?.abort();
      setActiveCues(null);
      setSubStatus('');
      return;
    }
    void loadEmbedSubtitles(preferredSubtitleLang);
  }, [media.embed, showOverlay, preferredSubtitleLang, loadEmbedSubtitles]);

  const computeSeekPreview = (time: number) => {
    if (!(position.duration > 0) || !markersRef.current) return;
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
      seconds: prev && prev.side === side ? prev.seconds + Math.abs(delta) : Math.abs(delta),
      nonce: (prev?.nonce ?? 0) + 1,
    }));
    tapSeekTimerRef.current = window.setTimeout(() => setTapSeek(null), 700);
  };

  useEffect(() => () => clearTimeout(tapSeekTimerRef.current), []);

  const handlePictureClick = (event: React.MouseEvent<HTMLDivElement>) => {
    clearTimeout(clickTimerRef.current);
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    if (coarse && showOverlay) {
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
      const side: 'left' | 'center' | 'right' = ratio < 0.35 ? 'left' : ratio > 0.65 ? 'right' : 'center';
      const now = Date.now();
      const previous = lastTapRef.current;
      if (previous && previous.side === side && now - previous.time < 340 && side !== 'center') {
        lastTapRef.current = { time: now, side, count: previous.count + 1 };
        if (positionRef.current.duration > 0 || !media.embed) {
          triggerTapSeek(side, side === 'left' ? -10 : 10);
        }
        return;
      }
      lastTapRef.current = { time: now, side, count: 1 };
      clickTimerRef.current = window.setTimeout(() => {
        if (!controlsActive && !positionRef.current.paused) {
          revealControls();
        } else if (positionRef.current.duration > 0 || endedRef.current || !media.embed) {
          sendCommand(endedRef.current || positionRef.current.paused ? 'play' : 'pause');
        }
      }, 280);
      return;
    }
    if (event.detail !== 1) return;
    clickTimerRef.current = window.setTimeout(() => {
      if (positionRef.current.duration > 0 || endedRef.current || !media.embed) {
        sendCommand(endedRef.current || positionRef.current.paused ? 'play' : 'pause');
      }
    }, 260);
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

  const displayTime = scrubTime !== null ? scrubTime : position.currentTime;
  const activeCaptionText = activeCues
    ? activeCues.cues.filter(c => position.currentTime >= c.start && position.currentTime < c.end).map(c => c.text).join('\n')
    : '';
  const playedPct = position.duration > 0 ? `${(displayTime / position.duration) * 100}%` : '0%';
  const volumePct = `${Math.round(volume * 100)}%`;
  const titleText = displayEpisode?.title || displayItem.title;
  const subTitleText = displayEpisode
    ? `${displayItem.title} · S${displayEpisode.season} E${displayEpisode.number}${displayEpisode.duration ? ` · ${displayEpisode.duration} min` : ''}`
    : displayItem.description;
  const sourcePage = media.nativeMedia?.page || (media.nativeMedia?.archive ? `https://archive.org/details/${encodeURIComponent(media.nativeMedia.archive)}` : '');

  const showCineLoading = media.embed && provider === 'cinesrc' && !providerControls && Boolean(embedStatus.message) && !embedStatus.canRetry;
  const showPictureLayer = !media.embed || (provider === 'cinesrc' && pictureVisible);
  const showEmbedNotice = media.embed && (embedStatus.canRetry || providerControls || animeEligible || provider !== 'cinesrc');

  return <>
    <div
      ref={videoBoxRef}
      className={`af-video-box ${controlsActive ? 'controls-active' : ''} ${position.paused || ended ? 'is-paused' : ''} ${ended ? 'is-ended' : ''} ${hasPlayed ? 'has-played' : ''}`}
      onPointerMove={event => { if (event.pointerType !== 'touch') revealControls(); }}
      onFocus={revealControls}
    >
      {!media.embed && media.nativeMedia && <video
        ref={videoRef}
        src={nativeSrc}
        playsInline
        preload="auto"
        poster={displayItem.backdrop}
        aria-label={titleText}
        onLoadedMetadata={event => {
          const video = event.currentTarget;
          const saved = initialProgressRef.current;
          if (pref('resume') && saved && saved.time > 5 && saved.time < video.duration - 2) video.currentTime = saved.time;
          if (pref('volume')) {
            video.volume = volumeRef.current;
            video.muted = mutedRef.current;
          }
          const track = video.textTracks[0];
          if (track) {
            const want = samePlaybackLanguage(playbackLanguage(track.language) || track.label, preferredSubtitleLang);
            track.mode = want ? 'showing' : 'disabled';
            setNativeCaptionsOn(want);
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
          const ranges = bufferedIntervals(video.buffered, video.duration);
          setBufferedCss(ranges.length ? `linear-gradient(to right, ${ranges.map(([s, e]) => `transparent ${s}%, #ffffff80 ${s}% ${e}%, transparent ${e}%`).join(', ')})` : '');
        }}
        onPlay={() => {
          clearTimeout(bufferingTimerRef.current);
          setBuffering(false);
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
          setHasPlayed(true);
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
          setVideoError(true);
        }}
      >
        {media.nativeMedia.captions && <track kind="captions" label="English (auto-generated)" srcLang="en" src={media.nativeMedia.captions} />}
      </video>}

      {media.embed && embedSrc && <iframe
        key={`${provider}:${providerControls}:${quality}:${dubFallback}:${reloadNonce}`}
        ref={frameRef}
        src={embedSrc}
        title={`${titleText} ${provider === 'cinesrc' ? 'video' : 'anime'} player`}
        allow={provider === 'cinesrc'
          ? 'autoplay; fullscreen; picture-in-picture; encrypted-media'
          : 'autoplay; fullscreen; picture-in-picture; encrypted-media; screen-wake-lock'}
        allowFullScreen
        sandbox={provider === 'cinesrc' ? 'allow-scripts allow-same-origin allow-presentation' : undefined}
        referrerPolicy="strict-origin"
        onLoad={() => {
          if (provider === 'anipm') sendCommand('hello');
        }}
      />}

      {showCineLoading && <div className="af-embed-loading">
        {displayItem.backdrop && <img src={displayItem.backdrop} alt="" />}
        <span role="status">{embedStatus.message}</span>
      </div>}

      {showPictureLayer && <div
        className={`af-video-picture ${media.embed && providerControls ? 'is-embed-passthrough' : ''}`}
        aria-hidden="true"
        onClick={handlePictureClick}
        onDoubleClick={handlePictureDoubleClick}
      />}

      {tapSeek && <div
        key={tapSeek.nonce}
        className={`af-tap-seek af-tap-seek-${tapSeek.side}`}
        aria-hidden="true"
      >
        <span>{tapSeek.side === 'left' ? `« ${tapSeek.seconds}s` : `${tapSeek.seconds}s »`}</span>
      </div>}

      {buffering && <p className="af-video-buffering" role="status">Buffering…</p>}

      {videoError && media.nativeMedia && <div className="af-video-error" role="alert">
        <p>The video could not load.</p>
        <div className="af-actions">
          <button type="button" className="af-button af-secondary" onClick={() => {
            setVideoError(false);
            videoRef.current?.load();
            void videoRef.current?.play().catch(() => {});
          }}>Retry</button>
          {!direct
            ? <button type="button" className="af-button af-primary" onClick={() => { setVideoError(false); setDirect(true); }}>Try direct stream</button>
            : sourcePage && <a className="af-button af-primary" href={sourcePage} target="_blank" rel="noopener noreferrer">Open source</a>}
        </div>
      </div>}

      {showOverlay && <>
        <div className="af-player-pause" aria-hidden="true">
          <div className="af-player-pause-copy">
            <p className="af-player-pause-status">Paused</p>
            <p className="af-player-pause-title">{titleText}</p>
            {subTitleText && <p className="af-player-pause-desc">{subTitleText}</p>}
            {position.duration > 0 && <p className="af-player-remaining">{formatClock(Math.max(0, position.duration - displayTime))} remaining</p>}
          </div>
        </div>

        <div className="af-player-header">
          <div className="af-player-ident">
            <a className="af-player-back" href={backHref}><Icon name="left" /><span>Back to details</span></a>
            <div className="af-player-context" aria-hidden="true">
              <p className="af-player-context-title">{titleText}</p>
              {displayEpisode && subTitleText && <p className="af-player-context-ep">{subTitleText}</p>}
            </div>
          </div>
        </div>

        {media.embed && activeCaptionText && <div className="af-player-caption" aria-hidden="true"><span>{activeCaptionText}</span></div>}

        <div className="af-player-lower">
          {countdown !== null && adjacent.next && <div className="af-next-countdown" role="region" aria-label="Next episode">
            <strong>{adjacent.next.title || `Episode ${adjacent.next.number}`}</strong>
            <p>Next episode in {countdown} seconds</p>
            <div className="af-actions">
              <button type="button" className="af-button af-primary" onClick={() => onNavigateEpisode(adjacent.next!)}>Play now</button>
              <button type="button" className="af-button af-secondary" onClick={() => { setCountdownCancelled(true); setCountdown(null); }}>Cancel</button>
            </div>
          </div>}

          {activeSegment && <button type="button" className="af-player-skip" onClick={() => skipSegment(activeSegment)}>
            Skip {segmentNames[activeSegment.kind].toLowerCase()}
          </button>}

          {!activeSegment && undoSkip && <div className="af-player-undo-skip" role="status">
            <span>Skipped {segmentNames[undoSkip.kind].toLowerCase()}</span>
            <button type="button" className="af-text-link" onClick={revertSkip}>Undo</button>
          </div>}

          <PlayerControls
            media={media}
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
            adjacent={adjacent}
            nativeAudioTracks={nativeAudioTracks}
            activeCues={activeCues}
            nativeCaptionsOn={nativeCaptionsOn}
            subTracks={subTracks}
            subLang={subLang}
            subStatus={subStatus}
            rememberSubtitles={pref('subtitles')}
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
              if (!(position.duration > 0) || pointerScrubbingRef.current || !markersRef.current) return;
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
              closeOtherMenus(target);
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
            onSpeedChange={val => { setSpeed(val); sendCommand('setPlaybackRate', val); }}
            onQualityChange={val => { if (val !== quality) reloadCineWithState(providerControls, val); }}
            onOpenProviderSources={() => {
              if (settingsMenuRef.current) settingsMenuRef.current.open = false;
              reloadCineWithState(true, quality);
            }}
            onToggleFullscreen={toggleFullscreen}
            onNavigateEpisode={onNavigateEpisode}
          />
        </div>
      </>}

      {media.embed && !showOverlay && (activeSegment || undoSkip || countdown !== null) && <div className="af-player-lower af-anime-overlay">
        {countdown !== null && adjacent.next && <div className="af-next-countdown" role="region" aria-label="Next episode">
          <strong>{adjacent.next.title || `Episode ${adjacent.next.number}`}</strong>
          <p>Next episode in {countdown} seconds</p>
          <div className="af-actions">
            <button type="button" className="af-button af-primary" onClick={() => onNavigateEpisode(adjacent.next!)}>Play now</button>
            <button type="button" className="af-button af-secondary" onClick={() => { setCountdownCancelled(true); setCountdown(null); }}>Cancel</button>
          </div>
        </div>}
        {activeSegment && <button type="button" className="af-player-skip" onClick={() => skipSegment(activeSegment)}>
          Skip {segmentNames[activeSegment.kind].toLowerCase()}
        </button>}
        {!activeSegment && undoSkip && <div className="af-player-undo-skip" role="status">
          <span>Skipped {segmentNames[undoSkip.kind].toLowerCase()}</span>
          <button type="button" className="af-text-link" onClick={revertSkip}>Undo</button>
        </div>}
      </div>}
    </div>

    {showEmbedNotice && <EmbedNoticeBar
      provider={provider}
      providerControls={providerControls}
      animeEligible={animeEligible}
      embedStatus={embedStatus}
      onSwitchProvider={next => {
        restoreStateRef.current = null;
        setDubFallback(false);
        setProvider(next);
      }}
      onToggleProviderControls={() => reloadCineWithState(!providerControls, quality)}
      onReload={() => {
        cineSrcServers.delete(media.item.key);
        restoreStateRef.current = null;
        setReloadNonce(n => n + 1);
      }}
    />}
  </>;
}

