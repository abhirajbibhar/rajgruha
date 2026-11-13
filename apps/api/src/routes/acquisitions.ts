import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { AcquisitionInput, AcquisitionPatch, type Acquisition } from '@rajgruha/shared';
import { requireAuth } from '../auth';
import type { AppEnv } from '../types';

export const acquisitionRoutes = new Hono<AppEnv>();
acquisitionRoutes.use('*', requireAuth);

type Row = {
  id: string; title: string; author: string | null; isbn: string | null; notes: string | null;
  status: Acquisition['status']; priority: Acquisition['priority']; position: number; requested_by: string | null;
  requester: string | null; created_at: string; updated_at: string;
};
const SELECT = `SELECT a.*, u.name AS requester FROM acquisitions a LEFT JOIN users u ON u.id = a.requested_by`;
const toAcq = (r: Row): Acquisition => ({
  id: r.id, title: r.title, author: r.author, isbn: r.isbn, notes: r.notes, status: r.status, priority: r.priority, position: r.position,
  requestedBy: r.requested_by && r.requester ? { id: r.requested_by, name: r.requester } : null, createdAt: r.created_at, updatedAt: r.updated_at
});
const find = async (db: D1Database, id: string) => {
  const row = await db.prepare(`${SELECT} WHERE a.id = ?1`).bind(id).first<Row>();
  if (!row) throw new HTTPException(404, { message: 'Request not found' });
  return row;
};
const endOf = async (db: D1Database, status: string) =>
  ((await db.prepare('SELECT MAX(position) AS m FROM acquisitions WHERE status = ?1').bind(status).first<{ m: number | null }>())?.m ?? 0) + 1;

acquisitionRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`${SELECT} ORDER BY a.status, a.position, a.created_at`).all<Row>();
  return c.json(results.map(toAcq));
});

// Anyone signed in can ask for a book.
acquisitionRoutes.post('/', async (c) => {
  const body = AcquisitionInput.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw new HTTPException(400, { message: body.error.issues[0]?.message ?? 'Invalid request' });
  const id = crypto.randomUUID();
  const b = body.data;
  await c.env.DB.prepare('INSERT INTO acquisitions (id, title, author, isbn, notes, priority, requested_by, position) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)')
    .bind(id, b.title, b.author || null, b.isbn || null, b.notes || null, b.priority, c.get('user').id, await endOf(c.env.DB, 'requested')).run();
  return c.json(toAcq(await find(c.env.DB, id)), 201);
});

// Admins run the board. A member may edit or withdraw their own request while it is still just "requested".
acquisitionRoutes.patch('/:id', async (c) => {
  const body = AcquisitionPatch.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw new HTTPException(400, { message: body.error.issues[0]?.message ?? 'Invalid change' });
  const me = c.get('user');
  const row = await find(c.env.DB, c.req.param('id'));
  const { status, position, ...content } = body.data;

  if (me.role !== 'admin') {
    if (row.requested_by !== me.id || row.status !== 'requested') throw new HTTPException(403, { message: 'Only an admin can change this request' });
    if (status !== undefined || position !== undefined) throw new HTTPException(403, { message: 'Only an admin can move requests' });
  }

  const sets: string[] = ["updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"];
  const vals: unknown[] = [];
  const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = ?${vals.length}`); };
  for (const [k, v] of Object.entries(content)) if (v !== undefined) add(k, typeof v === 'string' && v === '' ? null : v);
  if (status !== undefined && status !== row.status) { add('status', status); add('position', position ?? (await endOf(c.env.DB, status))); }
  else if (position !== undefined) add('position', position);
  vals.push(row.id);
  await c.env.DB.prepare(`UPDATE acquisitions SET ${sets.join(', ')} WHERE id = ?${vals.length}`).bind(...vals).run();
  return c.json(toAcq(await find(c.env.DB, row.id)));
});

acquisitionRoutes.delete('/:id', async (c) => {
  const me = c.get('user');
  const row = await find(c.env.DB, c.req.param('id'));
  if (me.role !== 'admin' && !(row.requested_by === me.id && row.status === 'requested')) throw new HTTPException(403, { message: 'Only an admin can remove this request' });
  await c.env.DB.prepare('DELETE FROM acquisitions WHERE id = ?1').bind(row.id).run();
  return c.body(null, 204);
});
