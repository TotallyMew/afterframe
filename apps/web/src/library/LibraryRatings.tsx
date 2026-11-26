import { isAnime } from '@afterframe/shared/discover';
import { useState } from 'react';
import { comicCover, libraryItemHref, webHref, type Comic, type Title } from '../catalog';
import { ActionLink, Artwork, Icon } from '../components';
import { EmptyState } from '../EmptyState';
import { savedRating, type LibraryControls } from '../library';
import { AfSelect } from '../UiControls';

const ratingOptions = [
  { value: '0', label: 'Clear rating' },
  ...Array.from({ length: 10 }, (_, index) => ({ value: String(10 - index), label: `${10 - index} / 10` })),
];
const typeFilters = [
  ['all', 'All'],
  ['movie', 'Movies'],
  ['tv', 'TV Shows'],
  ['anime', 'Anime'],
  ['comic', 'Manga'],
] as const;
const sortOptions = [
  { value: 'highest', label: 'Highest rated' },
  { value: 'lowest', label: 'Lowest rated' },
  { value: 'recent', label: 'Recently rated' },
  { value: 'title', label: 'Title A–Z' },
] as const;

export function LibraryRatings({ controls }: { controls: LibraryControls }) {
  const [mediaFilter, setMediaFilter] = useState<'all' | 'movie' | 'tv' | 'anime' | 'comic'>('all');
  const [selectedScore, setSelectedScore] = useState<number | null>(null);
  const [sort, setSort] = useState<'highest' | 'lowest' | 'recent' | 'title'>('highest');

  const allEntries = Object.values(controls.library.ratings).map(entry => ({
    item: entry.item,
    score: savedRating(entry),
    updated: entry.updated,
  }));

  if (!allEntries.length) {
    return (
      <EmptyState
        icon="film"
        title="No ratings yet"
        description="Rate any movie, series, anime, or manga from its details page or Library list."
        actions={<ActionLink href={webHref('movies')} primary>Browse movies</ActionLink>}
      />
    );
  }

  const matchesMedia = (item: Title | Comic) => {
    if (mediaFilter === 'all') return true;
    if (mediaFilter === 'comic') return item.type === 'comic';
    if (item.type === 'comic') return false;
    if (mediaFilter === 'anime') return isAnime(item.originalLanguage, item.genreIds);
    return item.type === mediaFilter;
  };

  const mediaEntries = allEntries.filter(entry => matchesMedia(entry.item));
  const countsByScore = Array.from({ length: 10 }, (_, index) => {
    const score = index + 1;
    return { score, count: mediaEntries.filter(entry => entry.score === score).length };
  });
  const maxCount = Math.max(1, ...countsByScore.map(b => b.count));

  const visible = mediaEntries
    .filter(entry => selectedScore === null || entry.score === selectedScore)
    .sort((a, b) => {
      if (sort === 'highest') return b.score - a.score || b.updated - a.updated;
      if (sort === 'lowest') return a.score - b.score || b.updated - a.updated;
      if (sort === 'title') return a.item.title.localeCompare(b.item.title);
      return b.updated - a.updated;
    });

  const avg = mediaEntries.length
    ? (mediaEntries.reduce((sum, entry) => sum + entry.score, 0) / mediaEntries.length).toFixed(2)
    : '—';

  return (
    <div className="af-lib-section">
      <section className="af-rating-dist" aria-label="Rating distribution">
        <div className="af-rating-dist-head">
          <div className="af-filters" role="group" aria-label="Filter ratings by media type">
            {typeFilters.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mediaFilter === value}
                onClick={() => { setMediaFilter(value); setSelectedScore(null); }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="af-rating-dist-meta">
            <span className="af-meta">Mean <strong>{avg}</strong> · {mediaEntries.length} rated</span>
            <AfSelect
              ariaLabel="Sort ratings"
              value={sort}
              options={sortOptions}
              onChange={value => setSort(value as typeof sort)}
            />
          </div>
        </div>

        <div className="af-rating-bars" role="group" aria-label="Filter by score">
          {countsByScore.map(({ score, count }) => {
            const active = selectedScore === score;
            const heightPct = count > 0 ? Math.max(14, Math.round((count / maxCount) * 100)) : 4;
            return (
              <button
                key={score}
                type="button"
                className={`af-rating-bar-col ${active ? 'is-active' : ''} ${count === 0 ? 'is-empty' : ''}`}
                aria-pressed={active}
                aria-label={`Score ${score}: ${count} ${count === 1 ? 'title' : 'titles'}`}
                disabled={count === 0 && !active}
                onClick={() => setSelectedScore(active ? null : score)}
              >
                <span className="af-rating-bar-count">{count > 0 ? count : ''}</span>
                <span className="af-rating-bar-track">
                  <span className="af-rating-bar-fill" style={{ height: `${heightPct}%` }} />
                </span>
                <span className="af-rating-bar-label">{score}</span>
              </button>
            );
          })}
        </div>
        {selectedScore !== null && (
          <div className="af-rating-dist-active">
            <span className="af-meta">Showing titles rated <strong>{selectedScore}/10</strong></span>
            <button type="button" className="af-text-link" onClick={() => setSelectedScore(null)}>Show all scores</button>
          </div>
        )}
      </section>

      {visible.length > 0 ? (
        <div className="af-poster-grid">
          {visible.map(({ item, score }) => {
            const poster = item.type === 'comic' ? comicCover(item.poster) : item.poster;
            const subtitle = item.type === 'comic'
              ? [item.year, 'Manga'].filter(Boolean).join(' · ')
              : [item.year, item.genre || (item.type === 'tv' ? 'TV series' : 'Movie')].filter(Boolean).join(' · ');
            return (
              <article className="af-lib-card af-lib-rating-card" key={item.key}>
                <a className="af-lib-card-link" href={libraryItemHref(item)}>
                  <span className="af-poster">
                    <Artwork src={poster} loading="lazy" decoding="async" fallback={<Icon name={item.type === 'comic' ? 'book' : 'film'} />} />
                    <span className="af-poster-rating-pill" aria-label={`Rated ${score} out of 10`}>
                      <span aria-hidden="true">★</span> {score}
                    </span>
                  </span>
                  <strong title={item.title}>{item.title}</strong>
                  <span className="af-card-meta">{subtitle}</span>
                </a>
                <div className="af-lib-rating-edit">
                  <AfSelect
                    className="af-lib-inline-select"
                    ariaLabel={`Edit rating for ${item.title}`}
                    value={String(score)}
                    disabled={!controls.ready || controls.isPending(item.key)}
                    options={ratingOptions}
                    onChange={value => void controls.rate(item, Number(value))}
                  />
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="af-state">No rated titles match this filter.</p>
      )}
    </div>
  );
}
