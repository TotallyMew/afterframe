import { comicEditionCredit, comicLanguage, groupComicEditions } from '../../../afterframe/public/comic-display.js';
import { useEffect, useState } from 'react';
import { comicCover, comicDetailsHref, previousBrowse, request, routeWithParams, webHref, type Comic } from './catalog';
import { InputField, PageHeading, ResultsSummary, RouteTabs, SelectField } from './Catalogue';
import { ActionLink, Artwork, Icon, Loading, RatingProblem, SaveButton, Score, Shelf, useOptionalRating } from './components';
import type { LibraryControls } from './library';

const formats = [['', 'All comics'], ['manga', 'Manga'], ['manhwa', 'Manhwa'], ['manhua', 'Manhua'], ['comic', 'Comics']] as const;
const statuses = [['ongoing', 'Ongoing'], ['completed', 'Completed'], ['hiatus', 'On hiatus'], ['cancelled', 'Cancelled']] as const;
const sorts = [['popular', 'Popularity'], ['updated', 'Recently updated'], ['newest', 'Publication year'], ['title', 'Title A–Z']] as const;

export function comicHref(item: Pick<Comic, 'id'>) {
  return comicDetailsHref(item.id);
}

export function readerHref(item: Pick<Comic, 'id'>, chapter: string, language: string, page = 1, position = 1) {
  const variables = new URLSearchParams({ lang: language });
  if (page > 1) variables.set('page', String(page));
  if (position > 1) variables.set('position', String(position));
  const [prior, priorQuery = ''] = location.hash.split('?', 2);
  const back = prior.startsWith('#comic/') ? new URLSearchParams(priorQuery).get('back') : location.hash;
  if (back) variables.set('back', back);
  return webHref(routeWithParams(`comic/${encodeURIComponent(item.id)}/read/${encodeURIComponent(chapter)}`, variables));
}

function comicFacts(item: Comic) {
  const format = formats.find(([key]) => key && key === item.format)?.[1] ?? 'Comics';
  const status = statuses.find(([key]) => key === item.status)?.[1];
  return [format, item.year, status].filter(Boolean).join(' · ');
}

export function ComicCard({ item, controls, href, context, eager }: { item: Comic; controls: LibraryControls; href?: string; context?: string; eager?: boolean }) {
  const cover = comicCover(item.poster);
  return <article className="af-media-card"><a href={href || comicHref(item)}>
    <span className="af-poster"><Artwork src={cover} loading={eager ? 'eager' : 'lazy'} decoding="async" fallback={<Icon name="book" />} /></span>
    <strong>{item.title}</strong><span className="af-card-meta">{context || comicFacts(item)}</span>
  </a><SaveButton item={item} controls={controls} compact /></article>;
}

type ComicsResults = { results: Comic[]; nextPage?: number | null };

