import { isAnime } from '@afterframe/shared/discover';
import { useEffect, useRef, useState } from 'react';
import { formatDate, libraryItemHref, navigate, request, resumeHref, routeWithParams, timeCode, webHref, type Comic, type Details, type Title } from './catalog';
import { InputField, PageHeading, ResultsSummary, RouteTabs, SelectField } from './Catalogue';
import { AccountButton } from './Account';
import { ActionLink, MediaCard, MutationStatus, Shelf } from './components';
import { ComicCard, readerHref } from './Comics';
import { useConfirm } from './ConfirmDialog';
import { EmptyState } from './EmptyState';
import {
  buildLibraryExport, countLibraryEntries, parseLibraryImport, readingStatuses, savedRating, titleCoverage, watchStatuses,
  type LibraryControls, type SavedTitle, type WatchStatus,
} from './library';
import { useToast } from './Toast';
import { AfSelect, FilterPopover } from './UiControls';

const watchStatusOptions = Object.entries(watchStatuses).map(([value, label]) => ({ value, label }));
const readingStatusOptions = Object.entries(readingStatuses).map(([value, label]) => ({ value, label }));

const tabs = [['watchlist', 'Watchlist'], ['watched', 'Watched'], ['history', 'History'], ['ratings', 'My ratings'], ['reading', 'Reading'], ['notifications', 'Notifications']] as const;
const ratingFilters = Array.from({ length: 10 }, (_, index) => [String(index + 1), `${index + 1}+`] as const);
const sorting = [['recent', 'Recently added'], ['title', 'Title A–Z'], ['rating', 'Your rating'], ['progress', 'Watch progress'], ['status', 'Watch status'], ['genre', 'Genre']] as const;
const readingSorting = [['recent', 'Recently added'], ['title', 'Title A–Z'], ['rating', 'Your rating'], ['status', 'Reading status']] as const;
const comicFormats = [['manga', 'Manga'], ['manhwa', 'Manhwa'], ['manhua', 'Manhua'], ['comic', 'Comics']] as const;
const progression = [['unstarted', 'Unstarted'], ['started', 'Started'], ['complete', 'Complete']] as const;
const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

type VideoSaved = SavedTitle & Title;
type ComicSaved = SavedTitle & Comic;
function isVideo(item: SavedTitle): item is VideoSaved { return item.type !== 'comic'; }
function isComic(item: SavedTitle): item is ComicSaved { return item.type === 'comic'; }

