import { Popover } from '@base-ui/react/popover';
import { useState, type FormEvent } from 'react';
import { Icon } from '../components';
import { folderColors, type FolderColor, type LibraryControls } from '../library';
import { useToast } from '../Toast';

export function FolderPickerPopover({
  itemKey,
  itemTitle,
  controls,
  compact = false,
  label = 'Folders',
}: {
  itemKey: string;
  itemTitle: string;
  controls: LibraryControls;
  compact?: boolean;
  label?: string;
}) {
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [color, setColor] = useState<FolderColor>('ember');

  const folders = Object.values(controls.library.folders ?? {}).sort((a, b) => a.created - b.created);
  const assignedCount = folders.filter(folder => folder.items.includes(itemKey)).length;

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    const created = await controls.createFolder(trimmed, color, itemKey);
    if (created) {
      setNewName('');
      notify({ message: `Created “${created.name}” and added “${itemTitle}”.`, tone: 'success' });
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={compact
          ? `af-icon-button af-folder-trigger-compact ${assignedCount > 0 ? 'has-folders' : ''}`
          : `af-button af-secondary af-folder-trigger ${assignedCount > 0 ? 'has-folders' : ''}`}
        aria-label={assignedCount > 0 ? `Manage folders for ${itemTitle} (${assignedCount} assigned)` : `Add ${itemTitle} to a folder`}
        title={assignedCount > 0 ? `In ${assignedCount} ${assignedCount === 1 ? 'folder' : 'folders'}` : 'Add to folder'}
        disabled={!controls.ready}
      >
        <Icon name="folder" />
        {!compact && <span>{assignedCount > 0 ? `${label} (${assignedCount})` : label}</span>}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="af-popover-positioner" side="bottom" align="start" sideOffset={6}>
          <Popover.Popup className="af-popover-popup af-folder-picker-popup">
            <div className="af-popover-head">
              <Popover.Title className="af-popover-title">Add to folder</Popover.Title>
              <Popover.Close className="af-text-link af-popover-done" type="button">Done</Popover.Close>
            </div>
            {folders.length > 0 ? (
              <ul className="af-folder-checklist">
                {folders.map(folder => {
                  const checked = folder.items.includes(itemKey);
                  return (
                    <li key={folder.id}>
                      <label className="af-folder-check-row">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={controls.isPending(`folder/${folder.id}`)}
                          onChange={() => {
                            void controls.toggleFolderItem(folder.id, itemKey)?.then(ok => {
                              if (!ok) return;
                              notify({
                                message: checked
                                  ? `Removed “${itemTitle}” from ${folder.name}.`
                                  : `Added “${itemTitle}” to ${folder.name}.`,
                                tone: 'default',
                              });
                            });
                          }}
                        />
                        <span className={`af-folder-dot is-${folder.color}`} aria-hidden="true" />
                        <span className="af-folder-check-name">{folder.name}</span>
                        <span className="af-meta">{folder.items.length}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="af-meta af-folder-empty-hint">No folders yet. Create one below.</p>
            )}
            <form className="af-folder-create-inline" onSubmit={handleCreate}>
              <input
                type="text"
                className="af-input"
                placeholder="New folder name…"
                aria-label="New folder name"
                maxLength={50}
                value={newName}
                onChange={event => setNewName(event.target.value)}
              />
              <div className="af-folder-create-row">
                <div className="af-folder-swatches" role="radiogroup" aria-label="Folder color">
                  {folderColors.map(swatch => (
                    <button
                      key={swatch}
                      type="button"
                      className={`af-folder-swatch is-${swatch} ${color === swatch ? 'is-selected' : ''}`}
                      role="radio"
                      aria-checked={color === swatch}
                      aria-label={`Color ${swatch}`}
                      onClick={() => setColor(swatch)}
                    />
                  ))}
                </div>
                <button type="submit" className="af-button af-primary af-folder-submit" disabled={!newName.trim()}>
                  Create
                </button>
              </div>
            </form>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
