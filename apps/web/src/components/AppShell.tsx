import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { User } from '@rajgruha/shared';
import { api } from '../lib/api';
import { useTheme } from '../lib/theme';
import { NAV, isParent, type NavItem, type NavLeaf } from '../lib/nav';
import { openMenu, showModal, showToast } from '../ui/index.js';
import { Icon } from './icons';

const RAIL_KEY = 'rajgruha:sidebar-rail';
export const LOCK_KEY = 'rajgruha:locked';
const isDesktop = () => window.matchMedia('(min-width: 769px)').matches;

const NATIVE_PAGE: [string, string][] = [
  ['/read/', 'reader'], ['/books/', 'book'], ['/catalog', 'catalog'], ['/inventory', 'inventory'],
  ['/log', 'orders'], ['/analytics', 'reading-analytics'], ['/upload', 'form-upload'], ['/files', 'files'], ['/settings', 'settings'], ['/acquisitions', 'kanban'], ['/members', 'members'], ['/profile', 'profile'], ['/help', 'help']
];

/** data-page keys drive body-scoped rules in the design system (reader, kanban, …). */
function pageKey(pathname: string): string {
  return NATIVE_PAGE.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? 'dashboard';
}

type Crumb = { text: string; to?: string };
const NATIVE_CRUMBS: [string, Crumb[]][] = [
  ['/read/', [{ text: 'Catalog', to: '/catalog' }, { text: 'Reader' }]],
  ['/books/', [{ text: 'Catalog', to: '/catalog' }, { text: 'Book' }]],
  ['/catalog', [{ text: 'Catalog' }]],
  ['/inventory', [{ text: 'Books' }]],
  ['/log', [{ text: 'Reading log' }]],
  ['/analytics', [{ text: 'Reading analytics' }]],
  ['/upload', [{ text: 'Add books' }]],
  ['/files', [{ text: 'Book files' }]],
  ['/edit/', [{ text: 'Catalog', to: '/catalog' }, { text: 'Edit book' }]],
  ['/acquisitions', [{ text: 'Acquisitions' }]],
  ['/members', [{ text: 'Members' }]],
  ['/profile', [{ text: 'Your profile' }]],
  ['/help', [{ text: 'Help' }]],
  ['/settings', [{ text: 'Settings' }]]
];

function crumbs(pathname: string): Crumb[] {
  const home: Crumb = { text: 'Home', to: '/' };
  const match = NATIVE_CRUMBS.find(([prefix]) => pathname.startsWith(prefix));
  return match ? [home, ...match[1]] : [{ text: 'Home' }];
}

