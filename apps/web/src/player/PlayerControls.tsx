import { Dialog } from '@base-ui/react/dialog';
import { preferenceDefaults, type PlaybackPosition, type SkipSegment } from '@afterframe/shared/playback';
import type { SubtitleCue, SubtitleTrack } from '@afterframe/shared/subtitles';
import { memo, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import type { EpisodePosition } from '../catalog';
import { Icon } from '../components';
import type { LibraryControls } from '../library';
import { PlayerGlyph } from './PlayerGlyph';
import { formatClock } from './route';
import { SubtitleMenu, type CaptionStyle } from './SubtitleMenu';
import { qualityOptions, speedOptions, type ActiveMedia, type EmnexAvailableTypes, type EmnexServerOption, type VideoWithAudioTracks } from './types';

interface PlayerControlsProps {
  media: ActiveMedia;
  useNativeVideo: boolean;
  isEmnex?: boolean;
  emnexAudio?: 'sub' | 'dub';
  emnexAvailableTypes?: EmnexAvailableTypes | null;
  emnexServer?: string;
  emnexServers?: EmnexServerOption[] | null;
  hlsLevels?: { index: number; label: string }[];
  hlsLevel?: number;
  controls: LibraryControls;
  position: PlaybackPosition;
  displayTime: number;
  playedPct: string;
  bufferedCss: string;
  segments: SkipSegment[];
  seekPreview: { time: number; offset: number; segment?: string } | null;
  ended: boolean;
  volume: number;
  muted: boolean;
  volumePct: string;
  lastVolume: number;
  speed: number;
  quality: string;
  isFullscreen: boolean;
  useMobileSheets?: boolean;
  theatreMode?: boolean;
  hasEpisodesDrawer?: boolean;
  episodesOpen?: boolean;
  adjacent: { previous?: EpisodePosition & { key?: string }; next?: EpisodePosition & { key?: string }; ready: boolean };
  nativeAudioTracks: { index: number; label: string; language: string; enabled: boolean }[];
  activeCues: { url: string; cues: SubtitleCue[] } | null;
  nativeCaptionsOn: boolean;
  subTracks: SubtitleTrack[] | null;
  subLang: string;
  subStatus: string;
  rememberSubtitles: boolean;
  preferredSubtitleLang?: string;
  captionStyle: CaptionStyle;
  controlsBarRef: RefObject<HTMLFieldSetElement | null>;
  markersRef: RefObject<HTMLDivElement | null>;
  audioMenuRef: RefObject<HTMLDetailsElement | null>;
  subtitleMenuRef: RefObject<HTMLDetailsElement | null>;
  settingsMenuRef: RefObject<HTMLDetailsElement | null>;
  videoRef: RefObject<VideoWithAudioTracks | null>;
  onControlsHoverChange: (hovered: boolean) => void;
  onRevealControls: () => void;
  onScrubStart: () => void;
  onSeekChange: (nextVal: number) => void;
  onSeekHover: (clientX: number) => void;
  onSeekPreviewClear: () => void;
  onSendCommand: (command: string, value?: unknown) => void;
  onJumpPlayback: (delta: number) => void;
  onUpdateAudio: (level: number, isMuted: boolean) => void;
  onCloseOtherMenus: (target: HTMLDetailsElement) => void;
  onOpenSubtitles: (target?: HTMLDetailsElement) => void;
  onTurnOffSubtitles: () => void;
  onEnableNativeSubtitles: () => void;
  onSelectSubLang: (lang: string) => void;
  onChooseSubTrack: (track: SubtitleTrack) => void;
  onChangeCaptionStyle: (next: CaptionStyle) => void;
  onSpeedChange: (val: number) => void;
  onQualityChange: (val: string) => void;
  onEmnexAudioChange?: (audio: 'sub' | 'dub') => void;
  onEmnexServerChange?: (server: string) => void;
  onHlsLevelChange?: (level: number) => void;
  onOpenSettings?: () => void;
  onOpenProviderSources: () => void;
  onTogglePip?: () => void;
  onToggleTheatre?: () => void;
  onToggleEpisodes?: () => void;
  onToggleFullscreen: () => void;
  onNavigateEpisode: (target: EpisodePosition & { key?: string }) => void;
}

function playButtonMeta(ended: boolean, paused?: boolean) {
  if (ended) {
    return { label: 'Replay', title: 'Replay (Space)', icon: <PlayerGlyph name="replay" /> };
  }
  if (paused) {
    return { label: 'Play', title: 'Play (Space)', icon: <Icon name="play" /> };
  }
  return { label: 'Pause', title: 'Pause (Space)', icon: <PlayerGlyph name="pause" /> };
}

function seekKeyTarget(key: string, duration: number, displayTime: number): number | null {
  if (duration <= 0) return null;
  if (key === 'PageUp') return Math.min(duration, displayTime + 30);
  if (key === 'PageDown') return Math.max(0, displayTime - 30);
  if (key === 'Home') return 0;
  if (key === 'End') return duration;
  return null;
}

function collectEmnexServerChoices(
  isEmnex: boolean | undefined,
  emnexServer: string | undefined,
  emnexServers: EmnexServerOption[] | null | undefined,
  emnexAudio: 'sub' | 'dub' | undefined,
): string[] {
  if (!isEmnex) return [];
  const choices = new Set<string>();
  if (emnexServer) choices.add(emnexServer);
  for (const entry of emnexServers ?? []) {
    if (entry.type === emnexAudio) choices.add(entry.provider);
  }
  return [...choices];
}

function applyNativeAudioTrack(
  videoRef: RefObject<VideoWithAudioTracks | null>,
  nativeAudioTracks: { index: number; label: string; language: string; enabled: boolean }[],
  controls: LibraryControls,
  idx: number,
) {
  const list = videoRef.current?.audioTracks;
  if (!list) return;
  for (let i = 0; i < list.length; i++) list[i].enabled = i === idx;
  const chosen = nativeAudioTracks[idx];
  if (chosen?.language && chosen.language.length <= 60) {
    void controls.setPreference('audioLanguage', chosen.language, 'Preferred audio');
  }
}

function EmnexSettingsSection({
  emnexAudio,
  emnexAvailableTypes,
  emnexServer,
  emnexServerChoices,
  hlsLevels,
  hlsLevel,
  onEmnexAudioChange,
  onEmnexServerChange,
  onHlsLevelChange,
}: Readonly<{
  emnexAudio?: 'sub' | 'dub';
  emnexAvailableTypes?: EmnexAvailableTypes | null;
  emnexServer?: string;
  emnexServerChoices: string[];
  hlsLevels?: { index: number; label: string }[];
  hlsLevel?: number;
  onEmnexAudioChange?: (audio: 'sub' | 'dub') => void;
  onEmnexServerChange?: (server: string) => void;
  onHlsLevelChange?: (level: number) => void;
}>) {
  const subUnavailable = Boolean(emnexAvailableTypes && !emnexAvailableTypes.sub);
  const dubUnavailable = Boolean(emnexAvailableTypes && !emnexAvailableTypes.dub);

  return <>
    {onEmnexAudioChange && <div>
      <p className="af-meta">Audio</p>
      <fieldset className="af-player-choice-group" aria-label="Anime audio">
        <button
          type="button"
          aria-pressed={emnexAudio === 'sub'}
          disabled={subUnavailable}
          title={subUnavailable ? 'Sub unavailable for this episode' : undefined}
          onClick={() => onEmnexAudioChange('sub')}
        >
          {subUnavailable ? 'Sub (N/A)' : 'Sub'}
        </button>
        <button
          type="button"
          aria-pressed={emnexAudio === 'dub'}
          disabled={dubUnavailable}
          title={dubUnavailable ? 'Dub unavailable for this episode' : undefined}
          onClick={() => onEmnexAudioChange('dub')}
        >
          {dubUnavailable ? 'Dub (N/A)' : 'Dub'}
        </button>
      </fieldset>
    </div>}
    {onEmnexServerChange && emnexServerChoices.length > 0 && <div>
      <p className="af-meta">Server</p>
      <fieldset className="af-player-choice-group" aria-label="Anime server">
        {emnexServerChoices.map(srv => (
          <button key={srv} type="button" aria-pressed={emnexServer === srv} onClick={() => onEmnexServerChange(srv)}>{srv}</button>
        ))}
      </fieldset>
    </div>}
    {onHlsLevelChange && hlsLevels && hlsLevels.length > 1 && <div>
      <p className="af-meta">Quality</p>
      <fieldset className="af-player-choice-group" aria-label="Video quality">
        <button type="button" aria-pressed={hlsLevel === -1} onClick={() => onHlsLevelChange(-1)}>Auto</button>
        {hlsLevels.map(lvl => (
          <button key={lvl.index} type="button" aria-pressed={hlsLevel === lvl.index} onClick={() => onHlsLevelChange(lvl.index)}>{lvl.label}</button>
        ))}
      </fieldset>
    </div>}
  </>;
}

function PlayerSettingsBody({
  media,
  isEmnex,
  isCineSrc,
  emnexAudio,
  emnexAvailableTypes,
  emnexServer,
  emnexServerChoices,
  hlsLevels,
  hlsLevel,
  speed,
  quality,
  controls,
  nativeAudioTracks,
  videoRef,
  onSpeedChange,
  onQualityChange,
  onEmnexAudioChange,
  onEmnexServerChange,
  onHlsLevelChange,
  onOpenProviderSources,
}: Readonly<{
  media: ActiveMedia;
  isEmnex?: boolean;
  isCineSrc: boolean;
  emnexAudio?: 'sub' | 'dub';
  emnexAvailableTypes?: EmnexAvailableTypes | null;
  emnexServer?: string;
  emnexServerChoices: string[];
  hlsLevels?: { index: number; label: string }[];
  hlsLevel?: number;
  speed: number;
  quality: string;
  controls: LibraryControls;
  nativeAudioTracks: { index: number; label: string; language: string; enabled: boolean }[];
  videoRef: RefObject<VideoWithAudioTracks | null>;
  onSpeedChange: (val: number) => void;
  onQualityChange: (val: string) => void;
  onEmnexAudioChange?: (audio: 'sub' | 'dub') => void;
  onEmnexServerChange?: (server: string) => void;
  onHlsLevelChange?: (level: number) => void;
  onOpenProviderSources: () => void;
}>) {
  const prefs = controls.library.preferences;
  const skipIntro = prefs.intro ?? preferenceDefaults.intro;
  const skipRecap = prefs.recap ?? preferenceDefaults.recap;
  const skipCredits = prefs.credits ?? preferenceDefaults.credits;

  return <>
    <div>
      <p className="af-meta">Speed</p>
      <fieldset className="af-player-choice-group" aria-label="Speed">
        {speedOptions.map(val => <button key={val} type="button" aria-pressed={speed === val} onClick={() => onSpeedChange(val)}>{`${val}×`}</button>)}
      </fieldset>
    </div>
    {isEmnex && <EmnexSettingsSection
      emnexAudio={emnexAudio}
      emnexAvailableTypes={emnexAvailableTypes}
      emnexServer={emnexServer}
      emnexServerChoices={emnexServerChoices}
      hlsLevels={hlsLevels}
      hlsLevel={hlsLevel}
      onEmnexAudioChange={onEmnexAudioChange}
      onEmnexServerChange={onEmnexServerChange}
      onHlsLevelChange={onHlsLevelChange}
    />}
    {isCineSrc && <div>
      <p className="af-meta">Preferred quality</p>
      <fieldset className="af-player-choice-group" aria-label="Preferred quality">
        {qualityOptions.map(([val, lbl]) => <button key={val} type="button" aria-pressed={quality === val} onClick={() => onQualityChange(val)}>{lbl}</button>)}
      </fieldset>
    </div>}
    <div>
      <p className="af-meta">Auto-skip</p>
      <fieldset className="af-player-choice-group" aria-label="Auto-skip segments">
        <button type="button" aria-pressed={skipIntro} disabled={!controls.ready}
          onClick={() => void controls.setPreference('intro', !skipIntro, 'Automatically skip intros')}>Intro</button>
        <button type="button" aria-pressed={skipRecap} disabled={!controls.ready}
          onClick={() => void controls.setPreference('recap', !skipRecap, 'Automatically skip recaps')}>Recap</button>
        <button type="button" aria-pressed={skipCredits} disabled={!controls.ready}
          onClick={() => void controls.setPreference('credits', !skipCredits, 'Automatically skip credits')}>Credits</button>
      </fieldset>
    </div>
    {!media.embed && nativeAudioTracks.length > 1 && <label className="af-player-language">
      <span>Audio track</span>
      <select
        className="af-player-select"
        value={nativeAudioTracks.find(t => t.enabled)?.index ?? 0}
        onChange={event => applyNativeAudioTrack(videoRef, nativeAudioTracks, controls, Number(event.target.value))}
      >
        {nativeAudioTracks.map(t => <option key={t.index} value={t.index}>{t.label}</option>)}
      </select>
    </label>}
    {isCineSrc && <button type="button" className="af-player-provider-toggle" onClick={onOpenProviderSources}>
      <span>Provider video sources</span><Icon name="right" />
    </button>}
  </>;
}

function TimelineMarkers({
  duration,
  segments,
  markersRef,
}: Readonly<{
  duration: number;
  segments: SkipSegment[];
  markersRef: RefObject<HTMLDivElement | null>;
}>) {
  const visible = duration > 0 ? segments.filter(s => s.end <= duration) : [];
  return (
    <div ref={markersRef} className="af-player-markers" aria-hidden="true">
      {visible.map(s => (
        <span key={`${s.kind}-${s.start}`} className="af-player-marker" data-kind={s.kind}
          style={{ left: `${(s.start / duration) * 100}%`, width: `${((s.end - s.start) / duration) * 100}%` }} />
      ))}
    </div>
  );
}

function PlayerTimeline({
  position,
  displayTime,
  playedPct,
  bufferedCss,
  segments,
  seekPreview,
  useNativeVideo,
  markersRef,
  onScrubStart,
  onRevealControls,
  onSeekChange,
  onSeekHover,
  onSeekPreviewClear,
}: Readonly<{
  position: PlaybackPosition;
  displayTime: number;
  playedPct: string;
  bufferedCss: string;
  segments: SkipSegment[];
  seekPreview: { time: number; offset: number; segment?: string } | null;
  useNativeVideo: boolean;
  markersRef: RefObject<HTMLDivElement | null>;
  onScrubStart: () => void;
  onRevealControls: () => void;
  onSeekChange: (nextVal: number) => void;
  onSeekHover: (clientX: number) => void;
  onSeekPreviewClear: () => void;
}>) {
  const bufferNoticeId = useId();
  const seekHoverRafRef = useRef(0);
  const seekHoverClientXRef = useRef(0);
  const bufferNotice = useNativeVideo ? undefined : 'This video source does not report buffered ranges';
  const valueText = position.duration > 0
    ? `${formatClock(displayTime)} of ${formatClock(position.duration)}`
    : formatClock(displayTime);
  const seekStyle = { '--played': playedPct, '--buffered-track': bufferedCss || 'none' } as CSSProperties;

  const handleSeekKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    const target = seekKeyTarget(event.key, position.duration, displayTime);
    if (target === null) return;
    event.preventDefault();
    onSeekChange(target);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (event.pointerType === 'touch') return;
    seekHoverClientXRef.current = event.clientX;
    if (seekHoverRafRef.current) return;
    seekHoverRafRef.current = requestAnimationFrame(() => {
      seekHoverRafRef.current = 0;
      onSeekHover(seekHoverClientXRef.current);
    });
  };

  const handlePointerLeave = () => {
    cancelAnimationFrame(seekHoverRafRef.current);
    seekHoverRafRef.current = 0;
    onSeekPreviewClear();
  };

  return <div className="af-player-timeline">
    <TimelineMarkers duration={position.duration} segments={segments} markersRef={markersRef} />
    {seekPreview && <output
      className="af-player-seek-preview"
      aria-hidden="true"
      style={{ '--preview-position': `${seekPreview.offset}px` } as CSSProperties}
    >
      <span>{formatClock(seekPreview.time)}</span>
      {seekPreview.segment && <span className="af-player-preview-segment">{seekPreview.segment}</span>}
    </output>}
    {bufferNotice && <span id={bufferNoticeId} className="sr-only">{bufferNotice}</span>}
    <input
      className={`af-player-seek ${bufferedCss ? 'has-buffer-data' : ''}`}
      type="range"
      min={0}
      max={position.duration || 1}
      step={5}
      value={displayTime}
      disabled={position.duration <= 0}
      aria-label="Seek"
      title={bufferNotice}
      aria-describedby={bufferNotice ? bufferNoticeId : undefined}
      aria-valuetext={valueText}
      style={seekStyle}
      onPointerDown={() => { onScrubStart(); onRevealControls(); }}
      onChange={event => onSeekChange(Number(event.currentTarget.value))}
      onKeyDown={handleSeekKeyDown}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onBlur={onSeekPreviewClear}
    />
  </div>;
}

