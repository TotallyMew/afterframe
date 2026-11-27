import type { ReactNode } from 'react';
import { Icon } from './components';

export type EmptyEmblem = 'film' | 'book' | 'search' | 'bookmark' | 'clock' | 'settings' | 'bell' | 'folder';

export function EmptyState({
  icon,
  title,
  description,
  actions,
  headingLevel = 2,
}: Readonly<{
  icon: EmptyEmblem;
  title: string;
  description: string;
  actions?: ReactNode;
  headingLevel?: 2 | 3;
}>) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return <div className="af-empty-state">
    <span className="af-empty-emblem" aria-hidden="true">
      <Icon name={icon} />
    </span>
    <div className="af-empty-copy">
      <Heading>{title}</Heading>
      <p className="af-meta">{description}</p>
      {actions && <div className="af-actions">{actions}</div>}
    </div>
  </div>;
}
