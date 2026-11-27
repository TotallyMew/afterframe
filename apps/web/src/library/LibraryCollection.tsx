import { Popover } from '@base-ui/react/popover';
import { isAnime } from '@afterframe/shared/discover';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  comicCover, libraryItemHref, navigate, playerHref, playHref, request, resumeHref, routeWithParams, webHref,
  type Comic, type Details, type Title,
} from '../catalog';
import { InputField, ResultsSummary, SelectField } from '../Catalogue';
import { ActionLink, Artwork, Icon, MediaCard, Shelf, tmdbImageSet, tmdbImageSize } from '../components';
import { ComicCard, readerHref } from '../ComicCard';
import { EmptyState } from '../EmptyState';
import {
  effectiveWatchStatus, progressPercent, readingStatuses, resumeEntries, resumeFor, savedRating, titleCoverage,
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
}: Readonly<{
  status: WatchStatus;
  labels: Record<WatchStatus, string>;
  itemTitle: string;
  disabled: boolean;
  onSelect: (next: WatchStatus) => void;
}>) {
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
                aria-pressed={option === status}
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
  canEditStatus,
  onChangeStatus,
}: Readonly<{
  item: SavedTitle;
  status: WatchStatus;
  score: number;
  labels: Record<WatchStatus, string>;
  controls: LibraryControls;
  disabled: boolean;
  canEditStatus: boolean;
  onChangeStatus: (next: WatchStatus) => void;
}>) {
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
            {canEditStatus && (
              <div className="af-card-menu-section">
                <span className="af-card-menu-label">Status</span>
                <div className="af-card-menu-statuses">
                  {statusOrder.map(option => (
                    <button
                      key={option}
                      type="button"
                      className={`af-card-menu-pill is-${option} ${option === status ? 'is-selected' : ''}`}
                      aria-pressed={option === status}
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
            )}

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
                      aria-pressed={score === val}
                      aria-label={`Rate ${val} out of 10`}
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
                              void controls.toggleFolderItem(folder.id, item.key)?.then(ok => {
                                if (!ok) return;
                                notify({
                                  message: checked
                                    ? `Removed “${item.title}” from ${folder.name}.`
                                    : `Added “${item.title}” to ${folder.name}.`,
                                  tone: 'default',
                                });
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

function shouldKeepFilterValue(key: string, value: string): boolean {
  return Boolean(value) && !(key === 'sort' && value === 'recent');
}

function readBaseFilterParams(form: HTMLFormElement | null, filters: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams();
  if (!form) {
    for (const [key, value] of filters) next.set(key, value);
    return next;
  }
  for (const [key, value] of new FormData(form)) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (shouldKeepFilterValue(key, trimmed)) next.set(key, trimmed);
  }
  return next;
}

function applyFilterOverrides(next: URLSearchParams, overrides: Record<string, string>) {
  for (const [key, value] of Object.entries(overrides)) {
    const trimmed = value.trim();
    if (shouldKeepFilterValue(key, trimmed)) next.set(key, trimmed);
    else next.delete(key);
  }
}

function buildNextFilterParams(
  form: HTMLFormElement | null,
  filters: URLSearchParams,
  overrides?: Record<string, string>,
): URLSearchParams {
  const next = readBaseFilterParams(form, filters);
  const preserveStatus = filters.get('status');
  if (preserveStatus && (!overrides || !('status' in overrides))) next.set('status', preserveStatus);
  const preserveFolder = filters.get('folder');
  if (preserveFolder && (!overrides || !('folder' in overrides))) next.set('folder', preserveFolder);
  if (overrides) applyFilterOverrides(next, overrides);
  return next;
}

function matchesCoverage(coverage: string, pct: number): boolean {
  if (!coverage) return true;
  if (coverage === 'complete') return pct === 100;
  if (coverage === 'started') return pct > 0 && pct < 100;
  if (coverage === 'unstarted') return pct === 0;
  return true;
}

function matchesVideoItem(
  item: SavedTitle,
  params: { type: string; genre: string; after: string; before: string; coverage: string },
  pct: number,
): boolean {
  if (params.type) {
    if (item.type === 'comic') return false;
    const typeOk = params.type === 'anime' ? isAnime(item.originalLanguage, item.genreIds) : item.type === params.type;
    if (!typeOk) return false;
  }
  if (params.genre && (item.type === 'comic' || item.genre !== params.genre)) return false;
  if (params.after && item.added < Date.parse(`${params.after}T00:00:00`)) return false;
  if (params.before && item.added > Date.parse(`${params.before}T23:59:59.999`)) return false;
  return matchesCoverage(params.coverage, pct);
}

function formatRemainingMinutes(rem: number): string {
  if (rem < 60) return `${rem} min left`;
  const mins = rem % 60;
  const minPart = mins ? `${mins} min ` : '';
  return `${Math.floor(rem / 60)} hr ${minPart}left`;
}

function formatVideoTypeLabel(value: string): string {
  if (value === 'tv') return 'TV Shows';
  if (value === 'movie') return 'Movies';
  if (value === 'anime') return 'Anime';
  return '';
}

function formatGridMetaLine(
  item: SavedTitle,
  epInfo: { watched: number; total?: number } | null,
  status: WatchStatus,
): string {
  if (item.type === 'comic') {
    const formatName = comicFormats.find(([k]) => k === item.format)?.[1] || 'Manga';
    return [item.year, formatName].filter(Boolean).join(' · ');
  }
  if (epInfo && epInfo.watched > 0 && status !== 'completed') {
    const epLabel = epInfo.total ? `${epInfo.watched}/${epInfo.total} ep` : `${epInfo.watched} ep`;
    return [item.year, epLabel].filter(Boolean).join(' · ');
  }
  return [item.year, item.genre || (item.type === 'tv' ? 'TV series' : 'Movie')].filter(Boolean).join(' · ');
}

function resolveLibraryPlayHref(item: VideoSaved, library: LibraryControls['library']): string {
  const isArchive = Boolean(item.archiveId) || !Number.isSafeInteger(item.id) || !/^(movie|tv)-\d+$/.test(item.key);
  if (isArchive) return playerHref(`edition/${encodeURIComponent(item.key)}/watch`);
  if (item.type === 'tv') return playHref(item, resumeFor(library, item)?.episode ?? { season: 1, number: 1 });
  return playHref(item);
}

function LibraryGridCard({
  item,
  status,
  score,
  pct,
  epInfo,
  itemFolders,
  labels,
  controls,
  isSaving,
  completionError,
  onStatusChange,
}: Readonly<{
  item: SavedTitle;
  status: WatchStatus;
  score: number;
  pct: number;
  epInfo: { watched: number; total?: number } | null;
  itemFolders: { id: string; name: string; color: string }[];
  labels: Record<WatchStatus, string>;
  controls: LibraryControls;
  isSaving: boolean;
  completionError: string;
  onStatusChange: (item: SavedTitle, next: WatchStatus) => void;
}>) {
  const poster = item.type === 'comic' ? comicCover(item.poster) : item.poster;
  const busy = !controls.ready || isSaving || controls.isPending(item.key);
  const canEditStatus = item.type === 'comic' || (!item.archiveId && Number.isSafeInteger(item.id));
  const metaLine = formatGridMetaLine(item, epInfo, status);

  return (
    <article className="af-lib-card">
      <div className="af-lib-poster-wrap">
        <a className="af-lib-card-link" href={libraryItemHref(item)} tabIndex={-1} aria-hidden="true">
          <span className="af-poster">
            <Artwork
              src={item.type === 'comic' ? poster : tmdbImageSize(poster, 'w342')}
              srcSet={item.type === 'comic' ? undefined : tmdbImageSet(poster, [185, 342, 500])}
              sizes="(max-width: 640px) 44vw, 190px"
              loading="lazy"
              decoding="async"
              fallback={<Icon name={item.type === 'comic' ? 'book' : 'film'} />}
            />
          </span>
        </a>
        {pct > 0 && pct < 100 && (
          <progress className="af-progress af-card-progress" max={100} value={pct} aria-label={`${item.title} ${pct}% watched`} />
        )}

        {canEditStatus ? (
          <StatusPillPopover
            status={status}
            labels={labels}
            itemTitle={item.title}
            disabled={busy}
            onSelect={next => onStatusChange(item, next)}
          />
        ) : (
          <span className={`af-poster-status is-${status}`}>
            <span className={`af-status-dot is-${status}`} aria-hidden="true" />
            <span>{labels[status]}</span>
          </span>
        )}

        <div className="af-lib-poster-right">
          {score > 0 && (
            <span className="af-poster-rating-pill">
              <span className="sr-only">Rated </span>
              <span aria-hidden="true">★</span> {score}
              <span className="sr-only"> out of 10</span>
            </span>
          )}
          <CardQuickMenu
            item={item}
            status={status}
            score={score}
            labels={labels}
            controls={controls}
            disabled={busy}
            canEditStatus={canEditStatus}
            onChangeStatus={next => onStatusChange(item, next)}
          />
        </div>
      </div>

      <a className="af-lib-card-copy" href={libraryItemHref(item)}>
        <strong title={item.title}>{item.title}</strong>
        <span className="af-card-meta">
          {metaLine}
          {itemFolders.length > 0 && (
            <span className="af-card-folder-dots" title={itemFolders.map(f => f.name).join(', ')}>
              <span className="sr-only">Folders: {itemFolders.map(f => f.name).join(', ')}</span>
              {itemFolders.slice(0, 3).map(f => (
                <span key={f.id} className={`af-folder-dot is-${f.color}`} aria-hidden="true" />
              ))}
            </span>
          )}
        </span>
      </a>
      {isSaving && !controls.isPending(item.key) && <output className="af-meta">Updating…</output>}
      {completionError && (
        <p className="af-meta" role="alert">
          {completionError}{' '}
          <button type="button" className="af-text-link" onClick={() => onStatusChange(item, 'completed')}>Retry</button>
        </p>
      )}
    </article>
  );
}

function LibraryListRow({
  item,
  mode,
  status,
  score,
  pct,
  epInfo,
  itemFolders,
  labels,
  statusOptions,
  controls,
  isSaving,
  onSelectFolder,
  onStatusChange,
}: Readonly<{
  item: SavedTitle;
  mode: 'video' | 'reading';
  status: WatchStatus;
  score: number;
  pct: number;
  epInfo: { watched: number; total?: number } | null;
  itemFolders: { id: string; name: string; color: string }[];
  labels: Record<WatchStatus, string>;
  statusOptions: readonly { value: WatchStatus; label: string }[];
  controls: LibraryControls;
  isSaving: boolean;
  onSelectFolder: (folderId: string) => void;
  onStatusChange: (item: SavedTitle, next: WatchStatus) => void;
}>) {
  const poster = item.type === 'comic' ? comicCover(item.poster) : item.poster;
  const busy = !controls.ready || isSaving || controls.isPending(item.key);
  const canEditStatus = item.type === 'comic' || (!item.archiveId && Number.isSafeInteger(item.id));
  const rowMeta = item.type === 'comic'
    ? [item.year, comicFormats.find(([k]) => k === item.format)?.[1] || 'Manga'].filter(Boolean).join(' · ')
    : [item.year, item.genre || (item.type === 'tv' ? 'TV series' : 'Movie')].filter(Boolean).join(' · ');

  return (
    <li className="af-lib-row">
      <a className="af-lib-row-art" href={libraryItemHref(item)} tabIndex={-1} aria-hidden="true">
        <Artwork
          src={item.type === 'comic' ? poster : tmdbImageSize(poster, 'w154')}
          srcSet={item.type === 'comic' ? undefined : tmdbImageSet(poster, [154, 342])}
          sizes="64px"
          loading="lazy"
          fallback={<Icon name={item.type === 'comic' ? 'book' : 'film'} />}
        />
      </a>
      <div className="af-lib-row-main">
        <div className="af-lib-row-title-wrap">
          <a className="af-lib-row-title" href={libraryItemHref(item)}>{item.title}</a>
          <span className="af-meta">{rowMeta}</span>
        </div>
        {itemFolders.length > 0 && (
          <div className="af-lib-row-folders">
            {itemFolders.map(folder => (
              <button
                key={folder.id}
                type="button"
                className="af-mini-folder-tag"
                onClick={() => onSelectFolder(folder.id)}
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
              {epInfo?.total ? `${epInfo.watched}/${epInfo.total} ep` : `${pct}%`}
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
            onChange={value => onStatusChange(item, value as WatchStatus)}
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
          <a className="af-icon-button" href={resolveLibraryPlayHref(item, controls.library)} aria-label={`Play ${item.title}`} title="Play">
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
    </li>
  );
}

function filterLibraryItems(
  pool: SavedTitle[],
  options: {
    mode: 'video' | 'reading';
    requiredTitle: string;
    activeStatus: string;
    type: string;
    format: string;
    genre: string;
    after: string;
    before: string;
    coverage: string;
    rating: string;
    ratings: LibraryControls['library']['ratings'];
    progressMap: Map<string, number>;
    statusMap: Map<string, WatchStatus>;
  },
): SavedTitle[] {
  const { mode, requiredTitle, activeStatus, type, format, genre, after, before, coverage, rating, ratings, progressMap, statusMap } = options;
  return pool.filter(item => {
    if (requiredTitle && !item.title.toLocaleLowerCase().includes(requiredTitle)) return false;
    if (activeStatus && statusMap.get(item.key) !== activeStatus) return false;
    if (mode === 'video' && !matchesVideoItem(item, { type, genre, after, before, coverage }, progressMap.get(item.key) ?? 0)) return false;
    if (mode === 'reading' && format && (item.type !== 'comic' || item.format !== format)) return false;
    return !rating || savedRating(ratings[item.key]) >= Number(rating);
  });
}

function sortLibraryItems(
  items: SavedTitle[],
  sort: string,
  ratings: LibraryControls['library']['ratings'],
  progressMap: Map<string, number>,
  statusMap: Map<string, WatchStatus>,
): SavedTitle[] {
  return [...items].sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    if (sort === 'rating') return savedRating(ratings[b.key]) - savedRating(ratings[a.key]);
    if (sort === 'progress') return (progressMap.get(b.key) ?? 0) - (progressMap.get(a.key) ?? 0);
    if (sort === 'genre') return ((a.type !== 'comic' ? a.genre : '') ?? '').localeCompare((b.type !== 'comic' ? b.genre : '') ?? '');
    if (sort === 'status') return statusOrder.indexOf(statusMap.get(a.key) ?? 'planned') - statusOrder.indexOf(statusMap.get(b.key) ?? 'planned');
    return b.added - a.added;
  });
}

function indexFoldersByItem(folders: NonNullable<LibraryControls['library']['folders']>) {
  const index = new Map<string, (typeof folders)[string][]>();
  for (const folder of Object.values(folders)) {
    for (const key of folder.items) {
      let list = index.get(key);
      if (!list) { list = []; index.set(key, list); }
      list.push(folder);
    }
  }
  return index;
}

function LibraryActiveQueue({
  showActiveQueue,
  mode,
  resumeList,
  readingList,
  controls,
  notify,
}: Readonly<{
  showActiveQueue: boolean;
  mode: 'video' | 'reading';
  resumeList: ReturnType<typeof resumeEntries>;
  readingList: LibraryControls['library']['reading'][string][];
  controls: LibraryControls;
  notify: ReturnType<typeof useToast>['notify'];
}>) {
  if (!showActiveQueue) return null;
  if (mode === 'video' && resumeList.length > 0) {
    return (
      <Shelf title="Continue Watching" href={webHref('history')} hrefLabel="History" landscape>
        {resumeList.map(([key, entry]) => {
          const ep = entry.episode;
          const rem = Math.ceil((entry.duration - entry.time) / 60);
          const left = formatRemainingMinutes(rem);
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
    );
  }
  if (mode === 'reading' && readingList.length > 0) {
    return (
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
    );
  }
  return null;
}

function LibraryControlsToolbar({
  mode,
  pool,
  statusMap,
  activeStatus,
  labels,
  viewMode,
  formRef,
  searchTimer,
  query,
  type,
  genre,
  genreNames,
  format,
  rating,
  coverage,
  after,
  before,
  sort,
  moreCount,
  moreFiltersOpen,
  problem,
  onMoreFiltersOpenChange,
  onUpdateViewMode,
  onApplyLiveFilter,
  onSelectFilter,
}: Readonly<{
  mode: 'video' | 'reading';
  pool: SavedTitle[];
  statusMap: Map<string, WatchStatus>;
  activeStatus: string;
  labels: Record<WatchStatus, string>;
  viewMode: 'grid' | 'list';
  formRef: RefObject<HTMLFormElement | null>;
  searchTimer: RefObject<number | undefined>;
  query: string;
  type: string;
  genre: string;
  genreNames: string[];
  format: string;
  rating: string;
  coverage: string;
  after: string;
  before: string;
  sort: string;
  moreCount: number;
  moreFiltersOpen: boolean;
  problem: string;
  onMoreFiltersOpenChange: (open: boolean) => void;
  onUpdateViewMode: (next: 'grid' | 'list') => void;
  onApplyLiveFilter: (form: HTMLFormElement | null, replace?: boolean, overrides?: Record<string, string>) => void;
  onSelectFilter: (name: string) => (value: string) => void;
}>) {
  return (
    <>
      <div className="af-lib-controls-row">
        <fieldset className="af-lib-status-pills" aria-label="Filter by status">
          <button
            type="button"
            className={`af-status-pill ${!activeStatus ? 'is-active' : ''}`}
            aria-pressed={!activeStatus}
            onClick={() => onApplyLiveFilter(formRef.current, true, { status: '' })}
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
                onClick={() => onApplyLiveFilter(formRef.current, true, { status: active ? '' : status })}
              >
                <span className={`af-status-dot is-${status}`} aria-hidden="true" />
                <span>{labels[status]}</span>
                <span className="af-pill-count">{count}</span>
              </button>
            );
          })}
        </fieldset>

        <fieldset className="af-view-toggle" aria-label="View mode">
          <button
            type="button"
            className={`af-icon-button ${viewMode === 'grid' ? 'is-active' : ''}`}
            aria-pressed={viewMode === 'grid'}
            aria-label="Grid view"
            title="Grid view"
            onClick={() => onUpdateViewMode('grid')}
          >
            <Icon name="grid" />
          </button>
          <button
            type="button"
            className={`af-icon-button ${viewMode === 'list' ? 'is-active' : ''}`}
            aria-pressed={viewMode === 'list'}
            aria-label="List view"
            title="List view"
            onClick={() => onUpdateViewMode('list')}
          >
            <Icon name="list" />
          </button>
        </fieldset>
      </div>

      <form
        ref={formRef}
        className="af-field-bar af-lib-filter-bar"
        onSubmit={event => {
          event.preventDefault();
          onApplyLiveFilter(event.currentTarget, false);
        }}
        onChange={event => {
          const form = event.currentTarget;
          const target = event.target as HTMLElement;
          if (target instanceof HTMLInputElement && target.type === 'search') {
            clearTimeout(searchTimer.current);
            searchTimer.current = window.setTimeout(() => onApplyLiveFilter(form, true), 150);
          } else {
            onApplyLiveFilter(form, true);
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
            <FilterPopover activeCount={moreCount} open={moreFiltersOpen} onOpenChange={onMoreFiltersOpenChange}>
              <SelectField label="Personal rating" name="rating" value={rating} empty="Any rating" options={ratingFilters} onChange={onSelectFilter('rating')} />
              <SelectField label="Progress" name="coverage" value={coverage} empty="Any progress" options={progression} onChange={onSelectFilter('coverage')} />
              <InputField label="Added from" type="date" name="after" defaultValue={after} aria-invalid={Boolean(problem)} aria-describedby={problem ? 'library-error' : undefined} />
              <InputField label="Added through" type="date" name="before" defaultValue={before} aria-invalid={Boolean(problem)} aria-describedby={problem ? 'library-error' : undefined} />
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
    </>
  );
}

function LibraryItemsDisplay({
  items,
  viewMode,
  mode,
  activeFolderName,
  statusMap,
  progressMap,
  library,
  labels,
  statusOptions,
  controls,
  saving,
  completionError,
  foldersForItem,
  onSelectFolder,
  onStatusChange,
}: Readonly<{
  items: SavedTitle[];
  viewMode: 'grid' | 'list';
  mode: 'video' | 'reading';
  activeFolderName?: string;
  statusMap: Map<string, WatchStatus>;
  progressMap: Map<string, number>;
  library: LibraryControls['library'];
  labels: Record<WatchStatus, string>;
  statusOptions: { value: WatchStatus; label: string }[];
  controls: LibraryControls;
  saving: string[];
  completionError: Record<string, string>;
  foldersForItem: (itemKey: string) => NonNullable<LibraryControls['library']['folders']>[string][];
  onSelectFolder: (folderId: string) => void;
  onStatusChange: (target: SavedTitle, next: WatchStatus) => void;
}>) {
  if (items.length === 0) {
    return (
      <div className="af-lib-empty-filtered">
        <p className="af-state">
          {activeFolderName
            ? `No titles in “${activeFolderName}” match these filters yet.`
            : 'No titles match these filters.'}
        </p>
      </div>
    );
  }
  if (viewMode === 'grid') {
    return (
      <div className="af-poster-grid">
        {items.map(item => (
          <LibraryGridCard
            key={item.key}
            item={item}
            status={statusMap.get(item.key) ?? 'planned'}
            score={savedRating(library.ratings[item.key])}
            pct={progressMap.get(item.key) ?? 0}
            epInfo={item.type === 'tv' ? watchedEpisodeCount(item, library) : null}
            itemFolders={foldersForItem(item.key)}
            labels={labels}
            controls={controls}
            isSaving={saving.includes(item.key)}
            completionError={completionError[item.key] || ''}
            onStatusChange={onStatusChange}
          />
        ))}
      </div>
    );
  }
  return (
    <ul className="af-lib-list" aria-label="Library items">
      {items.map(item => (
        <LibraryListRow
          key={item.key}
          item={item}
          mode={mode}
          status={statusMap.get(item.key) ?? 'planned'}
          score={savedRating(library.ratings[item.key])}
          pct={progressMap.get(item.key) ?? 0}
          epInfo={item.type === 'tv' ? watchedEpisodeCount(item, library) : null}
          itemFolders={foldersForItem(item.key)}
          labels={labels}
          statusOptions={statusOptions}
          controls={controls}
          isSaving={saving.includes(item.key)}
          onSelectFolder={onSelectFolder}
          onStatusChange={onStatusChange}
        />
      ))}
    </ul>
  );
}

function useLibraryStatusMutation(
  controls: LibraryControls,
  clearProblem: () => void,
) {
  const [saving, setSaving] = useState<string[]>([]);
  const [completionError, setCompletionError] = useState<Record<string, string>>({});

  async function handleStatusChange(item: SavedTitle, nextStatus: WatchStatus) {
    if (item.type === 'comic') {
      void controls.setComicStatus(item, nextStatus);
      return;
    }
    setCompletionError(current => ({ ...current, [item.key]: '' }));
    setSaving(current => [...current, item.key]);
    clearProblem();
    try {
      const details = item.type === 'tv' && nextStatus === 'completed'
        ? await request<Details>(`/api/tv/${item.id}`)
        : { id: item.id };
      await controls.setStatus({ ...item, totalEpisodes: details.number_of_episodes ?? item.totalEpisodes }, nextStatus, details);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not update this title.';
      setCompletionError(current => ({ ...current, [item.key]: message }));
    } finally {
      setSaving(current => current.filter(key => key !== item.key));
    }
  }

  return { saving, completionError, handleStatusChange };
}

function LibraryEmptyState({ mode }: Readonly<{ mode: 'video' | 'reading' }>) {
  const reading = mode === 'reading';
  return (
    <EmptyState
      icon={reading ? 'book' : 'bookmark'}
      title={reading ? 'Your reading list is empty' : 'Your library is empty'}
      description={reading
        ? 'Save manga, manhwa, or manhua to track your reading status, ratings, and custom folders.'
        : 'Save movies, TV shows, and anime to track what you watch, organize folders, and view your stats.'}
      actions={<ActionLink primary href={webHref(reading ? 'comics' : 'movies')}>
        {reading ? 'Browse manga' : 'Browse movies'}
      </ActionLink>}
    />
  );
}

function buildResultsSummaryLabels(
  labels: Record<WatchStatus, string>,
  folders: NonNullable<LibraryControls['library']['folders']>,
) {
  const allSortings = [...videoSorting, ...readingSorting];
  return {
    status: (value: string) => labels[value as WatchStatus] ?? '',
    folder: (value: string) => folders[value]?.name ? `Folder: ${folders[value].name}` : '',
    type: formatVideoTypeLabel,
    format: (value: string) => comicFormats.find(([key]) => key === value)?.[1] ?? '',
    sort: (value: string) => value === 'recent' ? '' : (allSortings.find(([key]) => key === value)?.[1] ?? ''),
  };
}

function resolveVideoTypeFilter(mode: 'video' | 'reading', type: string): '' | 'movie' | 'tv' | 'anime' {
  if (mode !== 'video') return '';
  if (type === 'movie' || type === 'tv' || type === 'anime') return type;
  return '';
}

function persistViewMode(next: 'grid' | 'list') {
  try { localStorage.setItem(viewModeKey, next); } catch { /* ignore */ }
}

function hasInvalidDateRange(params: URLSearchParams): boolean {
  const afterVal = params.get('after');
  const beforeVal = params.get('before');
  return Boolean(afterVal && beforeVal && afterVal > beforeVal);
}

function extractGenreNames(saved: SavedTitle[]): string[] {
  const names = saved.flatMap(item => item.type !== 'comic' && item.genre ? [item.genre] : []);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

function buildLibraryData(
  library: LibraryControls['library'],
  mode: 'video' | 'reading',
  filters: URLSearchParams,
) {
  const lookup = (name: string) => filters.get(name) || '';
  const allSaved = Object.values(library.saved);
  const saved: SavedTitle[] = mode === 'reading' ? allSaved.filter(isComic) : allSaved.filter(isVideo);
  const folders = library.folders ?? {};
  const activeStatus = lookup('status');
  const activeFolderId = lookup('folder');
  const activeFolder = activeFolderId ? folders[activeFolderId] : undefined;
  const pool: SavedTitle[] = activeFolder
    ? allSaved.filter(item => activeFolder.items.includes(item.key))
    : saved;

  const progressMap = new Map(pool.map(item => [item.key, item.type === 'comic' ? 0 : titleCoverage(item, library)]));
  const statusMap = new Map(pool.map(item => [item.key, effectiveWatchStatus(item, library)]));
  const { type, format, genre, rating, coverage, after, before, query, sort } = Object.fromEntries(
    ['type', 'format', 'genre', 'rating', 'coverage', 'after', 'before', 'query', 'sort'].map(key => [key, lookup(key)]),
  );

  const filtered = filterLibraryItems(pool, {
    mode,
    requiredTitle: query.toLocaleLowerCase(),
    activeStatus,
    type,
    format,
    genre,
    after,
    before,
    coverage,
    rating,
    ratings: library.ratings,
    progressMap,
    statusMap,
  });
  const items = sortLibraryItems(filtered, sort, library.ratings, progressMap, statusMap);
  const moreCount = ['after', 'before', 'rating', 'coverage'].filter(key => Boolean(lookup(key))).length;
  const resumeList = mode === 'video' ? resumeEntries(library).slice(0, 8) : [];
  const readingList = mode === 'reading' ? Object.values(library.reading).sort((a, b) => b.updated - a.updated).slice(0, 8) : [];
  const showActiveQueue = !activeFolderId && (!activeStatus || activeStatus === 'watching');
  const isEmpty = !saved.length && !resumeList.length && !readingList.length && !Object.keys(folders).length;

  return {
    allSaved,
    folders,
    activeStatus,
    activeFolderId,
    activeFolder,
    pool,
    progressMap,
    statusMap,
    type,
    format,
    genre,
    rating,
    coverage,
    after,
    before,
    query,
    sort,
    genreNames: extractGenreNames(saved),
    items,
    moreCount,
    resumeList,
    readingList,
    showActiveQueue,
    isEmpty,
  };
}

export function LibraryCollection({
  mode,
  controls,
  query: appliedQuery,
  forcedStatus,
}: Readonly<{
  mode: 'video' | 'reading';
  controls: LibraryControls;
  query: string;
  forcedStatus?: WatchStatus;
}>) {
  const { notify } = useToast();
  const route = mode === 'reading' ? 'reading' : 'watchlist';
  const filters = useMemo(() => {
    const p = new URLSearchParams(appliedQuery);
    if (forcedStatus && !p.has('status')) p.set('status', forcedStatus);
    return p;
  }, [appliedQuery, forcedStatus]);

  const [viewMode, setViewMode] = useState<'grid' | 'list'>(readViewMode);
  const [problem, setProblem] = useState('');
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const searchTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(searchTimer.current), []);

  const { saving, completionError, handleStatusChange } = useLibraryStatusMutation(controls, () => setProblem(''));

  function updateViewMode(next: 'grid' | 'list') {
    setViewMode(next);
    persistViewMode(next);
  }

  function applyLiveFilter(form: HTMLFormElement | null, replace = true, overrides?: Record<string, string>) {
    const next = buildNextFilterParams(form, filters, overrides);
    if (hasInvalidDateRange(next)) {
      setProblem('The first added date must come before the last added date.');
      setMoreFiltersOpen(true);
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('[name=after]')?.focus());
      return;
    }
    setProblem('');
    navigate(routeWithParams(route, next), { replace });
  }

  const { library } = controls;
  const labels = mode === 'reading' ? readingStatuses : watchStatuses;
  const statusOptions = useMemo(() => statusOrder.map(value => ({ value, label: labels[value] })), [labels]);
  const derived = buildLibraryData(library, mode, filters);
  const allSavedKeys = useMemo(() => new Set(derived.allSaved.map(item => item.key)), [derived.allSaved]);
  const foldersByItem = useMemo(() => indexFoldersByItem(derived.folders), [derived.folders]);
  const foldersForItem = (itemKey: string) => foldersByItem.get(itemKey) ?? [];
  const onSelectFilter = (name: string) => (value: string) => {
    applyLiveFilter(formRef.current, true, { [name]: value });
  };

  if (derived.isEmpty) return <LibraryEmptyState mode={mode} />;

  return (
    <div className="af-lib-section">
      <LibraryStats
        library={library}
        mode={mode}
        mediaType={resolveVideoTypeFilter(mode, derived.type)}
        activeStatus={derived.activeStatus}
        onSelectStatus={status => applyLiveFilter(formRef.current, true, { status })}
        onSelectType={mode === 'video' ? nextType => applyLiveFilter(formRef.current, true, { type: nextType }) : undefined}
      />

      <FolderBar
        controls={controls}
        activeFolderId={derived.activeFolderId}
        onSelectFolder={folder => applyLiveFilter(formRef.current, true, { folder })}
        itemKeys={allSavedKeys}
      />

      <LibraryActiveQueue
        showActiveQueue={derived.showActiveQueue}
        mode={mode}
        resumeList={derived.resumeList}
        readingList={derived.readingList}
        controls={controls}
        notify={notify}
      />

      <LibraryControlsToolbar
        mode={mode}
        pool={derived.pool}
        statusMap={derived.statusMap}
        activeStatus={derived.activeStatus}
        labels={labels}
        viewMode={viewMode}
        formRef={formRef}
        searchTimer={searchTimer}
        query={derived.query}
        type={derived.type}
        genre={derived.genre}
        genreNames={derived.genreNames}
        format={derived.format}
        rating={derived.rating}
        coverage={derived.coverage}
        after={derived.after}
        before={derived.before}
        sort={derived.sort}
        moreCount={derived.moreCount}
        moreFiltersOpen={moreFiltersOpen}
        problem={problem}
        onMoreFiltersOpenChange={setMoreFiltersOpen}
        onUpdateViewMode={updateViewMode}
        onApplyLiveFilter={applyLiveFilter}
        onSelectFilter={onSelectFilter}
      />

      {problem && <p className="af-state" id="library-error" role="alert">{problem}</p>}

      <ResultsSummary
        count={derived.items.length}
        route={route}
        filters={filters}
        clear={webHref(route)}
        labels={buildResultsSummaryLabels(labels, derived.folders)}
      />

      <LibraryItemsDisplay
        items={derived.items}
        viewMode={viewMode}
        mode={mode}
        activeFolderName={derived.activeFolder?.name}
        statusMap={derived.statusMap}
        progressMap={derived.progressMap}
        library={library}
        labels={labels}
        statusOptions={statusOptions}
        controls={controls}
        saving={saving}
        completionError={completionError}
        foldersForItem={foldersForItem}
        onSelectFolder={folderId => applyLiveFilter(formRef.current, true, { folder: folderId })}
        onStatusChange={(target, next) => void handleStatusChange(target, next)}
      />
    </div>
  );
}
