/**
 * Accounts and sessions.
 *
 * Multi-user, but bootstrapped safely: the instance starts with registration
 * open so the first person to sign up becomes the owner, and that registration
 * closes immediately after. Existing users can still be added by the owner from
 * the settings page.
 */
import { Hono } from 'hono';
import {
  assertPasswordAcceptable,
  clearSessionCookie,
  currentUser,
  hashPassword,
  passwordPolicy,
  requireUser,
  setSessionCookie,
  verifyPassword,
} from '../auth';
import type { AppEnv, SessionUser } from '../env';
import { asString, badRequest, conflict, forbidden, readJson, unauthorized } from '../lib/http';
import { emailKey, keys, newId } from '../lib/keys';
import {
  findUserByEmail,
  getInstanceConfig,
  getSettings,
  getUser,
  getUsersIndex,
  putEmailPointer,
  putInstanceConfig,
  putUser,
  putUsersIndex,
} from '../lib/repo';
import type { UserRecord } from '../lib/types';

export const authRoutes = new Hono<AppEnv>();

const EMAIL_PATTERN = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

function normaliseEmail(value: unknown): string {
  const email = asString(value, 'email', { max: 254 }).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw badRequest('"email" must be a valid email address');
  return email;
}

function publicUser(user: { id: string; email: string; name: string; role: UserRecord['role'] }): SessionUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role, isOwner: user.role === 'owner' };
}

/** GET /api/auth/status - drives the sign-in screen and tells it whether sign-up is available. */
authRoutes.get('/status', async (c) => {
  const store = c.get('store');
  const [config, index, me] = await Promise.all([
    getInstanceConfig(store, c.get('now')()),
    getUsersIndex(store),
    currentUser(c),
  ]);
  const initialized = index.users.length > 0;
  return c.json({
    appName: c.env.APP_NAME ?? 'Rajgruha',
    initialized,
    // Registration is open while the instance has no owner yet, and then only
    // when the owner has deliberately left it open.
    registrationOpen: initialized ? config.registrationOpen : true,
    user: me,
  });
});

/** POST /api/auth/register */
authRoutes.post('/register', async (c) => {
  const store = c.get('store');
  const now = c.get('now')();
  const body = await readJson(c.req.raw);

  const email = normaliseEmail(body.email);
  const name = asString(body.name, 'name', { max: 80 });
  const password = asString(body.password, 'password', { max: 200, required: true });
  assertPasswordAcceptable(password);

  const [config, index] = await Promise.all([getInstanceConfig(store, now), getUsersIndex(store)]);
  const initialized = index.users.length > 0;
  if (initialized && !config.registrationOpen) {
    throw forbidden('Registration is closed on this instance');
  }

  const hashed = await emailKey(email);
  const existing = await findUserByEmail(store, hashed);
  if (existing) throw conflict('An account with that email already exists');

  const iterations = passwordPolicy(Number(c.env.PBKDF2_ITERATIONS));
  const user: UserRecord = {
    id: newId(),
    email,
    name,
    role: initialized ? 'member' : 'owner',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    password: await hashPassword(password, iterations),
  };

  await putUser(store, user);
  await putEmailPointer(store, hashed, user.id);
  await putUsersIndex(store, {
    version: 1,
    users: [...index.users, { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt }],
  });

  if (!initialized) {
    // First account claims the instance and closes the door behind itself.
    await putInstanceConfig(store, {
      ...config,
      ownerId: user.id,
      registrationOpen: false,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  }

  await setSessionCookie(c, user.id, now);
  return c.json({ user: publicUser(user) }, 201);
});

/** POST /api/auth/login */
authRoutes.post('/login', async (c) => {
  const store = c.get('store');
  const body = await readJson(c.req.raw);
  const email = normaliseEmail(body.email);
  const password = asString(body.password, 'password', { max: 200, required: true });

  const user = await findUserByEmail(store, await emailKey(email));
  // Same response for "no such user" and "wrong password", so the endpoint does
  // not confirm which emails exist.
  if (!user || !(await verifyPassword(password, user.password))) {
    throw unauthorized('Email or password is incorrect');
  }

  await setSessionCookie(c, user.id, c.get('now')());
  return c.json({ user: publicUser(user) });
});

/** POST /api/auth/logout */
authRoutes.post('/logout', (c) => {
  clearSessionCookie(c);
  return c.json({ ok: true });
});

/** GET /api/auth/me */
authRoutes.get('/me', requireUser(), (c) => c.json({ user: c.get('user') }));

/** PATCH /api/auth/me - profile edits from the settings page. */
authRoutes.patch('/me', requireUser(), async (c) => {
  const store = c.get('store');
  const session = c.get('user');
  const now = c.get('now')();
  const body = await readJson(c.req.raw);

  const user = await getUser(store, session.id);
  if (!user) throw unauthorized();

  if (body.name !== undefined) user.name = asString(body.name, 'name', { max: 80 });
  if (body.email !== undefined) {
    const nextEmail = normaliseEmail(body.email);
    if (nextEmail !== user.email) {
      const hashedEmail = await emailKey(nextEmail);
      if (await findUserByEmail(store, hashedEmail)) throw conflict('That email is already in use');
      await putEmailPointer(store, hashedEmail, user.id);
      await store.delete(keys.userByEmail(await emailKey(user.email)));
      user.email = nextEmail;
    }
  }

  user.updatedAt = now.toISOString();
  await putUser(store, user);

  const index = await getUsersIndex(store);
  await putUsersIndex(store, {
    version: 1,
    users: index.users.map((entry) =>
      entry.id === user.id ? { ...entry, name: user.name, email: user.email, role: user.role } : entry,
    ),
  });

  return c.json({ user: publicUser(user) });
});

/** POST /api/auth/password */
authRoutes.post('/password', requireUser(), async (c) => {
  const store = c.get('store');
  const now = c.get('now')();
  const body = await readJson(c.req.raw);
  const currentPassword = asString(body.currentPassword, 'currentPassword', { max: 200 });
  const newPassword = asString(body.newPassword, 'newPassword', { max: 200 });

  const user = await getUser(store, c.get('user').id);
  if (!user) throw unauthorized();
  if (!(await verifyPassword(currentPassword, user.password))) {
    throw unauthorized('Your current password is incorrect');
  }
  assertPasswordAcceptable(newPassword);

  const iterations = passwordPolicy(Number(c.env.PBKDF2_ITERATIONS));
  user.password = await hashPassword(newPassword, iterations);
  user.updatedAt = now.toISOString();
  await putUser(store, user);

  await setSessionCookie(c, user.id, now);
  return c.json({ ok: true });
});

/** Users on this instance - owner-only, used by the settings page. */
authRoutes.get('/users', requireUser(), async (c) => {
  if (!c.get('user').isOwner) throw forbidden('Only the instance owner can list accounts');
  const index = await getUsersIndex(c.get('store'));
  return c.json({ users: index.users });
});

/** GET /api/auth/preferences - a shortcut the shell uses to apply the theme before paint. */
authRoutes.get('/preferences', requireUser(), async (c) => {
  const settings = await getSettings(c.get('store'), c.get('user').id);
  return c.json({ theme: settings.theme, library: settings.library });
});
