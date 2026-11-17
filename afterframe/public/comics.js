import { comicChapterIdSource, comicIdSource } from './comic-ids.js';

const formats = [['', 'All comics'], ['manga', 'Manga'], ['manhwa', 'Manhwa'], ['manhua', 'Manhua']];
const formatLabels = Object.fromEntries(formats.slice(1));
const statuses = [['', 'Any status'], ['ongoing', 'Ongoing'], ['completed', 'Completed'], ['hiatus', 'On hiatus'], ['cancelled', 'Cancelled']];
const sorts = [['popular', 'Popularity'], ['updated', 'Recently updated'], ['newest', 'Publication year'], ['title', 'Title A–Z']];
const languageNames = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });
export const comicRoute = new RegExp(`^comic/(${comicIdSource})(?:/read/(${comicChapterIdSource}))?$`);

export function comicFormat(item) {
  return formatLabels[item.format] || 'Comic';
}

export function comicCover(poster = '', width = 512) {
  return poster.replace(/^https:\/\/uploads\.mangadex\.org\/covers\/(.+)\.512\.jpg$/, `/comic-cover/$1.${width}.jpg`);
}

function hash(path, params) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value)).toString();
  return `#${path}${query ? `?${query}` : ''}`;
}

export function comicsHash(query, format, page = 1, { genre, status, sort } = {}) {
  return hash('comics', { q: query, type: format, genre, status, sort, page: page > 1 ? page : '' });
}

function chaptersHash(id, language, page = 1, focus) {
  return hash(`comic/${id}`, { lang: language, page: page > 1 ? page : '', chapters: focus });
}

export function readerHash(item, entry) {
  return hash(`comic/${item.id}/read/${entry.chapter}`, { lang: entry.language, page: entry.listPage > 1 ? entry.listPage : '' });
}

function pageNumber(params) {
  const page = Number(params.get('page'));
  return Number.isInteger(page) && page >= 1 && page <= 833 ? page : 1;
}

function languageLabel(code) {
  try { return languageNames.of(code === 'es-la' ? 'es-419' : code) || code; } catch { return code; }
}

function synopsisText(value) {
  return value.trim().split(/\n\s*(?:-{3,}|\*{3,})\s*\n/, 1)[0]
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*|__|~~/g, '').trim();
}

async function reportPage(url, result, started) {
  if (!new URL(url, location.origin).hostname.endsWith('.mangadex.network')) return;
  await fetch('/api/comics/report', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
    body: JSON.stringify({ url, duration: Math.round(performance.now() - started), ...result }),
  }).catch(() => {});
}

