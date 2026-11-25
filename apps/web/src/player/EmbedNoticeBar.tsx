import { animePlayers, type AnimeProvider } from './types';

export function EmbedNoticeBar({
  provider,
  providerControls,
  animeEligible,
  embedStatus,
  onSwitchProvider,
  onToggleProviderControls,
  onReload,
}: {
  provider: AnimeProvider;
  providerControls: boolean;
  animeEligible: boolean;
  embedStatus: { message: string; canRetry: boolean };
  onSwitchProvider: (next: AnimeProvider) => void;
  onToggleProviderControls: () => void;
  onReload: () => void;
}) {
  const isExternalControls = provider !== 'cinesrc' || providerControls;
  const modeLabel = isExternalControls ? 'External controls' : 'Afterframe controls';
  const detail = embedStatus.message || (
    isExternalControls
      ? `${animePlayers[provider].label} handles audio and subtitle controls for this stream.`
      : `Streaming via ${animePlayers[provider].label} with Afterframe playback controls.`
  );

  return <div className="af-embed-notice" data-mode={isExternalControls ? 'external' : 'afterframe'}>
    <div className="af-embed-notice-info">
      <span className="af-source-badge" data-external={isExternalControls || undefined}>
        {animePlayers[provider].label} · {modeLabel}
      </span>
      <span role="status" className="af-embed-notice-text">{detail}</span>
    </div>
    <div className="af-actions">
      {animeEligible && <button type="button" className="af-button af-secondary" onClick={() => onSwitchProvider(animePlayers[provider].next)}>
        Use {animePlayers[animePlayers[provider].next].label}
      </button>}
      {provider === 'cinesrc' && <button type="button" className="af-button af-secondary" onClick={onToggleProviderControls}>
        {providerControls ? 'Use Afterframe controls' : 'Use CineSrc controls'}
      </button>}
      {(embedStatus.canRetry || provider === 'cinesrc') && <button type="button" className="af-button af-secondary" onClick={onReload}>
        Reload player
      </button>}
    </div>
  </div>;
}
