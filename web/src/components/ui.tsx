/**
 * Shared UI primitives.
 *
 * Everything here is deliberately small and local. The only stateful pieces are
 * the toast queue and the async loading helper, which are the two things every
 * page would otherwise reimplement slightly differently.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { errorMessage } from '../api';
import { EmptyBoxIcon } from './Icons';

/* -------------------------------------------------------------------- toasts */

type ToastKind = 'info' | 'error' | 'success';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  push: (message: string, kind?: ToastKind) => void;
  error: (error: unknown) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export { errorMessage };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = nextId.current++;
    setToasts((current) => [...current.slice(-2), { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, kind === 'error' ? 6000 : 3200);
  }, []);

  const error = useCallback((thrown: unknown) => push(errorMessage(thrown), 'error'), [push]);

  const value = useMemo(() => ({ push, error }), [push, error]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toasts.length > 0 && (
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={toast.kind === 'error' ? 'toast toast--error' : 'toast'}>
              {toast.message}
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside a ToastProvider');
  return value;
}

/* --------------------------------------------------------------------- async */

export interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  /** True only for the very first load, so refreshes do not blank the screen. */
  initial: boolean;
  /** Takes no arguments so it can also be passed straight to an onClick. */
  reload: () => void;
  setData: (updater: (current: T | null) => T | null) => void;
}

/**
 * Runs an async loader and re-runs it when `deps` change.
 *
 * Stale responses are discarded by comparing a request counter, so switching
 * filters quickly can never leave the older result on screen.
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[],
  options: { enabled?: boolean } = {},
): AsyncState<T> {
  const enabled = options.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [initial, setInitial] = useState(enabled);
  const [tick, setTick] = useState(0);
  const requestId = useRef(0);
  const loaderRef = useRef(loader);

  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    if (!enabled) return;
    const id = ++requestId.current;
    setLoading(true);
    loaderRef
      .current()
      .then((result) => {
        if (id !== requestId.current) return;
        setData(result);
        setError(null);
      })
      .catch((thrown: unknown) => {
        if (id !== requestId.current) return;
        setError(thrown instanceof Error ? thrown : new Error(String(thrown)));
      })
      .finally(() => {
        if (id !== requestId.current) return;
        setLoading(false);
        setInitial(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tick, ...deps]);

  const reload = useCallback(() => setTick((value) => value + 1), []);

  return { data, error, loading, initial, reload, setData };
}

/* ------------------------------------------------------------------- pieces */

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" style={{ gap: 8 }}>
      <span className="spinner" aria-hidden="true" />
      {label && <span className="small muted">{label}</span>}
    </span>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <EmptyBoxIcon className="empty__icon" />
      <div>
        <h3>{title}</h3>
        {message && <p className="small muted" style={{ margin: 0 }}>{message}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({ value, label, hint }: { value: ReactNode; label: string; hint?: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
      {hint && <span className="tiny faint">{hint}</span>}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field__label">
        {label}
        {hint && <span className="faint" style={{ fontWeight: 400 }}> · {hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function Banner({ kind, children }: { kind: 'error' | 'success' | 'info'; children: ReactNode }) {
  return <div className={`banner banner--${kind}`}>{children}</div>;
}

export function Card({
  title,
  action,
  children,
  accent,
  padless,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  accent?: boolean;
  padless?: boolean;
}) {
  return (
    <section className={`card${accent ? ' card--accent' : ''}${padless ? ' card--padless' : ''}`}>
      {(title || action) && (
        <div className="card__head" style={padless ? { padding: '14px 14px 0', marginBottom: 10 } : undefined}>
          {title && <h2 className="card__title">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Bottom sheet on phones, centred dialog on desktop. */
export function Modal({
  title,
  onClose,
  children,
  submitLabel,
  onSubmit,
  danger,
  busy,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  submitLabel?: string;
  onSubmit?: () => void;
  danger?: boolean;
  busy?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal__panel">
        <div className="row row--between">
          <h2>{title}</h2>
          <button type="button" className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
        {(submitLabel || onSubmit) && (
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            {submitLabel && (
              <button
                type="button"
                className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
                onClick={onSubmit}
                disabled={busy}
              >
                {busy ? <Spinner /> : null}
                {submitLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** A form-shaped modal that keeps submission and busy state in one place. */
export function FormModal({
  title,
  onClose,
  onSubmit,
  submitLabel,
  children,
  danger,
}: {
  title: string;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  submitLabel: string;
  children: ReactNode;
  danger?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} busy={busy}>
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await onSubmit();
          } finally {
            setBusy(false);
          }
        }}
      >
        {children}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} disabled={busy}>
            {busy ? <Spinner /> : null}
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  title?: string;
}) {
  if (!onClick) {
    return (
      <span className="chip chip--static" title={title}>
        {children}
      </span>
    );
  }
  return (
    <button type="button" className={`chip${active ? ' chip--on' : ''}`} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

/** Skeletons sized like the real content, so the layout does not jump. */
export function SkeletonList({ rows = 3, height = 66 }: { rows?: number; height?: number }) {
  return (
    <div className="stack" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton" style={{ height }} />
      ))}
    </div>
  );
}
