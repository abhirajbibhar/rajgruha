/**
 * Per-user settings, plus the two instance-wide controls the owner needs:
 * whether new accounts can be created, and who is on the instance.
 */
import { Hono } from 'hono';
import { requireOwner, requireUser } from '../auth';
import type { AppEnv } from '../env';
import { asBool, asEnum, asInt, asString, readJson } from '../lib/http';
import { getInstanceConfig, getSettings, putInstanceConfig, putSettings } from '../lib/repo';

export const settingsRoutes = new Hono<AppEnv>();

const THEMES = ['light', 'dark', 'system'] as const;
const SORT_OPTIONS = ['recent', 'title', 'author', 'added'] as const;
const VIEWS = ['grid', 'list'] as const;

/** GET /api/settings */
settingsRoutes.get('/', requireUser(), async (c) => {
  const settings = await getSettings(c.get('store'), c.get('user').id);
  return c.json({ settings });
});

/**
 * PUT /api/settings
 *
 * A partial patch, merged over the stored settings so a client that only knows
 * about some of the fields never wipes the rest.
 */
settingsRoutes.put('/', requireUser(), async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const now = c.get('now')();
  const body = await readJson(c.req.raw);
  const current = await getSettings(store, userId);

  const next = {
    ...current,
    theme: body.theme === undefined ? current.theme : asEnum(body.theme, 'theme', THEMES, current.theme),
    reader: { ...current.reader },
    notebook: { ...current.notebook },
    quotes: { ...current.quotes },
    library: { ...current.library },
  };

  const reader = body.reader as Record<string, unknown> | undefined;
  if (reader && typeof reader === 'object') {
    if (reader.annotationAuthor !== undefined)
      next.reader.annotationAuthor = asString(reader.annotationAuthor, 'reader.annotationAuthor', {
        max: 120,
        required: false,
      });
    if (reader.highlightColor !== undefined)
      next.reader.highlightColor = asString(reader.highlightColor, 'reader.highlightColor', { max: 40 });
    if (reader.scrollStrategy !== undefined)
      next.reader.scrollStrategy = asEnum(reader.scrollStrategy, 'reader.scrollStrategy', ['vertical', 'horizontal'] as const, next.reader.scrollStrategy);
    if (reader.defaultZoom !== undefined)
      next.reader.defaultZoom = asString(reader.defaultZoom, 'reader.defaultZoom', { max: 40 });
    if (reader.showThumbnails !== undefined)
      next.reader.showThumbnails = asBool(reader.showThumbnails, 'reader.showThumbnails');
    if (reader.autosaveSeconds !== undefined)
      next.reader.autosaveSeconds = asInt(reader.autosaveSeconds, 'reader.autosaveSeconds', { min: 5, max: 600 });
  }

  const notebook = body.notebook as Record<string, unknown> | undefined;
  if (notebook && typeof notebook === 'object') {
    if (notebook.carryOverTodos !== undefined)
      next.notebook.carryOverTodos = asBool(notebook.carryOverTodos, 'notebook.carryOverTodos');
    if (notebook.showWeek !== undefined) next.notebook.showWeek = asBool(notebook.showWeek, 'notebook.showWeek');
  }

  const quotes = body.quotes as Record<string, unknown> | undefined;
  if (quotes && typeof quotes === 'object') {
    if (quotes.quoteOfTheDay !== undefined) next.quotes.quoteOfTheDay = asBool(quotes.quoteOfTheDay, 'quotes.quoteOfTheDay');
    if (quotes.compactLayout !== undefined) next.quotes.compactLayout = asBool(quotes.compactLayout, 'quotes.compactLayout');
  }

  const library = body.library as Record<string, unknown> | undefined;
  if (library && typeof library === 'object') {
    if (library.sortBy !== undefined) next.library.sortBy = asEnum(library.sortBy, 'library.sortBy', SORT_OPTIONS, next.library.sortBy);
    if (library.view !== undefined) next.library.view = asEnum(library.view, 'library.view', VIEWS, next.library.view);
  }

  next.updatedAt = now.toISOString();
  await putSettings(store, userId, next);
  return c.json({ settings: next });
});

/** GET /api/settings/instance - instance-wide state. */
settingsRoutes.get('/instance', requireUser(), async (c) => {
  const config = await getInstanceConfig(c.get('store'), c.get('now')());
  return c.json({
    ownerId: config.ownerId,
    registrationOpen: config.registrationOpen,
    isOwner: c.get('user').isOwner,
    createdAt: config.createdAt,
  });
});

/** PUT /api/settings/instance - owner-only instance controls. */
settingsRoutes.put('/instance', requireUser(), requireOwner(), async (c) => {
  const store = c.get('store');
  const now = c.get('now')();
  const body = await readJson(c.req.raw);
  const config = await getInstanceConfig(store, now);

  if (body.registrationOpen !== undefined) {
    config.registrationOpen = asBool(body.registrationOpen, 'registrationOpen');
  }
  config.ownerId = config.ownerId ?? c.get('user').id;
  config.updatedAt = now.toISOString();
  await putInstanceConfig(store, config);

  return c.json({ registrationOpen: config.registrationOpen, ownerId: config.ownerId });
});
