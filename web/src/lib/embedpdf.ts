/**
 * The EmbedPDF adapter.
 *
 * The viewer is duck-typed through local interfaces rather than imported types.
 * Two reasons: the package's declaration files reach into `preact` and a path
 * alias that only resolve inside its own build, and typing against the concrete
 * classes would couple this app to EmbedPDF's internal type graph across every
 * upgrade. The shapes below are the parts actually used, taken from the
 * installed 2.15.1 definitions.
 *
 * The one thing taken at runtime rather than copied is the annotation subtype
 * names, which come from the lazily imported package so they can never drift.
 */

export interface PdfAnnotationLike {
  id?: string;
  type?: number;
  pageIndex?: number;
  contents?: string;
  author?: string;
  created?: unknown;
  modified?: unknown;
  color?: string;
  strokeColor?: string;
  custom?: (Record<string, unknown> & { rajgruha?: { text?: string } }) | null;
  [key: string]: unknown;
}

export interface AnnotationTransferItemLike {
  annotation: PdfAnnotationLike;
  ctx?: unknown;
}

/** EmbedPDF tasks expose `wait(onSuccess, onError)` instead of being thenable. */
export interface TaskLike<T> {
  wait(onSuccess: (value: T) => void, onError?: (error: unknown) => void): unknown;
}

export interface AnnotationEventLike {
  type: 'create' | 'update' | 'delete' | string;
  documentId?: string;
  annotation: PdfAnnotationLike;
  pageIndex: number;
}

export interface AnnotationApiLike {
  exportAnnotations(options?: { pageIndex?: number }): TaskLike<AnnotationTransferItemLike[]>;
  importAnnotations(items: AnnotationTransferItemLike[]): unknown;
  getAnnotations(options?: { pageIndex?: number }): { object: PdfAnnotationLike }[];
  updateAnnotation(pageIndex: number, annotationId: string, patch: Record<string, unknown>): void;
  setActiveTool(toolId: string | null): void;
  onAnnotationEvent(handler: (event: AnnotationEventLike) => void): unknown;
}

export interface ScrollApiLike {
  getCurrentPage(): number;
  getTotalPages(): number;
  scrollToPage(options: { pageNumber: number; behavior?: ScrollBehavior; alignY?: number }): void;
  onPageChange(handler: (event: { pageNumber: number; totalPages: number }) => void): unknown;
}

export interface SelectionApiLike {
  getSelectedText(): TaskLike<string[]>;
  onSelectionChange(handler: (selection: unknown) => void): unknown;
}

export interface PluginRegistryLike {
  getPlugin(name: string): { provides(): unknown } | undefined;
}

/**
 * Subtype numbers used for behaviour (not for display).
 * Verified against `@embedpdf/models@2.15.1`, `enum PdfAnnotationSubtype`.
 */
export const ANNOTATION_TYPE = {
  TEXT: 1,
  FREETEXT: 3,
  HIGHLIGHT: 9,
  UNDERLINE: 10,
  SQUIGGLY: 11,
  STRIKEOUT: 12,
  STAMP: 13,
  INK: 15,
} as const;

const MARKUP_TYPES = new Set<number>([ANNOTATION_TYPE.HIGHLIGHT, ANNOTATION_TYPE.UNDERLINE, ANNOTATION_TYPE.SQUIGGLY, ANNOTATION_TYPE.STRIKEOUT]);

export function isMarkupType(type: number | undefined): boolean {
  return typeof type === 'number' && MARKUP_TYPES.has(type);
}

/** Runtime subtype names, stashed by the lazy import so nothing extra is bundled. */
let subtypeNames: Record<number, string> | null = null;

export function rememberSubtypeNames(value: unknown): void {
  if (value && typeof value === 'object') subtypeNames = value as Record<number, string>;
}

const FALLBACK_KIND: Record<number, string> = {
  0: 'unknown',
  1: 'note',
  2: 'link',
  3: 'text',
  4: 'line',
  5: 'square',
  6: 'circle',
  7: 'polygon',
  8: 'polyline',
  9: 'highlight',
  10: 'underline',
  11: 'squiggly',
  12: 'strikeout',
  13: 'stamp',
  14: 'caret',
  15: 'ink',
  16: 'popup',
  17: 'fileattachment',
  20: 'widget',
  24: 'watermark',
  28: 'redact',
};

/** Lowercase kind name for an annotation subtype. */
export function annotationKind(type: number | undefined): string {
  if (typeof type !== 'number') return 'unknown';
  const named = subtypeNames?.[type];
  if (typeof named === 'string') return named.toLowerCase();
  return FALLBACK_KIND[type] ?? 'unknown';
}

export function plugin<T>(registry: PluginRegistryLike | null, name: string): T | null {
  if (!registry) return null;
  try {
    const found = registry.getPlugin(name);
    if (!found || typeof found.provides !== 'function') return null;
    return (found.provides() as T) ?? null;
  } catch (error) {
    console.warn(`[rajgruha] plugin "${name}" is unavailable`, error);
    return null;
  }
}

/** Subscribes to an EmbedPDF event hook and returns an unsubscribe function. */
export function subscribe(hook: unknown, handler: (...args: never[]) => void): () => void {
  if (typeof hook !== 'function') return () => {};
  try {
    const result = (hook as unknown as (h: typeof handler) => unknown)(handler);
    if (typeof result === 'function') return result as () => void;
  } catch (error) {
    console.warn('[rajgruha] could not subscribe to a viewer event', error);
  }
  return () => {};
}

export function taskToPromise<T>(task: TaskLike<T> | null | undefined): Promise<T> {
  if (!task || typeof task.wait !== 'function') {
    return Promise.reject(new Error('The viewer did not return a task'));
  }
  return new Promise<T>((resolve, reject) => {
    try {
      task.wait(resolve, (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))));
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** A highlight rendered in the reader's own highlight list. */
export interface LiveAnnotation {
  id: string;
  page: number;
  kind: string;
  type: number;
  color: string | null;
  text: string | null;
  note: string | null;
  author: string | null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** Maps a live annotation onto the reader's highlight list shape. */
export function toLiveAnnotation(annotation: PdfAnnotationLike): LiveAnnotation | null {
  const id = typeof annotation.id === 'string' && annotation.id ? annotation.id : null;
  if (!id) return null;
  const type = typeof annotation.type === 'number' ? annotation.type : 0;
  const kind = annotationKind(type);
  const contents = firstString(annotation.contents);
  const customText = firstString(annotation.custom?.rajgruha?.text);
  const noteLike = kind === 'note' || kind === 'text';

  return {
    id,
    page: typeof annotation.pageIndex === 'number' ? annotation.pageIndex : 0,
    kind,
    type,
    color: firstString(annotation.strokeColor, annotation.color),
    text: customText ?? (noteLike ? contents : null),
    note: noteLike ? null : contents,
    author: firstString(annotation.author),
  };
}

/**
 * Imports saved annotations once the viewer has a document open.
 *
 * `onReady` fires as soon as the registry exists, which can be a moment before
 * the document is loaded, so this retries briefly instead of dropping the
 * import on the floor.
 */
export async function importWhenReady(
  api: AnnotationApiLike,
  items: AnnotationTransferItemLike[],
  options: { attempts?: number; delayMs?: number } = {},
): Promise<boolean> {
  const { attempts = 12, delayMs = 250 } = options;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      api.importAnnotations(items);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  console.warn('[rajgruha] saved annotations could not be imported into the viewer');
  return false;
}
