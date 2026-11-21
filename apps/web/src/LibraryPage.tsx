import { useState } from 'react';
import { formatDate, legacyHref, libraryItemHref, request, timeCode, webHref, type Details, type Title } from './catalog';
import { InputField, PageHeading, RouteTabs, SelectField } from './Catalogue';
import { ActionLink, MediaCard, Shelf } from './components';
import { ComicCard, readerHref } from './Comics';
import { savedRating, titleCoverage, watchStatuses, type LibraryControls, type SavedTitle, type WatchStatus } from './library';

const tabs = [['watchlist', 'Watchlist'], ['watched', 'Watched'], ['history', 'History'], ['ratings', 'My ratings'], ['reading', 'Reading'], ['notifications', 'Notifications']] as const;
const ratingFilters = Array.from({ length: 10 }, (_, index) => [String(index + 1), `${index + 1}+`] as const);
const sorting = [['recent', 'Recently added'], ['title', 'Title A–Z'], ['rating', 'Your rating'], ['progress', 'Watch progress'], ['status', 'Watch status'], ['genre', 'Genre']] as const;
const progression = [['unstarted', 'Unstarted'], ['started', 'Started'], ['complete', 'Complete']] as const;
const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

type VideoSaved = SavedTitle & Title;
function isVideo(item: SavedTitle): item is VideoSaved { return item.type !== 'comic'; }

function Watchlist({ controls }: { controls: LibraryControls }) {
  const [filters, setFilters] = useState(new URLSearchParams());
  const [saving, setSaving] = useState('');
  const [problem, setProblem] = useState('');
  const { library } = controls;
  const saved = Object.values(library.saved).filter(isVideo);
  const lookup = (name: string) => filters.get(name) || '';
  const progress = new Map(saved.map(item => [item.key, titleCoverage(item, library)]));
  const { type, status, genre, rating, coverage, after, before, query, sort } = Object.fromEntries(
    ['type', 'status', 'genre', 'rating', 'coverage', 'after', 'before', 'query', 'sort'].map(key => [key, lookup(key)]));
  const requiredTitle = query.toLocaleLowerCase();
  const genreNames = [...new Set(saved.flatMap(item => item.genre ? [item.genre] : []))].sort();
  const items = saved.filter(item => (!requiredTitle || item.title.toLocaleLowerCase().includes(requiredTitle)) &&
    (!type || item.type === type) && (!status || (item.watchStatus ?? 'planned') === status) && (!genre || item.genre === genre) &&
    (!rating || savedRating(library.ratings[item.key]) >= Number(rating)) &&
    (!after || item.added >= Date.parse(`${after}T00:00:00`)) && (!before || item.added <= Date.parse(`${before}T23:59:59.999`)) &&
    (!coverage || (coverage === 'complete' ? progress.get(item.key) === 100
      : coverage === 'started' ? Boolean(progress.get(item.key)) && progress.get(item.key) !== 100 : !progress.get(item.key))));
  items.sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    if (sort === 'rating') return savedRating(library.ratings[b.key]) - savedRating(library.ratings[a.key]);
    if (sort === 'progress') return (progress.get(b.key) ?? 0) - (progress.get(a.key) ?? 0);
    if (sort === 'genre') return (a.genre ?? '').localeCompare(b.genre ?? '');
    if (sort === 'status') return Object.keys(watchStatuses).indexOf(a.watchStatus ?? 'planned') - Object.keys(watchStatuses).indexOf(b.watchStatus ?? 'planned');
    return b.added - a.added;
  });

  async function changeStatus(item: VideoSaved, value: WatchStatus) {
    setSaving(item.key);
    setProblem('');
    try {
      const details = item.type === 'tv' && value === 'completed'
        ? await request<Details>(`/api/tv/${item.id}`)
        : { id: item.id };
      await controls.setStatus({ ...item, totalEpisodes: details.number_of_episodes ?? item.totalEpisodes }, value, details);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not update this title.');
    } finally {
      setSaving('');
    }
  }

  if (!saved.length) return <div className="af-empty-state"><h2>Your watchlist is empty</h2><p>Save a film or series to find it here.</p><ActionLink primary href={webHref('movies')}>Browse movies</ActionLink></div>;
  return <>
    <form className="af-field-bar" onSubmit={event => {
      event.preventDefault();
      const next = new URLSearchParams();
      for (const [key, value] of new FormData(event.currentTarget)) if (typeof value === 'string' && value.trim()) next.set(key, value.trim());
      setFilters(next);
    }}>
      <InputField label="Title" type="search" name="query" maxLength={180} />
      <SelectField label="Type" name="type" empty="All titles" options={ [['movie', 'Movies'], ['tv', 'TV Shows']] } />
      <SelectField label="Status" name="status" empty="All statuses" options={Object.entries(watchStatuses)} />
      <SelectField label="Genre" name="genre" empty="All genres" options={genreNames.map(value => [value, value])} />
      <SelectField label="Sort by" name="sort" value="recent" options={sorting} />
      <details className="af-more-filters"><summary className="af-button af-secondary">More filters</summary><div className="af-filter-panel">
        <SelectField label="Personal rating" name="rating" empty="Any rating" options={ratingFilters} />
        <SelectField label="Progress" name="coverage" empty="Any progress" options={progression} />
        <InputField label="Added from" type="date" name="after" /><InputField label="Added through" type="date" name="before" />
      </div></details>
      <button className="af-button af-secondary" type="submit">Apply filters</button>
    </form>
    {problem && <p className="af-state" role="alert">{problem}</p>}
    <p className="af-meta af-results-count">{items.length} {items.length === 1 ? 'title' : 'titles'}</p>
    {items.length ? <div className="af-poster-grid">{items.map(item => <div className="af-library-card" key={item.key}>
      <MediaCard item={item} controls={controls} href={libraryItemHref(item)} />
      <label>{Boolean(progress.get(item.key)) && <span className="af-meta">{progress.get(item.key)}% watched</span>}
        {item.archiveId || !Number.isSafeInteger(item.id) ? <span className="af-meta">{watchStatuses[item.watchStatus ?? 'planned']}</span>
          : <select className="af-select" aria-label={`Watch status for ${item.title}`} value={item.watchStatus ?? 'planned'}
            disabled={Boolean(saving) || controls.saving} onChange={event => void changeStatus(item, event.target.value as WatchStatus)}>
            {Object.entries(watchStatuses).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
          </select>}
      </label>
    </div>)}</div> : <p className="af-state">No titles match these filters.</p>}
  </>;
}

