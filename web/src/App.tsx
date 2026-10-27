/**
 * Application shell: session gate, theme, navigation and routing.
 *
 * Pages are dynamic imports, so the dashboard never downloads the PDF engine and
 * a phone on a slow connection only fetches the page it is actually opening.
 */
import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, type AuthStatus } from './api';
import { Link, isActive, navigate, useRoute, useScrollReset } from './router';
import { Spinner, useToast } from './components/ui';
import {
  BookIcon,
  HighlighterIcon,
  HomeIcon,
  LibraryMark,
  NotebookIcon,
  QuoteIcon,
  SettingsIcon,
} from './components/Icons';
import type { SessionUser, UserSettings } from '../../shared/types';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Library = lazy(() => import('./pages/Library'));
const BookDetail = lazy(() => import('./pages/BookDetail'));
const Reader = lazy(() => import('./pages/Reader'));
const Notes = lazy(() => import('./pages/Notes'));
const Notebook = lazy(() => import('./pages/Notebook'));
const Quotes = lazy(() => import('./pages/Quotes'));
const Settings = lazy(() => import('./pages/Settings'));
const Login = lazy(() => import('./pages/Login'));

const NAV = [
  { href: '/', label: 'Home', Icon: HomeIcon },
  { href: '/library', label: 'Library', Icon: BookIcon },
  { href: '/notes', label: 'Notes', Icon: HighlighterIcon },
  { href: '/notebook', label: 'Notebook', Icon: NotebookIcon },
  { href: '/quotes', label: 'Quotes', Icon: QuoteIcon },
];

/* ------------------------------------------------------------------ theming */

export type ThemePreference = UserSettings['theme'];

export function applyTheme(preference: ThemePreference): void {
  const dark =
    preference === 'dark' ||
    (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try {
    localStorage.setItem('rajgruha-theme', preference);
  } catch {
    // Private browsing can refuse storage; the theme still applies for this visit.
  }
}

function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    try {
      const stored = localStorage.getItem('rajgruha-theme');
      return stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'system';
    } catch {
      return 'system';
    }
  });

  useEffect(() => {
    applyTheme(preference);
    if (preference !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);

  return { preference, setPreference };
}

/* ------------------------------------------------------------ error boundary */

interface BoundaryState {
  error: Error | null;
}

class PageBoundary extends Component<{ children: ReactNode; onReset?: () => void }, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error('Page failed to render', error);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="page">
          <div className="card">
            <h2>This page hit a problem</h2>
            <p className="muted small">
              {this.state.error.message || 'An unexpected error occurred while rendering.'}
            </p>
            <div className="row">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  this.setState({ error: null });
                  this.props.onReset?.();
                }}
              >
                Try again
              </button>
              <button type="button" className="btn" onClick={() => navigate('/')}>
                Go home
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ---------------------------------------------------------------- app shell */

interface ShellContext {
  user: SessionUser;
  theme: ThemePreference;
  setTheme: (value: ThemePreference) => void;
  appName: string;
  signOut: () => Promise<void>;
  onUserChanged: (user: SessionUser) => void;
}

