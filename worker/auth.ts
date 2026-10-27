/**
 * Authentication: PBKDF2 password hashes and signed, HttpOnly cookie sessions.
 *
 * `jose` was already in the pinned dependency set, so sessions are standard
 * HS256 JWTs - nothing exotic, verifiable by any JWT library, and the secret is
 * the only thing that has to survive a migration.
 */
import { jwtVerify, SignJWT } from 'jose';
import type { Context, MiddlewareHandler, Next } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv, SessionUser } from './env';
import { unauthorized } from './lib/http';
import { keys } from './lib/keys';
import type { PasswordHash, UserRecord } from './lib/types';

export const SESSION_COOKIE = 'rajgruha_session';
export const SESSION_DAYS = 30;
const DEFAULT_ITERATIONS = 210_000;
const MIN_PASSWORD_LENGTH = 10;

/** Algorithm parameters for the hash of newly created or changed passwords. */
export function passwordPolicy(iterations: number | undefined): number {
  const parsed = Number(iterations);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_ITERATIONS;
  return Math.min(1_000_000, Math.max(1_000, Math.round(parsed)));
}

export function assertPasswordAcceptable(password: string): void {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw Object.assign(new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`), { status: 400 });
  }
  if (password.length > 200) {
    throw Object.assign(new Error('Password must be at most 200 characters'), { status: 400 });
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] as number);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Length-independent comparison, to avoid leaking a hash prefix by timing. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let difference = 0;
  for (let i = 0; i < a.byteLength; i += 1) difference |= (a[i] as number) ^ (b[i] as number);
  return difference === 0;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as unknown as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(
  password: string,
  iterations = DEFAULT_ITERATIONS,
  salt?: Uint8Array,
): Promise<PasswordHash> {
  assertPasswordAcceptable(password);
  const useSalt = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const derived = await derive(password, useSalt, iterations);
  return {
    algo: 'PBKDF2-SHA256',
    iterations,
    salt: bytesToBase64(useSalt),
    hash: bytesToBase64(derived),
  };
}

export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  if (!stored || stored.algo !== 'PBKDF2-SHA256' || !stored.salt || !stored.hash) return false;
  try {
    const derived = await derive(password, base64ToBytes(stored.salt), stored.iterations);
    return timingSafeEqual(derived, base64ToBytes(stored.hash));
  } catch {
    return false;
  }
}

function secretKey(secret: string): Uint8Array {
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET is missing or too short (use at least 32 random characters)');
  }
  return new TextEncoder().encode(secret);
}

export interface SessionClaims {
  sub: string;
}

export async function signSession(userId: string, secret: string, now: Date): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({ scope: 'session' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + SESSION_DAYS * 86_400)
    .sign(secretKey(secret));
}

export async function verifySession(token: string, secret: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), { algorithms: ['HS256'] });
    if (payload.scope !== 'session' || typeof payload.sub !== 'string') return null;
    return { sub: payload.sub };
  } catch {
    return null;
  }
}

/**
 * A short-lived token that authorises reading one book's bytes.
 *
 * The PDF viewer issues its own range requests, and a signed URL is the only way
 * to guarantee those carry credentials no matter how the library's internal
 * fetcher is configured. It is scoped to a single book and expires.
 */
export async function signFileToken(userId: string, bookId: string, secret: string, now: Date, ttlSeconds = 7200): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({ scope: 'file', bid: bookId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ttlSeconds)
    .sign(secretKey(secret));
}

export async function verifyFileToken(token: string, bookId: string, secret: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), { algorithms: ['HS256'] });
    if (payload.scope !== 'file' || typeof payload.sub !== 'string' || payload.bid !== bookId) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

export function cookieOptions(env: { COOKIE_SECURE?: string }) {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE === 'false' ? false : true,
    sameSite: 'Lax' as const,
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  };
}

export async function setSessionCookie(
  c: Context<AppEnv>,
  userId: string,
  now: Date,
): Promise<void> {
  const token = await signSession(userId, c.env.SESSION_SECRET, now);
  setCookie(c, SESSION_COOKIE, token, cookieOptions(c.env));
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

async function loadUserRecord(c: Context<AppEnv>, userId: string): Promise<UserRecord | null> {
  const object = await c.get('store').get(keys.user(userId));
  if (!object) return null;
  try {
    return JSON.parse(await object.text()) as UserRecord;
  } catch {
    return null;
  }
}

/**
 * Resolves the caller, if any. The user record is re-read on every request so a
 * deleted or renamed account takes effect immediately rather than at cookie
 * expiry - one extra GET is a cheap price for that.
 */
export async function currentUser(c: Context<AppEnv>): Promise<SessionUser | null> {
  const header = c.req.header('authorization');
  const bearer = header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
  const token = bearer ?? getCookie(c, SESSION_COOKIE);
  if (!token) return null;

  const claims = await verifySession(token, c.env.SESSION_SECRET);
  if (!claims) return null;

  const record = await loadUserRecord(c, claims.sub);
  if (!record) return null;

  return {
    id: record.id,
    email: record.email,
    name: record.name,
    role: record.role,
    isOwner: record.role === 'owner',
  };
}

export function requireUser(): MiddlewareHandler<AppEnv> {
  return async (c: Context<AppEnv>, next: Next) => {
    const user = await currentUser(c);
    if (!user) throw unauthorized();
    c.set('user', user);
    await next();
  };
}

export function requireOwner(): MiddlewareHandler<AppEnv> {
  return async (c: Context<AppEnv>, next: Next) => {
    if (!c.get('user')?.isOwner) {
      throw Object.assign(new Error('Only the instance owner can do that'), { status: 403 });
    }
    await next();
  };
}
