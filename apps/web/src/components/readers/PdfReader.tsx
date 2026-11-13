import { useRef } from 'react';
import { PDFViewer } from '@embedpdf/react-pdf-viewer';
// Self-host the PDFium WASM instead of fetching it from a public CDN.
import pdfiumWasm from '@embedpdf/pdfium/pdfium.wasm?url';
import { useTheme } from '../../lib/theme';

/** The slice of EmbedPDF's scroll plugin we use (its full types live in a package we don't depend on directly). */
type ScrollCap = {
  scrollToPage(o: { pageNumber: number; behavior?: ScrollBehavior }): void;
  getCurrentPage(): number;
  onLayoutReady(cb: (e: { isInitial: boolean; pageNumber: number; totalPages: number }) => void): () => void;
  onPageChange(cb: (e: { pageNumber: number; totalPages: number }) => void): () => void;
};

type Props = {
  url: string;
  /** 1-based page to open at (from a chapter link or the saved position). */
  initialPage?: number;
  onPage?: (page: number, total: number) => void;
};

export function PdfReader({ url, initialPage = 1, onPage }: Props) {
  const { theme } = useTheme();
  const abs = (u: string) => new URL(u, window.location.origin).href;
  const lastPage = useRef(initialPage); // survives the remount that a theme change causes
  const onPageRef = useRef(onPage);
  onPageRef.current = onPage;

  // `key` remounts the viewer when the app theme flips so it always matches light/dark.
  return (
    <div id="pdf-viewer" style={{ background: 'var(--bg-surface)' }}>
      <PDFViewer
        key={theme}
        config={{ src: abs(url), wasmUrl: abs(pdfiumWasm), theme: { preference: theme } }}
        onReady={(registry) => {
          const cap = (registry.getPlugin('scroll') as unknown as { provides(): ScrollCap } | null)?.provides();
          if (!cap) return;
          const go = () => { if (lastPage.current > 1) cap.scrollToPage({ pageNumber: lastPage.current, behavior: 'instant' }); };
          cap.onLayoutReady((e) => { if (e.isInitial) go(); });
          cap.onPageChange((e) => { lastPage.current = e.pageNumber; onPageRef.current?.(e.pageNumber, e.totalPages); });
          setTimeout(go, 400); // in case the layout was ready before we subscribed
        }}
      />
    </div>
  );
}
