import type { ReactNode } from 'react';

export type PlayerGlyphName =
  | 'pause' | 'replay' | 'back10' | 'fwd10'
  | 'speaker' | 'muted' | 'cc' | 'tune'
  | 'prev' | 'next' | 'full' | 'exitFull'
  | 'theatre' | 'episodes' | 'pip';

const paths: Record<PlayerGlyphName, ReactNode> = {
  pause: <path d="M9 5v14m6-14v14" strokeWidth="2.6" />,
  replay: <path d="M3 11a9 9 0 1 1 3.4 7M3 5v6h6" />,
  back10: <><path d="M3 10a9 9 0 1 1 4 9M3 4v6h6" /><path d="m8 12 2-1v5m4-5c-2 0-2 5 0 5s2-5 0-5" /></>,
  fwd10: <><path d="M21 10a9 9 0 1 0-4 9m4-15v6h-6" /><path d="m8 12 2-1v5m4-5c-2 0-2 5 0 5s2-5 0-5" /></>,
  speaker: <path d="M3.5 9.5h4L12.5 5v14l-5-4.5h-4zM16 9a4.5 4.5 0 0 1 0 6m2.5-8.5a8 8 0 0 1 0 11" />,
  muted: <path d="M3.5 9.5h4L12.5 5v14l-5-4.5h-4zM16 10l4 4m0-4-4 4" />,
  cc: <><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M7 11h4m2 0h4M7 14.5h6m2 0h2" /></>,
  tune: <><path d="M4 7h3m4 0h9M4 12h8m4 0h4M4 17h2m4 0h10" /><circle cx="9" cy="7" r="2" /><circle cx="14" cy="12" r="2" /><circle cx="8" cy="17" r="2" /></>,
  prev: <path d="M5 5v14m14-14-11 7 11 7z" />,
  next: <path d="M19 5v14M5 5l11 7-11 7z" />,
  full: <path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4" />,
  exitFull: <path d="M4 8h4V4m12 4h-4V4M8 20v-4H4m12 4v-4h4" />,
  theatre: <rect x="2.5" y="5.5" width="19" height="13" rx="2" />,
  episodes: <><rect x="3" y="5" width="7" height="5" rx="1" /><path d="M13 6.5h8M13 9.5h5" /><rect x="3" y="14" width="7" height="5" rx="1" /><path d="M13 15.5h8M13 18.5h5" /></>,
  pip: <><rect x="3" y="5" width="18" height="14" rx="2" /><rect x="11.5" y="11" width="7" height="5" rx="1" fill="currentColor" stroke="none" /></>,
};

export function PlayerGlyph({ name }: Readonly<{ name: PlayerGlyphName }>) {
  return <svg className="af-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
