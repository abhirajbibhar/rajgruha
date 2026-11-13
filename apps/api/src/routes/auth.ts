import { Hono, type Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { LoginInput, PasswordChangeInput, ProfilePatch, UserSchema, hashPassword } from '@rajgruha/shared';
import { SESSION_COOKIE, requireAuth, sessionMaxAge, signSession, verifyPassword } from '../auth';
import type { AppEnv } from '../types';

export const authRoutes = new Hono<AppEnv>();

type UserRow = { id: string; email: string; name: string; role: 'admin' | 'member'; password_hash: string; token_version: number };

// Verified against a throwaway hash when the email is unknown, so response time
// doesn't reveal which emails exist.
const DUMMY_HASH = 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

async function startSession(c: Context<AppEnv>, user: { id: string; email: string; name: string; role: 'admin' | 'member' }, tokenVersion: number) {
  const token = await signSession(UserSchema.parse(user), tokenVersion, c.env.JWT_SECRET);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: sessionMaxAge
  });
}

authRoutes.post('/login', async (c) => {
  const body = LoginInput.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw new HTTPException(400, { message: 'Email and password are required' });

  const row = await c.env.DB.prepare('SELECT id, email, name, role, password_hash, token_version FROM users WHERE email = ?1')
    .bind(body.data.email)
    .first<UserRow>();

  const ok = await verifyPassword(body.data.password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) throw new HTTPException(401, { message: 'Incorrect email or password' });

  await startSession(c, row, row.token_version);
  return c.json({ user: UserSchema.parse(row) });
});

authRoutes.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

authRoutes.get('/me', requireAuth, (c) => c.json({ user: c.get('user') }));

authRoutes.patch('/me', requireAuth, async (c) => {
  const body = ProfilePatch.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw new HTTPException(400, { message: 'Enter a name (1–100 characters)' });
  const me = c.get('user');
  await c.env.DB.prepare('UPDATE users SET name = ?1 WHERE id = ?2').bind(body.data.name, me.id).run();
  return c.json({ user: { ...me, name: body.data.name } });
});

// Change your own password. Every other device is signed out; this one gets a fresh token.
authRoutes.post('/password', requireAuth, async (c) => {
  const body = PasswordChangeInput.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw new HTTPException(400, { message: body.error.issues[0]?.message ?? 'Invalid password' });
  const me = c.get('user');
  const row = await c.env.DB.prepare('SELECT password_hash, token_version FROM users WHERE id = ?1').bind(me.id).first<{ password_hash: string; token_version: number }>();
  if (!row || !(await verifyPassword(body.data.current, row.password_hash))) throw new HTTPException(403, { message: 'Your current password is incorrect' });
  if (body.data.next === body.data.current) throw new HTTPException(400, { message: 'Choose a password different from the current one' });

  const version = row.token_version + 1;
  await c.env.DB.prepare('UPDATE users SET password_hash = ?1, token_version = ?2 WHERE id = ?3').bind(await hashPassword(body.data.next), version, me.id).run();
  await startSession(c, me, version);
  return c.json({ ok: true });
});

// Sign out of every device, including this one.
authRoutes.post('/logout-all', requireAuth, async (c) => {
  await c.env.DB.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?1').bind(c.get('user').id).run();
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});
