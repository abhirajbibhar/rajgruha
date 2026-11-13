import { z } from 'zod';

export const BookFormat = z.enum(['epub', 'pdf', 'audio']);
export type BookFormat = z.infer<typeof BookFormat>;

export const ReadingStatus = z.enum(['queued', 'reading', 'finished']);
export type ReadingStatus = z.infer<typeof ReadingStatus>;

export const UserRole = z.enum(['admin', 'member']);
export type UserRole = z.infer<typeof UserRole>;


// ── Users / auth ────────────────────────────────────────────────
export const UserSchema = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string(),
  role: UserRole
});
export type User = z.infer<typeof UserSchema>;

export const LoginInput = z.object({
  email: z.email(),
  password: z.string().min(1)
});
export type LoginInput = z.infer<typeof LoginInput>;

// ── Books ───────────────────────────────────────────────────────
export const TocItem = z.object({
  label: z.string(),
  /** EPUB-internal href, passed straight to the reader. */
  href: z.string(),
  level: z.number().int().min(0).max(6).default(0)
});
export type TocItem = z.infer<typeof TocItem>;

export const BookInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  author: z.string().min(1),
  series: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  publisher: z.string().nullable().default(null),
  publishedYear: z.number().int().nullable().default(null),
  pages: z.number().int().positive().nullable().default(null),
  language: z.string().default('en'),
  isbn: z.string().nullable().default(null),
  format: BookFormat,
  genres: z.array(z.string()).default([]),
  rating: z.number().min(0).max(5).default(0),
  ratingCount: z.number().int().nonnegative().default(0),
  /** Public path or URL of the cover image. */
  cover: z.string().nullable().default(null),
  /** R2 object key of the EPUB/PDF file, when uploaded. */
  fileKey: z.string().nullable().default(null),
  /** Chapters, extracted from the EPUB at upload time. */
  toc: z.array(TocItem).default([])
});
export type BookInput = z.input<typeof BookInput>;

export const ProgressSchema = z.object({
  status: ReadingStatus,
  /** 0–100 */
  percent: z.number().min(0).max(100),
  /** EPUB CFI string or PDF page number, depending on format. */
  location: z.string().nullable(),
  updatedAt: z.string()
});
export type Progress = z.infer<typeof ProgressSchema>;

export const ProgressInput = z.object({
  status: ReadingStatus.optional(),
  percent: z.number().min(0).max(100),
  location: z.string().max(2000).nullable().optional()
});
export type ProgressInput = z.infer<typeof ProgressInput>;

export const BookSchema = BookInput.required({
  series: true,
  description: true,
  publisher: true,
  publishedYear: true,
  pages: true,
  language: true,
  isbn: true,
  genres: true,
  rating: true,
  ratingCount: true,
  cover: true,
  fileKey: true,
  toc: true
}).extend({
  id: z.string(),
  addedAt: z.string(),
  progress: ProgressSchema.nullable()
});
export type Book = z.infer<typeof BookSchema>;

export const BookSort = z.enum(['recent', 'title', 'author', 'rating', 'popular', 'format', 'pages', 'status', 'genre']);
export type BookSort = z.infer<typeof BookSort>;

export const BookListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  format: BookFormat.optional(),
  genre: z.string().optional(),
  status: ReadingStatus.optional(),
  sort: BookSort.default('recent'),
  /** Overrides the default direction of the chosen sort. */
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24)
});
export type BookListQuery = z.infer<typeof BookListQuery>;

export const BookListSchema = z.object({
  items: z.array(BookSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int()
});
export type BookList = z.infer<typeof BookListSchema>;

export const StatsSchema = z.object({
  totalBooks: z.number().int(),
  byFormat: z.record(z.string(), z.number().int()),
  addedThisMonth: z.number().int(),
  reading: z.number().int(),
  finished: z.number().int(),
  queued: z.number().int()
});
export type Stats = z.infer<typeof StatsSchema>;

// Partial update (PATCH). Deliberately no defaults, so omitted fields stay untouched.
export const BookPatch = z.object({
  title: z.string().min(1).optional(),
  author: z.string().min(1).optional(),
  series: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  publisher: z.string().nullable().optional(),
  publishedYear: z.number().int().nullable().optional(),
  pages: z.number().int().positive().nullable().optional(),
  language: z.string().optional(),
  isbn: z.string().nullable().optional(),
  genres: z.array(z.string()).optional(),
  toc: z.array(TocItem).optional()
});
export type BookPatch = z.infer<typeof BookPatch>;

// ── Reading log ─────────────────────────────────────────────────
/** A calendar day in the reader's local time, YYYY-MM-DD. */
export const DayStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const MonthStr = z.string().regex(/^\d{4}-\d{2}$/);

export const SessionInput = z.object({
  bookId: z.string(),
  day: DayStr,
  startedAt: z.string(),
  durationS: z.number().int().min(0).max(86_400),
  startPercent: z.number().min(0).max(100),
  endPercent: z.number().min(0).max(100)
});
export type SessionInput = z.infer<typeof SessionInput>;

export const BookBrief = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  author: z.string(),
  cover: z.string().nullable(),
  format: BookFormat
});
export type BookBrief = z.infer<typeof BookBrief>;

