import { Dialog } from '@base-ui/react/dialog';
import { playbackLanguage, samePlaybackLanguage, type SubtitleCue, type SubtitleTrack } from '@afterframe/shared/subtitles';
import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
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

function languagePriority(lang: string, preferredLanguage?: string): number {
  if (preferredLanguage && samePlaybackLanguage(lang, preferredLanguage)) return 0;
  if (lang === 'English') return 1;
  return 2;
}

function nextSubtitleTab(key: string, current: 'tracks' | 'style'): 'tracks' | 'style' {
  if (key === 'Home') return 'tracks';
  if (key === 'End') return 'style';
  return current === 'tracks' ? 'style' : 'tracks';
}

const captionSizeOptions: readonly (readonly [CaptionSize, string])[] = [
  ['small', 'Small'],
  ['medium', 'Medium'],
  ['large', 'Large'],
];

const captionBgOptions: readonly (readonly [CaptionBg, string])[] = [
  ['box', 'Dark box'],
  ['translucent', 'Soft'],
  ['shadow', 'Shadow'],
];

function SubtitleStylePanel({
  captionStyle,
  onChangeCaptionStyle,
}: Readonly<{
  captionStyle: CaptionStyle;
  onChangeCaptionStyle: (next: CaptionStyle) => void;
}>) {
  const formattedOffset = `${captionStyle.offset > 0 ? '+' : ''}${captionStyle.offset.toFixed(1)}s`;
  const stepOffset = (delta: number) => {
    const rounded = Math.round((captionStyle.offset + delta) * 10) / 10;
    onChangeCaptionStyle({ ...captionStyle, offset: Math.max(-15, Math.min(15, rounded)) });
  };

  return <div className="af-sub-style-panel" role="tabpanel" id="af-sub-panel-style" aria-labelledby="af-sub-tab-style">
    <div>
      <p className="af-meta">Text size</p>
      <div className="af-player-choice-group">
        {captionSizeOptions.map(([val, label]) => (
          <button key={val} type="button" aria-pressed={captionStyle.size === val}
            onClick={() => onChangeCaptionStyle({ ...captionStyle, size: val })}>{label}</button>
        ))}
      </div>
    </div>
    <div>
      <p className="af-meta">Background</p>
      <div className="af-player-choice-group">
        {captionBgOptions.map(([val, label]) => (
          <button key={val} type="button" aria-pressed={captionStyle.bg === val}
            onClick={() => onChangeCaptionStyle({ ...captionStyle, bg: val })}>{label}</button>
        ))}
      </div>
    </div>
    <div>
      <div className="af-sub-sync-head">
        <span className="af-meta">Timing offset</span>
        <output className="af-tabular af-sub-sync-val">{formattedOffset}</output>
      </div>
      <div className="af-player-choice-group af-sub-sync-row">
        <button type="button" onClick={() => stepOffset(-0.5)}>−0.5s</button>
        <button type="button" disabled={captionStyle.offset === 0} onClick={() => onChangeCaptionStyle({ ...captionStyle, offset: 0 })}>Reset</button>
        <button type="button" onClick={() => stepOffset(0.5)}>+0.5s</button>
      </div>
    </div>
  </div>;
}

function SubtitleTrackOption({
  track,
  index,
  selected,
  onChooseTrack,
}: Readonly<{
  track: SubtitleTrack;
  index: number;
  selected: boolean;
  onChooseTrack: (track: SubtitleTrack) => void;
}>) {
  return (
    <button type="button" className="af-subtitle-choice" aria-pressed={selected}
      onClick={() => onChooseTrack(track)}>
      <span className="af-subtitle-choice-main">
        <span className="af-subtitle-choice-label">{track.release || `${track.language} · Track ${index + 1}`}</span>
        {(track.forced || track.hearingImpaired) && (
          <span className="af-subtitle-badges">
            {track.forced && <span className="af-subtitle-badge is-forced" title="Foreign dialogue only">Forced</span>}
            {track.hearingImpaired && <span className="af-subtitle-badge" title="Subtitles for the deaf and hard of hearing">SDH</span>}
          </span>
        )}
      </span>
      {selected && <Icon name="check" />}
    </button>
  );
}

function orderSubtitleLanguages(subTracks: SubtitleTrack[] | null, preferredLanguage?: string): string[] {
  if (!subTracks?.length) return [];
  const unique = [...new Set(subTracks.map(t => t.language))];
  return unique.sort((a, b) => {
    const diff = languagePriority(a, preferredLanguage) - languagePriority(b, preferredLanguage);
    return diff === 0 ? a.localeCompare(b) : diff;
  });
}

