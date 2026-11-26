import { useState } from 'react';
import { AccountButton } from '../Account';
import { formatDate, webHref } from '../catalog';
import { ActionLink, MutationStatus } from '../components';
import { EmptyState } from '../EmptyState';
import type { LibraryControls } from '../library';
import { useToast } from '../Toast';

export function LibraryNotifications({ controls }: { controls: LibraryControls }) {
  const { notify } = useToast();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const entries = Object.entries(controls.library.notifications).sort(([, a], [, b]) => b.created - a.created);
  const unreadCount = entries.filter(([, entry]) => !entry.read).length;

  if (!controls.account) {
    return (
      <EmptyState
        icon="bell"
        title="Follow release updates"
        description="Sign in to receive notifications for newly aired episodes and season premieres of followed series."
        actions={<AccountButton className="af-button af-primary">Sign in</AccountButton>}
      />
    );
  }
  if (!entries.length) {
    return (
      <EmptyState
        icon="bell"
        title="All caught up"
        description="New episodes and season premieres for followed series will appear here."
        actions={<ActionLink href={webHref('tv')}>Browse TV shows</ActionLink>}
      />
    );
  }

  const visible = filter === 'unread' ? entries.filter(([, entry]) => !entry.read) : entries;

  return (
    <section className="af-lib-section" aria-label="Release notifications">
      <div className="af-lib-toolbar">
        <div className="af-filters" role="group" aria-label="Filter notifications">
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All ({entries.length})
          </button>
          <button type="button" aria-pressed={filter === 'unread'} onClick={() => setFilter('unread')}>
            Unread ({unreadCount})
          </button>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            className="af-button af-secondary af-lib-clear-btn"
            disabled={!controls.ready || controls.isPending('notifications-read-all')}
            onClick={() => {
              void controls.markAllNotificationsRead().then(ok => {
                if (ok) notify({ message: 'All notifications marked as read.', tone: 'success' });
              });
            }}
          >
            Mark all as read
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="af-state">No unread notifications.</p>
      ) : (
        <div className="af-notif-page-list">
          {visible.map(([key, entry]) => (
            <article className={`af-activity-row ${entry.read ? '' : 'is-unread-row'}`} key={key}>
              <div>
                <strong><a href={webHref(`tv/${entry.seriesId}`)}>{entry.title}</a></strong>
                <p className="af-meta">{entry.message.replace(/ \(TMDb\)/gi, '')}</p>
                <p className="af-meta">{formatDate(new Date(entry.created).toISOString())}</p>
              </div>
              <div className="af-actions">
                {entry.source?.startsWith('https://') && (
                  <a className="af-text-link" href={entry.source} target="_blank" rel="noopener noreferrer">Announcement</a>
                )}
                {!entry.read && (
                  <button
                    className="af-text-link"
                    type="button"
                    disabled={!controls.ready || controls.isPending(key)}
                    onClick={() => void controls.markNotification(key)}
                  >
                    Mark as read
                  </button>
                )}
                <MutationStatus itemKey={key} controls={controls} />
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
