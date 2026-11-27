import { Dialog } from '@base-ui/react/dialog';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { post } from './catalog';
import { Icon } from './components';
import { guestLibrary, guestSummary, type Library, type LibraryControls, type LibraryCounts } from './library';
import { useToast } from './Toast';
import './Account.css';

type Mode = 'signin' | 'create' | 'reset';
type SecurityAction = 'recovery-code' | 'revoke-other';
type Action = Mode | SecurityAction | 'signout' | 'migrate';
type SessionResponse = { account: NonNullable<LibraryControls['account']>; library: Partial<Library> };

const modes = {
  signin: { title: 'Sign in to Afterframe', submit: 'Sign in', pending: 'Signing in…' },
  create: { title: 'Create an account', submit: 'Create account', pending: 'Creating your account…' },
  reset: { title: 'Reset your password', submit: 'Reset password', pending: 'Resetting your password…' },
} satisfies Record<Mode, { title: string; submit: string; pending: string }>;

const securityActions = {
  'recovery-code': {
    label: 'Generate recovery code',
    description: 'This replaces any recovery code you already have. Save the new code somewhere safe.',
    pending: 'Generating your recovery code…',
  },
  'revoke-other': {
    label: 'Sign out other devices',
    description: 'This device will stay signed in. Afterframe will end all your other sessions.',
    pending: 'Signing out other devices…',
  },
} satisfies Record<SecurityAction, { label: string; description: string; pending: string }>;

const usernamePattern = String.raw`[A-Za-z0-9][A-Za-z0-9_\-]{2,29}`;
const openAccountContext = createContext<(invoker: HTMLElement | null) => void>(() => {});

export function useAccountDialog() {
  return useContext(openAccountContext);
}

export function AccountButton({ className, children, label }: Readonly<{ className: string; children: ReactNode; label?: string }>) {
  const openAccount = useAccountDialog();
  return <button type="button" className={className} aria-label={label} aria-haspopup="dialog"
    onClick={event => openAccount(event.currentTarget)}>{children}</button>;
}

function getPendingMessage(pending?: Action): string {
  if (!pending) return '';
  if (pending === 'signout') return 'Signing out…';
  if (pending === 'migrate') return 'Merging browser library…';
  if (pending === 'recovery-code' || pending === 'revoke-other') return securityActions[pending].pending;
  return modes[pending].pending;
}

function buildMigrationSummaryParts(migration: LibraryCounts): string[] {
  return [
    migration.saved ? `${migration.saved} saved` : '',
    migration.watched ? `${migration.watched} watched` : '',
    migration.ratings ? `${migration.ratings} rated` : '',
    migration.progress ? `${migration.progress} playback positions` : '',
    migration.reading ? `${migration.reading} reading positions` : '',
    migration.history ? `${migration.history} history entries` : '',
    migration.folders ? `${migration.folders} folders` : '',
  ].filter(Boolean);
}

function AccountMigrationView({
  migration,
  clearGuestAfterMerge,
  onClearGuestChange,
  pending,
  onMerge,
  onClose,
}: Readonly<{
  migration: LibraryCounts;
  clearGuestAfterMerge: boolean;
  onClearGuestChange: (checked: boolean) => void;
  pending: boolean;
  onMerge: () => void;
  onClose: () => void;
}>) {
  const summaryParts = buildMigrationSummaryParts(migration);
  return (
    <div className="af-account-migrate">
      <h3>Merge browser guest library?</h3>
      <p className="af-meta">
        Found {summaryParts.join(', ')} saved on this browser. Existing items in your account are kept unless the browser copy is newer.
      </p>
      <label className="af-account-check">
        <input type="checkbox" checked={clearGuestAfterMerge} disabled={pending} onChange={event => onClearGuestChange(event.target.checked)} />
        <span>Clear this browser&apos;s guest copy after merging</span>
      </label>
      <div className="af-actions">
        <button type="button" className="af-button af-primary" disabled={pending} onClick={onMerge}>Merge into account</button>
        <button type="button" className="af-button af-secondary" disabled={pending} onClick={onClose}>Skip for now</button>
      </div>
    </div>
  );
}

