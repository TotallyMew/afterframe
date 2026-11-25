import { Popover } from '@base-ui/react/popover';
import { isAnime } from '@afterframe/shared/discover';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  comicCover, libraryItemHref, navigate, playHref, request, resumeHref, routeWithParams, webHref,
  type Comic, type Details, type Title,
} from '../catalog';
import { InputField, ResultsSummary, SelectField } from '../Catalogue';
import { ActionLink, Artwork, Icon, MediaCard, Shelf } from '../components';
import { ComicCard, readerHref } from '../Comics';
import { EmptyState } from '../EmptyState';
import {
  effectiveWatchStatus, progressPercent, readingStatuses, resumeEntries, savedRating, titleCoverage,
  watchedEpisodeCount, watchStatuses, type LibraryControls, type SavedTitle, type WatchStatus,
} from '../library';
import { useToast } from '../Toast';
import { AfSelect, FilterPopover } from '../UiControls';
import { FolderBar } from './FolderBar';
import { FolderPickerPopover } from './FolderPickerPopover';
import { LibraryStats } from './LibraryStats';

const ratingFilters = Array.from({ length: 10 }, (_, index) => [String(index + 1), `${index + 1}+`] as const);
const videoSorting = [
  ['recent', 'Recently added'],
  ['title', 'Title A–Z'],
  ['rating', 'Your rating'],
  ['progress', 'Watch progress'],
  ['status', 'Status'],
  ['genre', 'Genre'],
] as const;
const readingSorting = [
  ['recent', 'Recently added'],
  ['title', 'Title A–Z'],
  ['rating', 'Your rating'],
  ['status', 'Status'],
] as const;
const comicFormats = [['manga', 'Manga'], ['manhwa', 'Manhwa'], ['manhua', 'Manhua'], ['comic', 'Comics']] as const;
const progression = [['unstarted', 'Unstarted'], ['started', 'Started'], ['complete', 'Complete']] as const;
const statusOrder: readonly WatchStatus[] = ['watching', 'completed', 'hold', 'dropped', 'planned'];
const inlineRatingOptions = [
  { value: '0', label: 'Rate' },
  ...Array.from({ length: 10 }, (_, index) => ({ value: String(10 - index), label: `★ ${10 - index}` })),
];

type VideoSaved = SavedTitle & Title;
type ComicSaved = SavedTitle & Comic;
function isVideo(item: SavedTitle): item is VideoSaved { return item.type !== 'comic'; }
function isComic(item: SavedTitle): item is ComicSaved { return item.type === 'comic'; }

