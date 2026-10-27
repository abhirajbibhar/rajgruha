/**
 * The API client.
 *
 * Every call goes through one `request` helper so error handling, credentials
 * and JSON parsing behave the same everywhere. Failures arrive as an ApiError
 * carrying the server's message, which is what the toast shows.
 */
import type {
  AnnotationIndexItem,
  BookMeta,
  BookProgress,
  NotebookDay,
  NotebookTodo,
  Quote,
  SessionUser,
  UserSettings,
  UserSummary,
} from '../../shared/types';
import type { AnnotationTransferItemLike } from './lib/embedpdf';

export interface ApiErrorShape {
  error?: { code?: string; message?: string; details?: unknown };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Turns anything thrown into a message a person can act on.
 *
 * Lives here rather than in the UI layer so every caller describes failures the
 * same way, and so `useToast().error` and inline banners agree.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Your session expired. Please sign in again.';
    if (error.status === 403) return error.message || 'You do not have access to that.';
    return error.message;
  }
  if (error instanceof Error) {
    if (/failed to fetch|networkerror|load failed/i.test(error.message)) {
      return 'Could not reach the server. Check your connection and try again.';
    }
    return error.message;
  }
  return 'Something went wrong.';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
    ...init,
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const shape = (payload ?? {}) as ApiErrorShape;
    throw new ApiError(
      response.status,
      shape.error?.message ?? `Request failed (${response.status})`,
      shape.error?.code,
      shape.error?.details,
    );
  }

  return payload as T;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export interface AuthStatus {
  appName: string;
  initialized: boolean;
  registrationOpen: boolean;
  user: SessionUser | null;
}

export interface DashboardResponse {
  generatedAt: string;
  today: string;
  week: string;
  continueReading: { book: BookMeta; progress: BookProgress | null }[];
  recentlyAdded: { book: BookMeta; progress: BookProgress | null }[];
  startedRecently: { book: BookMeta; progress: BookProgress | null }[];
  quoteOfTheDay: Quote | null;
  recentQuotes: Quote[];
  recentlyAnnotated: AnnotationIndexItem[];
  tags: { name: string; count: number }[];
  shelves: string[];
  notebook: {
    date: string;
    streak: number;
    totalDays: number;
    todos: NotebookTodo[];
    remarks: string;
    written: boolean;
    updatedAt: string | null;
  };
  stats: {
    books: number;
    inProgress: number;
    finished: number;
    pagesRead: number;
    annotations: number;
    highlights: number;
    notes: number;
    quotes: number;
    favorites: number;
    annotatedBooks: number;
    notebookDays: number;
    streak: number;
  };
  settings: { theme: UserSettings['theme']; library: UserSettings['library']; quotes: UserSettings['quotes'] };
}

export interface BookDetail {
  book: BookMeta;
  progress: BookProgress | null;
  annotationCount: number;
  annotationRevision: number;
  highlights: number;
  fileUrl: string;
}

export interface NotesResponse {
  annotations: AnnotationIndexItem[];
  total: number;
  offset: number;
  byBook: Record<string, number>;
  byKind: Record<string, number>;
  updatedAt: string;
}

export interface QuotesResponse {
  quotes: Quote[];
  total: number;
  facets: { tags: string[]; authors: string[]; sources: string[] };
  favorites: number;
  updatedAt: string;
}

export interface SettingsResponse {
  settings: UserSettings;
}

export interface NotebookIndexResponse {
  today: string;
  week: string;
  streak: number;
  totalDays: number;
  days: string[];
  weeks: string[];
}

export interface NotebookWeekResponse {
  week: string;
  days: NotebookDay[];
  written: number;
}

export interface InstanceResponse {
  ownerId: string | null;
  registrationOpen: boolean;
  isOwner: boolean;
  createdAt: string;
}