function Watchlist({ controls, query: appliedQuery }: { controls: LibraryControls; query: string }) {
  const filters = new URLSearchParams(appliedQuery);
  const [saving, setSaving] = useState<string[]>([]);
  const [problem, setProblem] = useState('');
  const [completionError, setCompletionError] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const searchTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(searchTimer.current), []);

  function applyLiveFilter(form: HTMLFormElement, replace = true, overrides?: Record<string, string>) {
    const next = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      if (typeof value === 'string' && value.trim() && !(key === 'sort' && value.trim() === 'recent')) next.set(key, value.trim());
    }
    if (overrides) {
      for (const [key, value] of Object.entries(overrides)) {
        if (value.trim() && !(key === 'sort' && value.trim() === 'recent')) next.set(key, value.trim());
        else next.delete(key);
      }
    }
    const afterVal = next.get('after'), beforeVal = next.get('before');
    if (afterVal && beforeVal && afterVal > beforeVal) {
      setProblem('The first added date must come before the last added date.');
      return;
    }
    setProblem('');
    navigate(routeWithParams('watchlist', next), { replace });
  }
  const { library } = controls;
  const saved = Object.values(library.saved).filter(isVideo);
  const lookup = (name: string) => filters.get(name) || '';
  const progress = new Map(saved.map(item => [item.key, titleCoverage(item, library)]));
  const { type, status, genre, rating, coverage, after, before, query, sort } = Object.fromEntries(
    ['type', 'status', 'genre', 'rating', 'coverage', 'after', 'before', 'query', 'sort'].map(key => [key, lookup(key)]));
  const requiredTitle = query.toLocaleLowerCase();
  const genreNames = [...new Set(saved.flatMap(item => item.genre ? [item.genre] : []))].sort();
  const items = saved.filter(item => (!requiredTitle || item.title.toLocaleLowerCase().includes(requiredTitle)) &&
    (!type || (type === 'anime' ? isAnime(item.originalLanguage, item.genreIds) : item.type === type)) &&
    (!status || (item.watchStatus ?? 'planned') === status) && (!genre || item.genre === genre) &&
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

  const onSelectFilter = (name: string) => (value: string) => {
    if (formRef.current) applyLiveFilter(formRef.current, true, { [name]: value });
  };
  const moreWatchlistCount = ['after', 'before', 'rating', 'coverage'].filter(key => Boolean(lookup(key))).length;

  if (!saved.length) return <EmptyState icon="bookmark" title="Your watchlist is empty" description="Save a film or series to track what you plan to watch next." actions={<ActionLink primary href={webHref('movies')}>Browse movies</ActionLink>} />;
  return <>
    <form ref={formRef} className="af-field-bar" onSubmit={event => {
      event.preventDefault();
      applyLiveFilter(event.currentTarget, false);
    }} onChange={event => {
      const form = event.currentTarget;
      const target = event.target as HTMLElement;
      if (target instanceof HTMLInputElement && target.type === 'search') {
        clearTimeout(searchTimer.current);
        searchTimer.current = window.setTimeout(() => applyLiveFilter(form, true), 150);
      } else {
        applyLiveFilter(form, true);
      }
    }}>
      <InputField label="Title" type="search" name="query" defaultValue={lookup('query')} maxLength={180} />
      <SelectField label="Type" name="type" value={lookup('type')} empty="All titles" options={[['movie', 'Movies'], ['tv', 'TV Shows'], ['anime', 'Anime']]} onChange={onSelectFilter('type')} />
      <SelectField label="Watch plan" name="status" value={lookup('status')} empty="All statuses" options={Object.entries(watchStatuses)} onChange={onSelectFilter('status')} />
      <SelectField label="Genre" name="genre" value={lookup('genre')} empty="All genres" options={genreNames.map(value => [value, value])} onChange={onSelectFilter('genre')} />
      <SelectField label="Sort by" name="sort" value={lookup('sort') || 'recent'} options={sorting} onChange={onSelectFilter('sort')} />
      <FilterPopover activeCount={moreWatchlistCount}>
        <SelectField label="Personal rating" name="rating" value={lookup('rating')} empty="Any rating" options={ratingFilters} onChange={onSelectFilter('rating')} />
        <SelectField label="Progress" name="coverage" value={lookup('coverage')} empty="Any progress" options={progression} onChange={onSelectFilter('coverage')} />
        <InputField label="Added from" type="date" name="after" defaultValue={lookup('after')} aria-invalid={Boolean(problem)} aria-describedby={problem ? 'watchlist-error' : undefined} />
        <InputField label="Added through" type="date" name="before" defaultValue={lookup('before')} />
      </FilterPopover>
    </form>
    {problem && <p className="af-state" id="watchlist-error" role="alert">{problem}</p>}
    <ResultsSummary count={items.length} route="watchlist" filters={filters} clear={webHref('watchlist')} labels={{
      status: value => watchStatuses[value as WatchStatus] ?? '',
      type: value => value === 'tv' ? 'TV Shows' : value === 'movie' ? 'Movies' : value === 'anime' ? 'Anime' : '',
      sort: value => value !== 'recent' ? sorting.find(([key]) => key === value)?.[1] ?? '' : '',
    }} />
    {items.length ? <div className="af-poster-grid">{items.map(item => <div className="af-library-card" key={item.key}>
      <MediaCard item={item} controls={controls} href={libraryItemHref(item)} />
      <div className="af-library-card-footer">
        <span className="af-meta af-library-progress-line">{progress.get(item.key) ? `Viewing progress ${progress.get(item.key)}%` : '\u00A0'}</span>
        {item.archiveId || !Number.isSafeInteger(item.id) ? <span className="af-meta">{watchStatuses[item.watchStatus ?? 'planned']}</span>
          : <AfSelect
            className="af-library-status-select"
            ariaLabel={`Plan for ${item.title}`}
            value={item.watchStatus ?? 'planned'}
            disabled={!controls.ready || saving.includes(item.key) || controls.isPending(item.key)}
            options={watchStatusOptions}
            onChange={value => void changeStatus(item, value as WatchStatus)}
          />}
      </div>
      {saving.includes(item.key) && !controls.isPending(item.key) && <p className="af-meta" role="status">Checking aired episodes…</p>}
      {completionError[item.key] && <p className="af-meta" role="alert">{completionError[item.key]} <button type="button" className="af-text-link" onClick={() => void changeStatus(item, 'completed')}>Retry completion</button></p>}
    </div>)}</div> : <p className="af-state">No titles match these filters.</p>}
  </>;
}

