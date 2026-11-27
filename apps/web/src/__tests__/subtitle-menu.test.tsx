import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryControls } from '../library';
import { defaultCaptionStyle, SubtitleMenu } from '../player/SubtitleMenu';
import type { VideoWithAudioTracks } from '../player/types';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function mountMenu({ mobile = false, native = false, remember = true } = {}) {
  const setPreference = vi.fn(async () => true);
  const nativeTrack = { mode: 'showing', language: 'en', label: 'English' };
  const videoRef = { current: { textTracks: [nativeTrack] } as unknown as VideoWithAudioTracks };
  const track = { url: 'https://example.com/en.vtt', language: 'English', release: 'English subtitles' };
  function Harness() {
    const [active, setActive] = useState(true);
    return <SubtitleMenu menuRef={createRef()} videoRef={videoRef} isEmbed={!native} useMobileSheets={mobile}
      activeCues={!native && active ? { url: track.url, cues: [] } : null} nativeCaptionsOn={native && active}
      subTracks={[track]} subLang="English" subStatus="" rememberSubtitles={remember} preferredLanguage="en"
      captionStyle={defaultCaptionStyle} controls={{ setPreference } as unknown as LibraryControls}
      onOpen={() => {}} onTurnOff={() => setActive(false)} onEnableNative={() => setActive(true)} onSelectLanguage={() => {}}
      onChooseTrack={() => setActive(true)} onChangeCaptionStyle={() => {}} />;
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
    const off = within(choices).getByRole('button', { name: 'Subtitles off' });
    expect(off.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Off' })).toBeNull();
    fireEvent.click(off);
    expect(off.getAttribute('aria-pressed')).toBe('true');
    expect(nativeTrack.mode).toBe('disabled');
    expect(setPreference).toHaveBeenCalledWith('subtitleLanguage', '', 'Preferred subtitles');
    fireEvent.click(within(choices).getByRole('button', { name: 'English subtitles' }));
    expect(off.getAttribute('aria-pressed')).toBe('false');
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