export function ComicsPage({ query, controls }: { query: string; controls: LibraryControls }) {
  const params = new URLSearchParams(query);
  const initialPage = Number(params.get('page') || 1);
  const [data, setData] = useState<ComicsResults>();
  const [recent, setRecent] = useState<Comic[]>([]);
  const [genres, setGenres] = useState<NonNullable<Comic['genres']>>([]);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [auxError, setAuxError] = useState({ genres: false, updates: false });
  const [genreAttempt, setGenreAttempt] = useState(0);
  const [updateAttempt, setUpdateAttempt] = useState(0);
  const type = params.get('type') || '';
  const text = params.get('q') || '';
  const selectedGenre = params.get('genre') || '';
  const genreOptions = genres.map(genre => [genre.id, genre.name] as const);
  if (selectedGenre && !genreOptions.some(([id]) => id === selectedGenre)) genreOptions.unshift([selectedGenre, 'Selected genre']);


  useEffect(() => {
    const task = new AbortController();
    const { signal } = task;
    request<ComicsResults>(`/api/comics?${query}`, { signal })
      .then(value => { if (!Array.isArray(value.results)) throw new Error('The comic catalog returned invalid results.'); if (!signal.aborted) setData(value); })
      .catch(problem => { if (!signal.aborted) setError(problem.message); });
    return () => task.abort();
  }, [query, attempt]);

  useEffect(() => {
    const task = new AbortController();
    request<{ genres: NonNullable<Comic['genres']> }>('/api/comics/genres', { signal: task.signal })
      .then(data => {
        if (!Array.isArray(data.genres)) throw new Error('Genres unavailable.');
        if (!task.signal.aborted) {
          setGenres(data.genres);
          setAuxError(current => ({ ...current, genres: false }));
        }
      }).catch(() => { if (!task.signal.aborted) setAuxError(current => ({ ...current, genres: true })); });
    return () => task.abort();
  }, [genreAttempt]);

  useEffect(() => {
    if (query) return;
    const task = new AbortController();
    request<ComicsResults>('/api/comics/updates', { signal: task.signal })
      .then(data => {
        if (!Array.isArray(data.results)) throw new Error('Updates unavailable.');
        if (!task.signal.aborted) {
          setRecent(data.results);
          setAuxError(current => ({ ...current, updates: false }));
        }
      }).catch(() => { if (!task.signal.aborted) setAuxError(current => ({ ...current, updates: true })); });
    return () => task.abort();
  }, [query, updateAttempt]);

  function withParam(name: string, value: string) {
    const update = new URLSearchParams(params);
    update.delete('page');
    if (value) update.set(name, value); else update.delete(name);
    return routeWithParams('comics', update);
  }

  return <div className="af-wrap af-directory">
    <PageHeading title="Comics" />
    <div className="af-catalog-tools">
    <RouteTabs tabs={formats.map(([key, label]) => [withParam('type', key), label])} active={withParam('type', type)} label="Comic formats" />
    <form className="af-field-bar" onSubmit={event => {
      event.preventDefault();
      const update = new URLSearchParams();
      if (type) update.set('type', type);
      for (const [key, value] of new FormData(event.currentTarget)) if (typeof value === 'string' && value.trim()) update.set(key, value.trim());
      window.location.hash = routeWithParams('comics', update);
    }}>
      <div className="af-catalog-search"><InputField name="q" label="Find comics" type="search" maxLength={180} defaultValue={text} /></div>
      <div className="af-facet-with-status">
        <SelectField label="Genre" name="genre" empty="All genres" value={selectedGenre} options={genreOptions} />
        {auxError.genres && <p className="af-meta" role="status">Genres are unavailable. <button type="button" className="af-text-link" onClick={() => setGenreAttempt(value => value + 1)}>Retry genres</button></p>}
      </div>
      <SelectField label="Status" name="status" empty="Any status" value={params.get('status') || ''} options={statuses} />
      <SelectField label="Sort by" name="sort" empty={text ? 'Relevance' : 'Default order'} value={params.get('sort') || ''} options={sorts} />
      <button className="af-button af-primary" type="submit">Apply filters</button>
    </form>
    </div>
    {auxError.updates && <p className="af-state" role="alert">Recently updated comics could not load. <button type="button" className="af-text-link" onClick={() => setUpdateAttempt(value => value + 1)}>Retry updates</button></p>}
    {recent.length > 0 && <Shelf title="Recently updated">
      {recent.map((item, index) => <ComicCard item={item} key={item.key} controls={controls} eager={index < 5} />)}
    </Shelf>}
    {recent.length > 0 && <h2 className="af-comic-catalog-heading">Browse the catalog</h2>}
    <ResultsSummary count={data?.results.length} route="comics" filters={params} clear={webHref('comics')} labels={{
      type: value => formats.find(([key]) => key === value)?.[1] ?? '',
      genre: value => genreOptions.find(([id]) => id === value)?.[1] ?? '',
      status: value => statuses.find(([key]) => key === value)?.[1] ?? '',
      sort: value => sorts.find(([key]) => key === value)?.[1] ?? '',
    }} />
    {error ? <p className="af-state" role="alert">{error} <button className="af-text-link" type="button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry</button></p>
      : !data ? <Loading label="Loading comics…" /> : !data.results.length ? <p className="af-state" role="status">{query ? 'No comics match these filters.' : 'No comics are available in the catalog yet.'}</p>
        : <div className="af-poster-grid">{data.results.map((item, index) => <ComicCard item={item} key={item.key} controls={controls} eager={!recent.length && index < 5} />)}</div>}
    {data && <div className="af-pagination">
      {initialPage > 1 && <ActionLink href={webHref(withParam('page', String(initialPage - 1)))}>Previous page</ActionLink>}
      {data.nextPage && <ActionLink href={webHref(withParam('page', String(data.nextPage)))}>Next page</ActionLink>}
    </div>}
  </div>;
}

