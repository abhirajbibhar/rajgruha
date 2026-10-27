/**
 * Every R2 key in the system is built here.
 *
 * The layout is documented in the README and is intended to be readable and
 * browsable with any S3 tool: if the app disappears, the bucket still makes
 * sense and the data is still usable.
 *
 *   config.json                                  instance config (owner, registration)
 *   users/index.json                             list of user summaries
 *   users/<userId>.json                          user record including password hash
 *   users/by-email/<sha256(email)>.json          email -> userId lookup
 *   u/<userId>/settings.json                     per-user preferences
 *   u/<userId>/quotes.json                       quote collection
 *   u/<userId>/index/library.json                derived: library listing (fast list)
 *   u/<userId>/index/annotations.json            derived: notes & highlights index
 *   u/<userId>/library/<bookId>/meta.json        book metadata (source of truth)
 *   u/<userId>/library/<bookId>/book.pdf         the PDF itself
 *   u/<userId>/library/<bookId>/annotations.json raw EmbedPDF annotation transfer items
 *   u/<userId>/library/<bookId>/progress.json    reading position
 *   u/<userId>/notebook/<YYYY-Www>/<date>.md     one markdown file per day
 */

/** RFC4122 v4 id from the runtime CSPRNG. */
export function newId(): string {
  return crypto.randomUUID();
}

/** Stable, collision-resistant key for email lookup, so login never reads an index. */
export async function emailKey(email: string): Promise<string> {
  const normalised = email.trim().toLowerCase();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalised));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const keys = {
  instanceConfig: () => 'config.json',
  usersIndex: () => 'users/index.json',
  user: (userId: string) => `users/${userId}.json`,
  userByEmail: (hashedEmail: string) => `users/by-email/${hashedEmail}.json`,

  userPrefix: (userId: string) => `u/${userId}/`,
  settings: (userId: string) => `u/${userId}/settings.json`,
  quotes: (userId: string) => `u/${userId}/quotes.json`,
  libraryIndex: (userId: string) => `u/${userId}/index/library.json`,
  annotationsIndex: (userId: string) => `u/${userId}/index/annotations.json`,

  libraryPrefix: (userId: string) => `u/${userId}/library/`,
  bookPrefix: (userId: string, bookId: string) => `u/${userId}/library/${bookId}/`,
  bookMeta: (userId: string, bookId: string) => `u/${userId}/library/${bookId}/meta.json`,
  bookFile: (userId: string, bookId: string) => `u/${userId}/library/${bookId}/book.pdf`,
  bookAnnotations: (userId: string, bookId: string) => `u/${userId}/library/${bookId}/annotations.json`,
  bookProgress: (userId: string, bookId: string) => `u/${userId}/library/${bookId}/progress.json`,

  notebookPrefix: (userId: string) => `u/${userId}/notebook/`,
  notebookWeekPrefix: (userId: string, week: string) => `u/${userId}/notebook/${week}/`,
  notebookDay: (userId: string, week: string, date: string) => `u/${userId}/notebook/${week}/${date}.md`,

  /** Extracts the book id from a stored object key, or null when it is not a book key. */
  bookIdFromKey(userId: string, key: string): string | null {
    const prefix = `u/${userId}/library/`;
    if (!key.startsWith(prefix)) return null;
    const rest = key.slice(prefix.length);
    const slash = rest.indexOf('/');
    return slash > 0 ? rest.slice(0, slash) : null;
  },
};