function filterSubtitleLanguages(orderedLanguages: string[], langFilter: string): string[] {
  const q = langFilter.trim().toLowerCase();
  if (!q) return orderedLanguages;
  const matches = orderedLanguages.filter(lang => lang.toLowerCase().includes(q));
  return matches.length ? matches : orderedLanguages;
}

function enableNativeCaptionTrack(
  videoRef: RefObject<VideoWithAudioTracks | null>,
  rememberSubtitles: boolean,
  controls: LibraryControls,
  onEnableNative: () => void,
) {
  const track = videoRef.current?.textTracks[0];
  if (!track) return;
  track.mode = 'showing';
  onEnableNative();
  if (rememberSubtitles) {
    void controls.setPreference('subtitleLanguage', playbackLanguage(track.language) || track.label, 'Preferred subtitles');
  }
}

function disableNativeCaptionTrack(
  videoRef: RefObject<VideoWithAudioTracks | null>,
  rememberSubtitles: boolean,
  controls: LibraryControls,
  onTurnOff: () => void,
) {
  onTurnOff();
  if (videoRef.current?.textTracks[0]) videoRef.current.textTracks[0].mode = 'disabled';
  if (rememberSubtitles) void controls.setPreference('subtitleLanguage', '', 'Preferred subtitles');
}

function SubtitleTracksPanel({
  isEmbed,
  videoRef,
  nativeCaptionsOn,
  rememberSubtitles,
  controls,
  orderedLanguages,
  filteredLanguages,
  langFilter,
  subLang,
  showForcedFilter,
  forcedOnly,
  tracksForLangCount,
  forcedCount,
  visibleTracks,
  activeCuesUrl,
  subStatus,
  onEnableNative,
  onLangFilterChange,
  onSelectLanguage,
  onForcedOnlyChange,
  onChooseTrack,
}: Readonly<{
  isEmbed: boolean;
  videoRef: RefObject<VideoWithAudioTracks | null>;
  nativeCaptionsOn: boolean;
  rememberSubtitles: boolean;
  controls: LibraryControls;
  orderedLanguages: string[];
  filteredLanguages: string[];
  langFilter: string;
  subLang: string;
  showForcedFilter: boolean;
  forcedOnly: boolean;
  tracksForLangCount: number;
  forcedCount: number;
  visibleTracks: SubtitleTrack[];
  activeCuesUrl?: string;
  subStatus: string;
  onEnableNative: () => void;
  onLangFilterChange: (next: string) => void;
  onSelectLanguage: (lang: string) => void;
  onForcedOnlyChange: (next: boolean) => void;
  onChooseTrack: (track: SubtitleTrack) => void;
}>) {
  if (!isEmbed) {
    return (
      <div>
        <button type="button" className="af-subtitle-choice" aria-pressed={nativeCaptionsOn}
          onClick={() => enableNativeCaptionTrack(videoRef, rememberSubtitles, controls, onEnableNative)}>
          <span>English (auto-generated)</span>{nativeCaptionsOn && <Icon name="check" />}
        </button>
      </div>
    );
  }

  return <div role="tabpanel" id="af-sub-panel-tracks" aria-labelledby="af-sub-tab-tracks">
    {orderedLanguages.length >= 6 && (
      <label className="af-player-sub-search-wrap">
        <span className="sr-only">Filter subtitle language</span>
        <input
          type="search"
          className="af-player-sub-search"
          placeholder="Filter language"
          value={langFilter}
          onChange={event => onLangFilterChange(event.target.value)}
        />
      </label>
    )}
    {orderedLanguages.length > 0 && <label className="af-player-language">
      <span>Language</span>
      <select className="af-player-select" aria-label="Subtitle language" value={subLang} onChange={event => {
        onForcedOnlyChange(false);
        onSelectLanguage(event.target.value);
      }}>
        {filteredLanguages.map(lang => <option key={lang} value={lang}>{lang}</option>)}
      </select>
    </label>}
    {showForcedFilter && <div className="af-subtitle-filter">
      <button type="button" aria-pressed={!forcedOnly} onClick={() => onForcedOnlyChange(false)}>
        All ({tracksForLangCount})
      </button>
      <button type="button" aria-pressed={forcedOnly} onClick={() => onForcedOnlyChange(true)}>
        Forced ({forcedCount})
      </button>
    </div>}
    <section className="af-subtitle-tracks" aria-label="Subtitle versions">
      {visibleTracks.map((track, idx) => (
        <SubtitleTrackOption
          key={track.url}
          track={track}
          index={idx}
          selected={activeCuesUrl === track.url}
          onChooseTrack={onChooseTrack}
        />
      ))}
    </section>
    {subStatus && <output className="af-meta">{subStatus}</output>}
  </div>;
}