async function pageImage(url, signal) {
  if (!url) throw new Error('Page unavailable');
  const started = performance.now();
  let bytes = 0;
  let cached = false;
  let success = false;
  try {
    const response = await fetch(url, { credentials: 'omit', signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
    cached = response.headers.get('x-cache')?.startsWith('HIT') || false;
    const blob = await response.blob();
    bytes = blob.size;
    if (!response.ok || !blob.type.startsWith('image/')) throw new Error('Page unavailable');
    success = true;
    return URL.createObjectURL(blob);
  } finally {
    if (!signal.aborted) void reportPage(url, { success, cached, bytes }, started);
  }
}

export function createComics({ main, titlePage, api, escape, icon, grid, shelf, observeRails, saveButton, titles, getReading, recordReading, read, write }) {
  let controller;
  const source = '<span class="comics-credit">Catalog by MangaDex</span>';

  function close() {
    controller?.abort();
  }

  function open() {
    close();
    controller = new AbortController();
    return controller.signal;
  }

  function pager(page, nextPage, to, label) {
    if (page === 1 && !nextPage) return '';
    return `<nav class="comics-pager" aria-label="${label}">${page > 1 ? `<a class="button secondary" href="${escape(to(page - 1))}">${icon('chevron-left')} Previous</a>` : ''}<span>Page ${page}</span>${nextPage ? `<a class="button secondary" href="${escape(to(nextPage))}">Next ${icon('chevron-right')}</a>` : ''}</nav>`;
  }

  function retry(target, message, run) {
    target.innerHTML = `<p class="catalog-status" role="status">${escape(message)}</p><button class="button secondary" type="button">Try again</button>`;
    target.querySelector('button').addEventListener('click', run, { once: true });
  }

  function options(values, selected) {
    return values.map(([value, label]) => `<option value="${escape(value)}"${value === selected ? ' selected' : ''}>${escape(label)}</option>`).join('');
  }

  function rememberTitles(items) {
    for (const item of items) titles.set(item.key, item);
  }

  async function browse(params) {
    const signal = open();
    const query = params.get('q')?.trim().slice(0, 180) || '';
    const format = Object.hasOwn(formatLabels, params.get('type')) ? params.get('type') : '';
    const genre = params.get('genre') || '';
    const status = params.get('status') || '';
    const sortOptions = query ? [['relevance', 'Relevance'], ...sorts] : sorts;
    const sort = sortOptions.some(([value]) => value === params.get('sort')) ? params.get('sort') : '';
    const facets = { genre, status, sort };
    const page = pageNumber(params);
    const to = number => comicsHash(query, format, number, facets);
    main.classList.remove('home');
    main.innerHTML = `<header class="view-heading"><h1>${query ? `Results for “${escape(query)}”` : 'Comics'}</h1><a class="section-link" href="#reading">Reading list ${icon('arrow')}</a></header>
      <nav class="filters" aria-label="Comic format">${formats.map(([value, label]) => `<a class="filter" href="${escape(comicsHash(query, value, 1, facets))}"${value === format ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
      <div class="comic-updates"></div>
      <div class="catalog-layout comics-catalog">
        <aside class="catalog-sidebar" aria-label="Filters">
          <details class="catalog-disclosure"${genre || status ? ' open' : ''}><summary>Filters ${icon('chevron-down')}</summary></details>
          <form class="catalog-filters comic-filters" aria-label="Comics filters" data-mobile-open="${Boolean(genre || status)}">
            <fieldset><legend>Genre</legend><div class="genre-options" data-comic-genres>${genreChoice('', 'All genres', genre)}</div></fieldset>
            <fieldset><legend>Publication status</legend>${statuses.map(([value, label]) => genreChoice(value, label, status, 'status')).join('')}</fieldset>
            ${genre || status ? `<a class="plain-link" href="${escape(comicsHash(query, format, 1, { sort }))}">Clear filters</a>` : ''}
          </form>
        </aside>
        <section class="comics-results" aria-label="Comics catalog">
          <div class="catalog-header"><p class="results-count" role="status">Loading comics…</p><label class="sort-control"><span>Sort by</span><select aria-label="Sort comics">${options(sortOptions, sort || sortOptions[0][0])}</select></label></div>
          <div class="comic-results-grid"><div class="poster-grid skeleton-grid" aria-hidden="true">${'<div></div>'.repeat(10)}</div></div>
        </section>
      </div>
      <footer class="page-footer">${source}</footer>`;
    const form = main.querySelector('.comic-filters');
    const disclosure = main.querySelector('.comics-catalog details');
    disclosure.addEventListener('toggle', () => { form.dataset.mobileOpen = String(disclosure.open); });
    form.addEventListener('change', event => {
      location.hash = comicsHash(query, format, 1, { ...facets, [event.target.name]: event.target.value });
    });
    main.querySelector('.sort-control select').addEventListener('change', event => {
      location.hash = comicsHash(query, format, 1, { ...facets, sort: event.target.value });
    });
    api('/api/comics/genres', { signal }).then(result => {
      if (signal.aborted) return;
      form.querySelector('[data-comic-genres]').innerHTML = `${genreChoice('', 'All genres', genre)}${result.genres.map(({ id, name }) => genreChoice(id, name, genre)).join('')}`;
    }).catch(() => {});
    if (!query && !format && !genre && !status && !sort && page === 1) {
      api('/api/comics/updates', { signal }).then(result => {
        if (signal.aborted || !result.results.length) return;
        rememberTitles(result.results);
        main.querySelector('.comic-updates').innerHTML = shelf('Recently updated', result.results, '');
        for (const link of main.querySelectorAll('.comic-updates .comic-card')) link.href += '?lang=en';
        observeRails();
      }).catch(() => {});
    }
    const target = main.querySelector('.comic-results-grid');
    const statusText = main.querySelector('.comics-results .results-count');
    try {
      const result = await api(`/api/comics?${new URLSearchParams({ q: query, type: format, page, ...facets })}`, { signal });
      if (signal.aborted) return;
      rememberTitles(result.results);
      const count = result.results.length;
      statusText.textContent = `${count} ${count === 1 ? 'title' : 'titles'} on this page`;
      target.innerHTML = `${count ? grid(result.results) : `<div class="empty">${icon('search')}<h2>No comics found</h2><p>Try a different title or clear your filters.</p><a class="button secondary" href="#comics">Browse all comics</a></div>`}${pager(page, result.nextPage, to, 'Catalog pages')}`;
    } catch (error) {
      if (!signal.aborted) {
        statusText.textContent = 'Comics unavailable';
        retry(target, error.message, () => browse(params));
      }
    }
  }

  function genreChoice(value, label, current, name = 'genre') {
    return `<label class="facet-choice"><input type="radio" name="${name}" value="${escape(value)}"${value === current ? ' checked' : ''}>${escape(label)}</label>`;
  }

  function fetchChapters(id, language, page, signal, focus) {
    const params = new URLSearchParams({ page });
    if (language) params.set('lang', language);
    if (focus) params.set('chapter', focus);
    return api(`/api/comics/${id}/chapters?${params}`, { signal });
  }

  function chapterHash(item, chapter, page) {
    return readerHash(item, { chapter: chapter.id, language: chapter.language, listPage: page });
  }

  function groupCredits(chapter) {
    if (chapter.id.startsWith('weeb-')) return 'Weeb Central';
    if (chapter.id.startsWith('scans-')) return 'Manga Scans';
    if (chapter.id.startsWith('lector-')) return 'Lector Manga';
    return chapter.groups.map(group => escape(group.name)).join(', ');
  }

  function chapterGroups(entries) {
    const groups = new Map();
    for (const entry of entries) {
      const key = entry.number ?? entry.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    return [...groups.values()];
  }

  function chapterRow(item, entry, page, recent, alternate = false) {
    const resume = recent?.chapter === entry.id;
    const group = groupCredits(entry);
    const link = `<a class="button ${resume ? 'primary' : 'secondary'}" href="${escape(chapterHash(item, entry, page))}" aria-label="${resume ? 'Resume' : 'Read'} ${escape(entry.label)}">${icon('book')} ${resume ? 'Resume' : 'Read'}</a>`;
    return `<div class="comic-chapter-row${resume ? ' is-current' : ''}" data-chapter="${escape(entry.id)}">
      <span class="comic-chapter-icon">${icon('book')}</span>
      <div class="comic-chapter-info"><strong>${escape(alternate ? entry.title || entry.label : entry.label)}${!alternate && entry.title ? `<span> · ${escape(entry.title)}</span>` : ''}</strong>
      ${resume || group ? `<small>${resume ? `Page ${recent.page}` : ''}${resume && group ? ' · ' : ''}${group}</small>` : ''}</div>
      ${link}</div>`;
  }

  async function comicDetails(item, params, back, signal) {
    const { id } = item;
    const languages = [...new Set([item.defaultLanguage, ...item.languages])].sort((a, b) => languageLabel(a).localeCompare(languageLabel(b)));
    const requested = params.get('lang');
    const recent = getReading(item.key);
    const preferred = requested || recent?.language;
    const selected = languages.includes(preferred) ? preferred : '';
    let language = selected || item.defaultLanguage;
    let page = Math.min(pageNumber(params), 200);
    const focus = params.get('chapters');
    const synopsis = synopsisText(item.synopsis);
    const info = [comicFormat(item), item.year, statuses.find(([value]) => value === item.status)?.[1]].filter(Boolean);
    titlePage.innerHTML = `<article class="title-record comic-record">
      <a class="plain-link title-back" href="${escape(back)}">${icon('chevron-left')} ${back === '#reading' ? 'Reading list' : 'Comics'}</a>
      <div class="record-copy comic-overview">${item.poster ? `<img class="record-poster" src="${escape(comicCover(item.poster))}" alt="" fetchpriority="high">` : ''}
        <div class="record-information"><h1 id="title-heading" tabindex="-1">${escape(item.title)}</h1>
          <div class="meta title-facts">${info.map(fact => `<span>${escape(fact)}</span>`).join('')}</div>
          ${item.author.length ? `<p class="title-byline">${escape(item.author.join(', '))}</p>` : ''}
          ${synopsis ? `<p class="title-about comic-synopsis">${escape(synopsis)}</p>` : ''}
          ${item.genres?.length ? `<div class="comic-genre-links" aria-label="Genres">${item.genres.map(genre => `<a class="filter" href="${escape(comicsHash('', '', 1, { genre: genre.id }))}">${escape(genre.name)}</a>`).join('')}</div>` : ''}
          <div class="comic-actions title-actions"><span class="comic-start" hidden></span>${saveButton(item)}</div>
        </div></div>
      <section class="title-episodes comic-chapters" aria-labelledby="chapters-heading">
        <div class="episode-header"><div><h2 id="chapters-heading" tabindex="-1">Chapters</h2><p class="season-progress" role="status"></p></div>
          <div class="episode-filters">
            <label class="comic-field"><span>Language</span><select class="episode-range comic-language">${options(languages.map(code => [code, languageLabel(code)]), language)}</select></label>
            <label class="comic-field comic-ranges" hidden><span>Chapter range</span><select class="episode-range" aria-controls="comic-chapter-list"></select></label>
          </div>
        </div>
        <div id="comic-chapter-list" class="comic-chapter-list"><p class="catalog-status" role="status">Loading chapters…</p></div>
        <nav class="comics-pager comic-list-pages" aria-label="Chapter ranges" hidden></nav>
      </section><footer class="page-footer">${source}</footer>
    </article>`;
    const heading = titlePage.querySelector(focus ? '#chapters-heading' : '#title-heading');
    heading.focus({ preventScroll: true });
    if (focus) heading.scrollIntoView({ block: 'start', behavior: 'instant' });
    titlePage.querySelector('.comic-language').addEventListener('change', event => { location.hash = chaptersHash(id, event.target.value, 1, '1'); });
    const target = titlePage.querySelector('.comic-chapter-list');
    try {
      const result = await fetchChapters(id, selected, page, signal, focus);
      if (signal.aborted) return;
      ({ language, page } = result);
      titlePage.querySelector('.comic-language').value = language;
      const groups = chapterGroups(result.results);
      const status = titlePage.querySelector('.season-progress');
      const { totalChapters: total, mainChapters } = result;
      const extras = total - mainChapters;
      const count = mainChapters && extras
        ? `${mainChapters} main ${mainChapters === 1 ? 'chapter' : 'chapters'} · ${extras} additional ${extras === 1 ? 'entry' : 'entries'}`
        : total ? `${total} ${total === 1 ? 'chapter' : 'chapters'}` : '';
      status.textContent = [count, result.partial ? 'Some chapters are temporarily unavailable.' : ''].filter(Boolean).join(' · ');
      const start = titlePage.querySelector('.comic-start');
      const first = result.results[0];
      if (first) {
        start.outerHTML = recent?.language === language
          ? `<a class="button primary" href="${escape(readerHash(item, recent))}">${icon('book')} Resume ${escape(recent.label)} <span class="comic-resume-page">· Page ${recent.page}</span></a>`
          : `<a class="button primary" href="${escape(chapterHash(item, first, page))}">${icon('book')} Read ${escape(first.label)}</a>`;
      }
      target.innerHTML = groups.length
        ? `<ol class="comic-chapter-rows">${groups.map(group => {
          const entry = group.find(release => release.id === recent?.chapter) || group[0];
          const others = group.filter(candidate => candidate.id !== entry.id);
          return `<li>${chapterRow(item, entry, page, recent)}${others.length ? `<details class="comic-editions"${others.some(candidate => candidate.id === focus) ? ' open' : ''}><summary>${others.length} other ${others.length === 1 ? 'release' : 'releases'}</summary>${others.map(candidate => chapterRow(item, candidate, page, recent, true)).join('')}</details>` : ''}</li>`;
        }).join('')}</ol>`
        : `<p class="comic-chapter-note">No chapters are available to read in ${escape(languageLabel(language))}.</p>`;
      const to = number => chaptersHash(id, language, number, '1');
      if (result.pageCount > 1) {
        const range = titlePage.querySelector('.comic-ranges');
        const picker = range.querySelector('select');
        picker.innerHTML = options(result.ranges.map(({ start, end }, index) => [String(index + 1), start === end ? start : `${start}–${end}`]), String(page));
        picker.addEventListener('change', () => { location.hash = to(Number(picker.value)); });
        range.hidden = false;
        const listPages = titlePage.querySelector('.comic-list-pages');
        listPages.innerHTML = `${page > 1 ? `<a class="button secondary" href="${escape(to(page - 1))}">${icon('chevron-left')} Previous range</a>` : ''}
          ${result.nextPage ? `<a class="button secondary" href="${escape(to(result.nextPage))}">Next range ${icon('chevron-right')}</a>` : ''}`;
        listPages.hidden = false;
      }
      if (focus) {
        const row = target.querySelector(`[data-chapter="${CSS.escape(focus)}"]`);
        if (row) {
          row.querySelector('.button')?.focus({ preventScroll: true });
          row.scrollIntoView({ block: 'center', behavior: 'instant' });
        } else {
          heading.scrollIntoView({ block: 'start', behavior: 'instant' });
        }
      }
    } catch (error) {
      if (!signal.aborted) retry(target, error.message, () => show(id, null, params, back));
    }
  }

  async function readerControls(item, chapter, listPage, signal) {
    const targets = titlePage.querySelectorAll('[data-comic-chapter-nav]');
    const result = await fetchChapters(item.id, chapter.language, listPage, signal, chapter.id);
    if (signal.aborted || !result.neighbors) return;
    const control = (neighbor, direction) => {
      const label = direction === 'previous' ? 'Previous chapter' : 'Next chapter';
      if (!neighbor) return `<button class="button secondary" type="button" disabled aria-label="${label}">${icon(direction === 'previous' ? 'chevron-left' : 'chevron-right')}</button>`;
      const { entry, page } = neighbor;
      return `<a class="button secondary" href="${escape(chapterHash(item, entry, page))}" aria-label="${label}">${icon(direction === 'previous' ? 'chevron-left' : 'chevron-right')} <span>${label}</span></a>`;
    };
    const { previous, next } = result.neighbors;
    for (const target of targets) target.innerHTML = control(previous, 'previous') + control(next, 'next');
  }

  function mountPages(item, chapter, listPage, initialPages, endpoint, signal) {
    const viewer = titlePage.querySelector('.comic-reader-view');
    const toolbar = viewer.querySelector('.comic-reader-toolbar');
    const stage = titlePage.querySelector('.comic-pages');
    const indicator = titlePage.querySelector('.comic-page-number');
    const mode = titlePage.querySelector('.comic-mode');
    const fit = titlePage.querySelector('.comic-fit');
    const fullscreen = titlePage.querySelector('.comic-fullscreen');
    const header = document.querySelector('.topbar');
    const [previous, next] = titlePage.querySelectorAll('.reader-step');
    const recent = getReading(item.key);
    let position = recent?.chapter === chapter.id ? Math.min(recent.page, initialPages.length) : 1;
    let savedPage = recent?.chapter === chapter.id ? recent.page : 0;
    let urls = initialPages;
    let refresh;
    let view;
    let scrollTimer;
    const savedLayout = read('comicLayout', '');
    mode.value = ['pages', 'scroll'].includes(savedLayout) ? savedLayout : item.longStrip ? 'scroll' : 'pages';
    fit.value = read('comicFit', '') === 'width' ? 'width' : 'page';
    signal.addEventListener('abort', () => view?.abort(), { once: true });

    const expanded = () => viewer.classList.contains('is-expanded');
    const full = () => document.fullscreenElement === viewer || expanded();
    function alignPage(slot) {
      if (!slot) return;
      const scroller = full() ? viewer : window;
      const top = toolbar.offsetHeight + (full() ? 0 : header.offsetHeight);
      scroller.scrollBy({ top: slot.getBoundingClientRect().top - top, behavior: 'instant' });
    }

    function update(page, save = false) {
      position = page;
      indicator.value = String(page);
      previous.disabled = page <= 1;
      next.disabled = page >= initialPages.length;
      if (save && page !== savedPage) {
        savedPage = page;
        recordReading(item, { chapter: chapter.id, label: chapter.label, language: chapter.language, page, listPage });
      }
    }

    function imageSlot(page) {
      const slot = document.createElement('div');
      slot.className = 'comic-page-slot';
      slot.dataset.page = page;
      slot.textContent = `Loading page ${page}…`;
      return slot;
    }

    async function fill(slot, viewSignal) {
      const page = Number(slot.dataset.page);
      const index = page - 1;
      try {
        const url = urls[index];
        let objectUrl;
        try {
          objectUrl = await pageImage(url, viewSignal);
        } catch (error) {
          if (viewSignal.aborted) return;
          if (urls[index] === url) {
            refresh ||= api(endpoint, { signal }).then(data => { urls = data.pages; }).finally(() => { refresh = null; });
            await refresh;
          }
          objectUrl = await pageImage(urls[index], viewSignal);
        }
        if (viewSignal.aborted) return URL.revokeObjectURL(objectUrl);
        viewSignal.addEventListener('abort', () => URL.revokeObjectURL(objectUrl), { once: true });
        const img = new Image();
        img.alt = `Page ${page}`;
        img.src = objectUrl;
        await img.decode();
        if (viewSignal.aborted) return;
        slot.replaceChildren(img);
        if (page === position) update(page, true);
      } catch {
        if (!viewSignal.aborted) retry(slot, `Page ${page} could not be loaded.`, () => {
          slot.textContent = `Loading page ${page}…`;
          fill(slot, viewSignal);
        });
      }
    }

    function renderPages(page) {
      view?.abort();
      clearTimeout(scrollTimer);
      view = new AbortController();
      const viewSignal = view.signal;
      const continuous = mode.value === 'scroll';
      fit.closest('label').hidden = continuous;
      stage.classList.toggle('continuous', continuous);
      stage.dataset.fit = fit.value;
      const slots = continuous ? initialPages.map((_, index) => imageSlot(index + 1)) : [imageSlot(page)];
      stage.replaceChildren(...slots);
      update(page);
      const first = continuous ? slots[page - 1] : slots[0];
      alignPage(first);
      if (!continuous) {
        fill(first, viewSignal);
        return;
      }

      const loader = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting || viewSignal.aborted) continue;
          loader.unobserve(entry.target);
          fill(entry.target, viewSignal);
        }
      }, { rootMargin: '350px 0px' });
      for (const slot of slots) loader.observe(slot);
      const track = () => {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
          if (viewSignal.aborted) return;
          const marker = Math.min(innerHeight / 2, toolbar.getBoundingClientRect().bottom + 24);
          const visible = slots.find(slot => slot.getBoundingClientRect().bottom > marker);
          if (visible && visible.getBoundingClientRect().top < innerHeight) update(Number(visible.dataset.page), Boolean(visible.firstElementChild?.matches('img')));
        }, 130);
      };
      window.addEventListener('scroll', track, { passive: true, signal: viewSignal });
      viewer.addEventListener('scroll', track, { passive: true, signal: viewSignal });
      viewSignal.addEventListener('abort', () => { loader.disconnect(); clearTimeout(scrollTimer); }, { once: true });
    }

    function jump(page) {
      if (page < 1 || page > initialPages.length) return;
      if (mode.value === 'pages') renderPages(page);
      else {
        const slot = stage.children[page - 1];
        alignPage(slot);
        update(page, Boolean(slot.firstElementChild?.matches('img')));
      }
    }

    previous.addEventListener('click', () => jump(position - 1));
    next.addEventListener('click', () => jump(position + 1));
    indicator.addEventListener('change', () => jump(Number(indicator.value)));
    mode.addEventListener('change', () => {
      write('comicLayout', mode.value);
      renderPages(position);
    });
    fit.addEventListener('change', () => {
      write('comicFit', fit.value);
      stage.dataset.fit = fit.value;
      alignPage(stage.querySelector('.comic-page-slot'));
    });
    function updateFullscreen() {
      const label = full() ? 'Exit fullscreen' : 'Fullscreen';
      fullscreen.setAttribute('aria-label', label);
      fullscreen.title = label;
      fullscreen.innerHTML = icon(full() ? 'exit-fullscreen' : 'fullscreen');
      alignPage(stage.querySelector(`[data-page="${position}"]`));
    }
    async function toggleFullscreen() {
      if (expanded()) {
        viewer.classList.remove('is-expanded');
        updateFullscreen();
        return;
      }
      if (document.fullscreenElement === viewer) {
        await document.exitFullscreen().catch(() => {});
        return;
      }
      if (document.fullscreenEnabled) {
        try { await viewer.requestFullscreen(); return; } catch { /* Use the full viewport when native fullscreen is unavailable. */ }
      }
      if (signal.aborted) return;
      viewer.classList.add('is-expanded');
      updateFullscreen();
    }
    fullscreen.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', updateFullscreen, { signal });
    window.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey
        || document.querySelector('dialog[open]') || event.target.closest('input, select, [contenteditable]')) return;
      if (event.key.toLowerCase() === 'f' || (event.key === 'Escape' && expanded())) {
        event.preventDefault();
        toggleFullscreen();
        return;
      }
      if (mode.value !== 'pages') return;
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      jump(position + (event.key === 'ArrowRight' ? 1 : -1));
    }, { signal });
    renderPages(position);
  }

  async function reader(item, chapterId, params, signal) {
    const endpoint = `/api/comics/${item.id}/chapters/${chapterId}`;
    const listPage = Math.min(pageNumber(params), 200);
    const { chapter, pages } = await api(endpoint, { signal });
    if (signal.aborted) return;
    const back = chaptersHash(item.id, chapter.language, listPage, chapter.id);
    titlePage.classList.add('is-reading');
    titlePage.innerHTML = `<div class="comic-reader">
      <header class="comic-reader-heading">
        <div><a class="plain-link title-back" href="${escape(back)}">${icon('chevron-left')} ${escape(item.title)}</a>
        <h1 id="title-heading" tabindex="-1">${escape(chapter.label)}${chapter.title ? ` · ${escape(chapter.title)}` : ''}</h1></div>
        <nav class="comic-reader-chapters" data-comic-chapter-nav aria-label="Chapter navigation"></nav>
      </header>
      <div class="comic-reader-view">
        <div class="comic-reader-toolbar">
          <div class="comic-reader-paging"><button type="button" class="icon-button reader-step" aria-label="Previous page">${icon('chevron-left')}</button>
            <label><span>Page</span> <select class="episode-range comic-page-number">${pages.map((_, index) => `<option value="${index + 1}">${index + 1} / ${pages.length}</option>`).join('')}</select></label>
            <button type="button" class="icon-button reader-step" aria-label="Next page">${icon('chevron-right')}</button></div>
          <div class="comic-reader-options">
            <label class="comic-mode-control"><span>Layout</span> <select class="episode-range comic-mode"><option value="pages">Single page</option><option value="scroll">Vertical scroll</option></select></label>
            <label class="comic-fit-control"><span>Fit</span> <select class="episode-range comic-fit"><option value="page">Whole page</option><option value="width">Width</option></select></label>
            <button type="button" class="icon-button comic-fullscreen" aria-label="Fullscreen" title="Fullscreen">${icon('fullscreen')}</button>
          </div>
        </div>
        <div class="comic-pages" aria-label="Chapter pages"></div></div>
      <div class="comic-reader-end">
        <a class="plain-link" href="${escape(back)}">${icon('book')} All chapters</a>
        <nav class="comic-reader-chapters" data-comic-chapter-nav aria-label="Chapter navigation after reading"></nav>
      </div><footer class="page-footer comic-reader-credit">${groupCredits(chapter)}${source}</footer></div>`;
    titlePage.querySelector('#title-heading').focus({ preventScroll: true });
    mountPages(item, chapter, listPage, pages, endpoint, signal);
    readerControls(item, chapter, listPage, signal).catch(() => {});
  }

  async function show(id, chapterId, params, back) {
    const signal = open();
    titlePage.className = 'title-page';
    titlePage.innerHTML = '<div class="title-status" role="status">Loading comic…</div>';
    try {
      const item = await api(`/api/comics/${id}`, { signal });
      if (signal.aborted) return;
      rememberTitles([item]);
      if (chapterId) await reader(item, chapterId, params, signal);
      else await comicDetails(item, params, back, signal);
    } catch (error) {
      if (signal.aborted) return;
      titlePage.innerHTML = `<div class="title-status"><h1 id="title-heading" tabindex="-1">${chapterId ? 'Chapter unavailable' : 'Comic unavailable'}</h1><div class="comic-error"></div><a class="plain-link" href="${escape(chapterId ? chaptersHash(id, params.get('lang'), pageNumber(params), chapterId) : back)}">${icon('chevron-left')} ${chapterId ? 'Back to chapters' : 'Back to browse'}</a></div>`;
      retry(titlePage.querySelector('.comic-error'), error.message, () => show(id, chapterId, params, back));
    }
  }

  return { browse, show, close, rememberTitles };
}

