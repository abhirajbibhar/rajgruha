import type { PdfBookmarkObject } from '@embedpdf/models';
import { ensureInfoDictionary } from './ensureInfo';

/**
 * Reads and writes PDF metadata and outlines (chapters) with EmbedPDF's PDFium build, in the
 * browser. The PDF file is the source of truth; the library database only mirrors it for search.
 *
 * Field mapping (standard Info keys where one exists, otherwise custom ASCII keys):
 *   title → Title · author → Author · description → Subject · genres → Keywords (comma-separated)
 *   publisher → Publisher · year → PublishedYear · isbn → ISBN · language → Language · series → Series
 */
export type PdfInfo = {
  title: string; author: string; description: string; genres: string[];
  publisher: string; year: number | null; isbn: string; language: string; series: string;
};
/** One chapter. `page` is 1-based; `level` 0 = top level. The list is in reading order. */
export type OutlineEntry = { title: string; page: number; level: number };
export type PdfRead = { info: PdfInfo; outline: OutlineEntry[]; pageCount: number; hadInfoDict: boolean };

export class PdfEditError extends Error {}

type Engine = Awaited<ReturnType<(typeof import('@embedpdf/engines/pdfium-direct-engine'))['createPdfiumEngine']>>;
let enginePromise: Promise<Engine> | undefined;
let wasmOverride: string | undefined;

/** Tests (Node) point the engine at a file URL; the browser default is the self-hosted wasm. */
export function configurePdfEngine(wasmUrl: string | undefined) {
  wasmOverride = wasmUrl;
  enginePromise = undefined;
}

// Browser-only: on the Cloudflare server build these conditions fold to `true`, so the ~5 MB of PDFium engine
// and wasm are dropped from the Worker bundle (and stay in the client assets). Vitest runs with MODE=test.
const loadEngine = import.meta.env.SSR && import.meta.env.MODE !== 'test' ? undefined : () => import('@embedpdf/engines/pdfium-direct-engine');
const loadWasmUrl = import.meta.env.SSR && import.meta.env.MODE !== 'test' ? undefined : () => import('@embedpdf/pdfium/pdfium.wasm?url');

function getEngine(): Promise<Engine> {
  enginePromise ??= (async () => {
    if (!loadEngine || !loadWasmUrl) throw new PdfEditError('The PDF engine only runs in the browser.');
    const [{ createPdfiumEngine }, wasm] = await Promise.all([
      loadEngine(),
      wasmOverride ? Promise.resolve(wasmOverride) : loadWasmUrl().then((m) => new URL(m.default, window.location.origin).href)
    ]);
    return createPdfiumEngine(wasm, { fontFallback: null });
  })();
  enginePromise.catch(() => { enginePromise = undefined; });
  return enginePromise;
}

type Task<T> = { toPromise(): Promise<T> };
async function run<T>(task: Task<T>, what: string): Promise<T> {
  try {
    return await task.toPromise();
  } catch (e) {
    const reason = (e as { reason?: { code?: number; message?: string } }).reason;
    const msg = reason?.message ?? (e instanceof Error ? e.message : String(e));
    throw new PdfEditError(/password/i.test(msg) ? 'This PDF is password-protected and can’t be edited.' : `${what}: ${msg}`);
  }
}

let seq = 0;
const FIT_PAGE = 2; // PdfZoomMode.FitPage — the “Unknown” mode is rejected when writing a bookmark

const clean = (s: string | null | undefined) => (s ?? '').trim();
const splitKeywords = (s: string | null | undefined) => clean(s).split(/[;,]/).map((x) => x.trim()).filter(Boolean);
const toYear = (s: string | null | undefined) => { const y = Number(/\d{4}/.exec(s ?? '')?.[0]); return y >= 1000 && y <= 2999 ? y : null; };

function pageOf(b: PdfBookmarkObject): number {
  const t = b.target;
  const idx = t?.type === 'destination' ? t.destination.pageIndex
    : t?.type === 'action' && 'destination' in t.action ? t.action.destination.pageIndex : undefined;
  return typeof idx === 'number' && idx >= 0 ? idx + 1 : 1;
}

function flatten(items: PdfBookmarkObject[], level = 0, out: OutlineEntry[] = []): OutlineEntry[] {
  for (const b of items) {
    out.push({ title: clean(b.title), page: pageOf(b), level });
    if (b.children?.length) flatten(b.children, level + 1, out);
  }
  return out;
}