function titleGrid(path: 'ratings' | 'watched', controls: LibraryControls) {
  const { library } = controls;
  const entries: (Title | Comic)[] = path === 'ratings'
    ? Object.values(library.ratings).sort((a, b) => b.updated - a.updated).map(({ item }) => item)
    : [...new Map([
      ...Object.values(library.watched),
      ...Object.values(library.saved).filter((item): item is VideoSaved => isVideo(item) && item.watchStatus === 'completed')
        .map(item => ({ item, updated: item.completedAt || item.added })),
    ].sort((a, b) => b.updated - a.updated).map(({ item }) => [item.key, item])).values()];
  if (!entries.length) return <EmptyState
    icon="film"
    title={path === 'ratings' ? 'No ratings yet' : 'No watched titles yet'}
    description={path === 'ratings' ? 'Rate a movie, series, or comic from its details page.' : 'Watched films and episodes will appear here.'}
    actions={<ActionLink href={webHref('movies')} primary>Browse movies</ActionLink>}
  />;
  return <div className="af-poster-grid">{entries.map(item => <div className="af-library-card" key={item.key}>
    {item.type === 'comic'
      ? <ComicCard item={item} controls={controls} />
      : <MediaCard item={item} controls={controls} href={libraryItemHref(item)} />}
    {path === 'ratings' && <span className="af-meta">Your rating {savedRating(library.ratings[item.key])}/10</span>}
  </div>)}</div>;
}

function HistoryList({ controls }: { controls: LibraryControls }) {
  const [limit, setLimit] = useState(20);
  const history = Object.entries(controls.library.history).sort(([, a], [, b]) => b.updated - a.updated);
  if (!history.length) return <EmptyState
    icon="clock"
    title="No viewing history yet"
    description="Your playback sessions will appear here after you start watching."
    actions={<ActionLink href={webHref('movies')} primary>Browse movies</ActionLink>}
  />;
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
  if (!controls.account) return <EmptyState
    icon="clock"
    title="Follow release updates"
    description="Sign in to receive notifications for newly aired episodes and season premieres of followed series."
    actions={<AccountButton className="af-button af-primary">Sign in</AccountButton>}
  />;
  if (!entries.length) return <EmptyState
    icon="clock"
    title="All caught up"
    description="New episodes and season premieres for followed series will appear here."
    actions={<ActionLink href={webHref('tv')}>Browse TV shows</ActionLink>}
  />;
  return <section className="af-section" aria-label="Release notifications">
    {entries.map(([key, entry]) => <article className="af-activity-row" key={key}>
      <div><strong><a href={webHref(`tv/${entry.seriesId}`)}>{entry.title}</a></strong>
        <p className="af-meta">{entry.message.replace(/ \(TMDb\)/gi, '')}</p><p className="af-meta">{formatDate(new Date(entry.created).toISOString())}</p></div>
      {entry.source?.startsWith('https://') && <a className="af-text-link" href={entry.source} target="_blank" rel="noopener noreferrer">Announcement</a>}
      {!entry.read && <button className="af-text-link" type="button" disabled={!controls.ready || controls.isPending(key)} onClick={() => void controls.markNotification(key)}>Mark as read</button>}<MutationStatus itemKey={key} controls={controls} />
    </article>)}
  </section>;
}

