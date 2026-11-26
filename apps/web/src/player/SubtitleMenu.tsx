import { Dialog } from '@base-ui/react/dialog';
import { playbackLanguage, samePlaybackLanguage, type SubtitleCue, type SubtitleTrack } from '@afterframe/shared/subtitles';
import { useMemo, useState, type RefObject } from 'react';
import { Icon } from '../components';
import type { LibraryControls } from '../library';
import { PlayerGlyph } from './PlayerGlyph';
import type { VideoWithAudioTracks } from './types';

export type CaptionSize = 'small' | 'medium' | 'large';
export type CaptionBg = 'box' | 'shadow' | 'translucent';
export interface CaptionStyle {
  size: CaptionSize;
  bg: CaptionBg;
  offset: number;
}

const captionStyleKey = 'afterframe.captionStyle';
export const defaultCaptionStyle: CaptionStyle = { size: 'medium', bg: 'box', offset: 0 };

export function readCaptionStyle(): CaptionStyle {
  try {
    const raw = JSON.parse(localStorage.getItem(captionStyleKey) || 'null');
    if (raw && typeof raw === 'object') {
      const size = (['small', 'medium', 'large'] as const).includes(raw.size) ? raw.size : 'medium';
      const bg = (['box', 'shadow', 'translucent'] as const).includes(raw.bg) ? raw.bg : 'box';
      const offset = typeof raw.offset === 'number' && Number.isFinite(raw.offset) ? Math.max(-15, Math.min(15, raw.offset)) : 0;
      return { size, bg, offset };
    }
  } catch { /* ignore */ }
  return defaultCaptionStyle;
}

export function writeCaptionStyle(style: CaptionStyle) {
  try { localStorage.setItem(captionStyleKey, JSON.stringify(style)); }
  catch { /* ignore */ }
}