export const SessionSchema = z.object({
  id: z.string(),
  book: BookBrief,
  day: DayStr,
  startedAt: z.string(),
  durationS: z.number().int(),
  startPercent: z.number(),
  endPercent: z.number()
});
export type ReadingSession = z.infer<typeof SessionSchema>;

export const NoteKind = z.enum(['note', 'task']);
export const NoteInput = z.object({ day: DayStr, kind: NoteKind, text: z.string().trim().min(1).max(500) });
export const NotePatch = z.object({ done: z.boolean().optional(), text: z.string().trim().min(1).max(500).optional() });
export const NoteSchema = z.object({
  id: z.string(),
  day: DayStr,
  kind: NoteKind,
  text: z.string(),
  done: z.boolean(),
  createdAt: z.string()
});
export type Note = z.infer<typeof NoteSchema>;

export const MonthLogSchema = z.object({
  month: MonthStr,
  totalMinutes: z.number(),
  days: z.array(z.object({ day: DayStr, minutes: z.number(), sessions: z.number().int(), notes: z.number().int(), tasksOpen: z.number().int() }))
});
export type MonthLog = z.infer<typeof MonthLogSchema>;

export const DayLogSchema = z.object({
  day: DayStr,
  minutes: z.number(),
  sessions: z.array(SessionSchema),
  notes: z.array(NoteSchema)
});
export type DayLog = z.infer<typeof DayLogSchema>;

export const AnalyticsSchema = z.object({
  days: z.number().int(),
  totals: z.object({
    minutes: z.number(),
    sessions: z.number().int(),
    activeDays: z.number().int(),
    avgSessionMinutes: z.number(),
    currentStreak: z.number().int(),
    longestStreak: z.number().int(),
    booksFinished: z.number().int()
  }),
  daily: z.array(z.object({ day: DayStr, minutes: z.number() })),
  byFormat: z.array(z.object({ format: z.string(), minutes: z.number() })),
  byGenre: z.array(z.object({ genre: z.string(), minutes: z.number() })),
  topBooks: z.array(z.object({ book: BookBrief, minutes: z.number() })),
  finishedByMonth: z.array(z.object({ month: MonthStr, count: z.number().int() }))
});
export type Analytics = z.infer<typeof AnalyticsSchema>;

// ── Files (R2) ──────────────────────────────────────────────────
export const FILES_ROOT = 'library/';

export const FileListSchema = z.object({
  /** Current folder, relative to the library root ('' for the root). */
  prefix: z.string(),
  folders: z.array(z.object({ name: z.string(), prefix: z.string() })),
  files: z.array(z.object({
    key: z.string(),
    name: z.string(),
    size: z.number(),
    uploaded: z.string(),
    book: BookBrief.nullable()
  }))
});
export type FileList = z.infer<typeof FileListSchema>;

// ── Members & accounts ──────────────────────────────────────────
export const PASSWORD_MIN = 10;
const Password = z.string().min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`).max(200);

export const MemberSchema = UserSchema.extend({ createdAt: z.string() });
export type Member = z.infer<typeof MemberSchema>;

export const MemberCreateInput = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(100),
  role: UserRole.default('member'),
  password: Password
});
export type MemberCreateInput = z.input<typeof MemberCreateInput>;

export const MemberPatch = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  email: z.email().optional(),
  role: UserRole.optional(),
  /** Resets the password and signs the member out everywhere. */
  password: Password.optional()
});
export type MemberPatch = z.infer<typeof MemberPatch>;

export const ProfilePatch = z.object({ name: z.string().trim().min(1).max(100) });
export const PasswordChangeInput = z.object({ current: z.string().min(1), next: Password });

// ── Acquisitions ────────────────────────────────────────────────
export const AcquisitionStatus = z.enum(['requested', 'evaluating', 'ordered', 'received', 'declined']);
export type AcquisitionStatus = z.infer<typeof AcquisitionStatus>;
export const AcquisitionPriority = z.enum(['low', 'normal', 'high']);

export const AcquisitionInput = z.object({
  title: z.string().trim().min(1).max(200),
  author: z.string().trim().max(200).nullable().default(null),
  isbn: z.string().trim().max(20).nullable().default(null),
  notes: z.string().trim().max(1000).nullable().default(null),
  priority: AcquisitionPriority.default('normal')
});
export type AcquisitionInput = z.input<typeof AcquisitionInput>;

export const AcquisitionPatch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  author: z.string().trim().max(200).nullable().optional(),
  isbn: z.string().trim().max(20).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  priority: AcquisitionPriority.optional(),
  status: AcquisitionStatus.optional(),
  /** Sort key inside the column (the board sends the midpoint between neighbours). */
  position: z.number().finite().optional()
});
export type AcquisitionPatch = z.infer<typeof AcquisitionPatch>;

export const AcquisitionSchema = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string().nullable(),
  isbn: z.string().nullable(),
  notes: z.string().nullable(),
  status: AcquisitionStatus,
  priority: AcquisitionPriority,
  position: z.number(),
  requestedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Acquisition = z.infer<typeof AcquisitionSchema>;

// ── Catalog facets (filter options come from the real data) ─────
export const FacetsSchema = z.object({
  genres: z.array(z.object({ name: z.string(), count: z.number().int() })),
  formats: z.array(z.object({ format: BookFormat, count: z.number().int() }))
});
export type Facets = z.infer<typeof FacetsSchema>;
