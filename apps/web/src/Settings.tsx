import { Dialog } from '@base-ui/react/dialog';
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { preferenceDefaults } from '@afterframe/shared/playback';
import { AccountButton } from './Account';
import { post, request } from './catalog';
import { Icon, MutationStatus } from './components';
import type { BooleanPreference, LibraryControls } from './library';
import { SettingsContext, type OpenSettings, type SettingsTab } from './settings-context';
import { AfSelect, ModalPortalContext, type SelectOption } from './UiControls';

function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  label,
  className = '',
}: {
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (next: T) => void;
  label: string;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; width: number; ready: boolean; animate: boolean }>({
    x: 0, width: 0, ready: false, animate: false,
  });
  const hadRef = useRef(false);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const active = track.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
      if (!active || active.offsetWidth === 0) return;
      const x = active.offsetLeft;
      const width = active.offsetWidth;
      const animate = hadRef.current;
      hadRef.current = true;
      setPill(prev => prev.x === x && prev.width === width && prev.ready && prev.animate === animate
        ? prev : { x, width, ready: true, animate });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => ro.disconnect();
  }, [value, options.length]);

  return (
    <div ref={trackRef} role="group" aria-label={label} className={`af-segmented ${pill.ready ? 'has-indicator' : ''} ${className}`.trim()}>
      {pill.ready && (
        <span
          className={`af-segmented-indicator ${pill.animate ? 'is-animated' : ''}`}
          style={{ transform: `translateX(${pill.x}px)`, width: `${pill.width}px` }}
          aria-hidden="true"
        />
      )}
      {options.map(([key, text]) => (
        <button key={key} type="button" aria-pressed={key === value} onClick={() => onChange(key)}>
          {text}
        </button>
      ))}
    </div>
  );
}

const sections = ['Playback', 'Spoilers', 'Interface', 'Notifications'] as const;
type Section = typeof sections[number];
const settingsTabs = [['general', 'General'], ['integrations', 'Integrations']] as const;
const languages = ['English', 'French', 'German', 'Italian', 'Japanese', 'Korean', 'Lithuanian', 'Portuguese', 'Spanish'];

function Toggle({ name, label, description, controls }: { name: BooleanPreference; label: string; description?: string; controls: LibraryControls }) {
  const value = controls.library.preferences[name] ?? preferenceDefaults[name];
  const key = `preference/${name}`;
  return <div className="af-settings-row">
    <label><span>{label}{description && <small>{description}</small>}</span>
      <input type="checkbox" role="switch" checked={value} disabled={!controls.ready || controls.isPending(key)}
        onChange={event => void controls.setPreference(name, event.target.checked, label)} />
    </label>
    <MutationStatus itemKey={key} controls={controls} />
  </div>;
}

function SettingSelect({ label, description, value, disabled, options, onChange }: {
  label: string; description?: string; value: string; disabled?: boolean; options: readonly SelectOption[]; onChange: (value: string) => void;
}) {
  const labelId = useId();
  return <div className="af-settings-field">
    <span id={labelId}>{label}{description && <small>{description}</small>}</span>
    <AfSelect className="af-settings-select" ariaLabelledBy={labelId} value={value} disabled={disabled} options={options} onChange={onChange} />
  </div>;
}

