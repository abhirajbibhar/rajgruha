import { z } from 'zod';
import {
  AcquisitionSchema,
  AnalyticsSchema,
  BookListSchema,
  BookSchema,
  DayLogSchema,
  FacetsSchema,
  FileListSchema,
  MemberSchema,
  MonthLogSchema,
  NoteSchema,
  StatsSchema,
  UserSchema,
  type AcquisitionInput,
  type AcquisitionPatch,
  type BookInput,
  type BookListQuery,
  type BookPatch,
  type MemberCreateInput,
  type MemberPatch,
  type ProgressInput,
  type SessionInput
} from '@rajgruha/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

async function request<S extends z.ZodType>(path: string, schema: S, init?: RequestInit): Promise<z.infer<S>> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers }
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? res.statusText);
  }
  return schema.parse(await res.json());
}

const json = (body: unknown, method = 'POST'): RequestInit => ({ method, body: JSON.stringify(body) });
const Ok = z.object({ ok: z.boolean() });

async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  const res = await fetch(`/api${path}`, { credentials: 'include', ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? res.statusText);
  }
}

/** Raw-body upload with progress (fetch can't report upload progress). */
function upload<S extends z.ZodType>(path: string, body: Blob, schema: S, opts: { type?: string; onProgress?: (fraction: number) => void } = {}): Promise<z.infer<S>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(path.startsWith('/books') && path.endsWith('/cover') ? 'PUT' : 'POST', `/api${path}`);
    xhr.withCredentials = true;
    if (opts.type) xhr.setRequestHeader('Content-Type', opts.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && opts.onProgress?.(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError(0, 'Network error'));
    xhr.onload = () => {
      let data: unknown = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* empty */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        const parsed = schema.safeParse(data);
        return parsed.success ? resolve(parsed.data) : reject(new ApiError(xhr.status, 'Unexpected response'));
      }
      reject(new ApiError(xhr.status, (data as { error?: string } | null)?.error ?? xhr.statusText));
    };
    xhr.send(body);
  });
}

