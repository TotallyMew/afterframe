const seasons = [['WINTER', 'Winter'], ['SPRING', 'Spring'], ['SUMMER', 'Summer'], ['FALL', 'Fall']];
const formats = [['TV', 'TV'], ['TV_SHORT', 'TV short'], ['MOVIE', 'Movie'], ['OVA', 'OVA'], ['ONA', 'ONA'], ['SPECIAL', 'Special']];
const statuses = [['RELEASING', 'Currently airing'], ['NOT_YET_RELEASED', 'Upcoming'], ['FINISHED', 'Finished'], ['CANCELLED', 'Cancelled'], ['HIATUS', 'On hiatus']];
const sorting = [['POPULARITY_DESC', 'Popularity'], ['START_DATE_DESC', 'Newest first'], ['START_DATE', 'Oldest first']];
const airingTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function createDiscoveryPages({ main, api, escape, footer, grid, localizeTitle, library, syncCardRatings }) {
  const select = (params, name, label, options, all) => `<label>${label}<select name="${name}">${all ? `<option value="">${all}</option>` : ''}${options.map(([key, value]) => `<option value="${escape(key)}"${params.get(name) === key ? ' selected' : ''}>${escape(value)}</option>`).join('')}</select></label>`;
  const heading = (title, text = '') => `<header class="view-heading"><h1>${escape(title)}</h1>${text ? `<p>${escape(text)}</p>` : ''}</header>`;
  const status = text => `<p class="catalog-status" role="status">${escape(text)}</p>`;
  const pageLink = (path, params, page, label) => {
    const query = new URLSearchParams(params);
    query.set('page', page);
    return `<a class="button secondary" href="#${path}?${escape(query.toString())}">${label}</a>`;
  };
  const pagination = (path, params, next) => {
    const page = Number(params.get('page') || 1);
    return `<div class="load-more discovery-pagination">${page > 1 ? pageLink(path, params, page - 1, 'Previous page') : ''}${next ? pageLink(path, params, next, 'Next page') : ''}</div>`;
  };
  const artwork = (src, name) => `<span class="poster-art">${src ? `<img src="${escape(src)}" alt="" loading="lazy">` : `<span class="discovery-no-image" aria-hidden="true">${escape(name?.[0] || '')}</span>`}</span>`;
  function animeForm(params) {
    const input = (name, label, attrs) => `<label>${label}<input name="${name}" value="${escape(params.get(name) || '')}" ${attrs}></label>`;
    const fields = input('year', 'Year', 'type="number" min="1900" max="2100"') + select(params, 'season', 'Season', seasons, 'Any season')
      + select(params, 'status', 'Release status', statuses, 'Any status') + select(params, 'format', 'Format', formats, 'Any format')
      + input('genre', 'Genre', 'maxlength="60" list="anime-genres"') + input('theme', 'Theme', 'maxlength="60" list="anime-themes"')
      + input('min', 'Minimum episodes', 'type="number" min="1" max="5000"') + input('max', 'Maximum episodes', 'type="number" min="1" max="5000"')
      + select(params, 'sort', 'Sort by', sorting);
    return `<details class="discovery-filters"><summary>Filters${params.get('season') || params.get('year') ? ` · ${escape([seasons.find(([key]) => key === params.get('season'))?.[1], params.get('year')].filter(Boolean).join(' '))}` : ''}</summary><form class="library-filters" data-discovery-form="anime">${fields}<button class="button secondary">Apply filters</button><datalist id="anime-genres">${['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Mecha', 'Mystery', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'].map(value => `<option>${value}</option>`).join('')}</datalist><datalist id="anime-themes">${['Coming of Age', 'Found Family', 'Isekai', 'Magic', 'School', 'Space', 'Super Power', 'Time Manipulation', 'Urban Fantasy'].map(value => `<option>${value}</option>`).join('')}</datalist></form></details>`;
  }
  function animeCards(items) {
    return `<div class="poster-grid">${items.map(item => {
      const name = item.title?.english || item.title?.romaji || 'Anime';
      const cover = URL.parse(item.coverImage?.large || '');
      const link = /^(?:tv|movie)\/[1-9]\d*$/.test(item.catalog || '') ? `#${item.catalog}` : `#search=${encodeURIComponent(item.title?.romaji || name)}`;
      const next = item.nextAiringEpisode;
      const date = item.startDate?.year ? [item.startDate.year, item.startDate.month, item.startDate.day].filter(Boolean).join('-') : '';
      const meta = [formats.find(([key]) => key === item.format)?.[1], statuses.find(([key]) => key === item.status)?.[1], date, item.episodes ? `${item.episodes} ep` : '', item.mal ? `MAL ${item.mal.toFixed(2)}` : ''].filter(Boolean).join(' · ');
      return `<article class="poster-tile"><a class="poster-card" href="${link}">${artwork(cover?.origin === 'https://s4.anilist.co' ? cover.href : '', name)}<span class="poster-title">${escape(name)}</span><span class="poster-meta">${escape(meta)}</span>${next?.airingAt * 1000 > Date.now() ? `<span class="poster-meta">Episode ${Number(next.episode)} scheduled for ${escape(airingTime.format(new Date(next.airingAt * 1000)))}</span>` : ''}</a></article>`;
    }).join('')}</div>`;
  }
  async function load(path, query, signal) {
    const params = new URLSearchParams(query);
    if (path === 'anime' && !query) {
      const today = new Date();
      params.set('year', today.getFullYear());
      params.set('season', seasons[Math.floor(today.getMonth() / 3)][0]);
    }
    const intro = path === 'anime' ? heading('Anime seasons', 'Browse releases and airing schedules.') + animeForm(params)
      : heading('Recommendations');
    if (signal.aborted) return;
    main.innerHTML = `${intro}<div class="discovery-results"></div>${footer()}`;
    const results = main.querySelector('.discovery-results');
    const paint = body => { if (!signal.aborted) results.innerHTML = body; };
    paint(status('Loading…'));
    try {
      if (path === 'recommendations') {
        const guest = library();
        const data = await api('/api/recommendations', guest ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(guest), signal } : { signal });
        if (data.mode === 'unavailable') paint(status('Connect the catalog in Settings to load recommendations.'));
        else paint(`${status(data.personalized ? 'Picked from your viewing activity and library.' : 'Discovery picks. Finish two series or meaningfully watch three titles or episodes to personalize this page.')}${data.sections.filter(section => section.items.length).map(section => `<section class="shelf"><div class="section-head"><h2>${escape(section.label)}</h2></div>${grid(section.items.map(localizeTitle))}</section>`).join('') || status('No recommendations are available.')}`);
        if (!signal.aborted) syncCardRatings();
      } else {
        const data = await api(`/api/anime-discovery?${params}`, { signal });
        if (!signal.aborted) paint(data.results.length ? animeCards(data.results) + pagination(path, params, data.nextPage) : status('No results match these filters.') + pagination(path, params, data.nextPage));
      }
    } catch (error) {
      if (!signal.aborted) paint(status(error.message));
    }
  }
  return { load };
}