function PlaybackSettings({ controls }: { controls: LibraryControls }) {
  const preferences = controls.library.preferences;
  const subtitle = preferences.subtitleLanguage ?? (preferences.captions ? 'English' : '');
  const audio = preferences.audioLanguage ?? '';
  const langChoices = (language: string): SelectOption[] => (language && !languages.includes(language) ? [...languages, language] : languages)
    .map(value => ({ value, label: value }));
  return <>
    <p className="af-meta af-settings-help">Auto-skip only triggers on high-confidence verified segments; lower-confidence timings still show a manual Skip button. You can always click Undo after a skip.</p>
    <Toggle controls={controls} name="intro" label="Automatically skip intros" />
    <Toggle controls={controls} name="recap" label="Automatically skip recaps" />
    <Toggle controls={controls} name="credits" label="Automatically skip credits" description="When matched timings are available and there is no next episode." />
    <Toggle controls={controls} name="autoplay" label="Automatically play next episode" />
    <Toggle controls={controls} name="resume" label="Resume where I left off" />
    <Toggle controls={controls} name="autoAddWatching" label="Auto-add to Library as Watching" description="Automatically add series and movies to your Library as Watching after an episode or meaningful playback progress." />
    <Toggle controls={controls} name="volume" label="Remember volume" />
    <Toggle controls={controls} name="subtitles" label="Remember subtitles" description="For captions controlled by Afterframe." />
    <div className="af-settings-row">
      <SettingSelect label="Preferred subtitles" value={subtitle} disabled={!controls.ready || controls.isPending('preference/subtitleLanguage')}
        options={[{ value: '', label: 'Off' }, ...langChoices(subtitle)]}
        onChange={value => {
          if (value && preferences.subtitles === false) void controls.setPreference('subtitles', true, 'Remember subtitles');
          void controls.setPreference('subtitleLanguage', value, 'Preferred subtitles');
        }} />
      <MutationStatus controls={controls} itemKey="preference/subtitleLanguage" />
    </div>
    <div className="af-settings-row">
      <SettingSelect label="Preferred audio" description="Used when supported by the video source." value={audio}
        disabled={!controls.ready || controls.isPending('preference/audioLanguage')}
        options={[{ value: '', label: 'Source default' }, ...langChoices(audio)]}
        onChange={value => void controls.setPreference('audioLanguage', value, 'Preferred audio')} />
      <MutationStatus controls={controls} itemKey="preference/audioLanguage" />
    </div>
    <div className="af-settings-row">
      <SettingSelect label="Preferred quality" description="Requested when a CineSrc video opens." value={preferences.quality || ''}
        disabled={!controls.ready || controls.isPending('preference/quality')}
        options={[{ value: '', label: 'Auto' }, { value: '1080', label: '1080p' }, { value: '720', label: '720p' }, { value: '480', label: '480p' }]}
        onChange={value => void controls.setPreference('quality', value, 'Preferred quality')} />
      <MutationStatus controls={controls} itemKey="preference/quality" />
    </div>
  </>;
}

function Credits() {
  const [expanded, setExpanded] = useState(false);
  return <div className={`af-settings-credits ${expanded ? 'is-open' : ''}`}>
    <button
      type="button"
      className="af-settings-credits-toggle"
      aria-expanded={expanded}
      onClick={() => setExpanded(v => !v)}
    >
      <span>Sources &amp; credits</span>
      <svg className="af-credits-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
    <div className="af-settings-credits-collapse" aria-hidden={!expanded}>
      <div className="af-settings-credits-body">
        <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer" tabIndex={expanded ? 0 : -1}><img src="/art/tmdb.svg" width="83" height="26" alt="TMDB" /></a>
        <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
        <p>Catalog playback uses CineSrc and <a href="https://emnexanime.site/" target="_blank" rel="noopener noreferrer" tabIndex={expanded ? 0 : -1}>EmnexAnime</a>. Anime episode mappings come from <a href="https://github.com/anibridge/anibridge-mappings" target="_blank" rel="noopener noreferrer" tabIndex={expanded ? 0 : -1}>AniBridge</a>.</p>
        <p>Manga is provided by <a href="https://mangadex.org/" target="_blank" rel="noopener noreferrer" tabIndex={expanded ? 0 : -1}>MangaDex</a>. Chapter pages credit their scanlation groups where listed.</p>
        <p>Public-domain and Creative Commons editions stream from the <a href="https://archive.org/" target="_blank" rel="noopener noreferrer" tabIndex={expanded ? 0 : -1}>Internet Archive</a> and <a href="https://commons.wikimedia.org/" target="_blank" rel="noopener noreferrer" tabIndex={expanded ? 0 : -1}>Wikimedia Commons</a>. The player shows the source and rights label for each edition.</p>
        <p>Skip timestamps are supplied by <a href="https://skipdb.tv/" target="_blank" rel="noopener noreferrer" tabIndex={expanded ? 0 : -1}>SkipDB</a>, <a href="https://introdb.app/" target="_blank" rel="noopener noreferrer" tabIndex={expanded ? 0 : -1}>IntroDB</a>, <a href="https://theintrodb.org/" target="_blank" rel="noopener noreferrer" tabIndex={expanded ? 0 : -1}>TheIntroDB</a>, and <a href="https://aniskip.com/" target="_blank" rel="noopener noreferrer" tabIndex={expanded ? 0 : -1}>AniSkip</a>.</p>
      </div>
    </div>
  </div>;
}

