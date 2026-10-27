/**
 * The reader.
 *
 * This is the only page that pulls in the EmbedPDF engine, and it does so
 * lazily so the rest of the app stays small. Responsibilities:
 *
 *  1. Load the PDF through a signed, book-scoped URL so the engine's own range
 *     requests work.
 *  2. Import saved annotations on open, and autosave changes back as JSON.
 *  3. Capture the selected text when a highlight is created, because a PDF
 *     highlight annotation stores only the comment - not the text it covers.
 *     That captured text is what makes "add to quotes" carry real words.
 *  4. Track reading position so the dashboard can offer "continue reading".
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../api';
import { navigate } from '../router';
import { Banner, Spinner, useAsync, useToast } from '../components/ui';
import { PromoteToQuote } from '../components/PromoteToQuote';
import { BackIcon, CheckIcon, HighlighterIcon, MoreIcon, QuoteIcon, SparkIcon } from '../components/Icons';
import {
  importWhenReady,
  isMarkupType,
  plugin,
  rememberSubtypeNames,
  subscribe,
  taskToPromise,
  toLiveAnnotation,
  type AnnotationApiLike,
  type AnnotationEventLike,
  type AnnotationTransferItemLike,
  type LiveAnnotation,
  type PluginRegistryLike,
  type ScrollApiLike,
  type SelectionApiLike,
} from '../lib/embedpdf';
import { excerpt, formatProgress, normaliseHex } from '../lib/format';
import type { AnnotationIndexItem } from '../../../shared/types';

/**
 * The viewer is loaded on demand and its subtype enum is captured at the same
 * moment, so kind names always match the installed version.
 */
const LazyViewer = lazy(async () => {
  const module = await import('@embedpdf/react-pdf-viewer');
  rememberSubtypeNames(module.PdfAnnotationSubtype);
  return { default: (module.PDFViewer ?? module.default) as React.ComponentType<Record<string, unknown>> };
});