function ReadingList({ controls, query: appliedQuery }: { controls: LibraryControls; query: string }) {
  const { notify } = useToast();
  const filters = new URLSearchParams(appliedQuery);
  const formRef = useRef<HTMLFormElement>(null);
  const searchTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(searchTimer.current), []);
  const lookup = (name: string) => filters.get(name) || '';
  const applyReadingFilter = (form: HTMLFormElement, replace = true, overrides?: Record<string, string>) => {
    const next = new URLSearchParams();
    for (const [key, value] of new FormData(form)) if (typeof value === 'string' && value.trim() && !(key === 'sort' && value.trim() === 'recent')) next.set(key, value.trim());
    if (overrides) {
      for (const [key, value] of Object.entries(overrides)) {
        if (value.trim() && !(key === 'sort' && value.trim() === 'recent')) next.set(key, value.trim());
        else next.delete(key);
      }
    }
    navigate(routeWithParams('reading', next), { replace });
  };
  const onSelectReading = (name: string) => (value: string) => {
    if (formRef.current) applyReadingFilter(formRef.current, true, { [name]: value });
  };
  const recent = Object.values(controls.library.reading).sort((a, b) => b.updated - a.updated).slice(0, 12);
  const saved = Object.values(controls.library.saved).filter(isComic);
  const { query, format, status, rating, sort } = Object.fromEntries(
    ['query', 'format', 'status', 'rating', 'sort'].map(key => [key, lookup(key)]),
  );
  const requiredTitle = query.toLocaleLowerCase();
  const items = saved.filter(item =>
    (!requiredTitle || item.title.toLocaleLowerCase().includes(requiredTitle)) &&
    (!format || item.format === format) &&
    (!status || (item.watchStatus ?? 'planned') === status) &&
    (!rating || savedRating(controls.library.ratings[item.key]) >= Number(rating)),
  );
  items.sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    if (sort === 'rating') return savedRating(controls.library.ratings[b.key]) - savedRating(controls.library.ratings[a.key]);
    if (sort === 'status') return Object.keys(readingStatuses).indexOf(a.watchStatus ?? 'planned') - Object.keys(readingStatuses).indexOf(b.watchStatus ?? 'planned');
    return b.added - a.added;
  });

  return <>
    {recent.length > 0 && <Shelf title="Continue reading">{recent.map(entry => <ComicCard item={entry.item} controls={controls} key={entry.item.key}
      href={readerHref(entry.item, entry.chapter, entry.language, entry.listPage, entry.page)} context={`${entry.label} · Page ${entry.page}`}
      onDismiss={() => {
        void controls.removeReading(entry.item.key);
        notify({ message: `Removed “${entry.item.title}” from Continue reading.`, tone: 'default' });
      }} />)}</Shelf>}
    <section className="af-section"><header className="af-section-head"><h2>Reading list</h2><a className="af-text-link" href={webHref('comics')}>Browse comics</a></header>
      {!saved.length ? <EmptyState
        icon="book"
        headingLevel={3}
        title="Your reading list is empty"
        description="Save a manga, manhwa, or comic to track your reading status and ratings here."
        actions={<ActionLink primary href={webHref('comics')}>Browse comics</ActionLink>}
      />
        : <>
          <form ref={formRef} className="af-field-bar" onSubmit={event => {
            event.preventDefault();
            applyReadingFilter(event.currentTarget, false);
          }} onChange={event => {
            const form = event.currentTarget;
            const target = event.target as HTMLElement;
            if (target instanceof HTMLInputElement && target.type === 'search') {
              clearTimeout(searchTimer.current);
              searchTimer.current = window.setTimeout(() => applyReadingFilter(form, true), 150);
            } else {
              applyReadingFilter(form, true);
            }
          }}>
            <InputField label="Title" type="search" name="query" defaultValue={query} maxLength={180} />
            <SelectField label="Format" name="format" value={format} empty="All formats" options={comicFormats} onChange={onSelectReading('format')} />
            <SelectField label="Reading plan" name="status" value={status} empty="All statuses" options={Object.entries(readingStatuses)} onChange={onSelectReading('status')} />
            <SelectField label="Personal rating" name="rating" value={rating} empty="Any rating" options={ratingFilters} onChange={onSelectReading('rating')} />
            <SelectField label="Sort by" name="sort" value={sort || 'recent'} options={readingSorting} onChange={onSelectReading('sort')} />
          </form>
          <ResultsSummary count={items.length} route="reading" filters={filters} clear={webHref('reading')} labels={{
            status: value => readingStatuses[value as WatchStatus] ?? '',
            format: value => comicFormats.find(([key]) => key === value)?.[1] ?? '',
            sort: value => value !== 'recent' ? readingSorting.find(([key]) => key === value)?.[1] ?? '' : '',
          }} />
          {items.length ? <div className="af-poster-grid">{items.map(item => {
            const score = savedRating(controls.library.ratings[item.key]);
            return <div className="af-library-card" key={item.key}>
              <ComicCard item={item} controls={controls} />
              <div className="af-library-card-footer">
                <span className="af-meta af-library-progress-line">{score > 0 ? `Your rating ${score}/10` : '\u00A0'}</span>
                <AfSelect
                  className="af-library-status-select"
                  ariaLabel={`Reading status for ${item.title}`}
                  value={item.watchStatus ?? 'planned'}
                  disabled={!controls.ready || controls.isPending(item.key)}
                  options={readingStatusOptions}
                  onChange={value => void controls.setComicStatus(item, value as WatchStatus)}
                />
              </div>
            </div>;
          })}</div> : <p className="af-state">No comics match these filters.</p>}
        </>}
    </section>
  </>;
}

