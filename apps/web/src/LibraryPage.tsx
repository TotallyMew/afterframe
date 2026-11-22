import { useState } from 'react';
import { formatDate, libraryItemHref, request, resumeHref, routeWithParams, timeCode, webHref, type Details, type Title } from './catalog';
import { InputField, PageHeading, ResultsSummary, RouteTabs, SelectField } from './Catalogue';
import { AccountButton } from './Account';
import { ActionLink, MediaCard, MutationStatus, Shelf } from './components';
import { ComicCard, readerHref } from './Comics';
import { savedRating, titleCoverage, watchStatuses, type LibraryControls, type SavedTitle, type WatchStatus } from './library';

const tabs = [['watchlist', 'Watchlist'], ['watched', 'Watched'], ['history', 'History'], ['ratings', 'My ratings'], ['reading', 'Reading'], ['notifications', 'Notifications']] as const;
const ratingFilters = Array.from({ length: 10 }, (_, index) => [String(index + 1), `${index + 1}+`] as const);
const sorting = [['recent', 'Recently added'], ['title', 'Title A–Z'], ['rating', 'Your rating'], ['progress', 'Watch progress'], ['status', 'Watch status'], ['genre', 'Genre']] as const;
const progression = [['unstarted', 'Unstarted'], ['started', 'Started'], ['complete', 'Complete']] as const;
const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

type VideoSaved = SavedTitle & Title;
function isVideo(item: SavedTitle): item is VideoSaved { return item.type !== 'comic'; }

