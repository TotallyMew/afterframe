import { animePlayers, type AnimeProvider } from './types';

export function EmbedNoticeBar({
  provider,
  providerControls,
  animeEligible,
  embedStatus,
  streamMeta,
  fallbackNotice,
  onSwitchProvider,
  onToggleProviderControls,
  onReload,
}: Readonly<{
  provider: AnimeProvider;
  providerControls: boolean;
  animeEligible: boolean;
  embedStatus: { message: string; canRetry: boolean };
  streamMeta?: string;
  fallbackNotice?: string;
  onSwitchProvider: (next: AnimeProvider) => void;
  onToggleProviderControls: () => void;
  onReload: () => void;
}>) {
  const isExternalControls = provider === 'cinesrc' && providerControls;
  const modeLabel = isExternalControls ? 'External controls' : (streamMeta || 'Afterframe controls');
  const detail = (embedStatus.canRetry ? embedStatus.message : '')
    || fallbackNotice
    || embedStatus.message
    || (
      isExternalControls
        ? `${animePlayers[provider].label} handles playback controls for this stream.`
        : `Streaming via ${animePlayers[provider].label}.`
    );

  return <div className="af-embed-notice" data-mode={isExternalControls ? 'external' : 'afterframe'}>
    <div className="af-embed-notice-info">
      <span className="af-source-badge" data-external={isExternalControls || undefined}>
        {animePlayers[provider].label} · {modeLabel}
      </span>
      <output className="af-embed-notice-text">{detail}</output>
    </div>
    <div className="af-actions af-source-actions">
      {animeEligible && <button type="button" className="af-button af-secondary af-source-btn" onClick={() => onSwitchProvider(animePlayers[provider].next)}>
        Use {animePlayers[animePlayers[provider].next].label}
      </button>}
      {provider === 'cinesrc' && <button type="button" className="af-button af-secondary af-source-btn" onClick={onToggleProviderControls}>
        {providerControls ? 'Use Afterframe controls' : 'Use CineSrc controls'}
      </button>}
      {(embedStatus.canRetry || provider === 'cinesrc' || provider === 'emnex') && <button type="button" className="af-button af-secondary af-source-btn" onClick={onReload}>
        Reload
      </button>}
    </div>
  </div>;
}