function AccountSignedInView({
  account,
  controls,
  pending,
  availableGuest,
  confirmation,
  securityPassword,
  recoveryCode,
  confirmationHeading,
  onSignOut,
  onStartMigration,
  onRequestConfirmation,
  onSecurityPasswordChange,
  onConfirmAction,
  onDismissConfirmation,
}: Readonly<{
  account: NonNullable<LibraryControls['account']>;
  controls: LibraryControls;
  pending: boolean;
  availableGuest: LibraryCounts | null;
  confirmation: SecurityAction | undefined;
  securityPassword: string;
  recoveryCode: string;
  confirmationHeading: RefObject<HTMLHeadingElement | null>;
  onSignOut: () => void;
  onStartMigration: (guest: LibraryCounts) => void;
  onRequestConfirmation: (action: SecurityAction, source: HTMLButtonElement) => void;
  onSecurityPasswordChange: (value: string) => void;
  onConfirmAction: (action: SecurityAction) => void;
  onDismissConfirmation: () => void;
}>) {
  return (
    <>
      <div className="af-account-profile">
        <span className="af-account-avatar" aria-hidden="true">{account.username.slice(0, 1).toUpperCase()}</span>
        <div><h3>{account.username}</h3><Dialog.Description className="af-meta">Manage your account and active sessions.</Dialog.Description></div>
      </div>
      <div className="af-actions">
        <button type="button" className="af-button af-secondary" disabled={pending || controls.libraryBusy} onClick={onSignOut}>Sign out</button>
        {availableGuest && availableGuest.total > 0 && (
          <button type="button" className="af-button af-secondary" disabled={pending} onClick={() => onStartMigration(availableGuest)}>
            Merge {availableGuest.total} guest {availableGuest.total === 1 ? 'item' : 'items'}
          </button>
        )}
        {controls.libraryBusy && <output className="af-meta">Saving your library changes…</output>}
      </div>
      <section className="af-account-security" aria-labelledby="af-account-security">
        <h3 id="af-account-security">Account security</h3>
        <div className="af-actions">
          {(Object.keys(securityActions) as SecurityAction[]).map(action => (
            <button
              className="af-button af-secondary"
              type="button"
              key={action}
              disabled={pending}
              aria-expanded={confirmation === action}
              onClick={event => onRequestConfirmation(action, event.currentTarget)}
            >
              {securityActions[action].label}
            </button>
          ))}
        </div>
        {confirmation && (
          <div className="af-account-confirm">
            <h4 ref={confirmationHeading} tabIndex={-1}>{securityActions[confirmation].label}?</h4>
            <p className="af-meta">{securityActions[confirmation].description}</p>
            {confirmation === 'recovery-code' && (
              <label className="af-account-confirm-field">
                <span>Current password</span>
                <input
                  className="af-input"
                  type="password"
                  autoComplete="current-password"
                  minLength={8}
                  maxLength={128}
                  required
                  disabled={pending}
                  value={securityPassword}
                  onChange={event => onSecurityPasswordChange(event.target.value)}
                />
              </label>
            )}
            <div className="af-actions">
              <button
                type="button"
                className="af-button af-primary"
                disabled={pending || (confirmation === 'recovery-code' && securityPassword.length < 8)}
                onClick={() => onConfirmAction(confirmation)}
              >
                {securityActions[confirmation].label}
              </button>
              <button type="button" className="af-button af-secondary" disabled={pending} onClick={onDismissConfirmation}>Cancel</button>
            </div>
          </div>
        )}
        {recoveryCode && (
          <div className="af-account-recovery">
            <p>Save this one-time code somewhere safe.</p>
            <output aria-label="Recovery code">{recoveryCode}</output>
          </div>
        )}
      </section>
    </>
  );
}

function AccountAuthForm({
  mode,
  username,
  showPassword,
  error,
  pending,
  libraryBusy,
  usernameInput,
  onUsernameChange,
  onTogglePassword,
  onSwitchMode,
  onSubmit,
}: Readonly<{
  mode: Mode;
  username: string;
  showPassword: boolean;
  error: string;
  pending: boolean;
  libraryBusy: boolean;
  usernameInput: RefObject<HTMLInputElement | null>;
  onUsernameChange: (value: string) => void;
  onTogglePassword: () => void;
  onSwitchMode: (next: Mode) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}>) {
  const passwordDescribedBy = [mode !== 'signin' ? 'af-account-password-hint' : '', error ? 'af-account-error' : ''].filter(Boolean).join(' ') || undefined;
  return (
    <form className="af-account-form" key={mode} onSubmit={onSubmit}>
      <label htmlFor="af-account-username">Username</label>
      <input ref={usernameInput} id="af-account-username" className="af-input" name="username" type="text"
        autoComplete="username" autoCapitalize="none" spellCheck={false} pattern={usernamePattern}
        minLength={3} maxLength={30} required readOnly={pending} value={username}
        aria-describedby={mode === 'create' ? 'af-account-username-hint' : undefined}
        onChange={event => onUsernameChange(event.target.value)} />
      {mode === 'create' && <p id="af-account-username-hint" className="af-meta">Use 3–30 letters, numbers, underscores or hyphens.</p>}
      {mode === 'reset' && <>
        <label htmlFor="af-account-recovery-code">Recovery code</label>
        <input id="af-account-recovery-code" className="af-input" name="code" type="password"
          autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} minLength={48} maxLength={48}
          pattern="[A-Fa-f0-9]{48}" required readOnly={pending}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'af-account-recovery-hint af-account-error' : 'af-account-recovery-hint'} />
        <p id="af-account-recovery-hint" className="af-meta">Enter your 48-character recovery code (letters A–F and numbers 0–9).</p>
      </>}
      <label htmlFor="af-account-password">{mode === 'reset' ? 'New password' : 'Password'}</label>
      <div className="af-account-password">
        <input className="af-input" id="af-account-password" name="password" type={showPassword ? 'text' : 'password'}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={8} maxLength={128}
          aria-invalid={Boolean(error)}
          aria-describedby={passwordDescribedBy}
          required readOnly={pending} />
        <button className="af-password-toggle" type="button" aria-pressed={showPassword} aria-label="Show password"
          onClick={onTogglePassword}>{showPassword ? 'Hide' : 'Show'}</button>
      </div>
      {mode !== 'signin' && <p id="af-account-password-hint" className="af-meta">Use at least 8 characters.</p>}
      {libraryBusy && <output className="af-meta">Saving your library changes…</output>}
      <button className="af-button af-primary" type="submit" disabled={pending || libraryBusy}>{modes[mode].submit}</button>
      <div className="af-account-links">
        {mode === 'signin' ? <>
          <button type="button" className="af-text-link" disabled={pending} onClick={() => onSwitchMode('create')}>Create an account</button>
          <span className="af-meta" aria-hidden="true">·</span>
          <button type="button" className="af-text-link" disabled={pending} onClick={() => onSwitchMode('reset')}>Use a recovery code</button>
        </> : <button type="button" className="af-text-link" disabled={pending}
          onClick={() => onSwitchMode('signin')}>Back to sign in</button>}
      </div>
    </form>
  );
}