function Watchlist({ controls, query: appliedQuery }: { controls: LibraryControls; query: string }) {
  const filters = new URLSearchParams(appliedQuery);
  const [saving, setSaving] = useState<string[]>([]);
  const [problem, setProblem] = useState('');
  const [completionError, setCompletionError] = useState<Record<string, string>>({});
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
    setCompletionError(current => ({ ...current, [item.key]: '' }));
    setSaving(current => [...current, item.key]);
    setProblem('');
    try {
      const details = item.type === 'tv' && value === 'completed'
        ? await request<Details>(`/api/tv/${item.id}`)
        : { id: item.id };
      await controls.setStatus({ ...item, totalEpisodes: details.number_of_episodes ?? item.totalEpisodes }, value, details);
    } catch (error) {
      setCompletionError(current => ({ ...current, [item.key]: error instanceof Error ? error.message : 'Could not update this title.' }));
    } finally {
      setSaving(current => current.filter(key => key !== item.key));
    }
  }

  if (!saved.length) return <div className="af-empty-state"><h2>Your watchlist is empty</h2><p>Save a film or series to find it here.</p><ActionLink primary href={webHref('movies')}>Browse movies</ActionLink></div>;
  return <>
    <form className="af-field-bar" onSubmit={event => {
      event.preventDefault();
      const next = new URLSearchParams();
      for (const [key, value] of new FormData(event.currentTarget)) if (typeof value === 'string' && value.trim()) next.set(key, value.trim());
      const after = next.get('after'), before = next.get('before');
      if (after && before && after > before) {
        setProblem('The first added date must come before the last added date.');
        event.currentTarget.querySelector<HTMLInputElement>('[name=after]')?.focus();
        return;
      }
      setProblem('');
      window.location.hash = routeWithParams('watchlist', next);
    }}>
      <InputField label="Title" type="search" name="query" defaultValue={lookup('query')} maxLength={180} />
      <SelectField label="Type" name="type" value={lookup('type')} empty="All titles" options={ [['movie', 'Movies'], ['tv', 'TV Shows']] } />
      <SelectField label="Watch plan" name="status" value={lookup('status')} empty="All statuses" options={Object.entries(watchStatuses)} />
      <SelectField label="Genre" name="genre" value={lookup('genre')} empty="All genres" options={genreNames.map(value => [value, value])} />
      <SelectField label="Sort by" name="sort" value={lookup('sort') || 'recent'} options={sorting} />
      <details className="af-more-filters" open={['after', 'before', 'rating', 'coverage'].some(key => filters.has(key)) || undefined}><summary className="af-button af-secondary">More filters</summary><div className="af-filter-panel">
        <SelectField label="Personal rating" name="rating" value={lookup('rating')} empty="Any rating" options={ratingFilters} />
        <SelectField label="Progress" name="coverage" value={lookup('coverage')} empty="Any progress" options={progression} />
        <InputField label="Added from" type="date" name="after" defaultValue={lookup('after')} aria-invalid={Boolean(problem)} aria-describedby={problem ? "watchlist-error" : undefined} /><InputField label="Added through" type="date" name="before" defaultValue={lookup('before')} />
      </div></details>
      <button className="af-button af-secondary" type="submit">Apply filters</button>
    </form>
    {problem && <p className="af-state" id="watchlist-error" role="alert">{problem}</p>}
    <ResultsSummary count={items.length} route="watchlist" filters={filters} clear={webHref('watchlist')} labels={{
      status: value => watchStatuses[value as WatchStatus] ?? '',
      type: value => value === 'tv' ? 'TV Shows' : value === 'movie' ? 'Movies' : '',
      sort: value => value !== 'recent' ? sorting.find(([key]) => key === value)?.[1] ?? '' : '',
    }} />
    {items.length ? <div className="af-poster-grid">{items.map(item => <div className="af-library-card" key={item.key}>
      <MediaCard item={item} controls={controls} href={libraryItemHref(item)} />
      <label>{Boolean(progress.get(item.key)) && <span className="af-meta">Viewing progress {progress.get(item.key)}%</span>}
        {item.archiveId || !Number.isSafeInteger(item.id) ? <span className="af-meta">{watchStatuses[item.watchStatus ?? 'planned']}</span>
          : <select className="af-select" aria-label={`Plan for ${item.title}`} value={item.watchStatus ?? 'planned'}
            disabled={!controls.ready || saving.includes(item.key) || controls.isPending(item.key)} onChange={event => void changeStatus(item, event.target.value as WatchStatus)}>
            {Object.entries(watchStatuses).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
          </select>}
      </label>
      {saving.includes(item.key) && !controls.isPending(item.key) && <p className="af-meta" role="status">Checking aired episodes…</p>}
      {completionError[item.key] && <p className="af-meta" role="alert">{completionError[item.key]} <button type="button" className="af-text-link" onClick={() => void changeStatus(item, 'completed')}>Retry completion</button></p>}
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
  if (!entries.length) return <div className="af-empty-state">
    <h2>{path === 'ratings' ? 'No ratings yet' : 'No watched titles yet'}</h2>
    <p className="af-meta">{path === 'ratings' ? 'Rate a movie or series from its title page.' : 'Watched films and episodes will appear here.'}</p>
    <ActionLink href={webHref('movies')} primary>Browse movies</ActionLink>
  </div>;
  return <div className="af-poster-grid">{entries.map(item => <div className="af-library-card" key={item.key}>
    <MediaCard item={item} controls={controls} href={libraryItemHref(item)} />
    {path === 'ratings' && <span className="af-meta">Your rating {savedRating(library.ratings[item.key])}/10</span>}
  </div>)}</div>;
}

function HistoryList({ controls }: { controls: LibraryControls }) {
  const [limit, setLimit] = useState(20);
  const history = Object.entries(controls.library.history).sort(([, a], [, b]) => b.updated - a.updated);
  if (!history.length) return <div className="af-empty-state"><h2>No viewing history yet</h2>
    <p className="af-meta">Your playback sessions will appear here after you start watching.</p><ActionLink href={webHref('movies')} primary>Browse movies</ActionLink>
  </div>;
  const rewatched = new Set(history.filter(([, entry], index) => history.slice(index + 1).some(([, prior]) =>
    prior.mediaKey === entry.mediaKey && prior.completed)).map(([id]) => id));
  return <section className="af-section af-history" aria-label="Watch history">
    {history.slice(0, limit).map(([key, entry]) => <article className="af-activity-row" key={key}>
      <time className="af-meta af-history-date" dateTime={new Date(entry.updated).toISOString()}>{when.format(new Date(entry.updated))}</time>
      <div><strong><a href={libraryItemHref(entry.item)}>{entry.item.title}</a></strong>
        {entry.episode && <p className="af-meta">S{entry.episode.season} E{entry.episode.number}{entry.episode.title ? ` · ${entry.episode.title}` : ''}</p>}
        <p className="af-meta">{entry.duration > 0 ? `${Math.min(100, Math.round(entry.coverage / entry.duration * 100))}% watched · ` : ''} {timeCode(entry.time)}{entry.completed ? ' · Completed' : ''}{rewatched.has(key) ? ' · Rewatch' : ''}</p>
      </div>
      {!entry.completed && entry.time > 5 && entry.time < entry.duration - 2 && <ActionLink href={resumeHref(entry.item, entry.mediaKey, entry.episode)}>Resume at {timeCode(entry.time)}</ActionLink>}
    </article>)}
    {history.length > limit && <button className="af-button af-secondary" type="button" onClick={() => setLimit(value => value + 20)}>Show more</button>}
  </section>;
}

function Notifications({ controls }: { controls: LibraryControls }) {
  const entries = Object.entries(controls.library.notifications).sort(([, a], [, b]) => b.created - a.created);
  if (!controls.account) return <div className="af-empty-state"><h2>Follow release updates</h2><p className="af-meta">Sign in to receive notifications for followed series.</p><AccountButton className="af-button af-primary">Sign in</AccountButton></div>;
  if (!entries.length) return <p className="af-state">New releases for followed series will appear here.</p>;
  return <section className="af-section" aria-label="Release notifications">
    {entries.map(([key, entry]) => <article className="af-activity-row" key={key}>
      <div><strong><a href={webHref(`tv/${entry.seriesId}`)}>{entry.title}</a></strong>
        <p className="af-meta">{entry.message.replace(/ \(TMDb\)/gi, '')}</p><p className="af-meta">{formatDate(new Date(entry.created).toISOString())}</p></div>
      {entry.source?.startsWith('https://') && <a className="af-text-link" href={entry.source} target="_blank" rel="noopener noreferrer">Announcement</a>}
      {!entry.read && <button className="af-text-link" type="button" disabled={!controls.ready || controls.isPending(key)} onClick={() => void controls.markNotification(key)}>Mark as read</button>}<MutationStatus itemKey={key} controls={controls} />
    </article>)}
  </section>;
}

function ReadingList({ controls }: { controls: LibraryControls }) {
  const recent = Object.values(controls.library.reading).sort((a, b) => b.updated - a.updated).slice(0, 12);
  const saved = Object.values(controls.library.saved).filter(item => item.type === 'comic').sort((a, b) => b.added - a.added);
  return <>
    {recent.length > 0 && <Shelf title="Continue reading">{recent.map(entry => <ComicCard item={entry.item} controls={controls} key={entry.item.key}
      href={readerHref(entry.item, entry.chapter, entry.language, entry.listPage, entry.page)} context={`${entry.label} · Page ${entry.page}`} />)}</Shelf>}
    <section className="af-section"><header className="af-section-head"><h2>Reading list</h2><a className="af-text-link" href={webHref('comics')}>Browse comics</a></header>
      {saved.length ? <div className="af-poster-grid">{saved.map(item => <ComicCard item={item} controls={controls} key={item.key} />)}</div>
        : <p className="af-state">Save a comic to find it here.</p>}
    </section>
  </>;
}

export function LibraryPage({ path, query, controls }: { path: string; query: string; controls: LibraryControls }) {
  const unread = Object.values(controls.library.notifications).filter(entry => !entry.read).length;
  return <div className="af-wrap af-directory">
    <PageHeading title={tabs.find(([key]) => key === path)?.[1] ?? 'My Library'}>My Library</PageHeading>
    <RouteTabs label="Library" active={path} tabs={tabs.map(([id, name]) => [id, id === 'notifications' && unread ? `${name} (${unread})` : name])} />
    {controls.state === 'loading' ? <p className="af-state" role="status">{controls.error ? 'Your library is unavailable.' : 'Loading your library…'}</p>
      : path === 'watchlist' ? <Watchlist key={query} controls={controls} query={query} />
        : path === 'watched' || path === 'ratings' ? titleGrid(path, controls)
          : path === 'history' ? <HistoryList controls={controls} />
            : path === 'reading' ? <ReadingList controls={controls} /> : <Notifications controls={controls} />}
  </div>;
}
