import { useEffect, useRef, useState } from 'react';
import type { Book as EpubBook, Rendition } from 'epubjs';
import type { TocItem } from '@rajgruha/shared';
import { useTheme } from '../../lib/theme';

type Props = {
  url: string;
  initialLocation: string | null;
  /** Chapter to open instead of the saved location (from the Chapters tab). */
  initialHref?: string;
  toc: TocItem[];
  onProgress: (percent: number, location: string) => void;
  onActivity?: () => void;
};

const FS_KEY = 'rajgruha:epub-font-size';
const token = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export function EpubReader({ url, initialLocation, initialHref, toc, onProgress, onActivity }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const rendition = useRef<Rendition | null>(null);
  const [percent, setPercent] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [navToc, setNavToc] = useState<TocItem[]>(toc);
  const [fontSize, setFontSize] = useState(() => { try { return Number(localStorage.getItem(FS_KEY)) || 100; } catch { return 100; } });
  const { theme } = useTheme();
  const cb = useRef({ onProgress, onActivity });
  cb.current = { onProgress, onActivity };

  useEffect(() => {
    let cancelled = false;
    let book: EpubBook | undefined;

    (async () => {
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.arrayBuffer();
        const { default: ePub } = await import('epubjs');
        if (cancelled || !host.current) return;

        book = ePub(data);
        const r = book.renderTo(host.current, { width: '100%', height: '100%', flow: 'paginated', spread: 'auto' });
        rendition.current = r;

        r.on('relocated', (loc: { start: { cfi: string; percentage: number } }) => {
          const pct = Math.round((book!.locations.length() ? book!.locations.percentageFromCfi(loc.start.cfi) : loc.start.percentage) * 1000) / 10;
          setPercent(pct);
          cb.current.onProgress(pct, loc.start.cfi);
          cb.current.onActivity?.();
        });

        await r.display(initialHref ?? initialLocation ?? undefined);
        if (cancelled) return;
        setState('ready');

        // Older uploads have no stored chapters — fall back to the book's own navigation.
        void book.loaded.navigation.then((nav) => {
          if (cancelled) return;
          const flat: TocItem[] = [];
          const walk = (items: typeof nav.toc, level: number) => items.forEach((i) => { flat.push({ label: i.label.trim(), href: i.href, level }); if (i.subitems?.length) walk(i.subitems, level + 1); });
          walk(nav.toc, 0);
          setNavToc((cur) => (cur.length ? cur : flat));
        });
        // Page-accurate percentages need a locations index; build it in the background, then
        // re-report where we are (a chapter link opens before the index exists, i.e. at 0%).
        void book.ready.then(() => book!.locations.generate(1600)).then(() => {
          if (cancelled) return;
          const cfi = (r.currentLocation() as unknown as { start?: { cfi: string } } | null)?.start?.cfi;
          if (!cfi) return;
          const pct = Math.round(book!.locations.percentageFromCfi(cfi) * 1000) / 10;
          setPercent(pct);
          cb.current.onProgress(pct, cfi);
        });
      } catch {
        if (!cancelled) setState('error');
      }
    })();

    return () => {
      cancelled = true;
      rendition.current = null;
      book?.destroy();
    };
  }, [url]);

  // The book lives in an iframe, so CSS variables don't reach it: resolve our tokens to real
  // colours and hand them to epub.js. Re-applied whenever the theme or font size changes.
  useEffect(() => {
    if (state !== 'ready' || !rendition.current) return;
    const bg = token('--bg-surface', theme === 'dark' ? '#1a2029' : '#ffffff');
    const fg = token('--text', theme === 'dark' ? '#e6e9ee' : '#1f2933');
    const link = token('--primary', '#1abb9c');
    const name = `rg-${theme}`;
    const r = rendition.current;
    r.themes.register(name, {
      'html, body': { background: `${bg} !important`, color: `${fg} !important` },
      'p, li, span, div, h1, h2, h3, h4, h5, h6, blockquote': { color: `${fg} !important` },
      a: { color: `${link} !important` },
      '::selection': { background: `${link}55` }
    });
    r.themes.select(name);
    r.themes.fontSize(`${fontSize}%`);
  }, [theme, state, fontSize]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, select, textarea')) return;
      if (e.key === 'ArrowRight') void rendition.current?.next();
      if (e.key === 'ArrowLeft') void rendition.current?.prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const bump = (delta: number) => setFontSize((f) => {
    const next = Math.min(180, Math.max(70, f + delta));
    try { localStorage.setItem(FS_KEY, String(next)); } catch { /* ignore */ }
    return next;
  });

  return (
    <>
      <div ref={host} className="reader-epub" />
      {state === 'loading' && <div className="reader-loading"><span className="reader-spinner" /> Opening book…</div>}
      {state === 'error' && <div className="reader-loading">This EPUB could not be opened.</div>}
      <div className="reader-bar">
        <button className="btn btn-outline btn-sm" onClick={() => void rendition.current?.prev()} aria-label="Previous page">←</button>
        <div className="mid">
          {navToc.length > 0 && (
            <select className="form-control" aria-label="Jump to chapter" value="" onChange={(e) => e.target.value && void rendition.current?.display(e.target.value)}>
              <option value="">Chapters…</option>
              {navToc.map((t, i) => <option key={`${t.href}-${i}`} value={t.href}>{'\u00A0\u00A0'.repeat(t.level)}{t.label}</option>)}
            </select>
          )}
          <span>{percent.toFixed(0)}%</span>
          <button className="btn btn-ghost btn-sm" onClick={() => bump(-10)} aria-label="Smaller text">A−</button>
          <button className="btn btn-ghost btn-sm" onClick={() => bump(10)} aria-label="Larger text">A+</button>
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => void rendition.current?.next()} aria-label="Next page">→</button>
      </div>
    </>
  );
}
