import { useMemo, useState } from 'react';
import { libraryItemHref, resumeHref, timeCode, webHref } from '../catalog';
import { ActionLink, Artwork, Icon } from '../components';
import { useConfirm } from '../ConfirmDialog';
import { EmptyState } from '../EmptyState';
import type { History, LibraryControls } from '../library';
import { useToast } from '../Toast';

const timeOfDay = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
const monthYear = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function groupHeading(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const current = new Date(now);
  const startOfToday = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime();
  if (timestamp >= startOfToday) return 'Today';
  if (timestamp >= startOfToday - 86_400_000) return 'Yesterday';
  if (timestamp >= startOfToday - 7 * 86_400_000) return 'Earlier this week';
  return monthYear.format(date);
}

export function LibraryHistory({ controls }: { controls: LibraryControls }) {
  const confirmAction = useConfirm();
  const { notify } = useToast();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'movie' | 'tv' | 'completed'>('all');
  const [limit, setLimit] = useState(30);

  const rawHistory = useMemo(
    () => Object.entries(controls.library.history).sort(([, a], [, b]) => b.updated - a.updated),
    [controls.library.history],
  );

  const rewatched = useMemo(() => {
    const ids = new Set<string>();
    for (let i = 0; i < rawHistory.length; i++) {
      const [id, entry] = rawHistory[i];
      if (rawHistory.slice(i + 1).some(([, prior]) => prior.mediaKey === entry.mediaKey && prior.completed)) {
        ids.add(id);
      }
    }
    return ids;
  }, [rawHistory]);

  if (!rawHistory.length) {
    return (
      <EmptyState
        icon="clock"
        title="No viewing history yet"
        description="Your playback sessions will appear here after you start watching."
        actions={<ActionLink href={webHref('movies')} primary>Browse movies</ActionLink>}
      />
    );
  }

  const needle = search.trim().toLowerCase();
  const filtered = rawHistory.filter(([, entry]) => {
    if (needle && !entry.item.title.toLowerCase().includes(needle) && !(entry.episode?.title?.toLowerCase().includes(needle))) {
      return false;
    }
    if (filter === 'movie') return entry.item.type === 'movie';
    if (filter === 'tv') return entry.item.type === 'tv';
    if (filter === 'completed') return entry.completed;
    return true;
  });

  const groups = new Map<string, [string, History][]>();
  for (const pair of filtered.slice(0, limit)) {
    const label = groupHeading(pair[1].updated);
    const list = groups.get(label) ?? [];
    list.push(pair);
    groups.set(label, list);
  }

  async function handleClearAll() {
    const ok = await confirmAction({
      title: 'Clear viewing history?',
      message: `Remove all ${rawHistory.length} ${rawHistory.length === 1 ? 'session' : 'sessions'} from your watch history? Your Library statuses and ratings will not be affected.`,
      confirmLabel: 'Clear history',
    });
    if (!ok) return;
    await controls.clearHistory();
    notify({ message: 'Viewing history cleared.', tone: 'default' });
  }

  function handleRemoveEntry(id: string, entry: History) {
    controls.removeHistory(id);
    notify({
      message: `Removed “${entry.item.title}” from history.`,
      tone: 'default',
      action: {
        label: 'Undo',
        onAction: () => controls.recordHistory(id, entry),
      },
    });
  }

  return (
    <div className="af-lib-section">
      <div className="af-lib-toolbar">
        <input
          type="search"
          className="af-input af-lib-search"
          placeholder="Search viewing history…"
          aria-label="Search viewing history"
          value={search}
          onChange={event => setSearch(event.target.value)}
        />
        <div className="af-filters" role="group" aria-label="Filter history">
          {([['all', 'All'], ['movie', 'Movies'], ['tv', 'TV Shows'], ['completed', 'Completed']] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="af-button af-secondary af-lib-clear-btn"
          disabled={!controls.ready || controls.isPending('clear-history')}
          onClick={() => void handleClearAll()}
        >
          Clear history
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="af-state">No history entries match your filter.</p>
      ) : (
        <div className="af-history-groups">
          {[...groups].map(([label, entries]) => (
            <section className="af-history-group" key={label} aria-label={label}>
              <h2 className="af-history-group-title">{label}</h2>
              {entries.map(([id, entry]) => {
                const pct = entry.duration > 0 ? Math.min(100, Math.round((entry.coverage / entry.duration) * 100)) : 0;
                const canResume = !entry.completed && entry.time > 5 && entry.time < entry.duration - 2;
                const thumb = entry.item.backdrop || entry.item.poster;
                const stamp = label === 'Today' || label === 'Yesterday'
                  ? timeOfDay.format(new Date(entry.updated))
                  : shortDate.format(new Date(entry.updated));
                return (
                  <article className="af-history-row" key={id}>
                    <a className="af-history-thumb" href={libraryItemHref(entry.item)} tabIndex={-1} aria-hidden="true">
                      <Artwork src={thumb} loading="lazy" fallback={<Icon name="film" />} />
                    </a>
                    <div className="af-history-copy">
                      <div className="af-history-title-line">
                        <strong><a href={libraryItemHref(entry.item)}>{entry.item.title}</a></strong>
                        {entry.completed && <span className="af-status-chip is-completed">Completed</span>}
                        {rewatched.has(id) && <span className="af-status-chip is-rewatch">Rewatch</span>}
                      </div>
                      {entry.episode && (
                        <p className="af-meta">
                          S{entry.episode.season} E{entry.episode.number}{entry.episode.title ? ` · ${entry.episode.title}` : ''}
                        </p>
                      )}
                      <p className="af-meta af-history-stats">
                        <time dateTime={new Date(entry.updated).toISOString()}>{stamp}</time>
                        {entry.duration > 0 && <span>· {pct}% watched · {timeCode(entry.time)}</span>}
                      </p>
                    </div>
                    <div className="af-history-actions">
                      {canResume && (
                        <ActionLink href={resumeHref(entry.item, entry.mediaKey, entry.episode)}>
                          Resume {timeCode(entry.time)}
                        </ActionLink>
                      )}
                      <button
                        type="button"
                        className="af-icon-button af-history-remove"
                        aria-label={`Remove ${entry.item.title} from history`}
                        title="Remove from history"
                        onClick={() => handleRemoveEntry(id, entry)}
                      >
                        <Icon name="close" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </section>
          ))}
          {filtered.length > limit && (
            <div className="af-pagination">
              <button className="af-button af-secondary" type="button" onClick={() => setLimit(v => v + 30)}>
                Show more history
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
