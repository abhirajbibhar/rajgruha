/**
 * A hash router in ~60 lines.
 *
 * Hash routing means any static host serves the app with no rewrite rules, no
 * server-side routing config to keep working, and no history-API edge cases. For
 * a personal app that has to keep working for years with no maintenance, that is
 * the right trade.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export interface Route {
  /** Path only, e.g. "/read/abc123". */
  path: string;
  /** Path split into non-empty segments. */
  segments: string[];
  /** Parsed query string from after "?" in the hash. */
  query: URLSearchParams;
}

function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const questionMark = raw.indexOf('?');
  const path = (questionMark === -1 ? raw : raw.slice(0, questionMark)) || '/';
  const query = new URLSearchParams(questionMark === -1 ? '' : raw.slice(questionMark + 1));
  return {
    path,
    segments: path.split('/').filter(Boolean),
    query,
  };
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const target = `#${to.startsWith('/') ? to : `/${to}`}`;
  if (window.location.hash === target) return;
  if (options.replace) {
    window.history.replaceState(null, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = target;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

/**
 * Scrolls to the top when the path changes, but not when only the query does -
 * that keeps filters and pagination from jumping the page around.
 */
export function useScrollReset(path: string): void {
  const previous = useRef(path);
  useEffect(() => {
    if (previous.current !== path) {
      previous.current = path;
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
  }, [path]);
}

export function isActive(pathname: string, href: string, exact = false): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface LinkProps {
  to: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onNavigate?: () => void;
  title?: string;
  'aria-label'?: string;
  'aria-current'?: 'page' | undefined;
}

/** An anchor that keeps real link semantics: middle click and copy-link work. */
export function Link({ to, children, className, onNavigate, ...rest }: LinkProps) {
  const href = `#${to.startsWith('/') ? to : `/${to}`}`;
  const handle = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      // Let the browser handle modified clicks so "open in new tab" still works.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      onNavigate?.();
      navigate(to);
    },
    [onNavigate, to],
  );

  return (
    <a href={href} className={className} onClick={handle} {...rest}>
      {children}
    </a>
  );
}

/** Sends the browser back when there is history to go back to, otherwise home. */
export function goBack(fallback = '/'): void {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback);
}

/** Debounces a fast-changing value, for search boxes. */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Stable callback that always sees the latest render's value. */
export function useEvent<Args extends unknown[], R>(fn: (...args: Args) => R) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  return useMemo(() => (...args: Args) => ref.current(...args), []);
}
