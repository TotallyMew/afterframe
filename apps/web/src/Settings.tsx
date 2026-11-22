import { Dialog } from '@base-ui/react/dialog';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { preferenceDefaults } from '../../../afterframe/public/playback.js';
import { post, request } from './catalog';
import { Icon, MutationStatus } from './components';
import type { BooleanPreference, LibraryControls } from './library';
import { SettingsContext, type OpenSettings, type SettingsTab } from './settings-context';

const sections = ['Playback', 'Spoilers', 'Interface', 'Availability', 'Notifications'] as const;
type Section = typeof sections[number];
const settingsTabs = [['general', 'General'], ['integrations', 'Integrations']] as const;
const languages = ['English', 'French', 'German', 'Italian', 'Japanese', 'Korean', 'Lithuanian', 'Portuguese', 'Spanish'];
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const regions = 'AE AR AT AU BE BG BR CA CH CL CO CZ DE DK EE ES FI FR GB GR HK HR HU ID IE IL IN IS IT JP KR LT LU LV MX MY NL NO NZ PE PH PL PT RO RS SE SG SI SK TH TR TW UA US ZA'
  .split(' ').map(code => ({ code, name: regionNames.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name));

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

function SettingSelect({ label, description, value, disabled, children, onChange }: {
  label: string; description?: string; value: string; disabled?: boolean; children: ReactNode; onChange: (value: string) => void;
}) {
  return <label className="af-settings-field">
    <span>{label}{description && <small>{description}</small>}</span>
    <select className="af-input" value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>{children}</select>
  </label>;
}

function PlaybackSettings({ controls }: { controls: LibraryControls }) {
  const preferences = controls.library.preferences;
  const subtitle = preferences.subtitleLanguage ?? (preferences.captions ? 'English' : '');
  const audio = preferences.audioLanguage ?? '';
  const choices = (language: string) => (language && !languages.includes(language) ? [...languages, language] : languages)
    .map(value => <option key={value}>{value}</option>);
  return <>
    <p className="af-meta af-settings-help">CineSrc combines intro and recap skipping. Turn on both options to skip them automatically.</p>
    <Toggle controls={controls} name="intro" label="Automatically skip intros" />
    <Toggle controls={controls} name="recap" label="Automatically skip recaps" />
    <Toggle controls={controls} name="credits" label="Automatically skip credits" description="When matched timings are available and there is no next episode." />
    <Toggle controls={controls} name="autoplay" label="Automatically play next episode" />
    <Toggle controls={controls} name="resume" label="Resume where I left off" />
    <Toggle controls={controls} name="volume" label="Remember volume" />
    <Toggle controls={controls} name="subtitles" label="Remember subtitles" description="For captions controlled by Afterframe." />
    <div className="af-settings-row">
      <SettingSelect label="Preferred subtitles" value={subtitle} disabled={!controls.ready || controls.isPending('preference/subtitleLanguage')}
        onChange={value => {
          if (value && preferences.subtitles === false) void controls.setPreference('subtitles', true, 'Remember subtitles');
          void controls.setPreference('subtitleLanguage', value, 'Preferred subtitles');
        }}>
        <option value="">Off</option>{choices(subtitle)}
      </SettingSelect>
      <MutationStatus controls={controls} itemKey="preference/subtitleLanguage" />
    </div>
    <div className="af-settings-row">
      <SettingSelect label="Preferred audio" description="Used when supported by the video source." value={audio}
        disabled={!controls.ready || controls.isPending('preference/audioLanguage')}
        onChange={value => void controls.setPreference('audioLanguage', value, 'Preferred audio')}>
        <option value="">Source default</option>{choices(audio)}
      </SettingSelect>
      <MutationStatus controls={controls} itemKey="preference/audioLanguage" />
    </div>
    <div className="af-settings-row">
      <SettingSelect label="Preferred quality" description="Requested when a CineSrc video opens." value={preferences.quality || ''}
        disabled={!controls.ready || controls.isPending('preference/quality')}
        onChange={value => void controls.setPreference('quality', value, 'Preferred quality')}>
        <option value="">Auto</option><option value="1080">1080p</option><option value="720">720p</option><option value="480">480p</option>
      </SettingSelect>
      <MutationStatus controls={controls} itemKey="preference/quality" />
    </div>
  </>;
}

function AvailabilitySettings() {
  const [region, setRegion] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('afterframe.region') || 'null');
      if (regions.some(({ code }) => code === saved)) return saved as string;
    } catch { /* Use the catalog default. */ }
    return 'LT';
  });
  const [error, setError] = useState(false);
  return <div className="af-settings-row">
    <SettingSelect label="Region" description="Used for JustWatch listings." value={region} onChange={value => {
      try {
        localStorage.setItem('afterframe.region', JSON.stringify(value));
        setRegion(value);
        setError(false);
      } catch { setError(true); }
    }}>
      {regions.map(({ code, name }) => <option value={code} key={code}>{name}</option>)}
    </SettingSelect>
    {error && <p role="alert">Could not save the region. Try again.</p>}
  </div>;
}

