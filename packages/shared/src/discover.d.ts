export const categories: Record<string, number[]>;
export const archiveCategories: Record<string, string[]>;
export const sortOptions: Record<string, string>;
export const browseGenres: Record<string, number[]>;
export const runtimeRanges: Record<string, { min?: number; max?: number; label: string }>;

export function isAnime(originalLanguage?: string, genreIds?: number[]): boolean;
export function catalogFilters(params: URLSearchParams): {
  category: string;
  decade: number;
  sort: string;
  from: number;
  to: number;
  imdb: number;
  runtime: string;
};
export function discoverParams(
  type: 'movie' | 'tv',
  filters: { category?: string; decade?: number; sort?: string; from?: number; to?: number; runtime?: string },
  collection?: string,
): Record<string, string | number>;
export function matchesCatalog(
  item: { year?: string | number; genreIds?: number[]; categories?: string[]; genre?: string; originalLanguage?: string },
  filters: { category?: string; decade?: number; from?: number; to?: number },
): boolean;
