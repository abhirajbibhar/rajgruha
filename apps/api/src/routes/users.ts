import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { MemberCreateInput, MemberPatch, hashPassword, type Member } from '@rajgruha/shared';
import { requireAdmin, requireAuth } from '../auth';
import type { AppEnv } from '../types';

export const userRoutes = new Hono<AppEnv>();
userRoutes.use('*', requireAuth, requireAdmin);

type Row = { id: string; email: string; name: string; role: 'admin' | 'member'; created_at: string };
const toMember = (r: Row): Member => ({ id: r.id, email: r.email, name: r.name, role: r.role, createdAt: r.created_at });
const adminCount = async (db: D1Database) => (await db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`).first<{ n: number }>())?.n ?? 0;

userRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, email, name, role, created_at FROM users ORDER BY role ASC, name COLLATE NOCASE ASC').all<Row>();
  return c.json(results.map(toMember));
});

userRoutes.post('/', async (c) => {
  const body = MemberCreateInput.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw new HTTPException(400, { message: body.error.issues[0]?.message ?? 'Invalid member' });
  const id = crypto.randomUUID();
  try {
    await c.env.DB.prepare('INSERT INTO users (id, email, name, role, password_hash) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(id, body.data.email, body.data.name, body.data.role, await hashPassword(body.data.password)).run();
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new HTTPException(409, { message: 'A member with that email already exists' });
    throw e;
  }
  const row = await c.env.DB.prepare('SELECT id, email, name, role, created_at FROM users WHERE id = ?1').bind(id).first<Row>();
  return c.json(toMember(row!), 201);
});

userRoutes.patch('/:id', async (c) => {
  const body = MemberPatch.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw new HTTPException(400, { message: body.error.issues[0]?.message ?? 'Invalid change' });
  const id = c.req.param('id');
  const me = c.get('user');
  const target = await c.env.DB.prepare('SELECT id, role FROM users WHERE id = ?1').bind(id).first<{ id: string; role: 'admin' | 'member' }>();
  if (!target) throw new HTTPException(404, { message: 'Member not found' });

  const { name, email, role, password } = body.data;
  if (role && role !== target.role) {
    if (id === me.id) throw new HTTPException(400, { message: 'You can’t change your own role — ask another admin' });
    if (target.role === 'admin' && (await adminCount(c.env.DB)) <= 1) throw new HTTPException(400, { message: 'There must be at least one admin' });
  }

  const sets: string[] = [];
  const vals: unknown[] = [];
  const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = ?${vals.length}`); };
  if (name) add('name', name);
  if (email) add('email', email);
  if (role) add('role', role);
  if (password) { add('password_hash', await hashPassword(password)); sets.push('token_version = token_version + 1'); }
  if (!sets.length) throw new HTTPException(400, { message: 'Nothing to change' });
  vals.push(id);
  try {
    await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?${vals.length}`).bind(...vals).run();
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new HTTPException(409, { message: 'Another member already uses that email' });
    throw e;
  }
  // A role change must also take effect on that member's open sessions — requireAuth re-reads the row, so it does.
  const row = await c.env.DB.prepare('SELECT id, email, name, role, created_at FROM users WHERE id = ?1').bind(id).first<Row>();
  return c.json(toMember(row!));
});

userRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (id === c.get('user').id) throw new HTTPException(400, { message: 'You can’t remove yourself' });
  const res = await c.env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(id).run(); // cascades progress, sessions, notes
  if (!res.meta.changes) throw new HTTPException(404, { message: 'Member not found' });
  return c.body(null, 204);
});