const viewModeKey = 'afterframe.library.viewMode';
function readViewMode(): 'grid' | 'list' {
  try {
    return localStorage.getItem(viewModeKey) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

function StatusPillPopover({
  status,
  labels,
  itemTitle,
  disabled,
  onSelect,
}: {
  status: WatchStatus;
  labels: Record<WatchStatus, string>;
  itemTitle: string;
  disabled: boolean;
  onSelect: (next: WatchStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={`af-poster-status is-${status}`}
        aria-label={`Status for ${itemTitle}: ${labels[status]}. Change status`}
        disabled={disabled}
      >
        <span className={`af-status-dot is-${status}`} aria-hidden="true" />
        <span>{labels[status]}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="af-popover-positioner" side="bottom" align="start" sideOffset={6}>
          <Popover.Popup className="af-popover-popup af-status-menu">
            {statusOrder.map(option => (
              <button
                key={option}
                type="button"
                className={`af-status-menu-item ${option === status ? 'is-selected' : ''}`}
                onClick={() => {
                  setOpen(false);
                  if (option !== status) onSelect(option);
                }}
              >
                <span className={`af-status-dot is-${option}`} aria-hidden="true" />
                <span>{labels[option]}</span>
                {option === status && <Icon name="check" />}
              </button>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function CardQuickMenu({
  item,
  status,
  score,
  labels,
  controls,
  disabled,
  onChangeStatus,
}: {
  item: SavedTitle;
  status: WatchStatus;
  score: number;
  labels: Record<WatchStatus, string>;
  controls: LibraryControls;
  disabled: boolean;
  onChangeStatus: (next: WatchStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const folders = Object.values(controls.library.folders ?? {}).sort((a, b) => a.created - b.created);
  const { notify } = useToast();

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className="af-icon-button af-card-more"
        aria-label={`Quick actions for ${item.title}`}
        title="Quick actions"
        disabled={disabled}
      >
        <Icon name="more" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="af-popover-positioner" side="bottom" align="end" sideOffset={6}>
          <Popover.Popup className="af-popover-popup af-card-menu">
            <div className="af-card-menu-section">
              <span className="af-card-menu-label">Status</span>
              <div className="af-card-menu-statuses">
                {statusOrder.map(option => (
                  <button
                    key={option}
                    type="button"
                    className={`af-card-menu-pill is-${option} ${option === status ? 'is-selected' : ''}`}
                    onClick={() => {
                      setOpen(false);
                      if (option !== status) onChangeStatus(option);
                    }}
                  >
                    <span className={`af-status-dot is-${option}`} aria-hidden="true" />
                    <span>{labels[option]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="af-card-menu-section">
              <span className="af-card-menu-label">Your rating</span>
              <div className="af-card-menu-scores">
                {Array.from({ length: 10 }, (_, idx) => {
                  const val = idx + 1;
                  return (
                    <button
                      key={val}
                      type="button"
                      className={`af-score-btn ${score === val ? 'is-selected' : ''}`}
                      onClick={() => {
                        setOpen(false);
                        void controls.rate(item, score === val ? 0 : val);
                      }}
                    >
                      {val}
                    </button>
                  );
                })}
              </div>
            </div>

            {folders.length > 0 && (
              <div className="af-card-menu-section">
                <span className="af-card-menu-label">Folders</span>
                <ul className="af-folder-checklist">
                  {folders.map(folder => {
                    const checked = folder.items.includes(item.key);
                    return (
                      <li key={folder.id}>
                        <label className="af-folder-check-row">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              void controls.toggleFolderItem(folder.id, item.key);
                              notify({
                                message: checked
                                  ? `Removed “${item.title}” from ${folder.name}.`
                                  : `Added “${item.title}” to ${folder.name}.`,
                                tone: 'default',
                              });
                            }}
                          />
                          <span className={`af-folder-dot is-${folder.color}`} aria-hidden="true" />
                          <span className="af-folder-check-name">{folder.name}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="af-card-menu-footer">
              <button
                type="button"
                className="af-text-link af-danger-link"
                onClick={() => {
                  setOpen(false);
                  void controls.toggleSaved(item);
                }}
              >
                Remove from {item.type === 'comic' ? 'Reading' : 'Library'}
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function LibraryCollection({
  mode,
  controls,
  query: appliedQuery,
  forcedStatus,
}: {
  mode: 'video' | 'reading';
  controls: LibraryControls;
  query: string;
  forcedStatus?: WatchStatus;
}) {
  const { notify } = useToast();
  const route = mode === 'reading' ? 'reading' : 'watchlist';
  const filters = useMemo(() => {
    const p = new URLSearchParams(appliedQuery);
    if (forcedStatus && !p.has('status')) p.set('status', forcedStatus);
    return p;
  }, [appliedQuery, forcedStatus]);

  const [viewMode, setViewMode] = useState<'grid' | 'list'>(readViewMode);
  const [saving, setSaving] = useState<string[]>([]);
  const [problem, setProblem] = useState('');
  const [completionError, setCompletionError] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const searchTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(searchTimer.current), []);

  function updateViewMode(next: 'grid' | 'list') {
    setViewMode(next);
    try { localStorage.setItem(viewModeKey, next); } catch { /* ignore */ }
  }

  function applyLiveFilter(form: HTMLFormElement | null, replace = true, overrides?: Record<string, string>) {
    const next = new URLSearchParams();
    if (form) {
      for (const [key, value] of new FormData(form)) {
        if (typeof value === 'string' && value.trim() && !(key === 'sort' && value.trim() === 'recent')) {
          next.set(key, value.trim());
        }
      }
    } else {
      for (const [key, value] of filters) next.set(key, value);
    }
    if (filters.get('status') && !overrides?.status && !(overrides && 'status' in overrides)) {
      next.set('status', filters.get('status')!);
    }
    if (filters.get('folder') && !(overrides && 'folder' in overrides)) {
      next.set('folder', filters.get('folder')!);
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
    navigate(routeWithParams(route, next), { replace });
  }

  const { library } = controls;
  const labels = mode === 'reading' ? readingStatuses : watchStatuses;
  const statusOptions = useMemo(() => statusOrder.map(value => ({ value, label: labels[value] })), [labels]);
  const allSaved = Object.values(library.saved);
  const saved: SavedTitle[] = mode === 'reading' ? allSaved.filter(isComic) : allSaved.filter(isVideo);
  const folders = library.folders ?? {};
  const lookup = (name: string) => filters.get(name) || '';
  const activeStatus = lookup('status');
  const activeFolderId = lookup('folder');
  const activeFolder = activeFolderId ? folders[activeFolderId] : undefined;

  // Include mixed-media items when viewing a specific custom folder
  const pool: SavedTitle[] = activeFolder
    ? allSaved.filter(item => activeFolder.items.includes(item.key))
    : saved;

  const progressMap = useMemo(() => new Map(
    pool.map(item => [item.key, item.type === 'comic' ? 0 : titleCoverage(item, library)]),
  ), [pool, library]);

  const statusMap = useMemo(() => new Map(
    pool.map(item => [item.key, effectiveWatchStatus(item, library)]),
  ), [pool, library]);

  const { type, format, genre, rating, coverage, after, before, query, sort } = Object.fromEntries(
    ['type', 'format', 'genre', 'rating', 'coverage', 'after', 'before', 'query', 'sort'].map(key => [key, lookup(key)]),
  );
  const requiredTitle = query.toLocaleLowerCase();
  const genreNames = [...new Set(saved.flatMap(item => item.type !== 'comic' && item.genre ? [item.genre] : []))].sort();

  const items = pool.filter(item => {
    if (requiredTitle && !item.title.toLocaleLowerCase().includes(requiredTitle)) return false;
    if (activeStatus && statusMap.get(item.key) !== activeStatus) return false;
    if (mode === 'video') {
      if (type && (item.type === 'comic' || (type === 'anime' ? !isAnime(item.originalLanguage, item.genreIds) : item.type !== type))) return false;
      if (genre && (item.type === 'comic' || item.genre !== genre)) return false;
      if (after && item.added < Date.parse(`${after}T00:00:00`)) return false;
      if (before && item.added > Date.parse(`${before}T23:59:59.999`)) return false;
      if (coverage) {
        const pct = progressMap.get(item.key) ?? 0;
        if (coverage === 'complete' && pct !== 100) return false;
        if (coverage === 'started' && (!pct || pct === 100)) return false;
        if (coverage === 'unstarted' && pct > 0) return false;
      }
    } else if (format && (item.type !== 'comic' || item.format !== format)) {
      return false;
    }
    if (rating && savedRating(library.ratings[item.key]) < Number(rating)) return false;
    return true;
  });

  items.sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    if (sort === 'rating') return savedRating(library.ratings[b.key]) - savedRating(library.ratings[a.key]);
    if (sort === 'progress') return (progressMap.get(b.key) ?? 0) - (progressMap.get(a.key) ?? 0);
    if (sort === 'genre') return ((a.type !== 'comic' ? a.genre : '') ?? '').localeCompare((b.type !== 'comic' ? b.genre : '') ?? '');
    if (sort === 'status') return statusOrder.indexOf(statusMap.get(a.key) ?? 'planned') - statusOrder.indexOf(statusMap.get(b.key) ?? 'planned');
    return b.added - a.added;
  });

  async function handleStatusChange(item: SavedTitle, nextStatus: WatchStatus) {
    if (item.type === 'comic') {
      void controls.setComicStatus(item, nextStatus);
      return;
    }
    setCompletionError(current => ({ ...current, [item.key]: '' }));
    setSaving(current => [...current, item.key]);
    setProblem('');
    try {
      const details = item.type === 'tv' && nextStatus === 'completed'
        ? await request<Details>(`/api/tv/${item.id}`)
        : { id: item.id };
      await controls.setStatus({ ...item, totalEpisodes: details.number_of_episodes ?? item.totalEpisodes }, nextStatus, details);
    } catch (error) {
      setCompletionError(current => ({ ...current, [item.key]: error instanceof Error ? error.message : 'Could not update this title.' }));
    } finally {
      setSaving(current => current.filter(key => key !== item.key));
    }
  }

  const onSelectFilter = (name: string) => (value: string) => {
    applyLiveFilter(formRef.current, true, { [name]: value });
  };
  const moreCount = ['after', 'before', 'rating', 'coverage'].filter(key => Boolean(lookup(key))).length;

  const resumeList = mode === 'video' ? resumeEntries(library).slice(0, 8) : [];
  const readingList = mode === 'reading' ? Object.values(library.reading).sort((a, b) => b.updated - a.updated).slice(0, 8) : [];
  const showActiveQueue = !activeFolderId && (!activeStatus || activeStatus === 'watching');
  const allSavedKeys = useMemo(() => new Set(allSaved.map(item => item.key)), [allSaved]);

  const foldersForItem = (itemKey: string) =>
    Object.values(folders).filter(folder => folder.items.includes(itemKey));

  if (!saved.length && !resumeList.length && !readingList.length && !Object.keys(folders).length) {
    return (
      <EmptyState
        icon={mode === 'reading' ? 'book' : 'bookmark'}
        title={mode === 'reading' ? 'Your reading list is empty' : 'Your library is empty'}
        description={mode === 'reading'
          ? 'Save manga, manhwa, or comics to track your reading status, ratings, and custom folders.'
          : 'Save movies, TV shows, and anime to track what you watch, organize folders, and view your stats.'}
        actions={<ActionLink primary href={webHref(mode === 'reading' ? 'comics' : 'movies')}>
          {mode === 'reading' ? 'Browse comics' : 'Browse movies'}
        </ActionLink>}
      />
    );
  }

  return (
    <div className="af-lib-section">
      <LibraryStats
        library={library}
        mode={mode}
        mediaType={mode === 'video' && (type === 'movie' || type === 'tv' || type === 'anime') ? type : ''}
        activeStatus={activeStatus}
        onSelectStatus={status => applyLiveFilter(formRef.current, true, { status })}
        onSelectType={mode === 'video' ? nextType => applyLiveFilter(formRef.current, true, { type: nextType }) : undefined}
      />

      <FolderBar
        controls={controls}
        activeFolderId={activeFolderId}
        onSelectFolder={folder => applyLiveFilter(formRef.current, true, { folder })}
        itemKeys={allSavedKeys}
      />

      {showActiveQueue && mode === 'video' && resumeList.length > 0 && (
        <Shelf title="Continue Watching" href={webHref('history')} hrefLabel="History" landscape>
          {resumeList.map(([key, entry]) => {
            const ep = entry.episode;
            const rem = Math.ceil((entry.duration - entry.time) / 60);
            const left = rem >= 60 ? `${Math.floor(rem / 60)} hr ${rem % 60 ? `${rem % 60} min ` : ''}left` : `${rem} min left`;
            return (
              <MediaCard
                key={key}
                item={entry.item}
                controls={controls}
                href={resumeHref(entry.item, key, ep)}
                landscape
                context={ep ? `S${ep.season} E${ep.number} · ${left}` : left}
                percent={progressPercent(entry)}
                onDismiss={() => {
                  controls.recordProgress(key, null);
                  notify({
                    message: `Removed “${entry.item.title}” from Continue Watching.`,
                    tone: 'default',
                    action: { label: 'Undo', onAction: () => controls.recordProgress(key, { ...entry, updated: Date.now() }) },
                  });
                }}
              />
            );
          })}
        </Shelf>
      )}

      {showActiveQueue && mode === 'reading' && readingList.length > 0 && (
        <Shelf title="Continue reading">
          {readingList.map(entry => (
            <ComicCard
              item={entry.item}
              controls={controls}
              key={entry.item.key}
              href={readerHref(entry.item, entry.chapter, entry.language, entry.listPage, entry.page)}
              context={`${entry.label} · Page ${entry.page}`}
              onDismiss={() => {
                void controls.removeReading(entry.item.key);
                notify({ message: `Removed “${entry.item.title}” from Continue reading.`, tone: 'default' });
              }}
            />
          ))}
        </Shelf>
      )}

      <div className="af-lib-controls-row">
        <div className="af-lib-status-pills" role="group" aria-label="Filter by status">
          <button
            type="button"
            className={`af-status-pill ${!activeStatus ? 'is-active' : ''}`}
            aria-pressed={!activeStatus}
            onClick={() => applyLiveFilter(formRef.current, true, { status: '' })}
          >
            All <span className="af-pill-count">{pool.length}</span>
          </button>
          {statusOrder.map(status => {
            const count = pool.filter(item => statusMap.get(item.key) === status).length;
            const active = activeStatus === status;
            return (
              <button
                key={status}
                type="button"
                className={`af-status-pill is-${status} ${active ? 'is-active' : ''}`}
                aria-pressed={active}
                onClick={() => applyLiveFilter(formRef.current, true, { status: active ? '' : status })}
              >
                <span className={`af-status-dot is-${status}`} aria-hidden="true" />
                <span>{labels[status]}</span>
                <span className="af-pill-count">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="af-view-toggle" role="group" aria-label="View mode">
          <button
            type="button"
            className={`af-icon-button ${viewMode === 'grid' ? 'is-active' : ''}`}
            aria-pressed={viewMode === 'grid'}
            aria-label="Grid view"
            title="Grid view"
            onClick={() => updateViewMode('grid')}
          >
            <Icon name="grid" />
          </button>
          <button
            type="button"
            className={`af-icon-button ${viewMode === 'list' ? 'is-active' : ''}`}
            aria-pressed={viewMode === 'list'}
            aria-label="List view"
            title="List view"
            onClick={() => updateViewMode('list')}
          >
            <Icon name="list" />
          </button>
        </div>
      </div>

      <form
        ref={formRef}
        className="af-field-bar af-lib-filter-bar"
        onSubmit={event => {
          event.preventDefault();
          applyLiveFilter(event.currentTarget, false);
        }}
        onChange={event => {
          const form = event.currentTarget;
          const target = event.target as HTMLElement;
          if (target instanceof HTMLInputElement && target.type === 'search') {
            clearTimeout(searchTimer.current);
            searchTimer.current = window.setTimeout(() => applyLiveFilter(form, true), 150);
          } else {
            applyLiveFilter(form, true);
          }
        }}
      >
        <InputField
          label="Search"
          type="search"
          name="query"
          placeholder={mode === 'reading' ? 'Search reading list…' : 'Search titles…'}
          defaultValue={query}
          maxLength={180}
        />
        {mode === 'video' ? (
          <>
            <SelectField label="Type" name="type" value={type} empty="All titles" options={[['movie', 'Movies'], ['tv', 'TV Shows'], ['anime', 'Anime']]} onChange={onSelectFilter('type')} />
            <SelectField label="Genre" name="genre" value={genre} empty="All genres" options={genreNames.map(v => [v, v])} onChange={onSelectFilter('genre')} />
            <SelectField label="Sort by" name="sort" value={sort || 'recent'} options={videoSorting} onChange={onSelectFilter('sort')} />
            <FilterPopover activeCount={moreCount}>
              <SelectField label="Personal rating" name="rating" value={rating} empty="Any rating" options={ratingFilters} onChange={onSelectFilter('rating')} />
              <SelectField label="Progress" name="coverage" value={coverage} empty="Any progress" options={progression} onChange={onSelectFilter('coverage')} />
              <InputField label="Added from" type="date" name="after" defaultValue={after} aria-invalid={Boolean(problem)} aria-describedby={problem ? 'library-error' : undefined} />
              <InputField label="Added through" type="date" name="before" defaultValue={before} />
            </FilterPopover>
          </>
        ) : (
          <>
            <SelectField label="Format" name="format" value={format} empty="All formats" options={comicFormats} onChange={onSelectFilter('format')} />
            <SelectField label="Personal rating" name="rating" value={rating} empty="Any rating" options={ratingFilters} onChange={onSelectFilter('rating')} />
            <SelectField label="Sort by" name="sort" value={sort || 'recent'} options={readingSorting} onChange={onSelectFilter('sort')} />
          </>
        )}
      </form>

      {problem && <p className="af-state" id="library-error" role="alert">{problem}</p>}

      <ResultsSummary
        count={items.length}
        route={route}
        filters={filters}
        clear={webHref(route)}
        labels={{
          status: value => labels[value as WatchStatus] ?? '',
          folder: value => folders[value]?.name ? `Folder: ${folders[value].name}` : '',
          type: value => value === 'tv' ? 'TV Shows' : value === 'movie' ? 'Movies' : value === 'anime' ? 'Anime' : '',
          format: value => comicFormats.find(([key]) => key === value)?.[1] ?? '',
          sort: value => value !== 'recent' ? [...videoSorting, ...readingSorting].find(([key]) => key === value)?.[1] ?? '' : '',
        }}
      />

      {items.length === 0 ? (
        <div className="af-lib-empty-filtered">
          <p className="af-state">
            {activeFolder
              ? `No titles in “${activeFolder.name}” match these filters yet.`
              : 'No titles match these filters.'}
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="af-poster-grid">
          {items.map(item => {
            const status = statusMap.get(item.key) ?? 'planned';
            const score = savedRating(library.ratings[item.key]);
            const pct = progressMap.get(item.key) ?? 0;
            const epInfo = item.type === 'tv' ? watchedEpisodeCount(item, library) : null;
            const itemFolders = foldersForItem(item.key);
            const poster = item.type === 'comic' ? comicCover(item.poster) : item.poster;
            const busy = !controls.ready || saving.includes(item.key) || controls.isPending(item.key);
            const canEditStatus = item.type === 'comic' || (!item.archiveId && Number.isSafeInteger(item.id));
            const metaLine = item.type === 'comic'
              ? [item.year, comicFormats.find(([k]) => k === item.format)?.[1] || 'Comic'].filter(Boolean).join(' · ')
              : epInfo && epInfo.watched > 0 && status !== 'completed'
                ? [item.year, epInfo.total ? `${epInfo.watched}/${epInfo.total} ep` : `${epInfo.watched} ep`].filter(Boolean).join(' · ')
                : [item.year, item.genre || (item.type === 'tv' ? 'TV series' : 'Movie')].filter(Boolean).join(' · ');

            return (
              <article className="af-lib-card" key={item.key}>
                <div className="af-lib-poster-wrap">
                  <a className="af-lib-card-link" href={libraryItemHref(item)}>
                    <span className="af-poster">
                      <Artwork src={poster} loading="lazy" decoding="async" fallback={<Icon name={item.type === 'comic' ? 'book' : 'film'} />} />
                      {pct > 0 && pct < 100 && (
                        <progress className="af-progress af-card-progress" max={100} value={pct} aria-label={`${item.title} ${pct}% watched`} />
                      )}
                    </span>
                  </a>

                  {canEditStatus ? (
                    <StatusPillPopover
                      status={status}
                      labels={labels}
                      itemTitle={item.title}
                      disabled={busy}
                      onSelect={next => void handleStatusChange(item, next)}
                    />
                  ) : (
                    <span className={`af-poster-status is-${status}`}>
                      <span className={`af-status-dot is-${status}`} aria-hidden="true" />
                      <span>{labels[status]}</span>
                    </span>
                  )}

                  <div className="af-lib-poster-right">
                    {score > 0 && (
                      <span className="af-poster-rating-pill" aria-label={`Rated ${score} out of 10`}>
                        <span aria-hidden="true">★</span> {score}
                      </span>
                    )}
                    <CardQuickMenu
                      item={item}
                      status={status}
                      score={score}
                      labels={labels}
                      controls={controls}
                      disabled={busy}
                      onChangeStatus={next => void handleStatusChange(item, next)}
                    />
                  </div>
                </div>

                <a className="af-lib-card-copy" href={libraryItemHref(item)}>
                  <strong title={item.title}>{item.title}</strong>
                  <span className="af-card-meta">
                    {metaLine}
                    {itemFolders.length > 0 && (
                      <span className="af-card-folder-dots" title={itemFolders.map(f => f.name).join(', ')}>
                        {itemFolders.slice(0, 3).map(f => (
                          <span key={f.id} className={`af-folder-dot is-${f.color}`} aria-hidden="true" />
                        ))}
                      </span>
                    )}
                  </span>
                </a>
                {saving.includes(item.key) && !controls.isPending(item.key) && <p className="af-meta" role="status">Updating…</p>}
                {completionError[item.key] && (
                  <p className="af-meta" role="alert">
                    {completionError[item.key]}{' '}
                    <button type="button" className="af-text-link" onClick={() => void handleStatusChange(item, 'completed')}>Retry</button>
                  </p>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="af-lib-list" role="list" aria-label="Library items">
          {items.map(item => {
            const status = statusMap.get(item.key) ?? 'planned';
            const score = savedRating(library.ratings[item.key]);
            const pct = progressMap.get(item.key) ?? 0;
            const epInfo = item.type === 'tv' ? watchedEpisodeCount(item, library) : null;
            const itemFolders = foldersForItem(item.key);
            const poster = item.type === 'comic' ? comicCover(item.poster) : item.poster;
            const busy = !controls.ready || saving.includes(item.key) || controls.isPending(item.key);
            const canEditStatus = item.type === 'comic' || (!item.archiveId && Number.isSafeInteger(item.id));
            return (
              <article className="af-lib-row" role="listitem" key={item.key}>
                <a className="af-lib-row-art" href={libraryItemHref(item)} tabIndex={-1} aria-hidden="true">
                  <Artwork src={poster} loading="lazy" fallback={<Icon name={item.type === 'comic' ? 'book' : 'film'} />} />
                </a>
                <div className="af-lib-row-main">
                  <div className="af-lib-row-title-wrap">
                    <a className="af-lib-row-title" href={libraryItemHref(item)}>{item.title}</a>
                    <span className="af-meta">
                      {item.type === 'comic'
                        ? [item.year, comicFormats.find(([k]) => k === item.format)?.[1] || 'Comic'].filter(Boolean).join(' · ')
                        : [item.year, item.genre || (item.type === 'tv' ? 'TV series' : 'Movie')].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  {itemFolders.length > 0 && (
                    <div className="af-lib-row-folders">
                      {itemFolders.map(folder => (
                        <button
                          key={folder.id}
                          type="button"
                          className="af-mini-folder-tag"
                          onClick={() => applyLiveFilter(formRef.current, true, { folder: folder.id })}
                        >
                          <span className={`af-folder-dot is-${folder.color}`} aria-hidden="true" />
                          <span>{folder.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {item.type !== 'comic' && (pct > 0 || (epInfo && epInfo.watched > 0)) && (
                    <div className="af-lib-row-progress">
                      <progress className="af-progress" max={100} value={pct} aria-label={`${item.title} ${pct}%`} />
                      <span className="af-meta">
                        {epInfo && epInfo.total ? `${epInfo.watched}/${epInfo.total} ep` : `${pct}%`}
                      </span>
                    </div>
                  )}
                </div>

                <div className="af-lib-row-controls">
                  {canEditStatus ? (
                    <AfSelect
                      className="af-lib-row-status"
                      ariaLabel={`Status for ${item.title}`}
                      value={status}
                      disabled={busy}
                      options={statusOptions}
                      onChange={value => void handleStatusChange(item, value as WatchStatus)}
                    />
                  ) : (
                    <span className="af-meta">{labels[status]}</span>
                  )}
                  <AfSelect
                    className="af-lib-row-rating"
                    ariaLabel={`Rating for ${item.title}`}
                    value={String(score)}
                    disabled={busy}
                    options={inlineRatingOptions}
                    onChange={value => void controls.rate(item, Number(value))}
                  />
                  <FolderPickerPopover itemKey={item.key} itemTitle={item.title} controls={controls} compact />
                  {item.type !== 'comic' && (
                    <a className="af-icon-button" href={playHref(item)} aria-label={`Play ${item.title}`} title="Play">
                      <Icon name="play" />
                    </a>
                  )}
                  <button
                    type="button"
                    className="af-icon-button af-lib-row-remove"
                    aria-label={`Remove ${item.title} from ${mode === 'reading' ? 'Reading' : 'Library'}`}
                    title="Remove"
                    disabled={busy}
                    onClick={() => void controls.toggleSaved(item)}
                  >
                    <Icon name="close" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