function titleGrid(path: 'ratings' | 'watched', controls: LibraryControls) {
  const { library } = controls;
  const entries = path === 'ratings'
    ? Object.values(library.ratings).sort((a, b) => b.updated - a.updated).map(({ item }) => item)
    : [...new Map([
      ...Object.values(library.watched),
      ...Object.values(library.saved).filter((item): item is VideoSaved => isVideo(item) && item.watchStatus === 'completed')
        .map(item => ({ item, updated: item.completedAt || item.added })),
    ].sort((a, b) => b.updated - a.updated).map(({ item }) => [item.key, item])).values()];
  if (!entries.length) return <p className="af-state">{path === 'ratings' ? 'Rate a movie or series to find it here.' : 'Mark a title or episode watched to find it here.'}</p>;
  return <div className="af-poster-grid">{entries.map(item => <div className="af-library-card" key={item.key}>
    <MediaCard item={item} controls={controls} href={libraryItemHref(item)} />
    {path === 'ratings' && <span className="af-meta">Your rating {savedRating(library.ratings[item.key])}/10</span>}
  </div>)}</div>;
}

function HistoryList({ controls }: { controls: LibraryControls }) {
  const [limit, setLimit] = useState(20);
  const history = Object.entries(controls.library.history).sort(([, a], [, b]) => b.updated - a.updated);
  if (!history.length) return <p className="af-state">Your playback sessions will appear here after you start watching.</p>;
  const rewatched = new Set(history.filter(([, entry], index) => history.slice(index + 1).some(([, prior]) =>
    prior.mediaKey === entry.mediaKey && prior.completed)).map(([id]) => id));
  return <section className="af-section"><h2>Watch history</h2>
    {history.slice(0, limit).map(([key, entry]) => <article className="af-activity-row" key={key}>
      <div><strong><a href={libraryItemHref(entry.item)}>{entry.item.title}</a></strong>
        {entry.episode && <p className="af-meta">S{entry.episode.season} E{entry.episode.number}{entry.episode.title ? ` · ${entry.episode.title}` : ''}</p>}
        <p className="af-meta">{Math.round(entry.coverage / entry.duration * 100)}% watched · {timeCode(entry.time)}{entry.completed ? ' · Completed' : ''}{rewatched.has(key) ? ' · Rewatch' : ''}</p>
      </div><time className="af-meta" dateTime={new Date(entry.updated).toISOString()}>{when.format(new Date(entry.updated))}</time>
    </article>)}
    {history.length > limit && <button className="af-button af-secondary" type="button" onClick={() => setLimit(value => value + 20)}>Show more</button>}
  </section>;
}

