import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { SignJWT, jwtVerify } from 'jose';
import { UserSchema, type User } from '@rajgruha/shared';
import type { AppEnv } from './types';

export { hashPassword, verifyPassword } from '@rajgruha/shared';

export const SESSION_COOKIE = 'rg_session';
const SESSION_TTL_S = 60 * 60 * 24 * 14; // 14 days

// ── Session tokens ───────────────────────────────────────────────
const secretKey = (secret: string) => new TextEncoder().encode(secret);

export const sessionMaxAge = SESSION_TTL_S;

export async function signSession(user: User, tokenVersion: number, secret: string): Promise<string> {
  return new SignJWT({ tv: tokenVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_S}s`)
    .sign(secretKey(secret));
}

async function readClaims(token: string, secret: string): Promise<{ sub: string; tv: number } | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), { algorithms: ['HS256'] });
    return typeof payload.sub === 'string' ? { sub: payload.sub, tv: Number(payload.tv ?? 0) } : null;
  } catch {
    return null;
  }
}

/**
 * Accepts the HttpOnly session cookie (browser) or `Authorization: Bearer` (scripts). The token only proves
 * who you are; name and role come from the database on every request, so a deleted user, a demoted admin or a
 * password reset takes effect immediately rather than after the token expires.
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : getCookie(c, SESSION_COOKIE);
  const claims = token ? await readClaims(token, c.env.JWT_SECRET) : null;
  const row = claims
    ? await c.env.DB.prepare('SELECT id, email, name, role, token_version FROM users WHERE id = ?1').bind(claims.sub).first<{ id: string; email: string; name: string; role: 'admin' | 'member'; token_version: number }>()
    : null;
  const user = row && row.token_version === claims!.tv ? UserSchema.safeParse({ id: row.id, email: row.email, name: row.name, role: row.role }) : null;
  if (!user?.success) throw new HTTPException(401, { message: 'Not signed in' });
  c.set('user', user.data);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('user').role !== 'admin') throw new HTTPException(403, { message: 'Admins only' });
  await next();
};
