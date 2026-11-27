import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './components';
import './Toast.css';

export type ToastTone = 'default' | 'success' | 'error';

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ToastOptions {
  id?: string;
  message: string;
  tone?: ToastTone;
  action?: ToastAction;
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: string;
  tone: ToastTone;
  duration: number;
}

interface ToastContextValue {
  notify: (options: ToastOptions | string) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  notify: () => '',
  dismiss: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

let counter = 0;

export function ToastProvider({
  children,
  libraryFeedback,
}: Readonly<{
  children: ReactNode;
  libraryFeedback?: { message: string; onUndo?: () => void };
}>) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [politeAnnouncement, setPoliteAnnouncement] = useState('');
  const [alertAnnouncement, setAlertAnnouncement] = useState('');
  const timers = useRef(new Map<string, number>());
  const paused = useRef(false);

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts(current => current.filter(item => item.id !== id));
  }, []);

  const scheduleDismiss = useCallback((id: string, duration: number) => {
    if (duration <= 0) return;
    const existing = timers.current.get(id);
    if (existing) clearTimeout(existing);
    const timer = window.setTimeout(() => {
      timers.current.delete(id);
      if (!paused.current) {
        setToasts(current => current.filter(item => item.id !== id));
      }
    }, duration);
    timers.current.set(id, timer);
  }, []);

  const notify = useCallback((input: ToastOptions | string) => {
    const options: ToastOptions = typeof input === 'string' ? { message: input } : input;
    const id = options.id || `toast-${++counter}`;
    const duration = options.duration ?? (options.action ? 20_000 : 4200);
    const item: ToastItem = {
      id,
      message: options.message,
      tone: options.tone ?? 'default',
      action: options.action,
      duration,
    };
    setToasts(current => {
      const filtered = current.filter(existing => existing.id !== id);
      return [...filtered.slice(-2), item];
    });
    if (item.tone === 'error') setAlertAnnouncement(item.message);
    else setPoliteAnnouncement(item.action ? `${item.message} (${item.action.label} available in Notifications)` : item.message);
    scheduleDismiss(id, duration);
    return id;
  }, [scheduleDismiss]);

  // Bridge library mutation feedback into the unified toast system
  const lastFeedbackRef = useRef('');
  useEffect(() => {
    const msg = libraryFeedback?.message || '';
    if (!msg) {
      if (lastFeedbackRef.current) {
        lastFeedbackRef.current = '';
        dismiss('library-mutation');
      }
      return;
    }
    const signature = `${msg}:${Boolean(libraryFeedback?.onUndo)}`;
    if (signature === lastFeedbackRef.current) return;
    lastFeedbackRef.current = signature;
    notify({
      id: 'library-mutation',
      message: msg,
      tone: 'success',
      action: libraryFeedback?.onUndo ? { label: 'Undo', onAction: libraryFeedback.onUndo } : undefined,
      duration: libraryFeedback?.onUndo ? 20_000 : 4000,
    });
  }, [libraryFeedback?.message, libraryFeedback?.onUndo, notify, dismiss]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
      map.clear();
    };
  }, []);

  const handlePause = () => { paused.current = true; };
  const handleResume = () => {
    paused.current = false;
    setToasts(current => {
      for (const item of current) {
        if (!timers.current.has(item.id) && item.duration > 0) {
          scheduleDismiss(item.id, 2200);
        }
      }
      return current;
    });
  };

  const contextValue = useMemo(() => ({ notify, dismiss }), [notify, dismiss]);

  return <ToastContext.Provider value={contextValue}>
    {children}
    <output className="sr-only" aria-live="polite" aria-atomic="true">{politeAnnouncement}</output>
    <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">{alertAnnouncement}</div>
    <section
      className="af-toast-region"
      aria-label="Notifications"
      hidden={toasts.length === 0}
      onMouseEnter={handlePause}
      onMouseLeave={handleResume}
      onFocusCapture={handlePause}
      onBlurCapture={handleResume}
    >
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`af-toast af-toast-${toast.tone}`}
        >
          <span className="af-toast-message">{toast.message}</span>
          <div className="af-toast-actions">
            {toast.action && (
              <button
                type="button"
                className="af-toast-action"
                onClick={() => {
                  toast.action?.onAction();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              className="af-toast-close"
              aria-label="Dismiss notification"
              onClick={() => dismiss(toast.id)}
            >
              <Icon name="close" />
            </button>
          </div>
        </div>
      ))}
    </section>
  </ToastContext.Provider>;
}
