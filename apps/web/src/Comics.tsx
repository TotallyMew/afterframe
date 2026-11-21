import { useEffect, useState } from 'react';
import { comicCover, legacyHref, request, routeWithParams, webHref, type Comic } from './catalog';
import { InputField, PageHeading, RouteTabs, SelectField } from './Catalogue';
import { ActionLink, Icon, SaveButton, Shelf } from './components';
import type { LibraryControls } from './library';

const formats = [['', 'All comics'], ['manga', 'Manga'], ['manhwa', 'Manhwa'], ['manhua', 'Manhua'], ['comic', 'Comics']] as const;
const statuses = [['ongoing', 'Ongoing'], ['completed', 'Completed'], ['hiatus', 'On hiatus'], ['cancelled', 'Cancelled']] as const;
const sorts = [['popular', 'Popularity'], ['updated', 'Recently updated'], ['newest', 'Publication year'], ['title', 'Title A–Z']] as const;
const languageNames = new Intl.DisplayNames(undefined, { type: 'language', fallback: 'code' });

export function comicHref(item: Pick<Comic, 'id'>) {
  return webHref(`comic/${encodeURIComponent(item.id)}`);
}

export function readerHref(item: Pick<Comic, 'id'>, chapter: string, language: string, page = 1) {
  const variables = new URLSearchParams({ lang: language });
  if (page > 1) variables.set('page', String(page));
  return legacyHref(routeWithParams(`comic/${encodeURIComponent(item.id)}/read/${encodeURIComponent(chapter)}`, variables));
}

function comicFacts(item: Comic) {
  const format = formats.find(([key]) => key && key === item.format)?.[1] ?? 'Comics';
  const status = statuses.find(([key]) => key === item.status)?.[1];
  return [format, item.year, status].filter(Boolean).join(' · ');
}

export function ComicCard({ item, controls, href, context }: { item: Comic; controls: LibraryControls; href?: string; context?: string }) {
  const cover = comicCover(item.poster);
  return <article className="af-media-card"><a href={href || comicHref(item)}>
    <span className="af-poster">{cover ? <img src={cover} alt="" loading="lazy" /> : <Icon name="film" />}</span>
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
  const type = params.get('type') || '';
  const text = params.get('q') || '';

  useEffect(() => {
    const task = new AbortController();
    const { signal } = task;
    request<ComicsResults>(`/api/comics?${query}`, { signal })
      .then(value => { if (!signal.aborted) setData(value); })
      .catch(problem => { if (!signal.aborted) setError(problem.message); });
    request<{ genres: NonNullable<Comic['genres']> }>('/api/comics/genres', { signal })
      .then(result => { if (!signal.aborted) setGenres(result.genres); }).catch(() => {});
    if (!query) request<ComicsResults>('/api/comics/updates', { signal })
      .then(result => { if (!signal.aborted) setRecent(result.results); }).catch(() => {});
    return () => task.abort();
  }, [query, attempt]);

  function withParam(name: string, value: string) {
    const update = new URLSearchParams(params);
    update.delete('page');
    if (value) update.set(name, value); else update.delete(name);
    return routeWithParams('comics', update);
  }

  return <div className="af-wrap af-directory">
    <PageHeading title="Comics" />
    <RouteTabs tabs={formats.map(([key, label]) => [withParam('type', key), label])} active={withParam('type', type)} label="Comic formats" />
    <form className="af-field-bar" onSubmit={event => {
      event.preventDefault();
      const update = new URLSearchParams();
      if (type) update.set('type', type);
      for (const [key, value] of new FormData(event.currentTarget)) if (typeof value === 'string' && value.trim()) update.set(key, value.trim());
      window.location.hash = routeWithParams('comics', update);
    }}>
      <InputField name="q" label="Find comics" type="search" maxLength={180} defaultValue={text} />
      <SelectField label="Genre" name="genre" empty="All genres" value={params.get('genre') || ''} options={genres.map(genre => [genre.id, genre.name])} />
      <SelectField label="Status" name="status" empty="Any status" value={params.get('status') || ''} options={statuses} />
      <SelectField label="Sort by" name="sort" empty={text ? 'Relevance' : 'Default order'} value={params.get('sort') || ''} options={sorts} />
      <button className="af-button af-secondary" type="submit">Apply filters</button>
      {query && <a className="af-text-link" href={webHref('comics')}>Clear filters</a>}
    </form>
    {recent.length > 0 && <Shelf title="Recently updated">
      {recent.map(item => <ComicCard item={item} key={item.key} controls={controls} href={`${comicHref(item)}?lang=en`} />)}
    </Shelf>}
    {error ? <p className="af-state" role="alert">{error} <button className="af-text-link" type="button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry</button></p>
      : !data ? <p className="af-state" role="status">Loading comics…</p> : !data.results.length ? <p className="af-state">No comics match these filters.</p>
        : <div className="af-poster-grid">{data.results.map(item => <ComicCard item={item} key={item.key} controls={controls} />)}</div>}
    {data && <div className="af-pagination">
      {initialPage > 1 && <ActionLink href={webHref(withParam('page', String(initialPage - 1)))}>Previous page</ActionLink>}
      {data.nextPage && <ActionLink href={webHref(withParam('page', String(data.nextPage)))}>Next page</ActionLink>}
    </div>}
  </div>;
}

type ComicRecord = Comic & { synopsis?: string; author?: string[]; languages: string[]; defaultLanguage: string; malId?: number };
type Chapter = { id: string; label: string; title?: string; language: string; groups?: string[] };
type Chapters = { results: Chapter[]; nextPage?: number | null; ranges?: { start: string; end: string }[]; totalChapters?: number; partial?: boolean };