export const api = {
  /* --------------------------------------------------------------------- auth */
  status: () => request<AuthStatus>('/api/auth/status'),
  login: (email: string, password: string) =>
    request<{ user: SessionUser }>('/api/auth/login', { method: 'POST', ...json({ email, password }) }),
  register: (email: string, name: string, password: string) =>
    request<{ user: SessionUser }>('/api/auth/register', { method: 'POST', ...json({ email, name, password }) }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  me: () => request<{ user: SessionUser }>('/api/auth/me'),
  updateProfile: (patch: { name?: string; email?: string }) =>
    request<{ user: SessionUser }>('/api/auth/me', { method: 'PATCH', ...json(patch) }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('/api/auth/password', { method: 'POST', ...json({ currentPassword, newPassword }) }),
  users: () => request<{ users: UserSummary[] }>('/api/auth/users'),

  /* ---------------------------------------------------------------- dashboard */
  dashboard: (date?: string) =>
    request<DashboardResponse>(`/api/dashboard${date ? `?date=${encodeURIComponent(date)}` : ''}`),

  /* ------------------------------------------------------------------ library */
  library: (params: { sort?: string } = {}) =>
    request<{ books: BookMeta[]; updatedAt: string }>(
      `/api/library${params.sort ? `?sort=${encodeURIComponent(params.sort)}` : ''}`,
    ),
  book: (bookId: string) => request<BookDetail>(`/api/library/${encodeURIComponent(bookId)}`),
  uploadBook: (file: File, fields: { title?: string; author?: string; tags?: string; shelf?: string }) => {
    const form = new FormData();
    form.append('file', file);
    for (const [key, value] of Object.entries(fields)) {
      if (value) form.append(key, value);
    }
    return request<{ book: BookMeta }>('/api/library', { method: 'POST', body: form });
  },
  updateBook: (bookId: string, patch: Record<string, unknown>) =>
    request<{ book: BookMeta }>(`/api/library/${encodeURIComponent(bookId)}`, { method: 'PATCH', ...json(patch) }),
  deleteBook: (bookId: string) =>
    request<{ ok: true }>(`/api/library/${encodeURIComponent(bookId)}`, { method: 'DELETE' }),
  reindexLibrary: () =>
    request<{ books: number; annotatedBooks: number }>('/api/library/reindex', { method: 'POST' }),

  /* ----------------------------------------------------------------- progress */
  saveProgress: (bookId: string, page: number, pageCount: number) =>
    request<{ progress: BookProgress }>(`/api/library/${encodeURIComponent(bookId)}/progress`, {
      method: 'PUT',
      ...json({ page, pageCount }),
    }),

  /* -------------------------------------------------------------- annotations */
  bookAnnotations: (bookId: string) =>
    request<{ annotations: AnnotationTransferItemLike[]; revision: number; updatedAt: string }>(
      `/api/library/${encodeURIComponent(bookId)}/annotations`,
    ),
  saveAnnotations: (bookId: string, revision: number, items: AnnotationTransferItemLike[]) =>
    request<{ revision: number; count: number; added: number; updated: number; removed: number; indexRows: number }>(
      `/api/library/${encodeURIComponent(bookId)}/annotations`,
      { method: 'PUT', ...json({ revision, items }) },
    ),
  notes: (params: { bookId?: string; kind?: string; q?: string; markupOnly?: boolean; limit?: number } = {}) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '' && value !== false) search.set(key, String(value));
    }
    const query = search.toString();
    return request<NotesResponse>(`/api/annotations${query ? `?${query}` : ''}`);
  },
  reindexAnnotations: () => request<{ books: number; annotations: number }>('/api/annotations/reindex', { method: 'POST' }),

  /* ------------------------------------------------------------------- quotes */
  quotes: (params: { sort?: string; q?: string; tag?: string; favorite?: boolean } = {}) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '' && value !== false) search.set(key, String(value));
    }
    const query = search.toString();
    return request<QuotesResponse>(`/api/quotes${query ? `?${query}` : ''}`);
  },
  dailyQuote: (date?: string) =>
    request<{ date: string; quote: Quote | null }>(`/api/quotes/daily${date ? `?date=${date}` : ''}`),
  createQuote: (input: { text: string; note?: string; author?: string; source?: string; tags?: string[] }) =>
    request<{ quote: Quote }>('/api/quotes', { method: 'POST', ...json(input) }),
  updateQuote: (quoteId: string, patch: Record<string, unknown>) =>
    request<{ quote: Quote }>(`/api/quotes/${encodeURIComponent(quoteId)}`, { method: 'PATCH', ...json(patch) }),
  deleteQuote: (quoteId: string) =>
    request<{ ok: true }>(`/api/quotes/${encodeURIComponent(quoteId)}`, { method: 'DELETE' }),
  promoteAnnotation: (input: {
    bookId: string;
    annotationId: string;
    text?: string;
    note?: string;
    tags?: string[];
    author?: string;
  }) =>
    request<{ quote: Quote; created: boolean }>('/api/quotes/from-annotation', { method: 'POST', ...json(input) }),

  /* ----------------------------------------------------------------- notebook */
  notebook: (date?: string) =>
    request<NotebookIndexResponse>(`/api/notebook${date ? `?date=${date}` : ''}`),
  notebookToday: (date?: string) =>
    request<{ day: NotebookDay; isEmpty: boolean }>(`/api/notebook/today${date ? `?date=${date}` : ''}`),
  notebookDay: (date: string) =>
    request<{ day: NotebookDay }>(`/api/notebook/day/${encodeURIComponent(date)}`),
  saveNotebookDay: (date: string, payload: { markdown?: string; todos?: NotebookTodo[]; remarks?: string; reflections?: string }) =>
    request<{ day: NotebookDay }>(`/api/notebook/day/${encodeURIComponent(date)}`, {
      method: 'PUT',
      ...json(payload),
    }),
  notebookWeek: (week: string) =>
    request<NotebookWeekResponse>(`/api/notebook/week/${encodeURIComponent(week)}`),
  carryOverTodos: (date: string) =>
    request<{ day: NotebookDay; carried: number }>('/api/notebook/carry-over', { method: 'POST', ...json({ date }) }),

  /* ----------------------------------------------------------------- settings */
  settings: () => request<SettingsResponse>('/api/settings'),
  saveSettings: (patch: Partial<Record<keyof UserSettings, unknown>>) =>
    request<SettingsResponse>('/api/settings', { method: 'PUT', ...json(patch) }),
  instance: () => request<InstanceResponse>('/api/settings/instance'),
  saveInstance: (patch: { registrationOpen?: boolean }) =>
    request<{ registrationOpen: boolean }>('/api/settings/instance', { method: 'PUT', ...json(patch) }),

  /* ------------------------------------------------------------------- export */
  exportAll: () => request<Record<string, unknown>>('/api/export'),
};

/** Triggers a browser download of an in-memory JSON payload. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick so Safari has finished reading the blob.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
