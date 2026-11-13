import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
/** What the person chose; 'system' follows the OS and stores nothing. */
export type ThemePreference = Theme | 'system';

/** Runs in <head> before first paint so dark mode never flashes. Mirrors gen-lib's pre-paint script. */
export const PRE_PAINT_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');var d=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-theme',t||(d?'dark':'light'));}catch(e){}})();`;

// The single source of truth is the data-theme attribute on <html>. Every useTheme() caller
// (topbar toggle, EPUB reader, PDF viewer…) subscribes to it, so they can never disagree.
const read = (): Theme => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
function readPreference(): ThemePreference {
  try {
    const t = localStorage.getItem('theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}
const subscribe = (notify: () => void) => {
  const mo = new MutationObserver(notify);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('storage', notify);
  return () => { mo.disconnect(); window.removeEventListener('storage', notify); };
};

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, read, () => 'light' as Theme);

  // Follow the OS only while the user hasn't picked explicitly.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('theme')) document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = read() === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* private mode */
    }
    document.documentElement.setAttribute('data-theme', next);
  }, []);

  const preference: ThemePreference = useSyncExternalStore(subscribe, readPreference, () => 'system' as ThemePreference);
  const setPreference = useCallback((p: ThemePreference) => {
    try {
      if (p === 'system') localStorage.removeItem('theme'); else localStorage.setItem('theme', p);
    } catch {
      /* private mode */
    }
    document.documentElement.setAttribute('data-theme', p === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : p);
  }, []);

  return { theme, toggle, preference, setPreference };
}