export function ComicDetailsPage({ id, query, controls }: { id: string; query: string; controls: LibraryControls }) {
  const [item, setItem] = useState<ComicRecord>();
  const [chapters, setChapters] = useState<Chapters>();
  const [mal, setMal] = useState<number>();
  const [error, setError] = useState('');
  const [chapterError, setChapterError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [chapterAttempt, setChapterAttempt] = useState(0);
  const params = new URLSearchParams(query);
  const recent = item && controls.library.reading[item.key];
  const preferred = params.get('lang') || recent?.language || item?.defaultLanguage || 'en';
  const language = item?.languages.includes(preferred) ? preferred : item?.defaultLanguage;
  const page = Math.max(1, Math.min(200, Number(params.get('page')) || 1));

  useEffect(() => {
    const task = new AbortController();
    const { signal } = task;
    request<ComicRecord>(`/api/comics/${id}`, { signal })
      .then(value => {
        if (signal.aborted) return;
        setItem(value);
        if (value.malId) request<{ rating?: number }>(`/api/mal/manga/${value.malId}`, { signal })
          .then(result => { if (!signal.aborted) setMal(result.rating); }).catch(() => {});
      }).catch(problem => { if (!signal.aborted) setError(problem.message); });
    return () => task.abort();
  }, [id, attempt]);

  useEffect(() => {
    if (!language) return;
    const task = new AbortController();
    request<Chapters>(`/api/comics/${id}/chapters?${new URLSearchParams({ lang: language, page: String(page) })}`, { signal: task.signal })
      .then(result => { if (!task.signal.aborted) { setChapterError(''); setChapters(result); } })
      .catch(problem => { if (!task.signal.aborted) setChapterError(problem.message); });
    return () => task.abort();
  }, [id, language, page, chapterAttempt]);

  if (!item || !language) return <div className="af-wrap af-directory">
    <PageHeading title={error ? 'Comic unavailable' : 'Comics'} />
    {error ? <p className="af-state" role="alert">{error} <button className="af-text-link" type="button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry</button></p>
      : <p className="af-state" role="status">Loading comic…</p>}
  </div>;
  const cover = comicCover(item.poster);
  const first = chapters?.results[0];
  const synopsis = item.synopsis?.split(/\n(?:-{3,}|\*\*Links:)/i)[0].trim();
  const listing = (lang: string, range: number) => routeWithParams(`comic/${id}`, new URLSearchParams({ lang, ...(range > 1 ? { page: String(range) } : {}) }));
  return <div className="af-wrap af-directory">
    <a href={webHref('comics')} className="af-text-link"><Icon name="left" /> Comics</a>
    <section className="af-comic-intro">
      {cover && <img className="af-comic-cover" src={cover} alt="" fetchPriority="high" />}
      <div>
        <PageHeading title={item.title} />
        <p className="af-meta">{comicFacts(item)} {mal && <span className="af-score">MAL {mal.toFixed(2)}</span>}</p>
        {item.author && item.author.length > 0 && <p className="af-meta">{item.author.join(', ')}</p>}
        {synopsis && <p className="af-overview">{synopsis}</p>}
        <div className="af-actions">
          {recent ? <ActionLink primary href={readerHref(item, recent.chapter, recent.language, recent.listPage)}>Resume {recent.label} · Page {recent.page}</ActionLink>
            : first && <ActionLink primary href={readerHref(item, first.id, first.language, page)}>{page === 1 ? 'Start reading' : `Read ${first.label}`}</ActionLink>}
          <SaveButton item={item} controls={controls} />
        </div>
      </div>
    </section>
    <section className="af-section" aria-labelledby="chapters-heading">
      <header className="af-section-head"><div><h2 id="chapters-heading">Chapters</h2>{chapters?.totalChapters != null && <p className="af-meta">{chapters.totalChapters} chapters</p>}</div>
        <div className="af-actions">
          <select className="af-select" aria-label="Language" value={language} onChange={event => { window.location.hash = listing(event.target.value, 1); }}>
            {[...new Set(item.languages)].sort().map(code => <option key={code} value={code}>{languageNames.of(code) ?? code}</option>)}
          </select>
          {chapters?.ranges && chapters.ranges.length > 1 && <select className="af-select" aria-label="Chapter range" value={page} onChange={event => { window.location.hash = listing(language, Number(event.target.value)); }}>
            {chapters.ranges.map(({ start, end }, index) => <option key={index} value={index + 1}>Chapters {start}–{end}</option>)}
          </select>}
        </div>
      </header>
      {chapterError ? <p className="af-state" role="alert">{chapterError} <button type="button" className="af-text-link" onClick={() => { setChapterError(''); setChapterAttempt(value => value + 1); }}>Retry</button></p>
        : !chapters ? <p className="af-state" role="status">Loading chapters…</p> : !chapters.results.length ? <p className="af-state">No chapters are available in this language.</p>
          : chapters.results.map(chapter => <article className="af-activity-row" key={chapter.id}><div><strong>{chapter.label}{chapter.title ? ` · ${chapter.title}` : ''}</strong>
            <p className="af-meta">{chapter.groups?.join(' · ')}</p></div><ActionLink href={readerHref(item, chapter.id, chapter.language, page)}>Read</ActionLink></article>)}
      {chapters?.partial && <p className="af-state">Some chapters are temporarily unavailable.</p>}
      {chapters && <div className="af-pagination">
        {page > 1 && <ActionLink href={webHref(listing(language, page - 1))}>Previous page</ActionLink>}
        {chapters.nextPage && <ActionLink href={webHref(listing(language, chapters.nextPage))}>Next page</ActionLink>}
      </div>}
    </section>
  </div>;
}
