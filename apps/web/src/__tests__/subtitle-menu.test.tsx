import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryControls } from '../library';
import { defaultCaptionStyle, SubtitleMenu } from '../player/SubtitleMenu';
import type { VideoWithAudioTracks } from '../player/types';
import type { SubtitleTrack } from '@afterframe/shared/subtitles';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function mountMenu({ mobile = false, native = false, remember = true, tracks = [{ url: 'https://example.com/en.vtt', language: 'English', release: 'English subtitles' }] }: { mobile?: boolean; native?: boolean; remember?: boolean; tracks?: SubtitleTrack[] } = {}) {
  const setPreference = vi.fn(async () => true);
  const nativeTrack = { mode: 'showing', language: 'en', label: 'English' };
  const videoRef = { current: { textTracks: [nativeTrack] } as unknown as VideoWithAudioTracks };
  function Harness() {
    const [active, setActive] = useState(true);
    const [language, setLanguage] = useState('English');
    const [chosen, setChosen] = useState(tracks[0]?.url || '');
    return <SubtitleMenu menuRef={createRef()} videoRef={videoRef} isEmbed={!native} useMobileSheets={mobile}
      activeCues={!native && active ? { url: chosen, cues: [] } : null} nativeCaptionsOn={native && active}
      subTracks={tracks} subLang={language} subStatus="" rememberSubtitles={remember} preferredLanguage="en"
      captionStyle={defaultCaptionStyle} controls={{ setPreference } as unknown as LibraryControls}
      onOpen={() => {}} onTurnOff={() => setActive(false)} onEnableNative={() => setActive(true)} onSelectLanguage={setLanguage}
      onChooseTrack={track => { setChosen(track.url); setActive(true); }} onChangeCaptionStyle={() => {}} />;
  }
  const result = render(<Harness />);
  if (mobile) fireEvent.click(screen.getByRole('button', { name: 'Subtitles on' }));
  else result.container.querySelector('details')!.open = true;
  return { ...result, setPreference, nativeTrack };
}

describe('Subtitle off list option', () => {
  it.each([false, true])('turns subtitles off from the track list and restores selection (mobile=%s)', mobile => {
    const { setPreference, nativeTrack } = mountMenu({ mobile });
    const choices = screen.getByRole('region', { name: 'Subtitle versions' });
    const off = within(screen.getByRole('region', { name: 'Subtitle selection' })).getByRole('button', { name: 'Subtitles off' });
    expect(within(choices).queryByRole('button', { name: 'Subtitles off' })).toBeNull();
    expect(off.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Off' })).toBeNull();
    fireEvent.click(off);
    expect(off.getAttribute('aria-pressed')).toBe('true');
    expect(nativeTrack.mode).toBe('disabled');
    expect(setPreference).toHaveBeenCalledWith('subtitleLanguage', '', 'Preferred subtitles');
    fireEvent.click(within(choices).getByRole('button', { name: 'English · Track 1' }));
    expect(off.getAttribute('aria-pressed')).toBe('false');
  });

  it('uses one language selector, accurate track counts and stable numbering when filtering forced tracks', () => {
    const tracks: SubtitleTrack[] = [
      { url: 'normal', language: 'English', release: 'Show.S01E01.1080p.WEB-DL' },
      { url: 'forced', language: 'English', release: 'Show.S01E01.FORCED', forced: true },
      { url: 'cc', language: 'English', release: 'Show.S01E01.CC' },
      ...['French', 'German', 'Spanish', 'Japanese', 'Polish', 'Arabic'].map(language => ({ url: language, language, release: 'Release filename' })),
    ];
    const { container } = mountMenu({ tracks });
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'All (3)' })).toBeTruthy();
    expect(container.querySelectorAll('.af-subtitle-tracks .af-subtitle-choice')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Forced (1)' }));
    expect(container.querySelectorAll('.af-subtitle-tracks .af-subtitle-choice')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'English · Track 2 Forced' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Subtitles off' })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Subtitle language' }), { target: { value: 'French' } });
    expect(screen.getByRole('button', { name: 'French · Track 1' })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Subtitle language' }), { target: { value: 'English' } });
    expect(screen.getByRole('button', { name: 'All (3)' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows concise TV and anime labels, preserves release details, and uses consistent accessibility tags', () => {
    mountMenu({ tracks: [
      { url: 'normal', language: 'English', release: 'Severance.S01E01.2160p.WEB-DL.DDP5.1.H265-Group' },
      { url: 'forced', language: 'English', release: 'English (Forced)', forced: true },
      { url: 'cc', language: 'English', release: 'Severance.S01E01.CC' },
      { url: 'sdh', language: 'English', release: 'Severance.S01E01.SDH', hearingImpaired: true },
    ] });
    const normal = screen.getByRole('button', { name: 'English · Track 1' });
    expect(normal.getAttribute('title')).toBe('Severance.S01E01.2160p.WEB-DL.DDP5.1.H265-Group');
    expect(screen.queryByText(/Severance\.S01E01/)).toBeNull();
    expect(screen.getByRole('button', { name: 'English · Track 2 Forced' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'English · Track 3 CC' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'English · Track 4 SDH' })).toBeTruthy();
  });

  it('keeps the off option available with no tracks and supports keyboard tab navigation', () => {
    mountMenu({ tracks: [] });
    expect(screen.getByRole('button', { name: 'Subtitles off' })).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Tracks' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Style & sync' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Style & sync' }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Tracks' }).getAttribute('aria-selected')).toBe('true');
  });

  it('includes the off option for native video without saving a disabled remember preference', () => {
    const { setPreference, nativeTrack } = mountMenu({ native: true, remember: false });
    fireEvent.click(screen.getByRole('button', { name: 'Subtitles off' }));
    expect(nativeTrack.mode).toBe('disabled');
    expect(setPreference).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'English (auto-generated)' }));
    expect(nativeTrack.mode).toBe('showing');
    expect(screen.getByRole('button', { name: 'Subtitles off' }).getAttribute('aria-pressed')).toBe('false');
  });
});