export function AccountProvider({ controls, children }: Readonly<{ controls: LibraryControls; children: ReactNode }>) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('signin');
  const [username, setUsername] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [confirmation, setConfirmation] = useState<SecurityAction>();
  const [securityPassword, setSecurityPassword] = useState('');
  const [pending, setPending] = useState<Action>();
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [migration, setMigration] = useState<LibraryCounts | null>(null);
  const [clearGuestAfterMerge, setClearGuestAfterMerge] = useState(true);
  const { notify } = useToast();
  const invoker = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const usernameInput = useRef<HTMLInputElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const securityInvoker = useRef<HTMLButtonElement>(null);
  const restoreSecurityFocus = useRef(false);
  const inFlight = useRef(false);
  const account = controls.account;
  const controlsStateRef = useRef(controls.state);
  const controlsRefreshRef = useRef(controls.refresh);
  controlsStateRef.current = controls.state;
  controlsRefreshRef.current = controls.refresh;

  useEffect(() => {
    if (error) feedback.current?.focus();
  }, [error]);

  useEffect(() => {
    if (open && !account && !confirmation) usernameInput.current?.focus();
  }, [open, mode, account, confirmation]);

  useEffect(() => {
    if (confirmation) confirmationHeading.current?.focus();
  }, [confirmation]);

  useEffect(() => {
    if (!confirmation && !pending && restoreSecurityFocus.current) {
      restoreSecurityFocus.current = false;
      securityInvoker.current?.focus();
    }
  }, [confirmation, pending]);

  useEffect(() => {
    setRecoveryCode('');
    setConfirmation(undefined);
  }, [account?.id]);

  const openAccount = useCallback((source: HTMLElement | null) => {
    invoker.current = source;
    restoreSecurityFocus.current = false;
    setMode('signin');
    setUsername('');
    setShowPassword(false);
    setConfirmation(undefined);
    setError('');
    setStatus('');
    setRecoveryCode('');
    setOpen(true);
    if (controlsStateRef.current === 'unavailable') void controlsRefreshRef.current();
  }, []);

  function close() {
    setOpen(false);
    setRecoveryCode('');
    setMigration(null);
  }

  function switchMode(next: Mode) {
    setMode(next);
    setShowPassword(false);
    setError('');
    setStatus('');
  }

  async function runAction(action: Action, operation: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(action);
    setError('');
    setStatus('');
    try {
      await operation();
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : 'Afterframe could not complete that action. Try again.');
    } finally {
      inFlight.current = false;
      setPending(undefined);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (controls.libraryBusy) return;
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    void runAction(mode, async () => {
      if (mode === 'reset') {
        await post('/api/account/reset', fields);
        switchMode('signin');
        setStatus('Password reset. Sign in with your new password.');
        return;
      }
      const session = await post<SessionResponse>(`/api/account/${mode}`, fields);
      controls.updateAccount(session.account, session.library);
      notify({ message: `Signed in as ${session.account.username}.`, tone: 'success' });
      const summary = guestSummary();
      if (summary.total > 0) {
        setMigration(summary);
        setClearGuestAfterMerge(true);
      } else {
        close();
      }
    });
  }

  function mergeGuestLibrary() {
    void runAction('migrate', async () => {
      const result = await controls.importLibrary(guestLibrary(), { clearGuest: clearGuestAfterMerge });
      const itemWord = result.totalImported === 1 ? 'item' : 'items';
      const message = result.totalImported > 0
        ? `Merged ${result.totalImported} browser ${itemWord} into your account.`
        : 'Your account already has the latest version of those items.';
      notify({ message, tone: 'success' });
      close();
    });
  }

  function signOut() {
    if (controls.libraryBusy) return;
    const previousId = account?.id;
    void runAction('signout', async () => {
      await post('/api/account/signout', {});
      try {
        if (previousId != null) localStorage.removeItem(`afterframe.pendingPlayback.${previousId}`);
        localStorage.removeItem('afterframe.recentSearches');
        localStorage.removeItem('afterframe.animeShowAudio');
      } catch { /* ignore */ }
      controls.updateAccount(null, null);
      notify('Signed out.');
      close();
    });
  }

  function dismissConfirmation() {
    restoreSecurityFocus.current = true;
    setSecurityPassword('');
    setConfirmation(undefined);
  }

  function performSecurityAction(action: SecurityAction) {
    if (action === 'recovery-code' && securityPassword.length < 8) {
      setError('Enter your current password to generate a recovery code.');
      return;
    }
    void runAction(action, async () => {
      const payload = action === 'recovery-code' ? { password: securityPassword } : {};
      const result = await post<{ code?: string }>(`/api/account/${action}`, payload);
      if (action === 'recovery-code' && result.code) setRecoveryCode(result.code);
      setStatus(action === 'recovery-code' ? 'Recovery code generated.' : 'Other devices are signed out.');
      dismissConfirmation();
    });
  }

  const verifying = controls.state === 'loading';
  const pendingMessage = getPendingMessage(pending);
  const availableGuest = account && !migration ? guestSummary() : null;
  const isBusy = Boolean(pending);

  let dialogBody: ReactNode;
  if (verifying) {
    dialogBody = <output className="af-meta">Checking your session…</output>;
  } else if (account && migration) {
    dialogBody = (
      <AccountMigrationView
        migration={migration}
        clearGuestAfterMerge={clearGuestAfterMerge}
        onClearGuestChange={setClearGuestAfterMerge}
        pending={isBusy}
        onMerge={mergeGuestLibrary}
        onClose={close}
      />
    );
  } else if (account) {
    dialogBody = (
      <AccountSignedInView
        account={account}
        controls={controls}
        pending={isBusy}
        availableGuest={availableGuest}
        confirmation={confirmation}
        securityPassword={securityPassword}
        recoveryCode={recoveryCode}
        confirmationHeading={confirmationHeading}
        onSignOut={signOut}
        onStartMigration={guest => { setMigration(guest); setClearGuestAfterMerge(true); }}
        onRequestConfirmation={(action, source) => {
          securityInvoker.current = source;
          setStatus('');
          setError('');
          setConfirmation(action);
        }}
        onSecurityPasswordChange={setSecurityPassword}
        onConfirmAction={performSecurityAction}
        onDismissConfirmation={dismissConfirmation}
      />
    );
  } else {
    dialogBody = (
      <AccountAuthForm
        mode={mode}
        username={username}
        showPassword={showPassword}
        error={error}
        pending={isBusy}
        libraryBusy={controls.libraryBusy}
        usernameInput={usernameInput}
        onUsernameChange={setUsername}
        onTogglePassword={() => setShowPassword(value => !value)}
        onSwitchMode={switchMode}
        onSubmit={submit}
      />
    );
  }

  return <openAccountContext.Provider value={openAccount}>
    {children}
    <Dialog.Root open={open} onOpenChange={next => { if (!next && !inFlight.current) close(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="af-scrim" />
        <Dialog.Popup className="af-modal af-account-modal"
          initialFocus={() => usernameInput.current ?? closeButton.current}
          finalFocus={() => invoker.current?.isConnected ? invoker.current : document.getElementById('main')}>
          <header className="af-account-heading">
            <Dialog.Title>{account || verifying ? 'Account' : modes[mode].title}</Dialog.Title>
            <Dialog.Close ref={closeButton} className="af-icon-button" aria-label="Close account dialog"
              aria-disabled={isBusy}><Icon name="close" /></Dialog.Close>
          </header>
          <div className="af-account-content">
            {dialogBody}
            {error && <p id="af-account-error" className="af-account-feedback" role="alert" tabIndex={-1} ref={feedback}><span className="sr-only">Error: </span>{error}</p>}
            {(pendingMessage || status) && <output className="af-account-feedback af-meta">{pendingMessage || status}</output>}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  </openAccountContext.Provider>;
}