export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [drawer, setDrawer] = useState(false);
  const [rail, setRail] = useState(false);
  useGlobalShortcuts();

  useEffect(() => { document.body.dataset.page = pageKey(pathname); }, [pathname]);
  useEffect(() => { document.body.classList.toggle('sidebar-open', drawer); }, [drawer]);
  useEffect(() => { document.body.classList.toggle('sidebar-rail', rail); }, [rail]);
  useEffect(() => () => {
    delete document.body.dataset.page;
    document.body.classList.remove('sidebar-open', 'sidebar-rail');
  }, []);

  useEffect(() => {
    const stored = () => { try { return localStorage.getItem(RAIL_KEY) === '1'; } catch { return false; } };
    if (isDesktop()) setRail(stored());
    const mq = window.matchMedia('(min-width: 769px)');
    const onChange = (e: MediaQueryListEvent) => { setDrawer(false); setRail(e.matches ? stored() : false); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const toggleSidebar = () => {
    if (isDesktop()) {
      const next = !rail;
      setRail(next);
      try { localStorage.setItem(RAIL_KEY, next ? '1' : '0'); } catch { /* ignore */ }
    } else setDrawer((d) => !d);
  };

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Sidebar user={user} open={drawer} pathname={pathname} />
      <div className="sidebar-backdrop" hidden={!drawer} onClick={() => setDrawer(false)} />
      <Topbar user={user} pathname={pathname} drawerOpen={drawer} rail={rail} onToggle={toggleSidebar} />
      <main id="main-content" tabIndex={-1} className="main">
        {children}
        <footer className="footer">
          <span>Rajgruha — your digital library</span>
          <span>Design system: Gentelella (MIT)</span>
        </footer>
      </main>
    </>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────
const Chevron = () => (
  <svg className="nav-chev" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
);
const BadgeEl = ({ b }: { b?: NavLeaf['badge'] }) => (b ? <span className={`badge ${b.cls}`}>{b.text}</span> : null);
const isActive = (to: string, pathname: string) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`));

function NavEntry({ item, pathname, isAdmin }: { item: NavItem; pathname: string; isAdmin: boolean }) {
  const childActive = isParent(item) && item.children.some((c) => isActive(c.to, pathname));
  const [open, setOpen] = useState(childActive);
  useEffect(() => { if (childActive) setOpen(true); }, [childActive]);

  if (isParent(item)) {
    return (
      <div className={['nav-tree', open ? 'open' : '', childActive ? 'has-active' : ''].join(' ').trim()}>
        <button type="button" className="nav-link nav-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Icon name={item.icon} />
          <span className="nav-text">{item.text}</span>
          <BadgeEl b={item.badge} />
          <Chevron />
        </button>
        <div className="nav-sub"><div className="nav-sub-inner">
          {item.children.map((c) => (
            <Link key={c.to} to={c.to as '/'} className={isActive(c.to, pathname) ? 'nav-sublink active' : 'nav-sublink'} aria-current={isActive(c.to, pathname) ? 'page' : undefined}>
              {c.text}<BadgeEl b={c.badge} />
            </Link>
          ))}
        </div></div>
      </div>
    );
  }
  if (item.admin && !isAdmin) return null;
  const active = isActive(item.to, pathname);
  return (
    <Link to={item.to as '/'} className={active ? 'nav-link active' : 'nav-link'} aria-current={active ? 'page' : undefined} data-rail-label={item.text}>
      {item.icon && <Icon name={item.icon} />}
      <span className="nav-text">{item.text}</span>
      <BadgeEl b={item.badge} />
    </Link>
  );
}

function Sidebar({ user, open, pathname }: { user: User; open: boolean; pathname: string }) {
  const isAdmin = user.role === 'admin';
  return (
    <aside id="sidebar" className={open ? 'sidebar open' : 'sidebar'} aria-label="Primary navigation">
      <div className="sidebar-brand">
        <div className="brand-icon">R</div>
        <div className="brand-name">Rajgruha</div>
      </div>
      <nav className="sidebar-nav">
        {NAV.map((group) => {
          const visible = group.items.filter((i) => isParent(i) || !i.admin || isAdmin);
          if (!visible.length) return null;
          return (
            <div className="nav-group" key={group.label}>
              <div className="nav-label">{group.label}</div>
              {visible.map((item) => <NavEntry key={item.text} item={item} pathname={pathname} isAdmin={isAdmin} />)}
            </div>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="avatar">{user.name.charAt(0).toUpperCase()}<span className="online" /></div>
          <div className="sidebar-user-info">
            <div className="name">{user.name}</div>
            <div className="role">{isAdmin ? 'Administrator' : 'Member'}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ── Shortcuts ─────────────────────────────────────────────────────
const GO: Record<string, string> = { o: '/', c: '/catalog', l: '/log', a: '/analytics', b: '/inventory', u: '/upload', f: '/files' };

const row = (k: string, label: string) =>
  `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border-color-light);font-size:13px"><span style="color:var(--text-secondary)">${label}</span><kbd class="kbd">${k}</kbd></div>`;
const heading = (t: string) => `<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin:12px 0 6px">${t}</div>`;

export function openShortcuts() {
  showModal({
    title: 'Keyboard shortcuts',
    size: 'md',
    body: `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:0 24px"><div>
      ${heading('Global')}${row('/', 'Focus search')}${row('?', 'This help')}${row('T', 'Toggle light / dark')}${row('Esc', 'Close dialog or menu')}
      </div><div>
      ${heading('Go to')}${row('G  O', 'Overview')}${row('G  C', 'Catalog')}${row('G  L', 'Reading log')}${row('G  A', 'Analytics')}${row('G  B', 'Books table')}${row('G  U', 'Add books')}${row('G  F', 'Book files')}
      </div></div>`,
    actions: [{ label: 'Close', variant: 'primary' }]
  });
}

function useGlobalShortcuts() {
  const navigate = useNavigate();
  const pending = useRef<number>(0);
  const { toggle } = useTheme();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('.modal-backdrop')) return;
      if (pending.current && Date.now() - pending.current < 1200) {
        pending.current = 0;
        const to = GO[e.key.toLowerCase()];
        if (to) { e.preventDefault(); void navigate({ to: to as '/' }); }
        return;
      }
      if (e.key === '/') { e.preventDefault(); document.querySelector<HTMLInputElement>('.topbar .search-box input')?.focus(); }
      else if (e.key === '?') { e.preventDefault(); openShortcuts(); }
      else if (e.key.toLowerCase() === 't') toggle();
      else if (e.key.toLowerCase() === 'g') pending.current = Date.now();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navigate, toggle]);
}

