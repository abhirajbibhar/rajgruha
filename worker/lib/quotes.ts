/**
 * Quote collection helpers.
 *
 * The collection is a single JSON file so it stays trivially portable, and the
 * "quote of the day" is derived rather than stored - the same date always picks
 * the same quote on every device, with no cron job and no extra state to keep in
 * sync.
 */
import type { Quote, QuoteOrigin } from './types';
import { newId } from './keys';

export interface QuoteInput {
  text: string;
  note?: string;
  author?: string;
  source?: string;
  tags?: string[];
  favorite?: boolean;
  origin?: QuoteOrigin | null;
}

export function createQuote(input: QuoteInput, now: Date): Quote {
  const timestamp = now.toISOString();
  return {
    id: newId(),
    text: input.text,
    note: input.note ?? '',
    author: input.author ?? '',
    source: input.source ?? '',
    tags: input.tags ?? [],
    favorite: input.favorite ?? false,
    createdAt: timestamp,
    updatedAt: timestamp,
    origin: input.origin ?? null,
  };
}

/** FNV-1a, used only to turn a date string into a stable index. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Picks today's quote. Favourites are preferred but the whole collection is
 * eligible, so a small collection still rotates instead of repeating one line.
 */
export function pickQuoteOfTheDay(quotes: Quote[], date: string, seed = ''): Quote | null {
  if (quotes.length === 0) return null;
  const favourites = quotes.filter((quote) => quote.favorite);
  const pool = favourites.length > 0 && favourites.length * 2 < quotes.length ? favourites : quotes;
  const sorted = [...pool].sort((a, b) => a.id.localeCompare(b.id));
  const index = hashString(`${date}:${seed}:${quotes.length}`) % sorted.length;
  return sorted[index] ?? null;
}

/** Distinct tags and authors, for the filter chips on the quote page. */
export function quoteFacets(quotes: Quote[]): { tags: string[]; authors: string[]; sources: string[] } {
  const tags = new Set<string>();
  const authors = new Set<string>();
  const sources = new Set<string>();
  for (const quote of quotes) {
    for (const tag of quote.tags) tags.add(tag);
    if (quote.author) authors.add(quote.author);
    if (quote.source) sources.add(quote.source);
  }
  return {
    tags: [...tags].sort(),
    authors: [...authors].sort(),
    sources: [...sources].sort(),
  };
}

/** Newest first, favourites optionally lifted to the top. */
export function sortQuotes(quotes: Quote[], sortBy: string): Quote[] {
  const copy = [...quotes];
  switch (sortBy) {
    case 'author':
      copy.sort((a, b) => a.author.localeCompare(b.author) || a.text.localeCompare(b.text));
      break;
    case 'oldest':
      copy.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      break;
    default:
      copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return copy;
}
