import { Dialog } from '@base-ui/react/dialog';
import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
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

export function AccountButton({ className, children, label }: { className: string; children: ReactNode; label?: string }) {
  const openAccount = useAccountDialog();
  return <button type="button" className={className} aria-label={label} aria-haspopup="dialog"
    onClick={event => openAccount(event.currentTarget)}>{children}</button>;
}

export function AccountProvider({ controls, children }: { controls: LibraryControls; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('signin');
  const [username, setUsername] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [confirmation, setConfirmation] = useState<SecurityAction>();
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

  function openAccount(source: HTMLElement | null) {
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
    if (controls.state === 'unavailable') void controls.refresh();
  }

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
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Afterframe could not complete that action. Try again.');
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
      notify({
        message: result.totalImported > 0
          ? `Merged ${result.totalImported} browser ${result.totalImported === 1 ? 'item' : 'items'} into your account.`
          : 'Your account already has the latest version of those items.',
        tone: 'success',
      });
      close();
    });
  }

  function signOut() {
    if (controls.libraryBusy) return;
    void runAction('signout', async () => {
      await post('/api/account/signout', {});
      controls.updateAccount(null, null);
      notify('Signed out.');
      close();
    });
  }

  function dismissConfirmation() {
    restoreSecurityFocus.current = true;
    setConfirmation(undefined);
  }

  function performSecurityAction(action: SecurityAction) {
    void runAction(action, async () => {
      const result = await post<{ code?: string }>(`/api/account/${action}`, {});
      if (action === 'recovery-code' && result.code) setRecoveryCode(result.code);
      setStatus(action === 'recovery-code' ? 'Recovery code generated.' : 'Other devices are signed out.');
      dismissConfirmation();
    });
  }

  const verifying = controls.state === 'loading';
  const pendingMessage = pending === 'signout' ? 'Signing out…'
    : pending === 'migrate' ? 'Merging browser library…'
    : pending === 'recovery-code' || pending === 'revoke-other' ? securityActions[pending].pending
    : pending ? modes[pending].pending : '';
  const summaryParts = migration ? [
    migration.saved ? `${migration.saved} saved` : '',
    migration.watched ? `${migration.watched} watched` : '',
    migration.ratings ? `${migration.ratings} rated` : '',
    migration.progress ? `${migration.progress} playback positions` : '',
    migration.reading ? `${migration.reading} reading positions` : '',
    migration.history ? `${migration.history} history entries` : '',
  ].filter(Boolean) : [];
  const availableGuest = account && !migration ? guestSummary() : null;

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
              aria-disabled={Boolean(pending)}><Icon name="close" /></Dialog.Close>
          </header>
          <div className="af-account-content">
            {verifying ? <p role="status" className="af-meta">Checking your session…</p> : account && migration ? <div className="af-account-migrate">
              <h3>Merge browser guest library?</h3>
              <p className="af-meta">
                Found {summaryParts.join(', ')} saved on this browser. Existing items in your account are kept unless the browser copy is newer.
              </p>
              <label className="af-account-check">
                <input type="checkbox" checked={clearGuestAfterMerge} disabled={Boolean(pending)} onChange={event => setClearGuestAfterMerge(event.target.checked)} />
                <span>Clear this browser&apos;s guest copy after merging</span>
              </label>
              <div className="af-actions">
                <button type="button" className="af-button af-primary" disabled={Boolean(pending)} onClick={mergeGuestLibrary}>Merge into account</button>
                <button type="button" className="af-button af-secondary" disabled={Boolean(pending)} onClick={close}>Skip for now</button>
              </div>
            </div> : account ? <>
              <div className="af-account-profile">
                <span className="af-account-avatar" aria-hidden="true">{account.username.slice(0, 1).toUpperCase()}</span>
                <div><h3>{account.username}</h3><Dialog.Description className="af-meta">Manage your account and active sessions.</Dialog.Description></div>
              </div>
              <div className="af-actions">
                <button type="button" className="af-button af-secondary" disabled={Boolean(pending) || controls.libraryBusy}
                  onClick={signOut}>Sign out</button>
                {availableGuest && availableGuest.total > 0 && <button type="button" className="af-button af-secondary" disabled={Boolean(pending)}
                  onClick={() => { setMigration(availableGuest); setClearGuestAfterMerge(true); }}>
                  Merge {availableGuest.total} guest {availableGuest.total === 1 ? 'item' : 'items'}
                </button>}
                {controls.libraryBusy && <p role="status" className="af-meta">Saving your library changes…</p>}
              </div>
              <section className="af-account-security" aria-labelledby="af-account-security">
                <h3 id="af-account-security">Account security</h3>
                <div className="af-actions">
                  {(Object.keys(securityActions) as SecurityAction[]).map(action => <button className="af-button af-secondary"
                    type="button" key={action} disabled={Boolean(pending)} aria-expanded={confirmation === action}
                    onClick={event => {
                      securityInvoker.current = event.currentTarget;
                      setStatus('');
                      setError('');
                      setConfirmation(action);
                    }}>{securityActions[action].label}</button>)}
                </div>
                {confirmation && <div className="af-account-confirm">
                  <h4 ref={confirmationHeading} tabIndex={-1}>{securityActions[confirmation].label}?</h4>
                  <p className="af-meta">{securityActions[confirmation].description}</p>
                  <div className="af-actions">
                    <button type="button" className="af-button af-primary" disabled={Boolean(pending)}
                      onClick={() => performSecurityAction(confirmation)}>{securityActions[confirmation].label}</button>
                    <button type="button" className="af-button af-secondary" disabled={Boolean(pending)} onClick={dismissConfirmation}>Cancel</button>
                  </div>
                </div>}
                {recoveryCode && <div className="af-account-recovery">
                  <p>Save this one-time code somewhere safe.</p>
                  <output aria-label="Recovery code">{recoveryCode}</output>
                </div>}
              </section>
            </> : <form className="af-account-form" key={mode} onSubmit={submit}>
              <label htmlFor="af-account-username">Username</label>
              <input ref={usernameInput} id="af-account-username" className="af-input" name="username" type="text"
                autoComplete="username" autoCapitalize="none" spellCheck={false} pattern={usernamePattern}
                minLength={3} maxLength={30} required readOnly={Boolean(pending)} value={username}
                aria-describedby={mode === 'create' ? 'af-account-username-hint' : undefined}
                onChange={event => setUsername(event.target.value)} />
              {mode === 'create' && <p id="af-account-username-hint" className="af-meta">Use 3–30 letters, numbers, underscores or hyphens.</p>}
              {mode === 'reset' && <>
                <label htmlFor="af-account-recovery-code">Recovery code</label>
                <input id="af-account-recovery-code" className="af-input" name="code" type="password"
                  autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} minLength={48} maxLength={48}
                  pattern="[A-Fa-f0-9]{48}" required readOnly={Boolean(pending)} />
              </>}
              <label htmlFor="af-account-password">{mode === 'reset' ? 'New password' : 'Password'}</label>
              <div className="af-account-password">
                <input className="af-input" id="af-account-password" name="password" type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={8} maxLength={128}
                  aria-describedby={mode === 'signin' ? undefined : 'af-account-password-hint'}
                  required readOnly={Boolean(pending)} />
                <button className="af-button af-secondary" type="button" aria-pressed={showPassword}
                  onClick={() => setShowPassword(value => !value)}>Show password</button>
              </div>
              {mode !== 'signin' && <p id="af-account-password-hint" className="af-meta">Use at least 8 characters.</p>}
              {controls.libraryBusy && <p role="status" className="af-meta">Saving your library changes…</p>}
              <button className="af-button af-primary" type="submit" disabled={Boolean(pending) || controls.libraryBusy}>{modes[mode].submit}</button>
              <div className="af-actions">
                {mode === 'signin' ? <>
                  <button type="button" className="af-text-link" disabled={Boolean(pending)} onClick={() => switchMode('create')}>Create an account</button>
                  <button type="button" className="af-text-link" disabled={Boolean(pending)} onClick={() => switchMode('reset')}>Use a recovery code</button>
                </> : <button type="button" className="af-text-link" disabled={Boolean(pending)}
                  onClick={() => switchMode('signin')}>Back to sign in</button>}
              </div>
            </form>}
            {error && <p className="af-account-feedback" role="alert" tabIndex={-1} ref={feedback}>{error}</p>}
            {(pendingMessage || status) && <p className="af-account-feedback af-meta" role="status">{pendingMessage || status}</p>}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  </openAccountContext.Provider>;
}