function GeneralSettings({ controls, onSectionChange }: { controls: LibraryControls; onSectionChange?: () => void }) {
  const [section, setSection] = useState<Section>('Playback');
  const heading = useRef<HTMLHeadingElement>(null);
  return <>
    <SegmentedTabs
      label="General settings"
      className="af-settings-subnav"
      value={section}
      options={sections.map(name => [name, name] as const)}
      onChange={name => {
        setSection(name);
        onSectionChange?.();
        requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
      }}
    />
    <section id="af-settings-options" key={section} className="af-settings-panel-enter" aria-labelledby="af-settings-section">
      <h3 ref={heading} tabIndex={-1} id="af-settings-section">{section === 'Spoilers' ? 'Spoiler protection' : section}</h3>
      {!controls.ready && <p className="af-meta" role="status">{controls.state === 'loading' ? 'Loading preferences…' : 'Reconnect your library to change preferences.'}</p>}
      {section === 'Playback' && <PlaybackSettings controls={controls} />}
      {section === 'Spoilers' && <>
        <p className="af-meta af-settings-help">These preferences apply to unwatched episodes. You can reveal each item individually.</p>
        <Toggle controls={controls} name="blur" label="Blur unwatched episode thumbnails" />
        <Toggle controls={controls} name="hideSynopsis" label="Hide unwatched episode descriptions" />
      </>}
      {section === 'Interface' && <>
        <Toggle controls={controls} name="reducedMotion" label="Always reduce motion" description="When off, Afterframe follows your system preference." />
        <Toggle controls={controls} name="compact" label="Compact episode list" />
        <Toggle controls={controls} name="confirmRemoval" label="Confirm removals and resets in Library" />
      </>}
      {section === 'Notifications' && <>
        {!controls.account && (
          <div className="af-settings-signin-note">
            <p className="af-meta">Sign in to receive release notifications for newly aired episodes and season premieres.</p>
            <AccountButton className="af-button af-secondary">Sign in</AccountButton>
          </div>
        )}
        <Toggle controls={controls} name="notifyEpisodes" label="New episodes" />
        <Toggle controls={controls} name="notifySeasonStarts" label="Season premieres" />
        <Toggle controls={controls} name="notifySeasonSchedules" label="Verified season announcements" />
      </>}
    </section>
    <Credits />
  </>;
}

type ConnectionStatus = { connected: boolean; omdbConnected: boolean; managedIntegrations: boolean };
const integrations = [
  { provider: 'tmdb', title: 'Film and TV catalog', description: 'Movie and series listings, artwork, and release dates.', label: 'API Read Access Token or API key', action: 'Save catalog credential', url: 'https://www.themoviedb.org/settings/api', limit: 2048 },
  { provider: 'omdb', title: 'IMDb ratings', description: 'Optional ratings for movies and series.', label: 'Ratings API key', action: 'Save ratings key', url: 'https://www.omdbapi.com/apikey.aspx', limit: 128 },
] as const;

function Integration({ definition, connected, managed, open, onSaved }: {
  definition: typeof integrations[number]; connected: boolean; managed: boolean; open: boolean; onSaved: (status: ConnectionStatus) => void;
}) {
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const credential = String(new FormData(form).get('credential') || '').trim();
    if (!credential) { setError('Enter the API credential.'); return; }
    setPending(true);
    setError('');
    setSaved(false);
    try {
      const result = await post<ConnectionStatus>('/api/connection', { provider: definition.provider, credential });
      form.reset();
      setSaved(true);
      onSaved(result);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not verify the credential. Try again.');
    } finally { setPending(false); }
  }
  return <section className="af-settings-integration" aria-labelledby={`af-settings-${definition.provider}`}>
    <div className="af-settings-integration-heading"><h3 id={`af-settings-${definition.provider}`}>{definition.title}</h3>
      <span className="af-meta af-settings-connection" data-connected={connected} role="status">
        {pending ? 'Checking key…' : saved ? 'Verified and saved' : connected ? 'Configured' : managed ? 'Not configured' : 'Key needed'}
      </span>
    </div>
    <p className="af-meta">{definition.description}</p>
    {!managed && <details open={open || undefined}>
      <summary>Manage {definition.provider === 'tmdb' ? 'catalog credentials' : 'ratings key'}</summary>
      <form onSubmit={save}>
        <label>{definition.label}
          <input className="af-input" name="credential" type="password" autoComplete="off" spellCheck={false}
            required maxLength={definition.limit} disabled={pending} aria-invalid={Boolean(error)}
            aria-describedby={error ? `af-settings-error-${definition.provider}` : undefined} />
        </label>
        {error && <p id={`af-settings-error-${definition.provider}`} role="alert">{error}</p>}
        <div className="af-actions">
          <button className="af-button af-primary" type="submit" disabled={pending}>{definition.action}</button>
          <a className="af-text-link" href={definition.url} target="_blank" rel="noopener noreferrer">Get {definition.provider === 'tmdb' ? 'a catalog' : 'a ratings'} key</a>
        </div>
      </form>
    </details>}
  </section>;
}

