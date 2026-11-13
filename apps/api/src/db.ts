import type { Book, BookBrief, BookInput, ReadingStatus, TocItem } from '@rajgruha/shared';

export type BookRow = {
  id: string;
  slug: string;
  title: string;
  author: string;
  series: string | null;
  description: string | null;
  publisher: string | null;
  published_year: number | null;
  pages: number | null;
  language: string;
  isbn: string | null;
  format: Book['format'];
  genres: string;
  rating: number;
  rating_count: number;
  cover: string | null;
  file_key: string | null;
  toc: string;
  cover_key: string | null;
  added_at: string;
  // joined from reading_progress (nullable when the user hasn't started the book)
  p_status: ReadingStatus | null;
  p_percent: number | null;
  p_location: string | null;
  p_updated_at: string | null;
};

export const BOOK_SELECT = `
  b.*, p.status AS p_status, p.percent AS p_percent,
  p.location AS p_location, p.updated_at AS p_updated_at`;

const parseJson = <T>(s: string, fallback: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

/** Uploaded covers are served by the API; seeded ones are static files in the web app. */
export const coverUrl = (r: { slug: string; cover: string | null; cover_key: string | null }) =>
  r.cover_key ? `/api/books/${encodeURIComponent(r.slug)}/cover` : r.cover;

export type BriefRow = Pick<BookRow, 'id' | 'slug' | 'title' | 'author' | 'cover' | 'cover_key' | 'format'>;
export const rowToBrief = (r: BriefRow): BookBrief => ({
  id: r.id, slug: r.slug, title: r.title, author: r.author, cover: coverUrl(r), format: r.format
});

export function rowToBook(r: BookRow): Book {
  const genres = parseJson<string[]>(r.genres, []);
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    author: r.author,
    series: r.series,
    description: r.description,
    publisher: r.publisher,
    publishedYear: r.published_year,
    pages: r.pages,
    language: r.language,
    isbn: r.isbn,
    format: r.format,
    genres,
    rating: r.rating,
    ratingCount: r.rating_count,
    cover: coverUrl(r),
    fileKey: r.file_key,
    toc: parseJson<TocItem[]>(r.toc, []),
    addedAt: r.added_at,
    progress:
      r.p_status && r.p_percent !== null && r.p_updated_at
        ? { status: r.p_status, percent: r.p_percent, location: r.p_location, updatedAt: r.p_updated_at }
        : null
  };
}

export const insertBookStatement = (db: D1Database, id: string, b: BookInput) =>
  db
    .prepare(
      `INSERT INTO books (id, slug, title, author, series, description, publisher, published_year,
         pages, language, isbn, format, genres, rating, rating_count, cover, file_key, toc)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)`
    )
    .bind(
      id, b.slug, b.title, b.author, b.series ?? null, b.description ?? null, b.publisher ?? null,
      b.publishedYear ?? null, b.pages ?? null, b.language ?? 'en', b.isbn ?? null, b.format,
      JSON.stringify(b.genres ?? []), b.rating ?? 0, b.ratingCount ?? 0, b.cover ?? null, b.fileKey ?? null, JSON.stringify(b.toc ?? [])
    );
