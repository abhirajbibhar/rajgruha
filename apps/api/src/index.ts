import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { authRoutes } from './routes/auth';
import { bookRoutes } from './routes/books';
import { statsRoutes } from './routes/stats';
import { analyticsRoutes } from './routes/analytics';
import { acquisitionRoutes } from './routes/acquisitions';
import { exportRoutes } from './routes/export';
import { fileRoutes } from './routes/files';
import { logRoutes } from './routes/log';
import { userRoutes } from './routes/users';
import type { AppEnv } from './types';

const app = new Hono<AppEnv>();

app.use('/api/*', (c, next) =>
  cors({
    origin: c.env.CORS_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', 'Range'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['Content-Range', 'Accept-Ranges']
  })(c, next)
);

app.get('/api/health', (c) => c.json({ ok: true }));
app.route('/api/auth', authRoutes);
app.route('/api/books', bookRoutes);
app.route('/api/stats', statsRoutes);
app.route('/api/analytics', analyticsRoutes);
app.route('/api/files', fileRoutes);
app.route('/api/log', logRoutes);
app.route('/api/users', userRoutes);
app.route('/api/acquisitions', acquisitionRoutes);
app.route('/api/export', exportRoutes);

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'Internal error' }, 500);
});

export default app;
export type App = typeof app;
