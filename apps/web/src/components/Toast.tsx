// Toast notifications for mutation success/failure. Errors show the request id so operators
// can quote it to support. Rendered in a polite live region (assertive for errors).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface ToastInput {
  tone: ToastTone;
  /** Already-translated message. */
  message: string;
  /** Optional secondary text (e.g. the server's safe message). */
  detail?: string;
  requestId?: string | null;
  /** ms; default 5000 (errors 10000). 0 = sticky until dismissed. */
  durationMs?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastContextValue {
  show: (t: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
    const tm = timers.current.get(id);
    if (tm) clearTimeout(tm);
    timers.current.delete(id);
  }, []);

  const show = useCallback(
    (t: ToastInput) => {
      const id = nextId.current++;
      setItems((xs) => [...xs.slice(-4), { ...t, id }]);
      const duration = t.durationMs ?? (t.tone === 'error' ? 10_000 : 5_000);
      if (duration > 0) timers.current.set(id, setTimeout(() => dismiss(id), duration));
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((tm) => clearTimeout(tm));
  }, []);

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  const { t } = useI18n();
  return (
    <div className="toast-viewport">
      <div aria-live="polite" role="status" className="toast-stack">
        {items
          .filter((x) => x.tone !== 'error')
          .map((x) => (
            <ToastView key={x.id} item={x} onDismiss={onDismiss} closeLabel={t('Dismiss')} requestIdLabel={t('Request ID')} />
          ))}
      </div>
      <div aria-live="assertive" role="alert" className="toast-stack">
        {items
          .filter((x) => x.tone === 'error')
          .map((x) => (
            <ToastView key={x.id} item={x} onDismiss={onDismiss} closeLabel={t('Dismiss')} requestIdLabel={t('Request ID')} />
          ))}
      </div>
    </div>
  );
}

function ToastView({
  item,
  onDismiss,
  closeLabel,
  requestIdLabel,
}: {
  item: ToastItem;
  onDismiss: (id: number) => void;
  closeLabel: string;
  requestIdLabel: string;
}) {
  return (
    <div className={`toast toast-${item.tone}`}>
      <div className="toast-body">
        <strong>{item.message}</strong>
        {item.detail && item.detail !== item.message ? <div className="toast-detail">{item.detail}</div> : null}
        {item.requestId ? (
          <div className="toast-detail mono">
            {requestIdLabel}: {item.requestId}
          </div>
        ) : null}
      </div>
      <button type="button" className="icon-btn" aria-label={closeLabel} onClick={() => onDismiss(item.id)}>
        ×
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

/** Same as useToast but returns null outside a provider (used by hooks in tests). */
export function useToastOptional(): ToastContextValue | null {
  return useContext(ToastContext);
}
