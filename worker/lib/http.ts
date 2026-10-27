/**
 * Small helpers shared by every route.
 *
 * No validation library and no schema framework: fewer dependencies is the
 * whole point of this project's durability goal, and a handful of explicit
 * helpers are easier to keep working than a validator that gets a major bump.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const unauthorized = (message = 'Not signed in') => new HttpError(401, message);
export const forbidden = (message = 'Not allowed') => new HttpError(403, message);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const conflict = (message: string, details?: unknown) => new HttpError(409, message, details);
export const tooLarge = (message: string) => new HttpError(413, message);

export interface JsonObject {
  [key: string]: unknown;
}

/** Reads a JSON body, rejecting anything that is not a plain object. */
export async function readJson(request: Request): Promise<JsonObject> {
  const text = await request.text();
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw badRequest('Request body is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw badRequest('Request body must be a JSON object');
  }
  return parsed as JsonObject;
}

export function asString(value: unknown, field: string, options: { max?: number; required?: boolean } = {}): string {
  const { max = 2000, required = true } = options;
  if (value === undefined || value === null) {
    if (required) throw badRequest(`"${field}" is required`);
    return '';
  }
  if (typeof value !== 'string') throw badRequest(`"${field}" must be a string`);
  const trimmed = value.trim();
  if (required && !trimmed) throw badRequest(`"${field}" must not be empty`);
  if (trimmed.length > max) throw badRequest(`"${field}" must be at most ${max} characters`);
  return trimmed;
}

export function asBool(value: unknown, field: string, fallback = false): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw badRequest(`"${field}" must be true or false`);
  return value;
}

export function asInt(value: unknown, field: string, options: { min?: number; max?: number; fallback?: number } = {}): number {
  const { min = -Infinity, max = Infinity, fallback } = options;
  if (value === undefined || value === null) {
    if (fallback === undefined) throw badRequest(`"${field}" is required`);
    return fallback;
  }
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) throw badRequest(`"${field}" must be a number`);
  const rounded = Math.round(num);
  if (rounded < min || rounded > max) throw badRequest(`"${field}" must be between ${min} and ${max}`);
  return rounded;
}

export function asStringArray(value: unknown, field: string, maxItems = 50): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest(`"${field}" must be an array of strings`);
  const out: string[] = [];
  for (const entry of value) {
    const item = asString(entry, `${field}[]`, { max: 80 });
    if (item && !out.includes(item)) out.push(item);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** Constrains a value to a known set of options. */
export function asEnum<T extends string>(value: unknown, field: string, allowed: readonly T[], fallback: T): T {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw badRequest(`"${field}" must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_WEEK = /^\d{4}-W\d{2}$/;

export function asIsoDate(value: unknown, field = 'date'): string {
  const date = asString(value, field, { max: 10 });
  if (!ISO_DATE.test(date)) throw badRequest(`"${field}" must look like YYYY-MM-DD`);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(date)) {
    throw badRequest(`"${field}" is not a real calendar date`);
  }
  return date;
}

export function asIsoWeek(value: unknown, field = 'week'): string {
  const week = asString(value, field, { max: 8 });
  if (!ISO_WEEK.test(week)) throw badRequest(`"${field}" must look like YYYY-Www`);
  const number = Number(week.slice(6));
  if (number < 1 || number > 53) throw badRequest(`"${field}" week number must be 01-53`);
  return week;
}

/** Clamps a value that the server is willing to trust only as a hint. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Escapes a string for use inside a markdown heading or inline text. */
export function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]<>])/g, '\\$1').replace(/\r?\n/g, ' ');
}
