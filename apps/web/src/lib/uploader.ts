import type { BookInput, TocItem } from '@rajgruha/shared';
import { api, ApiError } from './api';
import { slugify } from './bookmeta';

export const MAX_BYTES = 100 * 1024 * 1024; // Workers request-body limit
export const isBookFile = (name: string) => /\.(epub|pdf)$/i.test(name);

/** Library-relative path: optional destination folder + the file's own (folder) path. No traversal. */
export const targetPath = (folder: string, rel: string) =>
  [...folder.split('/'), ...rel.split('/')].map((s) => s.trim()).filter((s) => s && s !== '.' && s !== '..').join('/');

export type UploadJob = {
  /** Path inside the library (R2 key without the `library/` root). Empty for a record with no file. */
  path: string;
  file?: Blob;
  format: 'epub' | 'pdf' | 'audio';
  title: string;
  author: string;
  publisher?: string; year?: number; language?: string; isbn?: string; description?: string; pages?: number; genres?: string[]; series?: string;
  toc?: TocItem[];
  cover?: Blob;
};

export type UploadResult = { status: 'done' | 'skipped'; slug: string; note?: string };

/** file → R2, then the book row, then the cover. Retries the slug on collision. */
export async function uploadBook(job: UploadJob, onProgress: (f: number) => void): Promise<UploadResult> {
  let fileKey: string | null = null;
  if (job.file) {
    try {
      fileKey = (await api.uploadFile(job.path, job.file, onProgress)).key;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) return { status: 'skipped', slug: '', note: 'A file already exists at this path' };
      throw e;
    }
  }

  const base: BookInput = {
    slug: slugify(job.title), title: job.title.trim(), author: job.author.trim() || 'Unknown', format: job.format,
    publisher: job.publisher ?? null, publishedYear: job.year ?? null, pages: job.pages ?? null, language: job.language ?? 'en',
    isbn: job.isbn ?? null, description: job.description ?? null, series: job.series ?? null, genres: job.genres ?? [], toc: job.toc ?? [], fileKey
  };

  for (let attempt = 1; attempt <= 6; attempt++) {
    const slug = attempt === 1 ? base.slug : `${base.slug}-${attempt}`;
    try {
      const book = await api.createBook({ ...base, slug });
      if (job.cover) await api.putCover(book.id, job.cover).catch(() => undefined); // cover is a nice-to-have
      return { status: 'done', slug: book.slug };
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 409) throw e;
      if (/already in the library/i.test(e.message)) return { status: 'skipped', slug: '', note: 'Already in the library' };
      // slug taken → try the next suffix
    }
  }
  throw new Error('Could not find a free slug for this title');
}

// ── Reading dropped folders ───────────────────────────────────────
export type Picked = { file: File; path: string };

/** Walks dropped files/folders (including nested folders) keeping relative paths. */
export async function readDrop(dt: DataTransfer): Promise<Picked[]> {
  // Entries must be collected synchronously — the DataTransfer is cleared after the first await.
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  const out: Picked[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ file, path: prefix + file.name });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}
