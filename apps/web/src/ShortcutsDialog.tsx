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
      { keys: ['←', '→'], label: 'Seek backward or forward 10 seconds' },
      { keys: ['F'], label: 'Toggle fullscreen' },
      { keys: ['S'], label: 'Skip active intro, recap, or credits' },
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
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable=true]')) return;
      if (event.key === '?') {
        if (!open && document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Backdrop className="af-scrim" />
      <Dialog.Popup className="af-modal af-shortcuts-modal" initialFocus={closeRef}>
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
