/**
 * On-disk shapes. These are the contract with the bucket: written as plain JSON
 * with a `version` field so a future reader can migrate them without guessing,
 * and documented in the README.
 */

/** The signed-in user as the client sees them. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'member';
  isOwner: boolean;
}

export interface PasswordHash {
  algo: 'PBKDF2-SHA256';
  /** Stored per user so the cost can be raised later without invalidating old hashes. */
  iterations: number;
  salt: string;
  hash: string;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'member';
  createdAt: string;
  updatedAt: string;
  password: PasswordHash;
}

export interface UserSummary {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'member';
  createdAt: string;
}

export interface UsersIndex {
  version: 1;
  users: UserSummary[];
}

export interface InstanceConfig {
  version: 1;
  /** Creator of the instance. Only the owner may change registration. */
  ownerId: string | null;
  /** Set to false once you are done adding accounts. */
  registrationOpen: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BookMeta {
  id: string;
  title: string;
  author: string;
  description: string;
  tags: string[];
  shelf: string;
  favorite: boolean;
  filename: string;
  bytes: number;
  pageCount: number | null;
  addedAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  finishedAt: string | null;
}

export interface LibraryIndex {
  version: 1;
  updatedAt: string;
  books: BookMeta[];
}

export interface BookProgress {
  version: 1;
  bookId: string;
  page: number;
  pageCount: number | null;
  percent: number;
  updatedAt: string;
}

/**
 * One annotation as EmbedPDF exports it. The server deliberately keeps this
 * opaque (minus the handful of fields used to build the searchable index) so an
 * EmbedPDF upgrade cannot break stored annotations.
 */
export interface RawAnnotation {
  id?: string;
  type?: number;
  pageIndex?: number;
  contents?: string;
  author?: string;
  created?: string;
  modified?: string;
  color?: string;
  strokeColor?: string;
  custom?: Record<string, unknown> & { rajgruha?: { text?: string; note?: string } };
  [key: string]: unknown;
}

export interface AnnotationTransferItem {
  annotation: RawAnnotation;
  ctx?: unknown;
}

export interface BookAnnotations {
  version: 1;
  bookId: string;
  /** Incremented on every accepted write; used to detect concurrent edits. */
  revision: number;
  updatedAt: string;
  items: AnnotationTransferItem[];
}

/** Compact, denormalised annotation used by the Notes & Highlights page. */
export interface AnnotationIndexItem {
  id: string;
  bookId: string;
  bookTitle: string;
  /** Friendly kind: highlight, underline, note, ink, text, ... */
  kind: string;
  /** Raw PdfAnnotationSubtype. */
  type: number;
  page: number;
  color: string | null;
  /** The text that was highlighted or written. May be null when unavailable. */
  text: string | null;
  /** The user's note / comment on the annotation. */
  note: string | null;
  author: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Set when this annotation was promoted into the quote collection. */
  quoteId: string | null;
}

export interface AnnotationsIndex {
  version: 1;
  updatedAt: string;
  books: Record<
    string,
    {
      bookTitle: string;
      count: number;
      updatedAt: string;
      items: AnnotationIndexItem[];
    }
  >;
}

export interface QuoteOrigin {
  bookId: string;
  bookTitle: string;
  page: number | null;
  annotationId: string;
  annotationKind: string;
}

export interface Quote {
  id: string;
  text: string;
  /** Optional personal note, e.g. the comment attached to the source annotation. */
  note: string;
  author: string;
  source: string;
  tags: string[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  /** Present when the quote came from a PDF annotation. */
  origin: QuoteOrigin | null;
}

export interface QuoteCollection {
  version: 1;
  updatedAt: string;
  quotes: Quote[];
}

export interface UserSettings {
  version: 1;
  updatedAt: string;
  theme: 'light' | 'dark' | 'system';
  reader: {
    annotationAuthor: string;
    highlightColor: string;
    scrollStrategy: 'vertical' | 'horizontal';
    defaultZoom: string;
    showThumbnails: boolean;
    autosaveSeconds: number;
  };
  notebook: {
    carryOverTodos: boolean;
    showWeek: boolean;
  };
  quotes: {
    quoteOfTheDay: boolean;
    compactLayout: boolean;
  };
  library: {
    sortBy: 'recent' | 'title' | 'author' | 'added';
    view: 'grid' | 'list';
  };
}

export interface NotebookTodo {
  text: string;
  done: boolean;
}

export interface NotebookDay {
  version: 1;
  date: string;
  week: string;
  markdown: string;
  todos: NotebookTodo[];
  remarks: string;
  reflections: string;
  updatedAt: string | null;
}