function SubtitleTabs({
  tab,
  onSelectTab,
}: Readonly<{
  tab: 'tracks' | 'style';
  onSelectTab: (next: 'tracks' | 'style') => void;
}>) {
  const handleTabKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = nextSubtitleTab(event.key, tab);
    onSelectTab(next);
    document.getElementById(`af-sub-tab-${next}`)?.focus();
  };

  return (
    <div className="af-player-tabs" role="tablist" tabIndex={0} aria-label="Subtitle options" onKeyDown={handleTabKey}>
      <button id="af-sub-tab-tracks" type="button" role="tab" aria-selected={tab === 'tracks'} aria-controls="af-sub-panel-tracks" tabIndex={tab === 'tracks' ? 0 : -1} onClick={() => onSelectTab('tracks')}>Tracks</button>
      <button id="af-sub-tab-style" type="button" role="tab" aria-selected={tab === 'style'} aria-controls="af-sub-panel-style" tabIndex={tab === 'style' ? 0 : -1} onClick={() => onSelectTab('style')}>Style &amp; sync</button>
    </div>
  );
}

function findMatchingSubtitleLanguage(orderedLanguages: string[], filterValue: string, currentLang: string): string | undefined {
  const q = filterValue.trim().toLowerCase();
  if (!q) return undefined;
  const match = orderedLanguages.find(l => l.toLowerCase().includes(q));
  return match && match !== currentLang ? match : undefined;
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
}: Readonly<{
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
}>) {
  const [tab, setTab] = useState<'tracks' | 'style'>('tracks');
  const [langFilter, setLangFilter] = useState('');
  const [forcedOnly, setForcedOnly] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const active = Boolean(activeCues || nativeCaptionsOn);
  const buttonLabel = active ? 'Subtitles on' : 'Subtitles';
  const activeClass = active ? 'has-subtitles' : '';

  const orderedLanguages = useMemo(() => orderSubtitleLanguages(subTracks, preferredLanguage), [subTracks, preferredLanguage]);
  const filteredLanguages = useMemo(() => filterSubtitleLanguages(orderedLanguages, langFilter), [orderedLanguages, langFilter]);
  const tracksForLang = useMemo(() => (subTracks ?? []).filter(t => t.language === subLang), [subTracks, subLang]);
  const forcedCount = useMemo(() => tracksForLang.filter(t => t.forced).length, [tracksForLang]);
  const showForcedFilter = forcedCount > 0 && forcedCount < tracksForLang.length;
  const visibleTracks = showForcedFilter && forcedOnly ? tracksForLang.filter(t => t.forced) : tracksForLang;

  const handleLangFilterChange = (next: string) => {
    setLangFilter(next);
    const match = findMatchingSubtitleLanguage(orderedLanguages, next, subLang);
    if (match) onSelectLanguage(match);
  };

  const body = <>
    {isEmbed && <SubtitleTabs tab={tab} onSelectTab={setTab} />}

    {tab === 'tracks' || !isEmbed ? (
      <SubtitleTracksPanel
        isEmbed={isEmbed}
        videoRef={videoRef}
        nativeCaptionsOn={nativeCaptionsOn}
        rememberSubtitles={rememberSubtitles}
        controls={controls}
        orderedLanguages={orderedLanguages}
        filteredLanguages={filteredLanguages}
        langFilter={langFilter}
        subLang={subLang}
        showForcedFilter={showForcedFilter}
        forcedOnly={forcedOnly}
        tracksForLangCount={tracksForLang.length}
        forcedCount={forcedCount}
        visibleTracks={visibleTracks}
        activeCuesUrl={activeCues?.url}
        subStatus={subStatus}
        onEnableNative={onEnableNative}
        onLangFilterChange={handleLangFilterChange}
        onSelectLanguage={onSelectLanguage}
        onForcedOnlyChange={setForcedOnly}
        onChooseTrack={onChooseTrack}
      />
    ) : (
      <SubtitleStylePanel
        captionStyle={captionStyle}
        onChangeCaptionStyle={onChangeCaptionStyle}
      />
    )}
  </>;

  const offButton = (
    <button type="button" className="af-player-popup-action" aria-pressed={!active}
      onClick={() => disableNativeCaptionTrack(videoRef, rememberSubtitles, controls, onTurnOff)}>Off</button>
  );

  if (useMobileSheets) {
    return <>
      <button
        type="button"
        className={`af-player-btn af-player-utility ${activeClass}`}
        aria-label={buttonLabel}
        title={buttonLabel}
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
      className={`af-player-btn af-player-utility ${activeClass}`}
      aria-label={buttonLabel}
      title={`${buttonLabel} (C)`}
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
