import { Dialog } from '@base-ui/react/dialog';
import { useEffect, useRef } from 'react';
import { Icon } from './components';

const groups = [
  {
    title: 'Navigation',
    items: [
      { keys: ['/', 'Ctrl K'], label: 'Open search & command palette' },
      { keys: ['?'], label: 'Show keyboard shortcuts' },
      { keys: ['Esc'], label: 'Close open dialog or drawer' },
    ],
  },
  {
    title: 'Video player',
    items: [
      { keys: ['Space'], label: 'Play or pause' },
      { keys: ['←', '→', 'J', 'L'], label: 'Seek backward or forward 10 seconds' },
      { keys: ['↑', '↓'], label: 'Volume up or down 10%' },
      { keys: ['M'], label: 'Mute or unmute audio' },
      { keys: ['C'], label: 'Toggle subtitles' },
      { keys: ['S'], label: 'Skip active intro, recap, or credits' },
      { keys: ['T'], label: 'Toggle theatre mode' },
      { keys: ['E'], label: 'Toggle episodes drawer' },
      { keys: ['F'], label: 'Toggle fullscreen' },
      { keys: ['Shift P', 'Shift N'], label: 'Previous or next episode' },
      { keys: ['0–9'], label: 'Jump to 0%–90% of video' },
    ],
  },
  {
    title: 'Manga reader',
    items: [
      { keys: ['←', '→'], label: 'Previous or next page' },
      { keys: ['+', '-', '0'], label: 'Zoom in, zoom out, or reset zoom' },
      { keys: ['M', 'X'], label: 'Toggle floating reader controls' },
      { keys: ['G'], label: 'Open chapters menu' },
      { keys: ['S'], label: 'Open reader settings' },
      { keys: ['D'], label: 'Flip reading direction (RTL / LTR)' },
      { keys: ['F'], label: 'Toggle fullscreen' },
    ],
  },
] as const;

export function ShortcutsDialog({
  open,
  onOpenChange,
  singleKeyShortcuts = true,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  singleKeyShortcuts?: boolean;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!singleKeyShortcuts) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable=true]')) return;
      if (event.key === '?') {
        if (!open && document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        event.preventDefault();
        if (!open) {
          const active = document.activeElement;
          returnFocusRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
        }
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange, singleKeyShortcuts]);

  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Backdrop className="af-scrim" />
      <Dialog.Popup
        className="af-modal af-shortcuts-modal"
        initialFocus={closeRef}
        finalFocus={() => returnFocusRef.current?.isConnected ? returnFocusRef.current : document.getElementById('main')}
      >
        <header className="af-section-head">
          <Dialog.Title>Keyboard shortcuts</Dialog.Title>
          <Dialog.Close ref={closeRef} className="af-icon-button" aria-label="Close shortcuts">
            <Icon name="close" />
          </Dialog.Close>
        </header>
        <div className="af-shortcuts-grid">
          {groups.map(group => (
            <section key={group.title} className="af-shortcuts-group" aria-labelledby={`af-keys-${group.title}`}>
              <h3 id={`af-keys-${group.title}`}>{group.title}</h3>
              <dl>
                {group.items.map(item => (
                  <div className="af-shortcut-row" key={item.label}>
                    <dt>{item.label}</dt>
                    <dd>
                      {item.keys.map((key, idx) => (
                        <span key={key}>
                          {idx > 0 && <span className="af-shortcut-sep" aria-hidden="true">/</span>}
                          <kbd className="af-kbd">{key}</kbd>
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}