export const api = {
  login: (email: string, password: string) =>
    request('/auth/login', z.object({ user: UserSchema }), json({ email, password })),
  logout: () => request('/auth/logout', z.object({ ok: z.boolean() }), { method: 'POST' }),
  me: () => request('/auth/me', z.object({ user: UserSchema })).then((r) => r.user),

  books: (query: Partial<BookListQuery> = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') qs.set(k, String(v));
    return request(`/books?${qs}`, BookListSchema);
  },
  book: (id: string) => request(`/books/${encodeURIComponent(id)}`, BookSchema),
  continueReading: () => request('/books/continue', z.array(BookSchema)),
  saveProgress: (id: string, input: ProgressInput) =>
    request(`/books/${encodeURIComponent(id)}/progress`, BookSchema, {
      method: 'PUT',
      body: JSON.stringify(input)
    }),
  stats: () => request('/stats', StatsSchema),

  /** Same-origin URL that streams the EPUB/PDF (cookie-authenticated). */
  fileUrl: (id: string) => `/api/books/${encodeURIComponent(id)}/file`,

  // ── admin: books & uploads ──
  createBook: (input: BookInput) => request('/books', BookSchema, json(input)),
  patchBook: (id: string, patch: BookPatch) => request(`/books/${encodeURIComponent(id)}`, BookSchema, json(patch, 'PATCH')),
  deleteBook: (id: string) => requestVoid(`/books/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  putCover: (id: string, image: Blob) => upload(`/books/${encodeURIComponent(id)}/cover`, image, BookSchema, { type: image.type }),
  uploadFile: (path: string, file: Blob, onProgress?: (f: number) => void) =>
    upload(`/files/upload?path=${encodeURIComponent(path)}`, file, z.object({ key: z.string(), size: z.number() }), { onProgress }),

  /** The book's file plus the ETag needed to replace it safely. */
  downloadFile: async (id: string) => {
    const res = await fetch(`/api/books/${encodeURIComponent(id)}/file`, { credentials: 'include', cache: 'no-store' }); // an edit must start from what is stored *now*
    if (!res.ok) throw new ApiError(res.status, ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? res.statusText);
    return { buffer: await res.arrayBuffer(), etag: res.headers.get('etag') ?? '' };
  },
  /** Overwrite the stored file (If-Match protects against a concurrent edit). Returns the new ETag. */
  replaceFile: async (id: string, body: ArrayBuffer | Blob, type: 'application/pdf' | 'application/epub+zip', etag?: string) => {
    const res = await fetch(`/api/books/${encodeURIComponent(id)}/file`, {
      method: 'PUT', credentials: 'include', body, headers: { 'Content-Type': type, ...(etag ? { 'If-Match': etag } : {}) }
    });
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText);
    return { book: BookSchema.parse(data), etag: res.headers.get('etag') ?? '' };
  },

  // ── files ──
  files: (prefix = '') => request(`/files?prefix=${encodeURIComponent(prefix)}`, FileListSchema),
  deleteFile: (key: string, deleteBook = false) => requestVoid(`/files?key=${encodeURIComponent(key)}${deleteBook ? '&deleteBook=1' : ''}`, { method: 'DELETE' }),
  rawFileUrl: (key: string, download = false) => `/api/files/raw?key=${encodeURIComponent(key)}${download ? '&download=1' : ''}`,

  // ── reading log ──
  logMonth: (month: string) => request(`/log/month?month=${month}`, MonthLogSchema),
  logDay: (day: string) => request(`/log/day?day=${day}`, DayLogSchema),
  putSession: (id: string, s: SessionInput, keepalive = false) => request(`/log/sessions/${id}`, Ok, { ...json(s, 'PUT'), keepalive }),
  addNote: (n: { day: string; kind: 'note' | 'task'; text: string }) => request('/log/notes', NoteSchema, json(n)),
  patchNote: (id: string, p: { done?: boolean; text?: string }) => request(`/log/notes/${id}`, NoteSchema, json(p, 'PATCH')),
  deleteNote: (id: string) => requestVoid(`/log/notes/${id}`, { method: 'DELETE' }),
  analytics: (days: number, today: string) => request(`/analytics?days=${days}&today=${today}`, AnalyticsSchema),

  // ── account ──
  updateProfile: (name: string) => request('/auth/me', z.object({ user: UserSchema }), json({ name }, 'PATCH')).then((r) => r.user),
  changePassword: (current: string, next: string) => request('/auth/password', Ok, json({ current, next })),
  logoutEverywhere: () => request('/auth/logout-all', Ok, { method: 'POST' }),
  /** Same-origin download URLs (the session cookie authorises them). */
  exportMyDataUrl: '/api/export/me',
  exportCatalogUrl: '/api/export/catalog.csv',

  // ── members (admin) ──
  members: () => request('/users', z.array(MemberSchema)),
  createMember: (m: MemberCreateInput) => request('/users', MemberSchema, json(m)),
  updateMember: (id: string, p: MemberPatch) => request(`/users/${id}`, MemberSchema, json(p, 'PATCH')),
  deleteMember: (id: string) => requestVoid(`/users/${id}`, { method: 'DELETE' }),

  // ── acquisitions ──
  acquisitions: () => request('/acquisitions', z.array(AcquisitionSchema)),
  addAcquisition: (a: AcquisitionInput) => request('/acquisitions', AcquisitionSchema, json(a)),
  updateAcquisition: (id: string, p: AcquisitionPatch) => request(`/acquisitions/${id}`, AcquisitionSchema, json(p, 'PATCH')),
  deleteAcquisition: (id: string) => requestVoid(`/acquisitions/${id}`, { method: 'DELETE' }),

  facets: () => request('/books/facets', FacetsSchema)
};