export default function Reader({ bookId }: { bookId: string }) {
  const toast = useToast();
  const detail = useAsync(() => api.book(bookId), [bookId]);
  const settingsState = useAsync(() => api.settings(), []);

  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [live, setLive] = useState<LiveAnnotation[]>([]);
  const [promoting, setPromoting] = useState<AnnotationIndexItem | null>(null);
  const [jumpValue, setJumpValue] = useState('');
  const [activeTool, setActiveTool] = useState<string | null>(null);

  const annotationApi = useRef<AnnotationApiLike | null>(null);
  const scrollApi = useRef<ScrollApiLike | null>(null);
  const selectionApi = useRef<SelectionApiLike | null>(null);
  const revisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const selectionText = useRef('');
  const progressTimer = useRef<number | undefined>(undefined);
  const restoreDone = useRef(false);
  const totalPagesRef = useRef(0);
  /** Saved reading position, read inside the stable onReady callback. */
  const savedPageRef = useRef<number | null>(null);

  const settings = settingsState.data?.settings;
  const book = detail.data?.book;

  useEffect(() => {
    savedPageRef.current = detail.data?.progress?.page ?? null;
  }, [detail.data?.progress?.page]);

  useEffect(() => {
    totalPagesRef.current = totalPages;
  }, [totalPages]);

  /* ------------------------------------------------------------ autosave core */

  const flushAnnotations = useCallback(
    async (options: { silent?: boolean } = {}) => {
      const apiRef = annotationApi.current;
      if (!apiRef || !dirtyRef.current) return;
      setSaveState('saving');
      try {
        const items = await taskToPromise<AnnotationTransferItemLike[]>(apiRef.exportAnnotations());
        const result = await api.saveAnnotations(bookId, revisionRef.current, items);
        revisionRef.current = result.revision;
        dirtyRef.current = false;
        setSaveState('saved');
        setSavedAt(new Date().toISOString());
        if (!options.silent) toast.push('Annotations saved', 'success');
      } catch (error) {
        setSaveState('error');
        toast.push(errorMessage(error), 'error');
      }
    },
    [bookId, toast],
  );

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    setSaveState('dirty');
  }, []);

  /* --------------------------------------------------------------- viewer wiring */

  const refreshLive = useCallback(() => {
    const apiRef = annotationApi.current;
    if (!apiRef) return;
    try {
      const rows = apiRef
        .getAnnotations()
        .map((tracked) => toLiveAnnotation(tracked.object))
        .filter((row): row is LiveAnnotation => row !== null)
        .sort((a, b) => a.page - b.page);
      setLive(rows);
    } catch (error) {
      console.warn('[rajgruha] could not read the annotation list', error);
    }
  }, []);

  const handleAnnotationEvent = useCallback(
    (event: AnnotationEventLike) => {
      const apiRef = annotationApi.current;
      const type = event.annotation?.type;

      // A highlight stores only a comment, so stamp the selected text onto the
      // annotation as it is created. It round-trips through the PDF as custom
      // data, and it is what the quote workflow reads later.
      if (apiRef && event.type === 'create' && isMarkupType(type) && selectionText.current) {
        const existing = event.annotation.custom ?? {};
        if (!existing.rajgruha?.text) {
          try {
            apiRef.updateAnnotation(event.pageIndex, event.annotation.id ?? '', {
              custom: { ...existing, rajgruha: { text: selectionText.current } },
            });
          } catch (error) {
            console.warn('[rajgruha] could not attach the selected text to the highlight', error);
          }
        }
      }

      scheduleSave();
      refreshLive();
    },
    [refreshLive, scheduleSave],
  );

  // Deliberately stable: the viewer is handed this prop, and a new identity would
  // make it tear down and re-initialise mid-read.
  const onReady = useCallback(
    async (registry: PluginRegistryLike) => {
      annotationApi.current = plugin<AnnotationApiLike>(registry, 'annotation');
      scrollApi.current = plugin<ScrollApiLike>(registry, 'scroll');
      selectionApi.current = plugin<SelectionApiLike>(registry, 'selection');
      setReady(true);

      const scroll = scrollApi.current;
      if (scroll) {
        subscribe(scroll.onPageChange, (event: { pageNumber: number; totalPages: number }) => {
          const reported = Math.max(1, event.pageNumber || 1);
          setPage(reported - 1);
          if (event.totalPages) setTotalPages(event.totalPages);

          // Restore the saved position once, as soon as the layout is known.
          const restoreTo = savedPageRef.current;
          if (!restoreDone.current && restoreTo !== null && event.totalPages > 0) {
            restoreDone.current = true;
            const target = Math.max(1, Math.min(event.totalPages, restoreTo + 1));
            if (target > 1) {
              try {
                scroll.scrollToPage({ pageNumber: target, behavior: 'instant' as ScrollBehavior });
              } catch (error) {
                console.warn('[rajgruha] could not restore the reading position', error);
              }
            }
          }

          // Progress is written at most every few seconds while scrolling.
          window.clearTimeout(progressTimer.current);
          progressTimer.current = window.setTimeout(() => {
            const pages = event.totalPages || totalPagesRef.current;
            if (pages > 0) {
              void api.saveProgress(bookId, reported - 1, pages).catch(() => {
                /* Progress is best-effort; never interrupt reading to report it. */
              });
            }
          }, 2500);
        });
      }

      const selection = selectionApi.current;
      if (selection) {
        // Cache the live selection so it is available at annotation-create time.
        subscribe(selection.onSelectionChange, () => {
          void taskToPromise<string[]>(selection.getSelectedText())
            .then((lines) => {
              const text = lines.join(' ').replace(/\s+/g, ' ').trim();
              if (text) selectionText.current = text;
            })
            .catch(() => {
              /* An empty selection is normal. */
            });
        });
      }

      const annotation = annotationApi.current;
      if (annotation) {
        subscribe(annotation.onAnnotationEvent, handleAnnotationEvent);

        try {
          const saved = await api.bookAnnotations(bookId);
          revisionRef.current = saved.revision;
          if (saved.annotations.length > 0) {
            await importWhenReady(annotation, saved.annotations as AnnotationTransferItemLike[]);
            refreshLive();
          }
        } catch (error) {
          toast.push(`Could not load saved annotations: ${errorMessage(error)}`, 'error');
        }
      }

      // Page count is only knowable here, so report it once for the library.
      const total = scroll?.getTotalPages?.() ?? 0;
      if (total > 0) {
        setTotalPages(total);
        void api.updateBook(bookId, { pageCount: total }).catch(() => {});
      }
    },
    [bookId, handleAnnotationEvent, refreshLive, toast],
  );

  /* ------------------------------------------------------------- save lifecycle */

  const autosaveSeconds = settings?.reader.autosaveSeconds ?? 20;

  useEffect(() => {
    if (!ready) return;
    const timer = window.setInterval(() => {
      if (dirtyRef.current) void flushAnnotations({ silent: true });
    }, autosaveSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [autosaveSeconds, flushAnnotations, ready]);

  // Flush pending annotations when leaving the reader.
  useEffect(() => {
    const onHide = () => {
      if (dirtyRef.current) void flushAnnotations({ silent: true });
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.clearTimeout(progressTimer.current);
      onHide();
    };
  }, [flushAnnotations]);

  const viewerConfig = useMemo(() => {
    if (!detail.data) return null;
    return {
      src: detail.data.fileUrl,
      // Vendored locally at build time so the engine never reaches a CDN.
      wasmUrl: '/embedpdf/pdfium.wasm',
      // No external font requests: system fonts cover Latin and Devanagari.
      fontFallback: null,
      fonts: { ui: null, signature: null },
      tabBar: 'never',
      theme: {
        preference: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
        light: { accent: { primary: '#a2622a' } },
        dark: { accent: { primary: '#d9a441' } },
      },
      annotations: {
        annotationAuthor: settings?.reader.annotationAuthor || 'Rajgruha',
        colorPresets: settings ? [settings.reader.highlightColor, '#ffd400', '#95e1a3', '#ffb3c1', '#a5d8ff'] : undefined,
        selectAfterCreate: true,
      },
      scroll: { defaultStrategy: settings?.reader.scrollStrategy ?? 'vertical' },
      // The stamp plugin's default library lives on jsDelivr. Disabling it is what
      // keeps the reader free of third-party requests, which is also a requirement
      // of the cross-origin isolation policy the engine needs.
      stamp: { defaultLibrary: false },
      disabledCategories: ['redaction'],
    };
  }, [detail.data, settings]);

  /* ------------------------------------------------------------------ actions */

  function setTool(tool: string | null) {
    const apiRef = annotationApi.current;
    if (!apiRef) {
      toast.push('The viewer is still loading', 'info');
      return;
    }
    try {
      apiRef.setActiveTool(tool);
      setActiveTool(tool);
    } catch (error) {
      toast.error(error);
    }
    setMenuOpen(false);
  }

  function jumpToPage(pageNumber: number) {
    const scroll = scrollApi.current;
    if (!scroll || totalPages === 0) return;
    const clamped = Math.max(1, Math.min(totalPages, pageNumber));
    try {
      scroll.scrollToPage({ pageNumber: clamped, behavior: 'smooth' });
    } catch (error) {
      toast.error(error);
    }
    setMenuOpen(false);
  }

  /** Promote a live annotation: flush first, so the server index knows about it. */
  async function promote(row: LiveAnnotation) {
    setPanelOpen(false);
    await flushAnnotations({ silent: true });
    const item: AnnotationIndexItem = {
      id: row.id,
      bookId,
      bookTitle: book?.title ?? 'This book',
      kind: row.kind,
      type: row.type,
      page: row.page,
      color: row.color,
      text: row.text,
      note: row.note,
      author: row.author,
      createdAt: null,
      updatedAt: new Date().toISOString(),
      quoteId: null,
    };
    setPromoting(item);
  }

  async function addNoteHere() {
    // Hand the user a sticky note tool positioned on the current page.
    setTool('text');
    toast.push('Tap where the note should go', 'info');
  }

  /* --------------------------------------------------------------------- render */

  // The viewer is only mounted once every config value is final, so nothing can
  // change underneath it and force a reload mid-read.
  if ((detail.initial && detail.loading) || (settingsState.loading && !settingsState.data)) {
    return (
      <div className="reader">
        <div className="reader__loading">
          <Spinner label="Loading the book…" />
        </div>
      </div>
    );
  }

  if (detail.error || !detail.data || !viewerConfig) {
    return (
      <div className="reader">
        <div className="reader__bar">
          <button type="button" className="btn btn--ghost btn--icon" onClick={() => navigate('/library')} aria-label="Back">
            <BackIcon />
          </button>
          <span className="reader__title">
            <strong>Could not open this book</strong>
          </span>
        </div>
        <div className="reader__loading">
          <Banner kind="error">{detail.error?.message ?? 'The book is unavailable.'}</Banner>
          <button type="button" className="btn" onClick={() => navigate('/library')}>
            Back to the library
          </button>
        </div>
      </div>
    );
  }

  const progress = detail.data.progress;

  return (
    <div className="reader">
      <div className="reader__bar">
        <button type="button" className="btn btn--ghost btn--icon" onClick={() => navigate(`/library/${bookId}`)} aria-label="Back to the book">
          <BackIcon />
        </button>

        <span className="reader__title">
          <strong className="truncate">{book?.title}</strong>
          <span className="reader__status">
            <SaveIndicator state={saveState} savedAt={savedAt} />
            {totalPages > 0 && <span>· {formatProgress(page, totalPages)}</span>}
            {activeTool && <span className="badge">{activeTool === 'text' ? 'note' : activeTool}</span>}
          </span>
        </span>

        <button
          type="button"
          className="btn btn--ghost btn--icon"
          onClick={() => setPanelOpen((value) => !value)}
          aria-label="Highlights in this book"
          aria-expanded={panelOpen}
        >
          <HighlighterIcon />
          {live.length > 0 && <span className="tiny">{live.length}</span>}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          onClick={() => setMenuOpen((value) => !value)}
          aria-label="Reader menu"
          aria-expanded={menuOpen}
        >
          <MoreIcon />
        </button>
      </div>

      <div className="reader__canvas">
        {!ready && (
          <div className="reader__loading">
            <Spinner label="Starting the PDF engine…" />
            <p className="tiny faint" style={{ maxWidth: 320, textAlign: 'center' }}>
              The first open downloads the 4.6 MB engine. It is cached by the browser after that.
            </p>
          </div>
        )}
        <Suspense
          fallback={
            <div className="reader__loading">
              <Spinner label="Loading the viewer…" />
            </div>
          }
        >
          <LazyViewer config={viewerConfig} onReady={onReady} style={{ width: '100%', height: '100%' }} />
        </Suspense>
      </div>

      {menuOpen && (
        <div className="reader__menu">
          <button type="button" onClick={() => setTool('highlight')}>
            <HighlighterIcon size={16} />
            Highlight text
          </button>
          <button type="button" onClick={() => setTool('underline')}>
            <HighlighterIcon size={16} />
            Underline text
          </button>
          <button type="button" onClick={addNoteHere}>
            <SparkIcon size={16} />
            Add a note
          </button>
          <button type="button" onClick={() => setTool(null)}>
            <CheckIcon size={16} />
            Back to selecting
          </button>
          <hr />
          <form
            className="row"
            style={{ padding: '4px 6px' }}
            onSubmit={(event) => {
              event.preventDefault();
              const value = Number(jumpValue);
              if (Number.isFinite(value) && value > 0) jumpToPage(value);
              setJumpValue('');
            }}
          >
            <input
              className="input"
              type="number"
              min={1}
              max={totalPages || undefined}
              placeholder={totalPages ? `Page 1-${totalPages}` : 'Page'}
              value={jumpValue}
              onChange={(event) => setJumpValue(event.target.value)}
              style={{ minHeight: 34 }}
            />
            <button type="submit" className="btn btn--sm">
              Go
            </button>
          </form>
          <button type="button" onClick={() => jumpToPage(1)}>
            First page
          </button>
          <button type="button" onClick={() => jumpToPage(Math.max(1, (progress?.page ?? 0) + 1))}>
            Last position
          </button>
          <hr />
          <button
            type="button"
            onClick={async () => {
              setMenuOpen(false);
              try {
                await api.updateBook(bookId, { finished: !book?.finishedAt });
                toast.push(book?.finishedAt ? 'Marked as still reading' : 'Marked as finished', 'success');
                detail.reload();
              } catch (error) {
                toast.error(error);
              }
            }}
          >
            <CheckIcon size={16} />
            {book?.finishedAt ? 'Mark as still reading' : 'Mark as finished'}
          </button>
          <button
            type="button"
            onClick={async () => {
              setMenuOpen(false);
              await flushAnnotations();
            }}
          >
            <CheckIcon size={16} />
            Save annotations now
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              navigate(`/library/${bookId}`);
            }}
          >
            <QuoteIcon size={16} />
            Book details
          </button>
        </div>
      )}

      {panelOpen && (
        <aside className="reader__menu" style={{ left: 8, right: 8, top: 'auto', bottom: 10, maxHeight: '52dvh' }} aria-label="Highlights in this book">
          <div className="row row--between" style={{ padding: '2px 6px 8px' }}>
            <strong className="small">
              {live.length === 0 ? 'No highlights yet' : `${live.length} annotation${live.length === 1 ? '' : 's'}`}
            </strong>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPanelOpen(false)}>
              Close
            </button>
          </div>
          {live.length === 0 ? (
            <p className="small muted" style={{ padding: '0 8px 8px' }}>
              Select text and use “Highlight text” from the menu, or add a note. Annotations save
              automatically and appear on the Notes page.
            </p>
          ) : (
            live.map((row) => (
              <div key={row.id} style={{ padding: '8px 6px', borderTop: '1px solid var(--border)' }}>
                <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                  <span
                    className="highlight-swatch"
                    style={{ background: normaliseHex(row.color), marginTop: 5, width: 4, height: 30, borderRadius: 2 }}
                  />
                  <span className="grow stack stack--tight">
                    <span className="small" style={{ fontFamily: 'var(--font-serif)' }}>
                      {excerpt(row.text ?? row.note ?? `(${row.kind} annotation)`, 140)}
                    </span>
                    <span className="tiny faint">
                      page {row.page + 1} · {row.kind}
                    </span>
                  </span>
                </div>
                <div className="row" style={{ gap: 6, marginTop: 6, paddingLeft: 12 }}>
                  <button type="button" className="btn btn--sm" onClick={() => promote(row)}>
                    <SparkIcon size={13} />
                    Add to quotes
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => jumpToPage(row.page + 1)}>
                    Go to page
                  </button>
                </div>
              </div>
            ))
          )}
        </aside>
      )}

      {promoting && (
        <PromoteToQuote
          item={promoting}
          onClose={() => setPromoting(null)}
          onPromoted={() => {
            refreshLive();
            detail.reload();
          }}
        />
      )}
    </div>
  );
}

function SaveIndicator({ state, savedAt }: { state: 'idle' | 'dirty' | 'saving' | 'saved' | 'error'; savedAt: string | null }) {
  if (state === 'saving') {
    return (
      <>
        <Spinner />
        Saving…
      </>
    );
  }
  if (state === 'dirty') return <>Unsaved</>;
  if (state === 'error') return <>Save failed</>;
  if (state === 'saved' && savedAt) {
    return (
      <>
        <CheckIcon size={13} />
        Saved {new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </>
    );
  }
  return <>Ready</>;
}