function Notifications({ controls }: { controls: LibraryControls }) {
  const entries = Object.entries(controls.library.notifications).sort(([, a], [, b]) => b.created - a.created);
  if (!controls.account) return <div className="af-state">Sign in to receive notifications for followed series. <ActionLink href={legacyHref('home', 'account')}>Sign in</ActionLink></div>;
  if (!entries.length) return <p className="af-state">New releases for followed series will appear here.</p>;
  return <section className="af-section"><h2>Notifications</h2>
    {entries.map(([key, entry]) => <article className="af-activity-row" key={key}>
      <div><strong><a href={webHref(`tv/${entry.seriesId}`)}>{entry.title}</a></strong>
        <p className="af-meta">{entry.message.replace(/ \(TMDb\)/gi, '')}</p><p className="af-meta">{formatDate(new Date(entry.created).toISOString())}</p></div>
      {entry.source?.startsWith('https://') && <a className="af-text-link" href={entry.source} target="_blank" rel="noopener noreferrer">Announcement</a>}
      {!entry.read && <button className="af-text-link" type="button" disabled={controls.saving} onClick={() => void controls.markNotification(key)}>Mark as read</button>}
    </article>)}
  </section>;
}

function ReadingList({ controls }: { controls: LibraryControls }) {
  const recent = Object.values(controls.library.reading).sort((a, b) => b.updated - a.updated).slice(0, 12);
  const saved = Object.values(controls.library.saved).filter(item => item.type === 'comic').sort((a, b) => b.added - a.added);
  return <>
    {recent.length > 0 && <Shelf title="Continue reading">{recent.map(entry => <ComicCard item={entry.item} controls={controls} key={entry.item.key}
      href={readerHref(entry.item, entry.chapter, entry.language, entry.listPage)} context={`${entry.label} · Page ${entry.page}`} />)}</Shelf>}
    <section className="af-section"><header className="af-section-head"><h2>Reading list</h2><a className="af-text-link" href={webHref('comics')}>Browse comics</a></header>
      {saved.length ? <div className="af-poster-grid">{saved.map(item => <ComicCard item={item} controls={controls} key={item.key} />)}</div>
        : <p className="af-state">Save a comic to find it here.</p>}
    </section>
  </>;
}

export function LibraryPage({ path, controls }: { path: string; controls: LibraryControls }) {
  const unread = Object.values(controls.library.notifications).filter(entry => !entry.read).length;
  return <div className="af-wrap af-directory">
    <PageHeading title="My Library" />
    <RouteTabs label="Library" active={path} tabs={tabs.map(([id, name]) => [id, id === 'notifications' && unread ? `${name} (${unread})` : name])} />
    {!controls.ready ? <p className="af-state" role="status">{controls.error ? 'Your library is unavailable.' : 'Loading your library…'}</p>
      : path === 'watchlist' ? <Watchlist controls={controls} />
        : path === 'watched' || path === 'ratings' ? titleGrid(path, controls)
          : path === 'history' ? <HistoryList controls={controls} />
            : path === 'reading' ? <ReadingList controls={controls} /> : <Notifications controls={controls} />}
  </div>;
}