function Credits() {
  return <details className="af-settings-credits">
    <summary>Sources &amp; credits</summary>
    <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer"><img src="/art/tmdb.svg" width="83" height="26" alt="TMDB" /></a>
    <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
    <p>Regional streaming, rental, and purchase availability is provided by <a href="https://www.justwatch.com/" target="_blank" rel="noopener noreferrer">JustWatch</a>.</p>
    <p>Catalog playback uses CineSrc, <a href="https://animeembed.com/" target="_blank" rel="noopener noreferrer">AnimeEmbed</a>, and <a href="https://ani.pm/developers" target="_blank" rel="noopener noreferrer">Ani.pm</a>. Anime episode mappings come from <a href="https://github.com/anibridge/anibridge-mappings" target="_blank" rel="noopener noreferrer">AniBridge</a>.</p>
    <p>Comics are provided by <a href="https://mangadex.org/" target="_blank" rel="noopener noreferrer">MangaDex</a>. Chapter pages credit their scanlation groups where listed.</p>
    <p>Public-domain and Creative Commons editions stream from the <a href="https://archive.org/" target="_blank" rel="noopener noreferrer">Internet Archive</a> and <a href="https://commons.wikimedia.org/" target="_blank" rel="noopener noreferrer">Wikimedia Commons</a>. The player shows the source and rights label for each edition.</p>
    <p>Community skip timestamps are supplied by <a href="https://theintrodb.org/" target="_blank" rel="noopener noreferrer">TheIntroDB</a>.</p>
  </details>;
}

function GeneralSettings({ controls }: { controls: LibraryControls }) {
  const [section, setSection] = useState<Section>('Playback');
  const heading = useRef<HTMLHeadingElement>(null);
  return <>
    <div role="group" aria-label="General settings" className="af-settings-subnav af-filters">
      {sections.map(name => <button key={name} type="button" aria-pressed={section === name} aria-controls="af-settings-options" onClick={() => {
        setSection(name);
        requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
      }}>{name}</button>)}
    </div>
    <section id="af-settings-options" aria-labelledby="af-settings-section">
      <h3 ref={heading} tabIndex={-1} id="af-settings-section">{section === 'Spoilers' ? 'Spoiler protection' : section}</h3>
      {!controls.ready && section !== 'Availability' && <p className="af-meta" role="status">{controls.state === 'loading' ? 'Loading preferences…' : 'Reconnect your library to change preferences.'}</p>}
      {section === 'Playback' && <PlaybackSettings controls={controls} />}
      {section === 'Spoilers' && <>
        <p className="af-meta af-settings-help">These preferences apply to unwatched episodes. You can reveal each item individually.</p>
        <Toggle controls={controls} name="blur" label="Blur unwatched episode thumbnails" />
        <Toggle controls={controls} name="hideSynopsis" label="Hide unwatched episode descriptions" />
      </>}
      {section === 'Interface' && <>
        <Toggle controls={controls} name="reducedMotion" label="Always reduce motion" description="When off, Afterframe follows your system preference." />
        <Toggle controls={controls} name="compact" label="Compact episode list" />
        <Toggle controls={controls} name="confirmRemoval" label="Confirm removals and resets in My Library" />
      </>}
      {section === 'Availability' && <AvailabilitySettings />}
      {section === 'Notifications' && <>
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
  const entry = useRef<SettingsTab>('general');
  const afterCatalogSaved = useRef<(() => void) | undefined>(undefined);
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
          <header className="af-settings-header"><Dialog.Title>Settings</Dialog.Title>
            <Dialog.Close ref={closeButton} className="af-icon-button" aria-label="Close settings"><Icon name="close" /></Dialog.Close>
          </header>
          <div className="af-settings-tabs af-filters" role="group" aria-label="Settings sections">
            {settingsTabs.map(([key, label]) => <button type="button" key={key} aria-pressed={key === tab} onClick={() => setTab(key)}>{label}</button>)}
          </div>
          <div className="af-settings-content" key={opening}>
            {tab === 'general' ? <GeneralSettings controls={controls} />
              : <Integrations expandCatalog={entry.current === 'integrations'} afterCatalogSaved={afterCatalogSaved.current} />}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  </SettingsContext.Provider>;
}
