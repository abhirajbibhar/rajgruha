/** Small formatting helpers shared by the pages. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Parses a `YYYY-MM-DD` string as a local calendar date, avoiding UTC drift. */
export function parseLocalDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Today in the browser's timezone, which is the date the user thinks it is. */
export function todayIso(): string {
  return toIsoDate(new Date());
}

export function formatDate(input: string | null | undefined): string {
  if (!input) return '';
  const date = input.length === 10 ? parseLocalDate(input) : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatShortDate(input: string | null | undefined): string {
  if (!input) return '';
  const date = input.length === 10 ? parseLocalDate(input) : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

export function weekdayLong(date: string): string {
  return WEEKDAYS[parseLocalDate(date).getDay()] ?? '';
}

export function weekdayShort(date: string): string {
  return WEEKDAYS_SHORT[parseLocalDate(date).getDay()] ?? '';
}

/** "3 minutes ago", "yesterday", "12 Mar 2026" - whichever is most useful. */
export function relativeTime(input: string | null | undefined): string {
  if (!input) return '';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);

  if (seconds < 45) return 'just now';
  if (seconds < 90) return 'a minute ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return formatDate(input);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

/** "12 of 340 pages" reads better than a bare number everywhere it is used. */
export function formatProgress(page: number, pageCount: number | null): string {
  if (!pageCount) return `Page ${page + 1}`;
  return `Page ${Math.min(page + 1, pageCount)} of ${pageCount}`;
}

/** Deterministic pastel cover for a book, derived from its id so it never changes. */
export function coverGradient(seed: string): { background: string; color: string } {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  }
  const hue = hash;
  return {
    background: `linear-gradient(145deg, hsl(${hue} 34% 34%), hsl(${(hue + 42) % 360} 40% 22%))`,
    color: '#fdfaf4',
  };
}

export function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase();
  return `${(words[0] ?? '').charAt(0)}${(words[1] ?? '').charAt(0)}`.toUpperCase();
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

/** Clamps long text for previews without breaking words. */
export function excerpt(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, clean.lastIndexOf(' ', max)))}…`;
}

/** Normalises a hex colour that came out of a PDF annotation into #rrggbb. */
export function normaliseHex(value: string | null | undefined, fallback = 'var(--accent)'): string {
  if (!value) return fallback;
  const hex = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(hex);
  if (rgba?.[1]) {
    const parts = rgba[1].split(',').map((part) => Number(part.trim()));
    if (parts.length >= 3 && parts.every((part) => Number.isFinite(part))) {
      return `#${parts
        .slice(0, 3)
        .map((part) => Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, '0'))
        .join('')}`;
    }
  }
  return fallback;
}