function PlayerVolumeControls({
  volume,
  muted,
  volumePct,
  lastVolume,
  useMobileSheets,
  audioMenuRef,
  onUpdateAudio,
  onCloseOtherMenus,
}: Readonly<{
  volume: number;
  muted: boolean;
  volumePct: string;
  lastVolume: number;
  useMobileSheets?: boolean;
  audioMenuRef: RefObject<HTMLDetailsElement | null>;
  onUpdateAudio: (level: number, isMuted: boolean) => void;
  onCloseOtherMenus: (target: HTMLDetailsElement) => void;
}>) {
  const [audioSheetOpen, setAudioSheetOpen] = useState(false);
  const isMuted = muted || volume === 0;
  const fillPct = muted ? '0%' : volumePct;
  const sliderValue = muted ? 0 : volume;
  const glyphName = isMuted ? 'muted' : 'speaker';
  const muteLabel = isMuted ? 'Unmute' : 'Mute';
  const muteTitle = isMuted ? 'Unmute (M)' : `Mute · ${volumePct} (M)`;
  const valueText = isMuted ? 'Muted' : volumePct;
  const mobileLabel = isMuted ? 'Audio controls (muted)' : 'Audio controls';
  const fillStyle = { '--volume-fill': fillPct } as CSSProperties;
  const toggleMute = () => onUpdateAudio(volume || lastVolume, !muted && volume > 0);
  const handleVolumeInput = (value: number) => onUpdateAudio(value, value === 0);

  const audioBody = <>
    <label className="af-player-popup-head" htmlFor="af-player-volume">
      <span>Volume</span><span className="af-player-volume-level">{fillPct}</span>
    </label>
    <input
      id="af-player-volume"
      className="af-player-volume"
      type="range"
      min={0}
      max={1}
      step={0.05}
      value={sliderValue}
      aria-valuetext={valueText}
      style={fillStyle}
      onChange={event => handleVolumeInput(Number(event.currentTarget.value))}
    />
    <button type="button" className="af-player-popup-action" onClick={toggleMute}>
      {muteLabel}
    </button>
  </>;

  return <>
    <fieldset className="af-player-inline-volume" aria-label="Volume controls">
      <button
        type="button"
        className="af-player-btn af-player-utility"
        aria-label={muteLabel}
        title={muteTitle}
        onClick={toggleMute}
      >
        <PlayerGlyph name={glyphName} />
      </button>
      <div className="af-inline-volume-slider">
        <input
          className="af-player-volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={sliderValue}
          aria-label="Volume"
          aria-valuetext={valueText}
          style={fillStyle}
          onChange={event => handleVolumeInput(Number(event.currentTarget.value))}
        />
      </div>
    </fieldset>

    {useMobileSheets ? <>
      <button
        type="button"
        className="af-player-btn af-player-utility af-player-audio-mobile-btn"
        aria-label={mobileLabel}
        onClick={() => setAudioSheetOpen(true)}
      >
        <PlayerGlyph name={glyphName} />
      </button>
      <Dialog.Root open={audioSheetOpen} onOpenChange={setAudioSheetOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="af-scrim af-sheet-scrim" />
          <Dialog.Popup className="af-mobile-sheet af-player-sheet">
            <div className="af-sheet-handle" aria-hidden="true" />
            <header className="af-sheet-head">
              <Dialog.Title>Audio</Dialog.Title>
              <Dialog.Close className="af-icon-button" aria-label="Close audio"><Icon name="close" /></Dialog.Close>
            </header>
            <div className="af-sheet-body">{audioBody}</div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </> : (
      <details ref={audioMenuRef} className="af-player-menu af-player-audio-mobile" onToggle={event => { if (event.currentTarget.open) onCloseOtherMenus(event.currentTarget); }}>
        <summary className="af-player-btn af-player-utility" aria-label={mobileLabel} title={mobileLabel}>
          <PlayerGlyph name={glyphName} />
        </summary>
        <div className="af-player-popup af-player-audio-panel">{audioBody}</div>
      </details>
    )}
  </>;
}

function PlayerSettingsMenu({
  useMobileSheets,
  speed,
  settingsMenuRef,
  settingsSheetOpen,
  onSettingsSheetOpenChange,
  onOpenSettings,
  onCloseOtherMenus,
  children,
}: Readonly<{
  useMobileSheets?: boolean;
  speed: number;
  settingsMenuRef: RefObject<HTMLDetailsElement | null>;
  settingsSheetOpen: boolean;
  onSettingsSheetOpenChange: (open: boolean) => void;
  onOpenSettings?: () => void;
  onCloseOtherMenus: (target: HTMLDetailsElement) => void;
  children: ReactNode;
}>) {
  if (useMobileSheets) {
    return <>
      <button
        type="button"
        className="af-player-btn af-player-utility af-player-tune-btn"
        aria-label="Playback settings"
        title="Playback settings"
        onClick={() => { onSettingsSheetOpenChange(true); onOpenSettings?.(); }}
      >
        <PlayerGlyph name="tune" />
        {speed !== 1 && <span className="af-speed-badge af-tabular">{speed}×</span>}
      </button>
      <Dialog.Root open={settingsSheetOpen} onOpenChange={onSettingsSheetOpenChange}>
        <Dialog.Portal>
          <Dialog.Backdrop className="af-scrim af-sheet-scrim" />
          <Dialog.Popup className="af-mobile-sheet af-player-sheet">
            <div className="af-sheet-handle" aria-hidden="true" />
            <header className="af-sheet-head">
              <Dialog.Title>Playback settings</Dialog.Title>
              <Dialog.Close className="af-icon-button" aria-label="Close playback settings"><Icon name="close" /></Dialog.Close>
            </header>
            <div className="af-sheet-body">{children}</div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>;
  }

  return (
    <details ref={settingsMenuRef} className="af-player-menu" onToggle={event => { if (event.currentTarget.open) { onCloseOtherMenus(event.currentTarget); onOpenSettings?.(); } }}>
      <summary className="af-player-btn af-player-utility af-player-tune-btn" aria-label="Playback settings" title="Playback settings">
        <PlayerGlyph name="tune" />
        {speed !== 1 && <span className="af-speed-badge af-tabular">{speed}×</span>}
      </summary>
      <div className="af-player-popup">
        <p className="af-player-popup-head">Playback</p>
        {children}
      </div>
    </details>
  );
}

function PlayerViewActions({
  hasEpisodesDrawer,
  episodesOpen,
  pipSupported,
  isFullscreen,
  theatreMode,
  canFullscreen,
  onToggleEpisodes,
  onTogglePip,
  onToggleTheatre,
  onToggleFullscreen,
}: Readonly<{
  hasEpisodesDrawer?: boolean;
  episodesOpen?: boolean;
  pipSupported: boolean;
  isFullscreen: boolean;
  theatreMode?: boolean;
  canFullscreen: boolean;
  onToggleEpisodes?: () => void;
  onTogglePip?: () => void;
  onToggleTheatre?: () => void;
  onToggleFullscreen: () => void;
}>) {
  const theatreLabel = theatreMode ? 'Exit theatre mode' : 'Theatre mode';
  const fullscreenLabel = isFullscreen ? 'Exit fullscreen' : 'Fullscreen';

  return <>
    {hasEpisodesDrawer && onToggleEpisodes && (
      <button type="button" className="af-player-btn af-player-utility af-desktop-utility" aria-label="Episodes" aria-pressed={episodesOpen} title="Episodes (E)" onClick={onToggleEpisodes}>
        <PlayerGlyph name="episodes" />
      </button>
    )}

    {pipSupported && onTogglePip && (
      <button type="button" className="af-player-btn af-player-utility af-desktop-utility" aria-label="Picture in picture" title="Picture in picture" onClick={onTogglePip}>
        <PlayerGlyph name="pip" />
      </button>
    )}

    {onToggleTheatre && !isFullscreen && (
      <button type="button" className="af-player-btn af-player-utility af-desktop-utility" aria-label={theatreLabel} aria-pressed={theatreMode} title={`${theatreLabel} (T)`} onClick={onToggleTheatre}>
        <PlayerGlyph name="theatre" />
      </button>
    )}

    {canFullscreen && <button type="button" className="af-player-btn" aria-label={fullscreenLabel} title={`${fullscreenLabel} (F)`} onClick={onToggleFullscreen}>
      <PlayerGlyph name={isFullscreen ? 'exitFull' : 'full'} />
    </button>}
  </>;
}

export const PlayerControls = memo(function PlayerControls(props: Readonly<PlayerControlsProps>) {
  const {
    media, useNativeVideo, isEmnex, emnexAudio, emnexAvailableTypes, emnexServer, emnexServers,
    hlsLevels, hlsLevel, controls, position, displayTime, playedPct, bufferedCss, segments, seekPreview,
    ended, volume, muted, volumePct, lastVolume, speed, quality, isFullscreen, useMobileSheets,
    theatreMode, hasEpisodesDrawer, episodesOpen, adjacent, nativeAudioTracks, activeCues,
    nativeCaptionsOn, subTracks, subLang, subStatus, rememberSubtitles, preferredSubtitleLang,
    captionStyle, controlsBarRef, markersRef, audioMenuRef, subtitleMenuRef, settingsMenuRef, videoRef,
    onControlsHoverChange, onRevealControls, onScrubStart, onSeekChange, onSeekHover, onSeekPreviewClear,
    onSendCommand, onJumpPlayback, onUpdateAudio, onCloseOtherMenus, onOpenSubtitles, onTurnOffSubtitles,
    onEnableNativeSubtitles, onSelectSubLang, onChooseSubTrack, onChangeCaptionStyle, onSpeedChange,
    onQualityChange, onEmnexAudioChange, onEmnexServerChange, onHlsLevelChange, onOpenSettings,
    onOpenProviderSources, onTogglePip, onToggleTheatre, onToggleEpisodes, onToggleFullscreen, onNavigateEpisode,
  } = props;

  const [settingsSheetOpen, setSettingsSheetOpen] = useState(false);

  const pipSupported = useNativeVideo && typeof document !== 'undefined' && Boolean(document.pictureInPictureEnabled);
  const isCineSrc = Boolean(media.embed && !isEmnex);
  const emnexServerChoices = collectEmnexServerChoices(isEmnex, emnexServer, emnexServers, emnexAudio);
  const playMeta = playButtonMeta(ended, position.paused);
  const noDuration = position.duration <= 0;

  const handleControlsPointer = (pointerType: string, hovered: boolean) => {
    if (pointerType === 'touch') return;
    onControlsHoverChange(hovered);
    onRevealControls();
  };

  return <fieldset
    ref={controlsBarRef}
    className="af-player-controls"
    aria-label="Playback controls"
    onPointerEnter={event => handleControlsPointer(event.pointerType, true)}
    onPointerLeave={event => handleControlsPointer(event.pointerType, false)}
    onBlur={onRevealControls}
  >
    <PlayerTimeline
      position={position}
      displayTime={displayTime}
      playedPct={playedPct}
      bufferedCss={bufferedCss}
      segments={segments}
      seekPreview={seekPreview}
      useNativeVideo={useNativeVideo}
      markersRef={markersRef}
      onScrubStart={onScrubStart}
      onRevealControls={onRevealControls}
      onSeekChange={onSeekChange}
      onSeekHover={onSeekHover}
      onSeekPreviewClear={onSeekPreviewClear}
    />

    <div className="af-player-transport">
      <div className="af-player-playback">
        {adjacent.previous && <button type="button" className="af-player-btn af-desktop-transport" aria-label="Previous episode" title="Previous episode (Shift+P)" onClick={() => onNavigateEpisode(adjacent.previous!)}><PlayerGlyph name="prev" /></button>}
        <button type="button" className="af-player-btn af-player-play-btn af-desktop-transport"
          aria-label={playMeta.label}
          title={playMeta.title}
          onClick={() => onSendCommand(ended || position.paused ? 'play' : 'pause')}>
          {playMeta.icon}
        </button>
        {adjacent.next && <button type="button" className="af-player-btn af-desktop-transport" aria-label="Next episode" title="Next episode (Shift+N)" onClick={() => onNavigateEpisode(adjacent.next!)}><PlayerGlyph name="next" /></button>}
      </div>

      <div className="af-player-jump af-desktop-transport">
        <button type="button" className="af-player-btn" aria-label="Back 10 seconds" title="Back 10 seconds (← / J)" disabled={noDuration}
          onClick={() => onJumpPlayback(-10)}><PlayerGlyph name="back10" /></button>
        <button type="button" className="af-player-btn" aria-label="Forward 10 seconds" title="Forward 10 seconds (→ / L)" disabled={noDuration}
          onClick={() => onJumpPlayback(10)}><PlayerGlyph name="fwd10" /></button>
      </div>

      <span className="af-player-time" aria-hidden="true">
        <span className="af-player-elapsed">{formatClock(displayTime)}</span>
        {position.duration > 0 && <span className="af-player-duration"> / {formatClock(position.duration)}</span>}
      </span>

      <div className="af-player-utilities">
        <PlayerVolumeControls
          volume={volume}
          muted={muted}
          volumePct={volumePct}
          lastVolume={lastVolume}
          useMobileSheets={useMobileSheets}
          audioMenuRef={audioMenuRef}
          onUpdateAudio={onUpdateAudio}
          onCloseOtherMenus={onCloseOtherMenus}
        />

        {(media.embed || media.nativeMedia?.captions) && <SubtitleMenu
          menuRef={subtitleMenuRef}
          videoRef={videoRef}
          isEmbed={media.embed}
          useMobileSheets={useMobileSheets}
          activeCues={activeCues}
          nativeCaptionsOn={nativeCaptionsOn}
          subTracks={subTracks}
          subLang={subLang}
          subStatus={subStatus}
          rememberSubtitles={rememberSubtitles}
          preferredLanguage={preferredSubtitleLang}
          captionStyle={captionStyle}
          controls={controls}
          onOpen={onOpenSubtitles}
          onTurnOff={onTurnOffSubtitles}
          onEnableNative={onEnableNativeSubtitles}
          onSelectLanguage={onSelectSubLang}
          onChooseTrack={onChooseSubTrack}
          onChangeCaptionStyle={onChangeCaptionStyle}
        />}

        <PlayerSettingsMenu
          useMobileSheets={useMobileSheets}
          speed={speed}
          settingsMenuRef={settingsMenuRef}
          settingsSheetOpen={settingsSheetOpen}
          onSettingsSheetOpenChange={setSettingsSheetOpen}
          onOpenSettings={onOpenSettings}
          onCloseOtherMenus={onCloseOtherMenus}
        >
          <PlayerSettingsBody
            media={media}
            isEmnex={isEmnex}
            isCineSrc={isCineSrc}
            emnexAudio={emnexAudio}
            emnexAvailableTypes={emnexAvailableTypes}
            emnexServer={emnexServer}
            emnexServerChoices={emnexServerChoices}
            hlsLevels={hlsLevels}
            hlsLevel={hlsLevel}
            speed={speed}
            quality={quality}
            controls={controls}
            nativeAudioTracks={nativeAudioTracks}
            videoRef={videoRef}
            onSpeedChange={onSpeedChange}
            onQualityChange={onQualityChange}
            onEmnexAudioChange={onEmnexAudioChange}
            onEmnexServerChange={onEmnexServerChange}
            onHlsLevelChange={onHlsLevelChange}
            onOpenProviderSources={() => { setSettingsSheetOpen(false); onOpenProviderSources(); }}
          />
        </PlayerSettingsMenu>

        <PlayerViewActions
          hasEpisodesDrawer={hasEpisodesDrawer}
          episodesOpen={episodesOpen}
          pipSupported={pipSupported}
          isFullscreen={isFullscreen}
          theatreMode={theatreMode}
          canFullscreen={document.fullscreenEnabled || !media.embed}
          onToggleEpisodes={onToggleEpisodes}
          onTogglePip={onTogglePip}
          onToggleTheatre={onToggleTheatre}
          onToggleFullscreen={onToggleFullscreen}
        />
      </div>
    </div>
  </fieldset>;
});
