import { Popover } from '@base-ui/react/popover';
import { useState, type FormEvent } from 'react';
import { Icon } from '../components';
import { useConfirm } from '../ConfirmDialog';
import { folderColors, type Folder, type FolderColor, type LibraryControls } from '../library';
import { useToast } from '../Toast';

export function FolderBar({
  controls,
  activeFolderId,
  onSelectFolder,
  itemKeys,
}: {
  controls: LibraryControls;
  activeFolderId: string;
  onSelectFolder: (id: string) => void;
  itemKeys: Set<string>;
}) {
  const confirmAction = useConfirm();
  const { notify } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<FolderColor>('ember');
  const [editing, setEditing] = useState<Folder | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState<FolderColor>('ember');

  const folders = Object.values(controls.library.folders ?? {}).sort((a, b) => a.created - b.created);
  const activeFolder = folders.find(f => f.id === activeFolderId);

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    const created = controls.createFolder(newName, newColor);
    if (!created) return;
    setNewName('');
    setNewColor('ember');
    setCreateOpen(false);
    notify({ message: `Created folder “${created.name}”.`, tone: 'success' });
  }

  function handleRename(event: FormEvent) {
    event.preventDefault();
    if (!editing || !editName.trim()) return;
    void controls.renameFolder(editing.id, editName, editColor);
    notify({ message: `Updated folder “${editName.trim()}”.`, tone: 'success' });
    setEditing(null);
  }

  async function handleDelete(folder: Folder) {
    const ok = await confirmAction({
      title: `Delete “${folder.name}”?`,
      message: 'This deletes the folder only. Your saved movies, shows, and comics stay in your Library.',
      confirmLabel: 'Delete folder',
    });
    if (!ok) return;
    if (activeFolderId === folder.id) onSelectFolder('');
    void controls.deleteFolder(folder.id);
    notify({ message: `Deleted folder “${folder.name}”.`, tone: 'default' });
  }

  return (
    <div className="af-folder-bar" role="region" aria-label="Custom folders">
      <div className="af-folder-chips">
        <button
          type="button"
          className={`af-folder-chip ${!activeFolderId ? 'is-active' : ''}`}
          aria-pressed={!activeFolderId}
          onClick={() => onSelectFolder('')}
        >
          <span>All folders</span>
        </button>

        {folders.map(folder => {
          const count = folder.items.filter(key => itemKeys.has(key)).length;
          const active = activeFolderId === folder.id;
          return (
            <button
              key={folder.id}
              type="button"
              className={`af-folder-chip ${active ? 'is-active' : ''}`}
              aria-pressed={active}
              onClick={() => onSelectFolder(active ? '' : folder.id)}
            >
              <span className={`af-folder-dot is-${folder.color}`} aria-hidden="true" />
              <span>{folder.name}</span>
              <span className="af-folder-count">{count}</span>
            </button>
          );
        })}

        <Popover.Root open={createOpen} onOpenChange={setCreateOpen}>
          <Popover.Trigger className="af-folder-chip af-folder-add" disabled={!controls.ready}>
            <Icon name="plus" />
            <span>New folder</span>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner className="af-popover-positioner" side="bottom" align="start" sideOffset={8}>
              <Popover.Popup className="af-popover-popup af-folder-form-popup">
                <div className="af-popover-head">
                  <Popover.Title className="af-popover-title">New folder</Popover.Title>
                  <Popover.Close className="af-text-link af-popover-done" type="button">Cancel</Popover.Close>
                </div>
                <form className="af-folder-create-inline" onSubmit={handleCreate}>
                  <input
                    type="text"
                    className="af-input"
                    placeholder="e.g. Favorites, Weekend Binge…"
                    aria-label="Folder name"
                    maxLength={50}
                    autoFocus
                    value={newName}
                    onChange={event => setNewName(event.target.value)}
                  />
                  <div className="af-folder-create-row">
                    <div className="af-folder-swatches" role="radiogroup" aria-label="Folder color">
                      {folderColors.map(swatch => (
                        <button
                          key={swatch}
                          type="button"
                          className={`af-folder-swatch is-${swatch} ${newColor === swatch ? 'is-selected' : ''}`}
                          role="radio"
                          aria-checked={newColor === swatch}
                          aria-label={`Color ${swatch}`}
                          onClick={() => setNewColor(swatch)}
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
      </div>

      {activeFolder && (
        <div className="af-folder-active-actions">
          <Popover.Root open={editing?.id === activeFolder.id} onOpenChange={open => {
            if (open) {
              setEditing(activeFolder);
              setEditName(activeFolder.name);
              setEditColor(activeFolder.color);
            } else {
              setEditing(null);
            }
          }}>
            <Popover.Trigger className="af-text-link" type="button">Rename</Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner className="af-popover-positioner" side="bottom" align="end" sideOffset={8}>
                <Popover.Popup className="af-popover-popup af-folder-form-popup">
                  <div className="af-popover-head">
                    <Popover.Title className="af-popover-title">Edit folder</Popover.Title>
                    <Popover.Close className="af-text-link af-popover-done" type="button">Cancel</Popover.Close>
                  </div>
                  <form className="af-folder-create-inline" onSubmit={handleRename}>
                    <input
                      type="text"
                      className="af-input"
                      aria-label="Edit folder name"
                      maxLength={50}
                      value={editName}
                      onChange={event => setEditName(event.target.value)}
                    />
                    <div className="af-folder-create-row">
                      <div className="af-folder-swatches" role="radiogroup" aria-label="Folder color">
                        {folderColors.map(swatch => (
                          <button
                            key={swatch}
                            type="button"
                            className={`af-folder-swatch is-${swatch} ${editColor === swatch ? 'is-selected' : ''}`}
                            role="radio"
                            aria-checked={editColor === swatch}
                            aria-label={`Color ${swatch}`}
                            onClick={() => setEditColor(swatch)}
                          />
                        ))}
                      </div>
                      <button type="submit" className="af-button af-primary af-folder-submit" disabled={!editName.trim()}>
                        Save
                      </button>
                    </div>
                  </form>
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
          <button type="button" className="af-text-link af-danger-link" onClick={() => void handleDelete(activeFolder)}>
            Delete folder
          </button>
        </div>
      )}
    </div>
  );
}
