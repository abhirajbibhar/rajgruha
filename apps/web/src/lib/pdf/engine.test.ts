// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureInfoDictionary } from './ensureInfo';
import { configurePdfEngine, readPdf, toBookmarkTree, writePdf, type PdfInfo } from './engine';

const fixture = (name: string) => {
  const b = fs.readFileSync(path.join(__dirname, '__fixtures__', name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

const INFO: PdfInfo = {
  title: 'The Glass Orchard – Ünïcode ✓', author: 'Mira Okonkwo', description: 'A quiet fantasy.', genres: ['Fantasy', 'Fiction'],
  publisher: 'Lantern House', year: 2021, isbn: '9780306406157', language: 'en', series: 'Orchard #1'
};
const OUTLINE = [
  { title: 'Part One', page: 1, level: 0 },
  { title: 'The Lantern Keeper', page: 1, level: 1 },
  { title: 'Glass Leaves', page: 2, level: 1 },
  { title: 'Part Two – Épilogue', page: 3, level: 0 }
];

beforeAll(() => {
  // The engine fetches its wasm by URL; serve file:// URLs from disk when running under Node.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: RequestInfo | URL, init?: RequestInit) =>
    String(u).startsWith('file:') ? new Response(fs.readFileSync(new URL(String(u)))) : realFetch(u, init)) as typeof fetch;
  configurePdfEngine('file://' + createRequire(import.meta.url).resolve('@embedpdf/pdfium/pdfium.wasm'));
});

describe('ensureInfoDictionary', () => {
  it('adds an Info dictionary to classic and xref-stream files, leaves others alone', () => {
    for (const f of ['classic-noinfo.pdf', 'xrefstream-noinfo.pdf', 'xrefstream-outline-noinfo.pdf']) {
      const r = ensureInfoDictionary(new Uint8Array(fixture(f)));
      expect(r.added, f).toBe(true);
      expect(r.bytes.length).toBeGreaterThan(fixture(f).byteLength);
    }
    const had = ensureInfoDictionary(new Uint8Array(fixture('classic-info.pdf')));
    expect(had).toMatchObject({ hadInfo: true, added: false });
  });
  it('does not touch garbage input', () => {
    const junk = new Uint8Array([1, 2, 3, 4]);
    expect(ensureInfoDictionary(junk).bytes).toBe(junk);
  });
});

describe('writePdf → readPdf round trip (EmbedPDF / PDFium)', () => {
  for (const f of ['classic-info.pdf', 'classic-noinfo.pdf', 'xrefstream-noinfo.pdf', 'xrefstream-outline-noinfo.pdf']) {
    it(`persists metadata and chapters in ${f}`, async () => {
      const { bytes, readBack } = await writePdf(fixture(f), { info: INFO, outline: OUTLINE });
      expect(readBack.info).toEqual(INFO);
      expect(readBack.outline).toEqual(OUTLINE);
      const again = await readPdf(bytes); // a brand-new read of the saved bytes
      expect(again.info).toEqual(INFO);
      expect(again.outline).toEqual(OUTLINE);
      expect(again.pageCount).toBe(3);
    });
  }

  it('replaces an existing outline and can clear fields', async () => {
    const first = await writePdf(fixture('xrefstream-outline-noinfo.pdf'), { info: INFO, outline: OUTLINE });
    const cleared = await writePdf(first.bytes, { info: { ...INFO, series: '', isbn: '', genres: [] }, outline: [{ title: 'Only', page: 2, level: 0 }] });
    expect(cleared.readBack.info.series).toBe('');
    expect(cleared.readBack.info.genres).toEqual([]);
    expect(cleared.readBack.outline).toEqual([{ title: 'Only', page: 2, level: 0 }]);
  });

  it('removes all chapters when the outline is emptied', async () => {
    const { readBack } = await writePdf(fixture('xrefstream-outline-noinfo.pdf'), { info: INFO, outline: [] });
    expect(readBack.outline).toEqual([]);
  });

  it('clamps out-of-range pages to the document', async () => {
    const { readBack } = await writePdf(fixture('classic-info.pdf'), { info: INFO, outline: [{ title: 'Way past the end', page: 99, level: 0 }] });
    expect(readBack.outline[0]!.page).toBe(3);
  });

  it('reports the existing outline of a file when reading', async () => {
    const r = await readPdf(fixture('xrefstream-outline-noinfo.pdf'));
    expect(r.outline).toEqual([{ title: 'Existing Chapter', page: 2, level: 0 }]);
    expect(r.pageCount).toBe(3);
  });

  it('rejects a file that is not a PDF with a readable message', async () => {
    await expect(readPdf(new TextEncoder().encode('not a pdf').buffer as ArrayBuffer)).rejects.toThrow(/Could not open/);
  });
});

describe('toBookmarkTree', () => {
  it('nests by level and never skips a level', () => {
    const tree = toBookmarkTree([
      { title: 'A', page: 1, level: 0 }, { title: 'A.1', page: 1, level: 1 }, { title: 'A.1.1', page: 2, level: 2 },
      { title: 'B', page: 3, level: 0 }, { title: 'jump', page: 3, level: 5 }
    ], 3);
    expect(tree.map((t) => t.title)).toEqual(['A', 'B']);
    expect(tree[0]!.children![0]!.children![0]!.title).toBe('A.1.1');
    expect(tree[1]!.children![0]!.title).toBe('jump'); // level 5 is pulled down to 1
  });
});