// ── Topbar ────────────────────────────────────────────────────────
function Topbar({ user, pathname, drawerOpen, rail, onToggle }: { user: User; pathname: string; drawerOpen: boolean; rail: boolean; onToggle: () => void }) {
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const router = useRouter();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const trail = crumbs(pathname);

  const go = (to: string) => () => router.history.push(to);
  const signOut = async () => {
    await api.logout().catch(() => undefined);
    qc.clear();
    showToast('Signed out', { variant: 'success' });
    await navigate({ to: '/login' });
  };
  const lock = () => {
    try { sessionStorage.setItem(LOCK_KEY, pathname); } catch { /* ignore */ }
    void navigate({ to: '/lock' });
  };

  const openUserMenu = (btn: HTMLElement) =>
    openMenu(btn, [
      { label: 'Profile', action: go('/profile') },
      { label: 'Account settings', action: go('/settings') },
      { label: 'Keyboard shortcuts', action: openShortcuts },
      '-',
      { label: 'Help', action: go('/help') },
      { label: 'Lock screen', action: lock },
      {
        label: 'Sign out',
        action: () => showModal({
          title: 'Sign out?',
          size: 'sm',
          body: '<p style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin:0">You’ll need to sign in again to open your library.</p>',
          actions: [{ label: 'Cancel', variant: 'ghost' }, { label: 'Sign out', variant: 'primary', action: () => void signOut() }]
        })
      }
    ]);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="sidebar-toggle" type="button" aria-label={rail ? 'Expand sidebar' : 'Open menu'} aria-controls="sidebar" aria-expanded={drawerOpen} onClick={onToggle}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <nav className="breadcrumb" aria-label="Breadcrumb">
          {trail.map((c, i) => {
            const last = i === trail.length - 1;
            return (
              <span key={`${c.text}-${i}`} style={{ display: 'contents' }}>
                {i > 0 && <span className="sep" aria-hidden="true">›</span>}
                {!last && c.to ? <Link to={c.to as '/'}>{c.text}</Link> : <span className={last ? 'current' : undefined} aria-current={last ? 'page' : undefined}>{c.text}</span>}
              </span>
            );
          })}
        </nav>
      </div>

      <form className="search-box" role="search" onSubmit={(e) => { e.preventDefault(); void navigate({ to: '/catalog', search: { q: q.trim() || undefined } }); setQ(''); }}>
        <svg className="s-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
        <input type="search" placeholder="Search books, authors, ISBN…  ( / )" aria-label="Search the catalog" value={q} onChange={(e) => setQ(e.target.value)} />
      </form>

      <div className="topbar-right">
        <button className="tb-btn theme-toggle" type="button" title="Toggle theme (T)" aria-label="Toggle theme" aria-pressed={theme === 'dark'} onClick={toggle}>
          <svg className="theme-icon-light" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
          <svg className="theme-icon-dark" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
        </button>
        <button className="tb-avatar" type="button" aria-label="Account menu" aria-haspopup="menu" onClick={(e) => openUserMenu(e.currentTarget)}>
          {user.name.charAt(0).toUpperCase()}
        </button>
      </div>
    </header>
  );
}
