import { comicCover, comicDetailsHref, routeWithParams, webHref, type Comic } from './catalog';
import { Artwork, Icon, SaveButton } from './components';
import type { LibraryControls } from './library';
import { currentLocationHref, currentSearchParams } from './router';

export const comicFormatOptions = [['', 'All'], ['manga', 'Manga'], ['manhwa', 'Manhwa'], ['manhua', 'Manhua']] as const;
export const comicStatusOptions = [['ongoing', 'Ongoing'], ['completed', 'Completed'], ['hiatus', 'On hiatus'], ['cancelled', 'Cancelled']] as const;
const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function releasedAgo(iso?: string, now = Date.now()) {
  const time = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(time)) return '';
  const minutes = Math.max(0, Math.round((now - time) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

function LatestRelease({ item }: { item: Comic }) {
  const ago = releasedAgo(item.latestAt);
  if (!ago) return null;
  const chapter = item.latestChapter ? `Ch. ${item.latestChapter}` : 'Updated';
  return <time className="af-poster-airing af-poster-latest" dateTime={item.latestAt}
    title={`${item.latestChapter ? `Chapter ${item.latestChapter}` : 'Latest chapter'} released ${fullDate.format(new Date(item.latestAt!))}`}>
    {chapter} · {ago}
  </time>;
}

export function comicHref(item: Pick<Comic, 'id'>) {
  return comicDetailsHref(item.id);
}

export function readerHref(item: Pick<Comic, 'id'>, chapter: string, language: string, page = 1, position = 1) {
  const variables = new URLSearchParams({ lang: language });
  if (page > 1) variables.set('page', String(page));
  if (position > 1) variables.set('position', String(position));
  const prior = currentLocationHref();
  const back = prior.startsWith('/comic/') ? currentSearchParams().get('back') : prior;
  if (back) variables.set('back', back);
  return webHref(routeWithParams(`comic/${encodeURIComponent(item.id)}/read/${encodeURIComponent(chapter)}`, variables));
}

export function comicFacts(item: Comic, includeChapters = true) {
  const format = comicFormatOptions.find(([key]) => key && key === item.format)?.[1] ?? 'Manga';
  const status = comicStatusOptions.find(([key]) => key === item.status)?.[1];
  const chapters = includeChapters ? (item.chapterCount || item.lastChapter) : '';
  const chapterLabel = chapters ? `${chapters} ch` : '';
  return [format, chapterLabel || item.year, status].filter(Boolean).join(' · ');
}

export function ComicCard({ item, controls, href, context, eager, onDismiss }: {
  item: Comic; controls: LibraryControls; href?: string; context?: string; eager?: boolean; onDismiss?: () => void;
}) {
  const cover = comicCover(item.poster);
  return <article className="af-media-card"><a href={href || comicHref(item)}>
    <span className="af-poster">
      <Artwork src={cover} loading={eager ? 'eager' : 'lazy'} decoding="async" fallback={<Icon name="book" />} />
      {!context && item.mal != null && item.mal > 0 && (
        <span className="af-poster-badge">
          <span className="sr-only">MyAnimeList score </span>
          <span aria-hidden="true">★</span> {item.mal.toFixed(1)}
        </span>
      )}
      {!context && <LatestRelease item={item} />}
    </span>
    <strong>{item.title}</strong><span className="af-card-meta">{context || comicFacts(item)}</span>
  </a>
    {onDismiss ? <button type="button" className="af-icon-button af-card-save af-card-dismiss"
      aria-label={`Remove ${item.title} from Continue reading`} title="Remove from Continue reading"
      onClick={onDismiss}><Icon name="close" /></button>
      : <SaveButton item={item} controls={controls} compact />}
  </article>;
}