export function SubtitleMenu({
  menuRef,
  videoRef,
  isEmbed,
  useMobileSheets,
  activeCues,
  nativeCaptionsOn,
  subTracks,
  subLang,
  subStatus,
  rememberSubtitles,
  preferredLanguage,
  captionStyle,
  controls,
  onOpen,
  onTurnOff,
  onEnableNative,
  onSelectLanguage,
  onChooseTrack,
  onChangeCaptionStyle,
}: {
  menuRef: RefObject<HTMLDetailsElement | null>;
  videoRef: RefObject<VideoWithAudioTracks | null>;
  isEmbed: boolean;
  useMobileSheets?: boolean;
  activeCues: { url: string; cues: SubtitleCue[] } | null;
  nativeCaptionsOn: boolean;
  subTracks: SubtitleTrack[] | null;
  subLang: string;
  subStatus: string;
  rememberSubtitles: boolean;
  preferredLanguage?: string;
  captionStyle: CaptionStyle;
  controls: LibraryControls;
  onOpen: (target?: HTMLDetailsElement) => void;
  onTurnOff: () => void;
  onEnableNative: () => void;
  onSelectLanguage: (lang: string) => void;
  onChooseTrack: (track: SubtitleTrack) => void;
  onChangeCaptionStyle: (next: CaptionStyle) => void;
}) {
  const [tab, setTab] = useState<'tracks' | 'style'>('tracks');
  const [langFilter, setLangFilter] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const active = Boolean(activeCues || nativeCaptionsOn);

  const orderedLanguages = useMemo(() => {
    if (!subTracks?.length) return [];
    const unique = [...new Set(subTracks.map(t => t.language))];
    return unique.sort((a, b) => {
      const aPref = preferredLanguage && samePlaybackLanguage(a, preferredLanguage) ? 0 : a === 'English' ? 1 : 2;
      const bPref = preferredLanguage && samePlaybackLanguage(b, preferredLanguage) ? 0 : b === 'English' ? 1 : 2;
      if (aPref !== bPref) return aPref - bPref;
      return a.localeCompare(b);
    });
  }, [subTracks, preferredLanguage]);

  const filteredLanguages = useMemo(() => {
    const q = langFilter.trim().toLowerCase();
    if (!q) return orderedLanguages;
    const matches = orderedLanguages.filter(lang => lang.toLowerCase().includes(q));
    return matches.length ? matches : orderedLanguages;
  }, [orderedLanguages, langFilter]);

  const formattedOffset = `${captionStyle.offset > 0 ? '+' : ''}${captionStyle.offset.toFixed(1)}s`;

  const body = <>
    {isEmbed && <div className="af-player-tabs" role="tablist" aria-label="Subtitle options">
      <button type="button" role="tab" aria-selected={tab === 'tracks'} onClick={() => setTab('tracks')}>Tracks</button>
      <button type="button" role="tab" aria-selected={tab === 'style'} onClick={() => setTab('style')}>Style &amp; sync</button>
    </div>}

    {tab === 'tracks' || !isEmbed ? <>
      {!isEmbed && <button type="button" className="af-subtitle-choice" aria-pressed={nativeCaptionsOn} onClick={() => {
        const track = videoRef.current?.textTracks[0];
        if (track) {
          track.mode = 'showing';
          onEnableNative();
          if (rememberSubtitles) void controls.setPreference('subtitleLanguage', playbackLanguage(track.language) || track.label, 'Preferred subtitles');
        }
      }}><span>English (auto-generated)</span>{nativeCaptionsOn && <Icon name="check" />}</button>}
      {isEmbed && <>
        {orderedLanguages.length >= 6 && (
          <input
            type="search"
            className="af-player-sub-search"
            placeholder="Filter language"
            aria-label="Filter subtitle language"
            value={langFilter}
            onChange={event => {
              const next = event.target.value;
              setLangFilter(next);
              const q = next.trim().toLowerCase();
              if (q) {
                const firstMatch = orderedLanguages.find(l => l.toLowerCase().includes(q));
                if (firstMatch && firstMatch !== subLang) onSelectLanguage(firstMatch);
              }
            }}
          />
        )}
        {orderedLanguages.length > 0 && <label className="af-player-language">
          <span>Language</span>
          <select className="af-player-select" aria-label="Subtitle language" value={subLang} onChange={event => onSelectLanguage(event.target.value)}>
            {filteredLanguages.map(lang => <option key={lang} value={lang}>{lang}</option>)}
          </select>
        </label>}
        <div className="af-subtitle-tracks" role="group" aria-label="Subtitle versions">
          {(subTracks ?? []).filter(t => t.language === subLang).map((track, idx) => (
            <button key={track.url} type="button" className="af-subtitle-choice" aria-pressed={activeCues?.url === track.url}
              onClick={() => onChooseTrack(track)}>
              <span>{track.release || `${track.language} · Track ${idx + 1}`}</span>
              {activeCues?.url === track.url && <Icon name="check" />}
            </button>
          ))}
        </div>
        {subStatus && <p className="af-meta" role="status">{subStatus}</p>}
      </>}
    </> : <div className="af-sub-style-panel">
      <div>
        <p className="af-meta">Text size</p>
        <div className="af-player-choice-group" role="group" aria-label="Subtitle size">
          {([['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']] as const).map(([val, label]) => (
            <button key={val} type="button" aria-pressed={captionStyle.size === val}
              onClick={() => onChangeCaptionStyle({ ...captionStyle, size: val })}>{label}</button>
          ))}
        </div>
      </div>
      <div>
        <p className="af-meta">Background</p>
        <div className="af-player-choice-group" role="group" aria-label="Subtitle background">
          {([['box', 'Dark box'], ['translucent', 'Soft'], ['shadow', 'Shadow']] as const).map(([val, label]) => (
            <button key={val} type="button" aria-pressed={captionStyle.bg === val}
              onClick={() => onChangeCaptionStyle({ ...captionStyle, bg: val })}>{label}</button>
          ))}
        </div>
      </div>
      <div>
        <div className="af-sub-sync-head">
          <span className="af-meta">Timing offset</span>
          <span className="af-tabular af-sub-sync-val">{formattedOffset}</span>
        </div>
        <div className="af-player-choice-group af-sub-sync-row" role="group" aria-label="Subtitle timing offset">
          <button type="button" onClick={() => onChangeCaptionStyle({ ...captionStyle, offset: Math.max(-15, Math.round((captionStyle.offset - 0.5) * 10) / 10) })}>−0.5s</button>
          <button type="button" disabled={captionStyle.offset === 0} onClick={() => onChangeCaptionStyle({ ...captionStyle, offset: 0 })}>Reset</button>
          <button type="button" onClick={() => onChangeCaptionStyle({ ...captionStyle, offset: Math.min(15, Math.round((captionStyle.offset + 0.5) * 10) / 10) })}>+0.5s</button>
        </div>
      </div>
    </div>}
  </>;

  const offButton = (
    <button type="button" className="af-player-popup-action" aria-pressed={!active} onClick={() => {
      onTurnOff();
      if (videoRef.current?.textTracks[0]) videoRef.current.textTracks[0].mode = 'disabled';
      if (rememberSubtitles) void controls.setPreference('subtitleLanguage', '', 'Preferred subtitles');
    }}>Off</button>
  );

  if (useMobileSheets) {
    return <>
      <button
        type="button"
        className={`af-player-btn af-player-utility ${active ? 'has-subtitles' : ''}`}
        aria-label={active ? 'Subtitles on' : 'Subtitles'}
        title={active ? 'Subtitles on' : 'Subtitles'}
        onClick={() => { setSheetOpen(true); onOpen(); }}
      >
        <PlayerGlyph name="cc" />
      </button>
      <Dialog.Root open={sheetOpen} onOpenChange={setSheetOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="af-scrim af-sheet-scrim" />
          <Dialog.Popup className="af-mobile-sheet af-player-sheet">
            <div className="af-sheet-handle" aria-hidden="true" />
            <header className="af-sheet-head">
              <Dialog.Title>Subtitles</Dialog.Title>
              <div className="af-sheet-head-actions">
                {offButton}
                <Dialog.Close className="af-icon-button" aria-label="Close subtitles"><Icon name="close" /></Dialog.Close>
              </div>
            </header>
            <div className="af-sheet-body">{body}</div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>;
  }

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
      title={active ? 'Subtitles on (C)' : 'Subtitles (C)'}
    >
      <PlayerGlyph name="cc" />
    </summary>
    <div className="af-player-popup af-subtitle-popup">
      <div className="af-player-popup-head">
        <span>Subtitles</span>
        {offButton}
      </div>
      {body}
    </div>
  </details>;
}
