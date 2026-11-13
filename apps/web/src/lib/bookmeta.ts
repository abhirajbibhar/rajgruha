import type { TocItem } from '@rajgruha/shared';

export type ParsedBook = {
  title?: string; author?: string; publisher?: string; year?: number; language?: string;
  isbn?: string; description?: string; toc: TocItem[]; cover?: Blob;
};

export const slugify = (s: string) =>
  s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'book';

/** Digits (and a trailing X) only; returns null unless it's a valid ISBN-10 or ISBN-13. */
export function normalizeIsbn(raw: string): string | null {
  const s = raw.replace(/^urn:isbn:/i, '').replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{13}$/.test(s)) {
    const sum = [...s].slice(0, 12).reduce((t, d, i) => t + Number(d) * (i % 2 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === Number(s[12]) ? s : null;
  }
  if (/^\d{9}[\dX]$/.test(s)) {
    const sum = [...s].slice(0, 9).reduce((t, d, i) => t + Number(d) * (10 - i), 0);
    const check = (11 - (sum % 11)) % 11;
    return (check === 10 ? 'X' : String(check)) === s[9] ? s : null;
  }
  return null;
}

/** "Author - Title.epub" → both; otherwise the file name is the title. */
export function guessFromPath(path: string): { title: string; author: string } {
  const stem = (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  const [a, ...rest] = stem.split(/\s+-\s+/);
  return rest.length ? { author: a!.trim(), title: rest.join(' - ').trim() } : { title: stem, author: 'Unknown' };
}

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/** Reads title/author/chapters/cover out of an EPUB entirely in the browser. Never throws. */
export async function parseEpub(file: File): Promise<ParsedBook> {
  const out: ParsedBook = { toc: [] };
  try {
    if (import.meta.env.SSR && import.meta.env.MODE !== 'test') return out;
    const { default: ePub } = await import('epubjs');
    const book = ePub(await file.arrayBuffer());
    try {
      const [meta, nav] = await withTimeout(Promise.all([book.loaded.metadata, book.loaded.navigation]), 20_000);
      const m = meta as unknown as Record<string, string | undefined>;
      out.title = m.title?.trim() || undefined;
      out.author = m.creator?.trim() || undefined;
      out.publisher = m.publisher?.trim() || undefined;
      out.language = m.language?.slice(0, 2).toLowerCase() || undefined;
      out.description = m.description?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || undefined;
      const year = Number(/\d{4}/.exec(m.pubdate ?? '')?.[0]);
      out.year = year > 1000 ? year : undefined;
      out.isbn = normalizeIsbn(m.identifier ?? '') ?? undefined;

      const walk = (items: typeof nav.toc, level: number) => {
        for (const i of items) {
          if (out.toc.length >= 400) return;
          out.toc.push({ label: i.label.replace(/\s+/g, ' ').trim(), href: i.href, level: Math.min(level, 6) });
          if (i.subitems?.length) walk(i.subitems, level + 1);
        }
      };
      walk(nav.toc, 0);

      const coverUrl = await withTimeout(book.coverUrl(), 8_000).catch(() => null);
      if (coverUrl) {
        const blob = await (await fetch(coverUrl)).blob();
        if (/^image\/(jpeg|png|webp)$/.test(blob.type) && blob.size < 5 * 1024 * 1024) out.cover = blob;
      }
    } finally {
      book.destroy();
    }
  } catch {
    /* unreadable EPUB → fall back to file-name guesses */
  }
  return out;
}

// ── Open Library lookup (ISBN → metadata). Free, no API key, CORS-enabled. ──
export type IsbnInfo = { title: string; author: string; publisher?: string; year?: number; pages?: number; isbn: string; coverUrl?: string; genres: string[]; description?: string };

export async function lookupIsbn(isbn: string): Promise<IsbnInfo | null> {
  const key = `ISBN:${isbn}`;
  const res = await fetch(`https://openlibrary.org/api/books?bibkeys=${key}&format=json&jscmd=data`);
  if (!res.ok) throw new Error('Lookup service unavailable');
  const data = (await res.json()) as Record<string, {
    title?: string; subtitle?: string; authors?: { name: string }[]; publishers?: { name: string }[]; publish_date?: string;
    number_of_pages?: number; cover?: { large?: string; medium?: string }; subjects?: { name: string }[]; excerpts?: { text: string }[];
  }>;
  const b = data[key];
  if (!b?.title) return null;
  const year = Number(/\d{4}/.exec(b.publish_date ?? '')?.[0]);
  return {
    title: b.subtitle ? `${b.title}: ${b.subtitle}` : b.title,
    author: b.authors?.map((a) => a.name).join(' & ') || 'Unknown',
    publisher: b.publishers?.[0]?.name,
    year: year > 1000 ? year : undefined,
    pages: b.number_of_pages,
    isbn,
    coverUrl: b.cover?.large ?? b.cover?.medium,
    genres: (b.subjects ?? []).slice(0, 3).map((s) => s.name),
    description: b.excerpts?.[0]?.text
  };
}

/** Reads a PDF's own metadata, chapters and page count (EmbedPDF). Never throws — a bad file just yields nothing. */
export async function parsePdf(file: Blob): Promise<(ParsedBook & { pages?: number; series?: string; genres?: string[]; hasOutline: boolean }) | null> {
  try {
    const [{ readPdf }, { outlineToToc }] = await Promise.all([import('./pdf/engine'), import('./pdf/outlineOps')]);
    const r = await readPdf(await file.arrayBuffer());
    const i = r.info;
    return {
      title: i.title || undefined, author: i.author || undefined, publisher: i.publisher || undefined, year: i.year ?? undefined,
      language: i.language || undefined, isbn: normalizeIsbn(i.isbn) ?? (i.isbn || undefined), description: i.description || undefined,
      series: i.series || undefined, genres: i.genres, pages: r.pageCount, toc: outlineToToc(r.outline), hasOutline: r.outline.length > 0
    };
  } catch {
    return null;
  }
}