/** Flat, levelled list → nested bookmarks. A level may exceed its predecessor's by at most one. */
export function toBookmarkTree(entries: OutlineEntry[], pageCount: number): PdfBookmarkObject[] {
  const root: PdfBookmarkObject[] = [];
  const stack: PdfBookmarkObject[][] = [root];
  entries.forEach((e, i) => {
    const level = Math.max(0, Math.min(e.level, stack.length - 1, i === 0 ? 0 : e.level));
    const node: PdfBookmarkObject = {
      title: e.title.trim(),
      target: { type: 'destination', destination: { pageIndex: Math.max(0, Math.min(pageCount - 1, Math.round(e.page) - 1)), zoom: { mode: FIT_PAGE as never }, view: [] } }
    };
    stack.length = level + 1;
    stack[level]!.push(node);
    node.children = [];
    stack.push(node.children);
  });
  const prune = (list: PdfBookmarkObject[]) => list.forEach((n) => { if (n.children?.length) prune(n.children); else delete n.children; });
  prune(root);
  return root;
}

export async function readPdf(bytes: ArrayBuffer): Promise<PdfRead> {
  const engine = await getEngine();
  const doc = await run(engine.openDocumentBuffer({ id: `rd-${++seq}`, content: bytes }), 'Could not open the PDF');
  try {
    const [meta, marks] = await Promise.all([run(engine.getMetadata(doc), 'Could not read metadata'), run(engine.getBookmarks(doc), 'Could not read chapters')]);
    const c = meta.custom ?? {};
    return {
      pageCount: doc.pageCount,
      hadInfoDict: true, // refined by writePdf, which inspects the raw bytes
      outline: flatten(marks.bookmarks),
      info: {
        title: clean(meta.title), author: clean(meta.author), description: clean(meta.subject), genres: splitKeywords(meta.keywords),
        publisher: clean(c.Publisher), year: toYear(c.PublishedYear), isbn: clean(c.ISBN), language: clean(c.Language), series: clean(c.Series)
      }
    };
  } finally {
    await engine.closeDocument(doc).toPromise().catch(() => undefined);
  }
}

export type PdfEdit = { info: PdfInfo; outline: OutlineEntry[] };

const norm = (e: PdfEdit) => JSON.stringify({
  i: { ...e.info, genres: e.info.genres.map((g) => g.trim()).filter(Boolean) },
  o: e.outline.map((x) => ({ t: x.title.trim(), p: Math.round(x.page), l: x.level }))
});

/**
 * Applies the edit and returns the new file bytes. The saved bytes are re-opened and compared with
 * what was asked for; if anything differs this throws and the original file is left alone.
 */
export async function writePdf(original: ArrayBuffer, edit: PdfEdit): Promise<{ bytes: ArrayBuffer; readBack: PdfRead; addedInfoDict: boolean }> {
  const engine = await getEngine();
  const prepared = ensureInfoDictionary(new Uint8Array(original));
  const source = prepared.added ? prepared.bytes.buffer.slice(prepared.bytes.byteOffset, prepared.bytes.byteOffset + prepared.bytes.byteLength) as ArrayBuffer : original;

  const doc = await run(engine.openDocumentBuffer({ id: `wr-${++seq}`, content: source }), 'Could not open the PDF');
  let saved: ArrayBuffer;
  try {
    const i = edit.info;
    const val = (s: string) => (s.trim() ? s.trim() : null); // null deletes the key
    await run(engine.setMetadata(doc, {
      title: val(i.title), author: val(i.author), subject: val(i.description), keywords: i.genres.length ? i.genres.join(', ') : null,
      modificationDate: new Date(),
      custom: { Publisher: val(i.publisher), PublishedYear: i.year ? String(i.year) : null, ISBN: val(i.isbn), Language: val(i.language), Series: val(i.series) }
    }), 'Could not write metadata');
    await run(engine.setBookmarks(doc, toBookmarkTree(edit.outline, doc.pageCount)), 'Could not write chapters');
    saved = await run(engine.saveAsCopy(doc), 'Could not save the PDF');
  } finally {
    await engine.closeDocument(doc).toPromise().catch(() => undefined);
  }

  const readBack = await readPdf(saved);
  const want = { info: edit.info, outline: edit.outline.map((o) => ({ ...o, page: Math.max(1, Math.min(readBack.pageCount, Math.round(o.page))) })) };
  if (norm({ info: readBack.info, outline: readBack.outline }) !== norm(want)) {
    throw new PdfEditError('The edited file did not read back correctly, so nothing was saved. Your original is untouched.');
  }
  return { bytes: saved, readBack, addedInfoDict: prepared.added };
}
