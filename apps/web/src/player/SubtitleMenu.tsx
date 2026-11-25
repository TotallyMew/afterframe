import { playbackLanguage, type SubtitleCue, type SubtitleTrack } from '@afterframe/shared/subtitles';
import type { RefObject } from 'react';
import { Icon } from '../components';
import type { LibraryControls } from '../library';
import { PlayerGlyph } from './PlayerGlyph';
import type { VideoWithAudioTracks } from './types';

export function SubtitleMenu({
  menuRef,
  videoRef,
  isEmbed,
  activeCues,
  nativeCaptionsOn,
  subTracks,
  subLang,
  subStatus,
  rememberSubtitles,
  controls,
  onOpen,
  onTurnOff,
  onEnableNative,
  onSelectLanguage,
  onChooseTrack,
}: {
  menuRef: RefObject<HTMLDetailsElement | null>;
  videoRef: RefObject<VideoWithAudioTracks | null>;
  isEmbed: boolean;
  activeCues: { url: string; cues: SubtitleCue[] } | null;
  nativeCaptionsOn: boolean;
  subTracks: SubtitleTrack[] | null;
  subLang: string;
  subStatus: string;
  rememberSubtitles: boolean;
  controls: LibraryControls;
  onOpen: (target: HTMLDetailsElement) => void;
  onTurnOff: () => void;
  onEnableNative: () => void;
  onSelectLanguage: (lang: string) => void;
  onChooseTrack: (track: SubtitleTrack) => void;
}) {
  const active = Boolean(activeCues || nativeCaptionsOn);
  return <details
    ref={menuRef}
    className="af-player-menu af-player-subtitles"
    onToggle={event => {
      if (event.currentTarget.open) onOpen(event.currentTarget);
    }}
  >
    <summary
      className={`af-player-btn af-player-utility ${active ? 'has-subtitles' : ''}`}
      aria-label={active ? 'Subtitles on' : 'Subtitles'}
      title={active ? 'Subtitles on' : 'Subtitles'}
    >
      <PlayerGlyph name="cc" />
    </summary>
    <div className="af-player-popup">
      <div className="af-player-popup-head">
        <span>Afterframe subtitles</span>
        <button type="button" className="af-player-popup-action" aria-pressed={!active} onClick={() => {
          onTurnOff();
          if (videoRef.current?.textTracks[0]) videoRef.current.textTracks[0].mode = 'disabled';
          if (rememberSubtitles) void controls.setPreference('subtitleLanguage', '', 'Preferred subtitles');
        }}>Off</button>
      </div>
      {!isEmbed && <button type="button" className="af-subtitle-choice" aria-pressed={nativeCaptionsOn} onClick={() => {
        const track = videoRef.current?.textTracks[0];
        if (track) {
          track.mode = 'showing';
          onEnableNative();
          if (rememberSubtitles) void controls.setPreference('subtitleLanguage', playbackLanguage(track.language) || track.label, 'Preferred subtitles');
        }
      }}><span>English (auto-generated)</span>{nativeCaptionsOn && <Icon name="check" />}</button>}
      {isEmbed && <>
        {subTracks && subTracks.length > 0 && <label className="af-player-language">
          <span>Language</span>
          <select className="af-player-select" aria-label="Subtitle language" value={subLang} onChange={event => onSelectLanguage(event.target.value)}>
            {[...new Set(subTracks.map(t => t.language))].map(lang => <option key={lang} value={lang}>{lang}</option>)}
          </select>
        </label>}
        <div className="af-subtitle-tracks" role="group" aria-label="Subtitle versions">
          {(subTracks ?? []).filter(t => t.language === subLang).map((track, idx) => (
            <button key={track.url} type="button" className="af-subtitle-choice" aria-pressed={activeCues?.url === track.url}
              onClick={() => onChooseTrack(track)}>
              <span>{track.release || `Version ${idx + 1}`}</span>
              {activeCues?.url === track.url && <Icon name="check" />}
            </button>
          ))}
        </div>
        {subStatus && <p className="af-meta" role="status">{subStatus}</p>}
      </>}
    </div>
  </details>;
}
