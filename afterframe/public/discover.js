// Shared category names keep TMDB, Archive and saved titles on the same filter controls.
export const categories = {
  Action: [28, 10759], Adventure: [12, 10759], Animation: [16], Comedy: [35], Crime: [80],
  Documentary: [99], Drama: [18], Family: [10751], Fantasy: [14, 10765], History: [36],
  Horror: [27], Music: [10402], Mystery: [9648], Romance: [10749], 'Science Fiction': [878, 10765],
  Thriller: [53], War: [10752, 10768], Western: [37],
};

export const archiveCategories = {
  Action: ['action', 'martial arts'], Adventure: ['adventure', 'swashbuckler'], Animation: ['animation', 'animated', 'cartoon'],
  Comedy: ['comedy', 'comedies', 'slapstick'], Crime: ['crime', 'film noir', 'gangster'], Documentary: ['documentary', 'documentaries'],
  Drama: ['drama'], Family: ['family', 'children'], Fantasy: ['fantasy'], History: ['history', 'historical'], Horror: ['horror'],
  Music: ['music', 'musical'], Mystery: ['mystery', 'detective'], Romance: ['romance', 'romantic'],
  'Science Fiction': ['science fiction', 'sci-fi', 'scifi'], Thriller: ['thriller', 'suspense'], War: ['war'], Western: ['western', 'westerns'],
};

export const sortOptions = { popular: 'Popular', top: 'Top rated', newest: 'Newest', oldest: 'Oldest' };
export const browseGenres = { ...categories, Anime: [16] };

export function catalogFilters(params) {
  const category = params.get('category');
  const decade = params.get('decade');
  const sort = params.get('sort');
  return {
    category: Object.hasOwn(browseGenres, category) ? category : '',
    decade: /^(?:18[89]|19\d|20[0-2])0$/.test(decade || '') ? Number(decade) : 0,
    sort: Object.hasOwn(sortOptions, sort) ? sort : 'popular',
  };
}

export function discoverParams(type, { category, decade, sort }, collection = '') {
  const date = type === 'tv' ? 'first_air_date' : 'primary_release_date';
  const today = new Date().toISOString().slice(0, 10);
  const results = {
    sort_by: { popular: 'popularity.desc', top: 'vote_average.desc', newest: `${date}.desc`, oldest: `${date}.asc` }[sort],
  };
  if (sort === 'top') results['vote_count.gte'] = type === 'tv' ? '150' : '300';
  if (sort === 'oldest' || decade) results[`${date}.gte`] = `${decade || 1888}-01-01`;
  if (decade) results[`${date}.lte`] = `${decade + 9}-12-31`;
  if (category) results.with_genres = browseGenres[category].join('|');
  if (category === 'Anime') results.with_original_language = 'ja';
  const upper = `${decade + 9}-12-31`;
  results[`${date}.lte`] = decade && upper < today ? upper : today;
  if (collection === 'new') {
    const start = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    results[`${date}.gte`] = start;
  }
  if (collection === 'gems') {
    Object.assign(results, { sort_by: 'vote_average.desc', 'vote_count.gte': '250', 'vote_count.lte': '2500', 'vote_average.gte': '7' });
  }
  return results;
}

export function matchesCatalog(item, { category, decade }) {
  if (decade && (!item.year || Math.floor(Number(item.year) / 10) * 10 !== Number(decade))) return false;
  if (!category) return true;
  if (category === 'Anime') return item.originalLanguage === 'ja' && item.genreIds?.includes(16);
  if (item.genreIds?.some(id => browseGenres[category]?.includes(id))) return true;
  return item.categories?.includes(category) || item.genre === category || (item.genre === 'Film Noir' && ['Crime', 'Mystery'].includes(category));
}
