/**
 * Annotation handling: kind mapping, index building and conflict-safe merging.
 *
 * The kind table is copied from the installed dependency rather than guessed —
 * verified against `@embedpdf/models@2.15.1`, `export declare enum PdfAnnotationSubtype`
 * in dist/pdf.d.ts. If an EmbedPDF upgrade ever renumbers these, this is the one
 * place to update; unknown numbers degrade to "unknown" instead of erroring.
 */
import type {
  AnnotationIndexItem,
  AnnotationTransferItem,
  BookAnnotations,
  RawAnnotation,
} from './types';

export const ANNOTATION_KIND_BY_TYPE: Record<number, string> = {
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
  18: 'sound',
  19: 'movie',
  20: 'widget',
  21: 'screen',
  22: 'printermark',
  23: 'trapnet',
  24: 'watermark',
  25: 'threed',
  26: 'richmedia',
  27: 'xfawidget',
  28: 'redact',
};

/** Kinds that read as markup over existing text - the ones a quote usually comes from. */
const MARKUP_KINDS = new Set(['highlight', 'underline', 'squiggly', 'strikeout']);

export function annotationKind(type: number | undefined): string {
  if (typeof type !== 'number') return 'unknown';
  return ANNOTATION_KIND_BY_TYPE[type] ?? 'unknown';
}

export function isMarkupKind(kind: string): boolean {
  return MARKUP_KINDS.has(kind);
}

/** Kinds the Notes page shows by default; drawing/shape annotations are opt-in. */
export function isTextualKind(kind: string): boolean {
  return MARKUP_KINDS.has(kind) || kind === 'note' || kind === 'text' || kind === 'stamp';
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  // EmbedPDF annotation dates can arrive as { year, month, day, ... } style objects.
  if (typeof value === 'object') {
    const record = value as Record<string, number>;
    if (typeof record.year === 'number') {
      const date = new Date(
        Date.UTC(
          record.year,
          Math.max(0, (record.month ?? 1) - 1),
          record.day ?? 1,
          record.hour ?? 0,
          record.minute ?? 0,
          Math.round(record.second ?? 0),
        ),
      );
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
  }
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Turns one exported annotation into the compact row shown on the Notes page.
 *
 * `text` is the highlighted text. EmbedPDF does not store it on the annotation
 * (a highlight only carries `contents` plus quad rects), so the reader stamps
 * the live selection into `annotation.custom.rajgruha.text` when the annotation
 * is created; older annotations fall back to the user's note.
 */
export function buildIndexItem(
  item: AnnotationTransferItem,
  bookId: string,
  bookTitle: string,
): AnnotationIndexItem | null {
  const annotation = (item?.annotation ?? {}) as RawAnnotation;
  if (!annotation || typeof annotation !== 'object') return null;

  const id = typeof annotation.id === 'string' && annotation.id ? annotation.id : null;
  if (!id) return null;

  const type = typeof annotation.type === 'number' ? annotation.type : 0;
  const kind = annotationKind(type);
  const custom = (annotation.custom ?? {}) as Record<string, unknown> & {
    rajgruha?: { text?: string; note?: string };
  };
  const contents = firstString(annotation.contents);
  const customNote = firstString(custom.rajgruha?.note);
  const customText = firstString(custom.rajgruha?.text);

  // For a highlight the user's words live in `contents`; for a sticky note the
  // note *is* the payload, so mirror it into text as well.
  const isNoteLike = kind === 'note' || kind === 'text';
  const text = customText ?? (isNoteLike ? contents : null);
  const note = customNote ?? (isNoteLike ? null : contents);

  return {
    id,
    bookId,
    bookTitle,
    kind,
    type,
    page: typeof annotation.pageIndex === 'number' ? annotation.pageIndex : 0,
    color: firstString(annotation.strokeColor, annotation.color),
    text,
    note,
    author: firstString(annotation.author),
    createdAt: toIso(annotation.created),
    updatedAt: toIso(annotation.modified) ?? toIso(annotation.created),
    quoteId: null,
  };
}

export function buildIndexItems(
  items: AnnotationTransferItem[],
  bookId: string,
  bookTitle: string,
): AnnotationIndexItem[] {
  const out: AnnotationIndexItem[] = [];
  for (const item of items) {
    const row = buildIndexItem(item, bookId, bookTitle);
    if (row) out.push(row);
  }
  return out;
}

function annotationTimestamp(annotation: RawAnnotation): number {
  const iso = toIso(annotation.modified) ?? toIso(annotation.created);
  return iso ? new Date(iso).getTime() : 0;
}

export interface MergeResult {
  merged: AnnotationTransferItem[];
  added: number;
  updated: number;
  removed: number;
}

/**
 * Merges a client's annotation set into the stored set.
 *
 * Rules, chosen so that a stale device can never destroy work:
 *  - Annotations are matched by id; the newer `modified` timestamp wins.
 *  - Deletions are only honoured when the client had seen the current revision,
 *    i.e. it actually knew about the annotation it is no longer sending. A device
 *    working from stale state can therefore add and update, but never delete.
 */
export function mergeAnnotations(
  existing: AnnotationTransferItem[],
  incoming: AnnotationTransferItem[],
  options: { allowDeletes: boolean },
): MergeResult {
  const byId = new Map<string, AnnotationTransferItem>();
  for (const item of existing) {
    const id = item?.annotation?.id;
    if (typeof id === 'string' && id) byId.set(id, item);
  }

  let added = 0;
  let updated = 0;

  for (const item of incoming) {
    const id = item?.annotation?.id;
    if (typeof id !== 'string' || !id) continue;
    const current = byId.get(id);
    if (!current) {
      byId.set(id, item);
      added += 1;
      continue;
    }
    if (annotationTimestamp(item.annotation) >= annotationTimestamp(current.annotation)) {
      byId.set(id, item);
      updated += 1;
    }
  }

  let removed = 0;
  if (options.allowDeletes) {
    const incomingIds = new Set(
      incoming.map((item) => item?.annotation?.id).filter((id): id is string => typeof id === 'string' && Boolean(id)),
    );
    for (const id of [...byId.keys()]) {
      if (!incomingIds.has(id)) {
        byId.delete(id);
        removed += 1;
      }
    }
  }

  const merged = [...byId.values()].sort(
    (a, b) => (a.annotation.pageIndex ?? 0) - (b.annotation.pageIndex ?? 0),
  );
  return { merged, added, updated, removed };
}

export function emptyBookAnnotations(bookId: string, now: string): BookAnnotations {
  return { version: 1, bookId, revision: 0, updatedAt: now, items: [] };
}

/** Defensive read: a hand-edited or partially written file should not 500 the app. */
export function coerceBookAnnotations(raw: unknown, bookId: string, now: string): BookAnnotations {
  if (!raw || typeof raw !== 'object') return emptyBookAnnotations(bookId, now);
  const record = raw as Partial<BookAnnotations>;
  const items = Array.isArray(record.items) ? (record.items as AnnotationTransferItem[]) : [];
  return {
    version: 1,
    bookId,
    revision: typeof record.revision === 'number' && record.revision >= 0 ? record.revision : 0,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : now,
    items: items.filter((item) => item && typeof item === 'object' && item.annotation),
  };
}
