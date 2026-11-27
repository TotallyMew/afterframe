import { PageHeading, RouteTabs } from './Catalogue';
import type { LibraryControls } from './library';
import { LibraryCollection } from './library/LibraryCollection';
import { LibraryHistory } from './library/LibraryHistory';
import { LibraryNotifications } from './library/LibraryNotifications';
import { LibraryRatings } from './library/LibraryRatings';
import './library/library.css';

function renderLibrarySection(path: string, query: string, controls: LibraryControls) {
  if (controls.state === 'loading') {
    return (
      <output className="af-state">
        {controls.error ? 'Your library is unavailable.' : 'Loading your library…'}
      </output>
    );
  }
  if (path === 'notifications') return <LibraryNotifications controls={controls} />;
  if (path === 'watchlist' || path === 'watched') {
    return (
      <LibraryCollection
        mode="video"
        controls={controls}
        query={query}
        forcedStatus={path === 'watched' ? 'completed' : undefined}
      />
    );
  }
  if (path === 'reading') return <LibraryCollection mode="reading" controls={controls} query={query} />;
  if (path === 'ratings') return <LibraryRatings controls={controls} />;
  return <LibraryHistory controls={controls} />;
}

export function LibraryPage({ path, query, controls }: Readonly<{ path: string; query: string; controls: LibraryControls }>) {
  const { library } = controls;
  const savedAll = Object.values(library.saved);
  const videoCount = savedAll.filter(item => item.type !== 'comic').length;
  const readingCount = savedAll.filter(item => item.type === 'comic').length;
  const ratingCount = Object.keys(library.ratings).length;
  const historyCount = Object.keys(library.history).length;

  const isNotifications = path === 'notifications';
  const activeTab = path === 'watched' ? 'watchlist' : path;

  const tabs: readonly (readonly [string, string])[] = [
    ['watchlist', videoCount ? `Library (${videoCount})` : 'Library'],
    ['reading', readingCount ? `Reading (${readingCount})` : 'Reading'],
    ['ratings', ratingCount ? `Ratings (${ratingCount})` : 'Ratings'],
    ['history', historyCount ? `History (${historyCount})` : 'History'],
  ];

  return (
    <div className="af-wrap af-directory">
      <PageHeading title={isNotifications ? 'Notifications' : 'Library'} />
      {!isNotifications && <RouteTabs label="Library sections" active={activeTab} tabs={tabs} />}
      {renderLibrarySection(path, query, controls)}
    </div>
  );
}