export function Shell({ user, theme, setTheme, appName, signOut, onUserChanged, children }: ShellContext & { children: ReactNode }) {
  const route = useRoute();
  useScrollReset(route.path);

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="topbar__brand">
          <LibraryMark className="topbar__mark" />
          {appName}
        </Link>
        <span className="topbar__spacer" />
        <Link
          to="/settings"
          className="btn btn--ghost btn--icon"
          aria-label="Settings"
          aria-current={isActive(route.path, '/settings') ? 'page' : undefined}
        >
          <SettingsIcon />
        </Link>
      </header>

      <div className="layout">
        <nav className="sidebar" aria-label="Main">
          {NAV.map(({ href, label, Icon }) => (
            <Link
              key={href}
              to={href}
              className="navlink"
              aria-current={isActive(route.path, href, href === '/') ? 'page' : undefined}
            >
              <Icon />
              {label}
            </Link>
          ))}
          <Link
            to="/settings"
            className="navlink"
            aria-current={isActive(route.path, '/settings') ? 'page' : undefined}
          >
            <SettingsIcon />
            Settings
          </Link>
        </nav>

        <main className="main">
          <PageBoundary onReset={() => navigate('/')}>
            <Suspense fallback={<ShellFallback />}>{children}</Suspense>
          </PageBoundary>
        </main>
      </div>

      <nav className="bottomnav" aria-label="Main">
        {NAV.map(({ href, label, Icon }) => (
          <Link
            key={href}
            to={href}
            className="bottomnav__link"
            aria-current={isActive(route.path, href, href === '/') ? 'page' : undefined}
          >
            <Icon size={20} />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function ShellFallback() {
  return (
    <div className="page">
      <div className="skeleton" style={{ height: 84 }} />
      <div className="skeleton" style={{ height: 180 }} />
    </div>
  );
}

/* ---------------------------------------------------------------------- app */

export function App() {
  const toast = useToast();
  const route = useRoute();
  const { preference, setPreference } = useTheme();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .status()
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch(() => {
        if (!cancelled) setFatal('Could not reach the server. Is the Worker running?');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The server is the source of truth for the theme once signed in.
  useEffect(() => {
    if (!status?.user) return;
    api
      .settings()
      .then(({ settings }) => setPreference(settings.theme))
      .catch(() => {
        /* Keep the locally stored theme if settings cannot be read yet. */
      });
  }, [status?.user, setPreference]);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Even if the request fails, drop local state so the user is not stuck.
    }
    setStatus((current) => (current ? { ...current, user: null } : current));
    navigate('/');
  }, []);

  const onUserChanged = useCallback((user: SessionUser) => {
    setStatus((current) => (current ? { ...current, user } : current));
  }, []);

  const shellContext: ShellContext | null = useMemo(
    () =>
      status?.user
        ? {
            user: status.user,
            theme: preference,
            setTheme: setPreference,
            appName: status.appName,
            signOut,
            onUserChanged,
          }
        : null,
    [status, preference, setPreference, signOut, onUserChanged],
  );

  if (fatal) {
    return (
      <div className="auth">
        <div className="auth__panel">
          <LibraryMark className="auth__mark" />
          <h1>Rajgruha</h1>
          <p className="muted small">{fatal}</p>
          <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="auth">
        <Spinner label="Opening Rajgruha…" />
      </div>
    );
  }

  if (!shellContext) {
    return (
      <Suspense fallback={<div className="auth"><Spinner /></div>}>
        <Login
          appName={status.appName}
          registrationOpen={status.registrationOpen}
          initialized={status.initialized}
          onSignedIn={async (user) => {
            const next = await api.status();
            setStatus({ ...next, user });
            toast.push(`Welcome, ${user.name}`, 'success');
          }}
        />
      </Suspense>
    );
  }

  // The reader owns the whole viewport, so it renders outside the shell chrome.
  if (route.path.startsWith('/read/')) {
    return (
      <Suspense fallback={<div className="auth"><Spinner label="Loading the reader…" /></div>}>
        <Reader bookId={route.segments[1] ?? ''} />
      </Suspense>
    );
  }

  return (
    <Shell {...shellContext}>
      <Pages route={route} />
    </Shell>
  );
}

/** Route table. Kept in one place so the nav and the pages stay in step. */
function Pages({ route }: { route: ReturnType<typeof useRoute> }) {
  const segments = route.segments;

  if (segments.length === 0) return <Dashboard />;
  if (segments[0] === 'library' && segments.length === 1) return <Library query={route.query} />;
  if (segments[0] === 'library' && segments[1]) return <BookDetail bookId={segments[1]} />;
  if (segments[0] === 'notes') return <Notes query={route.query} />;
  if (segments[0] === 'notebook') return <Notebook query={route.query} />;
  if (segments[0] === 'quotes') return <Quotes query={route.query} />;
  if (segments[0] === 'settings') return <Settings />;

  return (
    <div className="page">
      <div className="card">
        <h2>Page not found</h2>
        <p className="muted small">There is nothing at {route.path}.</p>
        <Link to="/" className="btn btn--primary">
          Back home
        </Link>
      </div>
    </div>
  );
}

export { ApiError };