type ComicRecord = Comic & { synopsis?: string; author?: string[]; languages: string[]; defaultLanguage: string; malId?: number };
type Chapter = { id: string; label: string; number?: string | number; title?: string; language: string; groups?: (string | { name?: string })[]; source?: string };
type Chapters = { results: Chapter[]; nextPage?: number | null; ranges?: { start: string; end: string }[]; totalChapters?: number; partial?: boolean; preview?: boolean };

export function ComicDetailsPage({ id, query, controls }: { id: string; query: string; controls: LibraryControls }) {
  const [item, setItem] = useState<ComicRecord>();
  const [chapterResult, setChapterResult] = useState<{ key: string; data: Chapters }>();
  const mal = useOptionalRating<number>(item?.malId ? `/api/mal/manga/${item.malId}?status=1` : undefined);
  const [error, setError] = useState('');
  const [chapterError, setChapterError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [chapterAttempt, setChapterAttempt] = useState(0);
  const [chapterPending, setChapterPending] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const params = new URLSearchParams(query);
  const recent = item && controls.library.reading[item.key];
  const preferred = params.get('lang') || recent?.language || item?.defaultLanguage || 'en';
  const language = item?.languages.includes(preferred) ? preferred : item?.defaultLanguage;
  const page = Math.max(1, Math.min(200, Number(params.get('page')) || 1));
  const chapterKey = `${id}:${language}:${page}`;
  const chapters = chapterResult?.key === chapterKey ? chapterResult.data : undefined;

  useEffect(() => {
    const task = new AbortController();
    const { signal } = task;
    request<ComicRecord>(`/api/comics/${id}`, { signal })
      .then(value => {
        if (signal.aborted) return;
        if (!Array.isArray(value.languages) || typeof value.title !== 'string') throw new Error('This comic record is incomplete.');
        setItem(value);

      }).catch(problem => { if (!signal.aborted) setError(problem.message); });
    return () => task.abort();
  }, [id, attempt]);

  useEffect(() => {
    if (!language) return;
    const task = new AbortController();
    const { signal } = task;
    const path = `/api/comics/${id}/chapters?${new URLSearchParams({ lang: language, page: String(page) })}`;
    let complete = false;
    setChapterError('');
    setChapterPending(true);
    request<Chapters>(path, { signal })
      .then(result => {
        if (!Array.isArray(result.results)) throw new Error('The chapter source returned invalid results.');
        complete = true;
        if (!signal.aborted) setChapterResult({ key: chapterKey, data: result });
      })
      .catch(problem => { if (!signal.aborted) setChapterError(problem.message); })
      .finally(() => { if (!signal.aborted) setChapterPending(false); });
    if (page === 1) request<Chapters>(`${path}&scope=native`, { signal }).then(result => {
      if (!signal.aborted && !complete && result.results.length) setChapterResult({ key: chapterKey, data: result });
    }).catch(() => {});
    return () => task.abort();
  }, [id, language, page, chapterAttempt, chapterKey]);

  if (!item || !language) return <div className="af-wrap af-directory">
    <PageHeading title={error ? 'Comic unavailable' : 'Comics'} />
    {error ? <p className="af-state" role="alert">{error} <button className="af-text-link" type="button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry</button></p>
      : <Loading label="Loading comic…" shape="hero" />}
  </div>;
  const cover = coverFailed ? undefined : comicCover(item.poster);
  const first = chapters?.results[0];
  const synopsis = item.synopsis?.split(/\n(?:-{3,}|\*\*Links:)/i)[0].trim();
  const retryChapters = () => { setChapterError(''); setChapterAttempt(value => value + 1); };
  const ranges = chapters?.ranges ?? chapterResult?.data.ranges;
  const listing = (lang: string, range: number) => routeWithParams(`comic/${id}`, new URLSearchParams({ lang, ...(range > 1 ? { page: String(range) } : {}), ...(params.has('back') ? { back: params.get('back')! } : {}) }));
  return <div className="af-wrap af-directory">
    <a href={previousBrowse('comics')} className="af-text-link"><Icon name="left" /> Back to browse</a>
    <section className={`af-comic-intro ${cover ? '' : 'af-no-cover'}`}>
      {cover && <img className="af-comic-cover" src={cover} alt="" fetchPriority="high" onError={() => setCoverFailed(true)} />}
      <div>
        <PageHeading title={item.title} />
        <p className="af-meta">{comicFacts(item)} <Score mal={mal.value} /></p>
        <RatingProblem name="MyAnimeList" rating={mal} />
        {item.author && item.author.length > 0 && <p className="af-meta">{item.author.join(', ')}</p>}
        {synopsis && <p className="af-overview">{synopsis}</p>}
        <div className="af-actions">
          {recent ? <ActionLink primary href={readerHref(item, recent.chapter, recent.language, recent.listPage, recent.page)}>Resume {recent.label} · Page {recent.page}</ActionLink>
            : first && <ActionLink primary href={readerHref(item, first.id, first.language, page)}>{page === 1 ? 'Start reading' : `Read ${first.label}`}</ActionLink>}
          <SaveButton item={item} controls={controls} />
        </div>
      </div>
    </section>
    <section className="af-section" aria-labelledby="chapters-heading">
      <header className="af-section-head"><div><h2 id="chapters-heading">Chapters</h2>{chapters?.totalChapters != null && <p className="af-meta" role="status">{chapters.totalChapters} chapters</p>}</div>
        <div className="af-actions">
          <select className="af-select" aria-label="Language" value={language} onChange={event => { window.location.hash = listing(event.target.value, 1); }}>
            {[...new Set(item.languages)].sort().map(code => <option key={code} value={code}>{comicLanguage(code)}</option>)}
          </select>
          {ranges && ranges.length > 1 && <select className="af-select" aria-label="Chapter range" value={page} onChange={event => { window.location.hash = listing(language, Number(event.target.value)); }}>
            {ranges.map(({ start, end }, index) => <option key={index} value={index + 1}>Chapters {start}–{end}</option>)}
          </select>}
        </div>
      </header>
      {chapterError && <p className="af-state" role="alert">{chapterError} <button type="button" className="af-text-link" onClick={retryChapters}>Retry</button></p>}
      {chapterPending && chapters && <p className="af-state" role="status">{chapters.preview ? 'Checking other chapter sources…' : 'Updating chapters…'}</p>}
      {!chapters && !chapterError && <Loading label="Loading chapters…" shape="rows" />}
      {chapters && !chapters.results.length && !chapters.partial && !chapterPending && <p className="af-state" role="status">No chapters are available in this language.</p>}
      {chapters?.partial && !chapterError && <p className="af-state" role="status">Some chapter sources are temporarily unavailable. <button type="button" className="af-text-link" onClick={retryChapters}>Retry sources</button></p>}
      {chapters && groupComicEditions(chapters.results).map(editions => {
        const chapter = editions.find(release => release.id === recent?.chapter) ?? editions[0];
        const credits = comicEditionCredit(chapter);
        const otherEditions = editions.filter(release => release.id !== chapter.id);
        return <article className="af-activity-row" key={chapter.id}>
          <div><strong>{chapter.label}{chapter.title ? ` · ${chapter.title}` : ''}</strong>{chapter.id === recent?.chapter && <p className="af-meta">Last read · Page {recent.page}</p>}
            {credits && <p className="af-meta">{credits}</p>}
            {otherEditions.length > 0 && <details>
              <summary>{otherEditions.length} other {otherEditions.length === 1 ? 'edition' : 'editions'}</summary>
              <ul>{otherEditions.map((release, index) => <li key={release.id}>
                <a className="af-text-link" href={readerHref(item, release.id, release.language, page)}>
                  Read {release.label} · {comicEditionCredit(release) || release.title || `Edition ${index + 2}`}
                </a>
              </li>)}</ul>
            </details>}
          </div>
          <ActionLink href={readerHref(item, chapter.id, chapter.language, page, chapter.id === recent?.chapter ? recent.page : 1)} label={`${chapter.id === recent?.chapter ? 'Resume' : 'Read'} ${chapter.label}${credits ? ` from ${credits}` : ''}`}>{chapter.id === recent?.chapter ? 'Resume' : 'Read'}</ActionLink>
        </article>;
      })}
      {chapters && <div className="af-pagination">
        {page > 1 && <ActionLink href={webHref(listing(language, page - 1))}>Previous page</ActionLink>}
        {chapters.nextPage && <ActionLink href={webHref(listing(language, chapters.nextPage))}>Next page</ActionLink>}
      </div>}
    </section>
  </div>;
}
