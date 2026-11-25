import { Dialog } from '@base-ui/react/dialog';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Icon } from './components';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(async () => true);

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);
  const invoker = useRef<HTMLElement | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  const settle = useCallback((confirmed: boolean) => {
    const finish = resolver.current;
    resolver.current = null;
    setRequest(null);
    finish?.(confirmed);
  }, []);

  const confirm: ConfirmFn = useCallback(options => {
    if (resolver.current) resolver.current(false);
    invoker.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRequest(options);
    return new Promise<boolean>(resolve => {
      resolver.current = resolve;
    });
  }, []);

  return <ConfirmContext.Provider value={confirm}>
    {children}
    <Dialog.Root open={Boolean(request)} onOpenChange={open => { if (!open) settle(false); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="af-scrim" />
        <Dialog.Popup className="af-modal af-confirm-modal" initialFocus={confirmButton}
          finalFocus={() => invoker.current?.isConnected ? invoker.current : document.getElementById('main')}>
          <header className="af-section-head">
            <Dialog.Title>{request?.title ?? 'Confirm'}</Dialog.Title>
            <Dialog.Close className="af-icon-button" aria-label="Cancel"><Icon name="close" /></Dialog.Close>
          </header>
          <Dialog.Description className="af-meta af-confirm-message">{request?.message}</Dialog.Description>
          <div className="af-actions af-confirm-actions">
            <button ref={confirmButton} type="button" className="af-button af-primary" onClick={() => settle(true)}>
              {request?.confirmLabel ?? 'Confirm'}
            </button>
            <button type="button" className="af-button af-secondary" onClick={() => settle(false)}>
              {request?.cancelLabel ?? 'Cancel'}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  </ConfirmContext.Provider>;
}
