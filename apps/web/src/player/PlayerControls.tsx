import type { PlaybackPosition, SkipSegment } from '@afterframe/shared/playback';
import type { SubtitleCue, SubtitleTrack } from '@afterframe/shared/subtitles';
import type { CSSProperties, RefObject } from 'react';
import type { EpisodePosition } from '../catalog';
import { Icon } from '../components';
import type { LibraryControls } from '../library';
import { PlayerGlyph } from './PlayerGlyph';
import { formatClock } from './route';
import { SubtitleMenu } from './SubtitleMenu';
import { qualityOptions, speedOptions, type ActiveMedia, type VideoWithAudioTracks } from './types';

export function PlayerControls({
  media,
  controls,
  position,
  displayTime,
  playedPct,
  bufferedCss,
  segments,
  seekPreview,
  ended,
  volume,
  muted,
  volumePct,
  lastVolume,
  speed,
  quality,
  isFullscreen,
  adjacent,
  nativeAudioTracks,
  activeCues,
  nativeCaptionsOn,
  subTracks,
  subLang,
  subStatus,
  rememberSubtitles,
  controlsBarRef,
  markersRef,
  audioMenuRef,
  subtitleMenuRef,
  settingsMenuRef,
  videoRef,
  onControlsHoverChange,
  onRevealControls,
  onScrubStart,
  onSeekChange,
  onSeekHover,
  onSeekPreviewClear,
  onSendCommand,
  onJumpPlayback,
  onUpdateAudio,
  onCloseOtherMenus,
  onOpenSubtitles,
  onTurnOffSubtitles,
  onEnableNativeSubtitles,
  onSelectSubLang,
  onChooseSubTrack,
  onSpeedChange,
  onQualityChange,
  onOpenProviderSources,
  onToggleFullscreen,
  onNavigateEpisode,
}: {
  media: ActiveMedia;
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
  adjacent: { previous?: EpisodePosition & { key?: string }; next?: EpisodePosition & { key?: string }; ready: boolean };
  nativeAudioTracks: { index: number; label: string; language: string; enabled: boolean }[];
  activeCues: { url: string; cues: SubtitleCue[] } | null;
  nativeCaptionsOn: boolean;
  subTracks: SubtitleTrack[] | null;
  subLang: string;
  subStatus: string;
  rememberSubtitles: boolean;
  controlsBarRef: RefObject<HTMLDivElement | null>;
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
  onOpenSubtitles: (target: HTMLDetailsElement) => void;
  onTurnOffSubtitles: () => void;
  onEnableNativeSubtitles: () => void;
  onSelectSubLang: (lang: string) => void;
  onChooseSubTrack: (track: SubtitleTrack) => void;
  onSpeedChange: (val: number) => void;
  onQualityChange: (val: string) => void;
  onOpenProviderSources: () => void;
  onToggleFullscreen: () => void;
  onNavigateEpisode: (target: EpisodePosition & { key?: string }) => void;
}) {
  return <div
    ref={controlsBarRef}
    className="af-player-controls"
    role="group"
    aria-label="Playback controls"
    onPointerEnter={event => { if (event.pointerType !== 'touch') { onControlsHoverChange(true); onRevealControls(); } }}
    onPointerLeave={event => { if (event.pointerType !== 'touch') { onControlsHoverChange(false); onRevealControls(); } }}
    onBlur={onRevealControls}
  >
    <div className="af-player-timeline">
      <div ref={markersRef} className="af-player-markers" aria-hidden="true">
        {position.duration > 0 && segments.filter(s => s.end <= position.duration).map(s => (
          <span key={`${s.kind}-${s.start}`} className="af-player-marker"
            style={{ left: `${(s.start / position.duration) * 100}%`, width: `${((s.end - s.start) / position.duration) * 100}%` }} />
        ))}
      </div>
      {seekPreview && <output
        className="af-player-seek-preview"
        aria-hidden="true"
        style={{ '--preview-position': `${seekPreview.offset}px` } as CSSProperties}
      >
        <span>{formatClock(seekPreview.time)}</span>
        {seekPreview.segment && <span className="af-player-preview-segment">{seekPreview.segment}</span>}
      </output>}
      <input
        className={`af-player-seek ${bufferedCss ? 'has-buffer-data' : ''}`}
        type="range"
        min={0}
        max={position.duration || 1}
        step={0.1}
        value={displayTime}
        disabled={!(position.duration > 0)}
        aria-label="Seek"
        title={media.embed ? 'This video source does not report buffered ranges' : undefined}
        aria-description={media.embed ? 'This video source does not report buffered ranges' : undefined}
        aria-valuetext={position.duration > 0 ? `${formatClock(displayTime)} of ${formatClock(position.duration)}` : formatClock(displayTime)}
        style={{ '--played': playedPct, '--buffered-track': bufferedCss || 'none' } as CSSProperties}
        onPointerDown={() => { onScrubStart(); onRevealControls(); }}
        onChange={event => onSeekChange(Number(event.currentTarget.value))}
        onPointerMove={event => { if (event.pointerType !== 'touch') onSeekHover(event.clientX); }}
        onPointerLeave={onSeekPreviewClear}
        onBlur={onSeekPreviewClear}
      />
    </div>

    <div className="af-player-transport">
      <div className="af-player-playback">
        {adjacent.previous && <button type="button" className="af-player-btn" aria-label="Previous episode" title="Previous episode" onClick={() => onNavigateEpisode(adjacent.previous!)}><PlayerGlyph name="prev" /></button>}
        <button type="button" className="af-player-btn af-player-play-btn"
          aria-label={ended ? 'Replay' : position.paused ? 'Play' : 'Pause'}
          title={ended ? 'Replay' : position.paused ? 'Play' : 'Pause'}
          onClick={() => onSendCommand(ended || position.paused ? 'play' : 'pause')}>
          {ended ? <PlayerGlyph name="replay" /> : position.paused ? <Icon name="play" /> : <PlayerGlyph name="pause" />}
        </button>
        {adjacent.next && <button type="button" className="af-player-btn" aria-label="Next episode" title="Next episode" onClick={() => onNavigateEpisode(adjacent.next!)}><PlayerGlyph name="next" /></button>}
      </div>

      <div className="af-player-jump">
        <button type="button" className="af-player-btn" aria-label="Back 10 seconds" title="Back 10 seconds" disabled={!(position.duration > 0)}
          onClick={() => onJumpPlayback(-10)}><PlayerGlyph name="back10" /></button>
        <button type="button" className="af-player-btn" aria-label="Forward 10 seconds" title="Forward 10 seconds" disabled={!(position.duration > 0)}
          onClick={() => onJumpPlayback(10)}><PlayerGlyph name="fwd10" /></button>
      </div>

      <span className="af-player-time" aria-hidden="true">
        <span className="af-player-elapsed">{formatClock(displayTime)}</span>
        {position.duration > 0 && <span className="af-player-duration"> / {formatClock(position.duration)}</span>}
      </span>

      <div className="af-player-utilities">
        <details ref={audioMenuRef} className="af-player-menu" onToggle={event => { if (event.currentTarget.open) onCloseOtherMenus(event.currentTarget); }}>
          <summary className="af-player-btn af-player-utility" aria-label={muted || volume === 0 ? 'Audio controls (muted)' : 'Audio controls'} title={muted || volume === 0 ? 'Audio controls (muted)' : 'Audio controls'}>
            <PlayerGlyph name={muted || volume === 0 ? 'muted' : 'speaker'} />
          </summary>
          <div className="af-player-popup af-player-audio-panel">
            <label className="af-player-popup-head" htmlFor="af-player-volume">
              <span>Volume</span><span className="af-player-volume-level">{volumePct}</span>
            </label>
            <input
              id="af-player-volume"
              className="af-player-volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              aria-valuetext={muted || volume === 0 ? 'Muted' : volumePct}
              style={{ '--volume-fill': volumePct } as CSSProperties}
              onChange={event => { const v = Number(event.currentTarget.value); onUpdateAudio(v, v === 0); }}
            />
            <button type="button" className="af-player-popup-action" onClick={() => onUpdateAudio(volume || lastVolume, !muted && volume > 0)}>
              {muted || volume === 0 ? 'Unmute' : 'Mute'}
            </button>
            {!media.embed && nativeAudioTracks.length > 1 && <label className="af-player-language">
              <span>Audio track</span>
              <select
                className="af-player-select"
                value={nativeAudioTracks.find(t => t.enabled)?.index ?? 0}
                onChange={event => {
                  const idx = Number(event.target.value);
                  const list = videoRef.current?.audioTracks;
                  if (!list) return;
                  for (let i = 0; i < list.length; i++) list[i].enabled = i === idx;
                  const chosen = nativeAudioTracks[idx];
                  if (chosen?.language && chosen.language.length <= 60) {
                    void controls.setPreference('audioLanguage', chosen.language, 'Preferred audio');
                  }
                }}
              >
                {nativeAudioTracks.map(t => <option key={t.index} value={t.index}>{t.label}</option>)}
              </select>
            </label>}
          </div>
        </details>

        {(media.embed || media.nativeMedia?.captions) && <SubtitleMenu
          menuRef={subtitleMenuRef}
          videoRef={videoRef}
          isEmbed={media.embed}
          activeCues={activeCues}
          nativeCaptionsOn={nativeCaptionsOn}
          subTracks={subTracks}
          subLang={subLang}
          subStatus={subStatus}
          rememberSubtitles={rememberSubtitles}
          controls={controls}
          onOpen={onOpenSubtitles}
          onTurnOff={onTurnOffSubtitles}
          onEnableNative={onEnableNativeSubtitles}
          onSelectLanguage={onSelectSubLang}
          onChooseTrack={onChooseSubTrack}
        />}

        <details ref={settingsMenuRef} className="af-player-menu" onToggle={event => { if (event.currentTarget.open) onCloseOtherMenus(event.currentTarget); }}>
          <summary className="af-player-btn af-player-utility" aria-label="Playback settings" title="Playback settings"><PlayerGlyph name="tune" /></summary>
          <div className="af-player-popup">
            <p className="af-player-popup-head">Playback</p>
            <div>
              <p className="af-meta">Speed</p>
              <div className="af-player-choice-group" role="group" aria-label="Speed">
                {speedOptions.map(val => <button key={val} type="button" aria-pressed={speed === val} onClick={() => onSpeedChange(val)}>{val}×</button>)}
              </div>
            </div>
            {media.embed && <div>
              <p className="af-meta">Preferred quality</p>
              <div className="af-player-choice-group" role="group" aria-label="Preferred quality">
                {qualityOptions.map(([val, lbl]) => <button key={val} type="button" aria-pressed={quality === val} onClick={() => onQualityChange(val)}>{lbl}</button>)}
              </div>
            </div>}
            {media.embed && <button type="button" className="af-player-provider-toggle" onClick={onOpenProviderSources}>
              <span>Provider video sources</span><Icon name="right" />
            </button>}
          </div>
        </details>

        {(document.fullscreenEnabled || !media.embed) && <button type="button" className="af-player-btn" aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={onToggleFullscreen}>
          <PlayerGlyph name={isFullscreen ? 'exitFull' : 'full'} />
        </button>}
      </div>
    </div>
  </div>;
}