function Integrations({ expandCatalog, afterCatalogSaved }: { expandCatalog: boolean; afterCatalogSaved?: () => void }) {
  const [status, setStatus] = useState<ConnectionStatus>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const task = new AbortController();
    request<ConnectionStatus>('/api/status', { signal: task.signal })
      .then(result => { if (!task.signal.aborted) setStatus(result); })
      .catch(problem => { if (!task.signal.aborted) setError(problem.message); });
    return () => task.abort();
  }, [attempt]);
  if (error) return <div className="af-settings-help"><p role="alert">{error}</p>
    <button className="af-button af-secondary" type="button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry integrations</button>
  </div>;
  if (!status) return <p className="af-meta" role="status">Checking integrations…</p>;
  return <>
    <p className="af-meta af-settings-help">{status.managedIntegrations ? 'The server administrator manages these integrations.' : 'These credentials apply to every local profile.'}</p>
    {integrations.map(definition => <Integration key={definition.provider} definition={definition} managed={status.managedIntegrations}
      connected={definition.provider === 'tmdb' ? status.connected : status.omdbConnected}
      open={expandCatalog && definition.provider === 'tmdb'} onSaved={result => {
        setStatus(current => current && ({ ...current, connected: current.connected || result.connected, omdbConnected: current.omdbConnected || result.omdbConnected }));
        if (definition.provider === 'tmdb' && result.connected) afterCatalogSaved?.();
      }} />)}
  </>;
}

export function SettingsProvider({ controls, children }: { controls: LibraryControls; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SettingsTab>('general');
  const [opening, setOpening] = useState(0);
  const invoker = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const portalHostRef = useRef<HTMLDivElement>(null);
  const entry = useRef<SettingsTab>('general');
  const afterCatalogSaved = useRef<(() => void) | undefined>(undefined);
  const resetScroll = () => { contentRef.current?.scrollTo({ top: 0 }); };
  const openSettings: OpenSettings = (next, source, onSaved) => {
    invoker.current = source;
    entry.current = next;
    afterCatalogSaved.current = onSaved;
    setTab(next);
    setOpening(value => value + 1);
    setOpen(true);
  };
  return <SettingsContext.Provider value={openSettings}>
    {children}
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="af-scrim" />
        <Dialog.Popup className="af-modal af-settings-modal" initialFocus={closeButton}
          finalFocus={() => invoker.current?.isConnected ? invoker.current : document.getElementById('main')}>
          <ModalPortalContext.Provider value={portalHostRef}>
            <header className="af-settings-header"><Dialog.Title>Settings</Dialog.Title>
              <Dialog.Close ref={closeButton} className="af-icon-button" aria-label="Close settings"><Icon name="close" /></Dialog.Close>
            </header>
            <div className="af-settings-tabs">
              <SegmentedTabs label="Settings sections" value={tab} options={settingsTabs} onChange={next => { setTab(next); resetScroll(); }} />
            </div>
            <div ref={contentRef} className="af-settings-content" key={opening}>
              <div key={tab} className="af-settings-panel-enter">
                {tab === 'general' ? <GeneralSettings controls={controls} onSectionChange={resetScroll} />
                  : <Integrations expandCatalog={entry.current === 'integrations'} afterCatalogSaved={afterCatalogSaved.current} />}
              </div>
            </div>
            <div ref={portalHostRef} className="af-modal-portal-host" />
          </ModalPortalContext.Provider>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  </SettingsContext.Provider>;
}
