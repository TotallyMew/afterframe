import { computeLibraryStats, readingStatuses, watchStatuses, type Library, type WatchStatus } from '../library';

const statusOrder: readonly WatchStatus[] = ['watching', 'completed', 'hold', 'dropped', 'planned'];
const videoScopes = [
  ['', 'All'],
  ['movie', 'Movies'],
  ['tv', 'TV Shows'],
  ['anime', 'Anime'],
] as const;

export function LibraryStats({
  library,
  mode,
  mediaType = '',
  activeStatus,
  onSelectStatus,
  onSelectType,
}: {
  library: Library;
  mode: 'video' | 'reading';
  mediaType?: '' | 'movie' | 'tv' | 'anime';
  activeStatus: string;
  onSelectStatus: (status: WatchStatus | '') => void;
  onSelectType?: (type: '' | 'movie' | 'tv' | 'anime') => void;
}) {
  const overall = computeLibraryStats(library, mode, '');
  if (!overall.totalEntries && !overall.episodes && !overall.ratedCount) return null;

  const stats = mediaType ? computeLibraryStats(library, mode, mediaType) : overall;
  const labels = mode === 'reading' ? readingStatuses : watchStatuses;
  const barTotal = Math.max(1, stats.totalEntries);

  return (
    <section className="af-lib-stats" aria-label={mode === 'reading' ? 'Reading statistics' : 'Library statistics'}>
      {mode === 'video' && onSelectType && (
        <div className="af-lib-stats-scope" role="group" aria-label="Filter statistics by media type">
          {videoScopes.map(([value, label]) => (
            <button
              key={value || 'all'}
              type="button"
              className={`af-stats-scope-btn ${mediaType === value ? 'is-active' : ''}`}
              aria-pressed={mediaType === value}
              onClick={() => onSelectType(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="af-lib-stats-top">
        {mode === 'video' ? (
          <div className="af-lib-stat-headline">
            <span className="af-lib-stat-label">Days:</span>
            <strong className="af-lib-stat-value">{stats.days.toFixed(1)}</strong>
          </div>
        ) : (
          <div className="af-lib-stat-headline">
            <span className="af-lib-stat-label">Active reads:</span>
            <strong className="af-lib-stat-value">{stats.activeReads.toLocaleString()}</strong>
          </div>
        )}
        <div className="af-lib-stat-headline">
          <span className="af-lib-stat-label">Mean Score:</span>
          <strong className="af-lib-stat-value">{stats.meanScore !== null ? stats.meanScore.toFixed(2) : '—'}</strong>
        </div>
      </div>

      <div className={`af-lib-bar ${activeStatus ? 'has-selection' : ''}`} role="img" aria-label="Status distribution bar">
        {statusOrder.map(status => {
          const count = stats.counts[status];
          if (!count) return null;
          const pct = (count / barTotal) * 100;
          return (
            <button
              key={status}
              type="button"
              className={`af-lib-bar-seg is-${status} ${activeStatus === status ? 'is-active' : ''}`}
              style={{ width: `${pct}%` }}
              title={`${labels[status]}: ${count}`}
              aria-label={`Filter by ${labels[status]} (${count})`}
              onClick={() => onSelectStatus(activeStatus === status ? '' : status)}
            />
          );
        })}
      </div>

      <div className="af-lib-stats-body">
        <ul className="af-lib-legend" aria-label="Status breakdown">
          {statusOrder.map(status => {
            const count = stats.counts[status];
            const selected = activeStatus === status;
            return (
              <li key={status}>
                <button
                  type="button"
                  className={`af-lib-legend-btn ${selected ? 'is-active' : ''}`}
                  aria-pressed={selected}
                  onClick={() => onSelectStatus(selected ? '' : status)}
                >
                  <span className={`af-status-dot is-${status}`} aria-hidden="true" />
                  <span className="af-lib-legend-name">{labels[status]}</span>
                  <span className="af-lib-legend-count">{count.toLocaleString()}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <dl className="af-lib-totals">
          <div>
            <dt>Total Entries</dt>
            <dd>{stats.totalEntries.toLocaleString()}</dd>
          </div>
          {mode === 'video' ? (
            <>
              <div>
                <dt>Rewatched</dt>
                <dd>{stats.rewatched.toLocaleString()}</dd>
              </div>
              {mediaType === 'movie' ? (
                <div>
                  <dt>Completed</dt>
                  <dd>{stats.counts.completed.toLocaleString()}</dd>
                </div>
              ) : (
                <div>
                  <dt>Episodes</dt>
                  <dd>{stats.episodes.toLocaleString()}</dd>
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                <dt>Completed</dt>
                <dd>{stats.counts.completed.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Rated</dt>
                <dd>{stats.ratedCount.toLocaleString()}</dd>
              </div>
            </>
          )}
        </dl>
      </div>
    </section>
  );
}