export function LibraryPage({ path, query, controls }: { path: string; query: string; controls: LibraryControls }) {
  const confirmAction = useConfirm();
  const { notify } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const unread = Object.values(controls.library.notifications).filter(entry => !entry.read).length;

  function exportJson() {
    const bundle = buildLibraryExport(controls.library);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `afterframe-library-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    notify({ message: 'Library exported as JSON.', tone: 'success' });
  }

  async function handleImportFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 2_097_152) {
      notify({ message: 'Import file must be 2 MB or smaller.', tone: 'error' });
      return;
    }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const incoming = parseLibraryImport(parsed);
      if (!incoming) {
        notify({ message: 'This file does not look like an Afterframe library backup.', tone: 'error' });
        return;
      }
      const counts = countLibraryEntries(incoming);
      const summary = [
        counts.saved ? `${counts.saved} saved` : '',
        counts.watched ? `${counts.watched} watched` : '',
        counts.ratings ? `${counts.ratings} rated` : '',
        counts.progress ? `${counts.progress} playback` : '',
        counts.reading ? `${counts.reading} reading` : '',
        counts.history ? `${counts.history} history` : '',
      ].filter(Boolean).join(', ');
      if (!summary) {
        notify({ message: 'This backup file contains no library records to import.', tone: 'error' });
        return;
      }
      const ok = await confirmAction({
        title: 'Import library backup?',
        message: `Merge ${summary} into your ${controls.account ? 'account' : 'browser'} library? Existing items are kept unless the backup entry is newer.`,
        confirmLabel: 'Import backup',
      });
      if (!ok) return;
      setImporting(true);
      const result = await controls.importLibrary(incoming);
      notify({
        message: result.totalImported > 0
          ? `Imported ${result.totalImported} ${result.totalImported === 1 ? 'record' : 'records'} from backup.`
          : 'Your library already has the latest version of all records in this backup.',
        tone: 'success',
      });
    } catch (problem) {
      notify({ message: problem instanceof Error ? problem.message : 'Could not read that JSON file.', tone: 'error' });
    } finally {
      setImporting(false);
    }
  }

  return <div className="af-wrap af-directory">
    <div className="af-library-header">
      <PageHeading title={tabs.find(([key]) => key === path)?.[1] ?? 'My Library'}>My Library</PageHeading>
      {controls.ready && <div className="af-actions af-library-tools">
        <button type="button" className="af-button af-secondary" onClick={exportJson}>Export JSON</button>
        <button type="button" className="af-button af-secondary" disabled={importing} onClick={() => fileInputRef.current?.click()}>
          {importing ? 'Importing…' : 'Import JSON'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          aria-label="Import library JSON file"
          onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            void handleImportFile(file);
          }}
        />
      </div>}
    </div>
    <RouteTabs label="Library" active={path} tabs={tabs.map(([id, name]) => [id, id === 'notifications' && unread ? `${name} (${unread})` : name])} />
    {controls.state === 'loading' ? <p className="af-state" role="status">{controls.error ? 'Your library is unavailable.' : 'Loading your library…'}</p>
      : path === 'watchlist' ? <Watchlist controls={controls} query={query} />
        : path === 'watched' || path === 'ratings' ? titleGrid(path, controls)
          : path === 'history' ? <HistoryList controls={controls} />
            : path === 'reading' ? <ReadingList controls={controls} query={query} /> : <Notifications controls={controls} />}
  </div>;
}
