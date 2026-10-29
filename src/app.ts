import express, { type Request, type Response, type NextFunction } from 'express';
import session from 'express-session';
import { randomBytes } from 'node:crypto';
import type { z } from 'zod';
import { IDLE_MS, equalToken, newToken, verifyPassword } from './auth.js';
import { seedStore } from './store.js';
import { createSchema, emptySchema, loginSchema, updateSchema, uuidSchema } from './validation.js';
import { createView, detailView, errorView, listView, loginView } from './views.js';

declare module 'express-session' {
  interface SessionData { userId?: string; csrfToken?: string; lastSeen?: number }
}

type Field = { field: string; code: 'INVALID_VALUE' };
function fail(res: Response, status: number, code: string, message: string, fields?: Field[]) {
  if (res.locals.browser) return res.status(status).type('html').send(errorView(message));
  return res.status(status).json({ error: { code, message, ...(fields ? { fields } : {}) } });
}
const unauthenticated = (res: Response) => fail(res, 401, 'UNAUTHENTICATED', 'Authentication required.');
const notFound = (res: Response) => fail(res, 404, 'NOT_FOUND', 'Ticket not found.');
function validate<T>(schema: z.ZodType<T>, input: unknown, res: Response, invalidView?: () => string): T | undefined {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  // Unknown field names are untrusted too; never echo attacker-supplied keys or values.
  const known = new Set(['email', 'password', 'title', 'description', 'status']);
  const fields: Field[] = result.error.issues.map(issue => ({
    field: known.has(String(issue.path[0])) ? String(issue.path[0]) : 'request', code: 'INVALID_VALUE',
  }));
  if (invalidView) res.status(400).type('html').send(invalidView());
  else fail(res, 400, 'VALIDATION_ERROR', 'Request validation failed.', fields);
  return undefined;
}

export async function createApp(options: { origin: () => string; now?: () => number; testReadFault?: () => void }) {
  const store = await seedStore();
  const now = options.now ?? Date.now;
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  app.set('trust proxy', false);
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  const routes: [RegExp, string[]][] = [
    [/^\/api\/csrf\/?$/, ['GET']], [/^\/api\/auth\/login\/?$/, ['POST']],
    [/^\/api\/auth\/me\/?$/, ['GET']], [/^\/api\/auth\/logout\/?$/, ['POST']],
    [/^\/api\/tickets\/?$/, ['GET', 'POST']], [/^\/api\/tickets\/[^/]+\/?$/, ['GET', 'PATCH']],
  ];
  const browserRoutes: [RegExp, string[]][] = [
    [/^\/login\/?$/, ['GET', 'POST']], [/^\/logout\/?$/, ['POST']],
    [/^\/tickets\/?$/, ['GET', 'POST']], [/^\/tickets\/new\/?$/, ['GET']],
    [/^\/tickets\/[^/]+\/status\/?$/, ['POST']], [/^\/tickets\/[^/]+\/?$/, ['GET']],
  ];
  app.use((req, res, next) => {
    res.locals.browser = !(req.path === '/api' || req.path.startsWith('/api/'));
    const matched = (res.locals.browser ? browserRoutes : routes).find(([pattern]) => pattern.test(req.path));
    if (!matched) { fail(res, 404, 'ROUTE_NOT_FOUND', 'Route not found.'); return; }
    if (!matched[1].includes(req.method)) {
      res.setHeader('Allow', matched[1].join(', '));
      fail(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.'); return;
    }
    const contentType = res.locals.browser ? 'application/x-www-form-urlencoded' : 'application/json';
    if (['POST', 'PATCH'].includes(req.method) && !req.is(contentType)) {
      fail(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported content type.'); return;
    }
    next();
  });
  app.use(express.json({ limit: '16kb', strict: false }));
  app.use(express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 20 }));
  app.use(session({
    name: 'ticketdesk.sid', secret: randomBytes(32).toString('hex'),
    resave: false, saveUninitialized: false, rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: false, path: '/', maxAge: IDLE_MS },
  }));
  app.use(async (req, _res, next) => {
    try {
      if (req.session.userId && req.session.lastSeen !== undefined && now() - req.session.lastSeen >= IDLE_MS) {
        await new Promise<void>((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
      }
      if (req.session.userId) req.session.lastSeen = now();
      next();
    } catch (error) { next(error); }
  });

  const protectedRoute = (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.userId) { unauthenticated(res); return; }
    next();
  };
  const csrf = (req: Request, res: Response, next: NextFunction) => {
    const origin = req.get('Origin');
    const referer = req.get('Referer');
    let trusted = false;
    try {
      if (origin !== undefined) {
        const parsed = new URL(origin);
        trusted = parsed.origin === options.origin() && origin === parsed.origin;
      } else if (referer) {
        const parsed = new URL(referer);
        trusted = parsed.origin === options.origin() && !parsed.username && !parsed.password;
      }
    } catch { trusted = false; }
    const supplied = res.locals.browser ? (typeof req.body?._csrf === 'string' ? req.body._csrf : undefined) : req.get('X-CSRF-Token');
    if (!trusted || !equalToken(supplied, req.session.csrfToken)) {
      fail(res, 403, 'CSRF_FAILED', 'CSRF validation failed.'); return;
    }
    next();
  };
  const noQuery = (req: Request, res: Response, next: NextFunction) => {
    if (req.originalUrl.includes('?') && req.originalUrl.split('?')[1]) {
      fail(res, 400, 'VALIDATION_ERROR', 'Request validation failed.', [{ field: 'request', code: 'INVALID_VALUE' }]); return;
    }
    next();
  };
  const pageToken = (req: Request) => req.session.csrfToken ??= newToken();
  const stripFormToken = (req: Request, _res: Response, next: NextFunction) => {
    if (req.body && typeof req.body === 'object') delete req.body._csrf;
    next();
  };
  const browserProtected = (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.userId) {
      if (req.method === 'GET') res.redirect(303, '/login');
      else unauthenticated(res);
      return;
    }
    next();
  };
  const beginSession = async (req: Request, userId: string) => {
    await new Promise<void>((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.userId = userId;
    req.session.lastSeen = now();
    req.session.csrfToken = newToken();
  };
  const endSession = async (req: Request, res: Response) => {
    await new Promise<void>((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
    res.clearCookie('ticketdesk.sid', { httpOnly: true, sameSite: 'lax', secure: false, path: '/' });
  };
  app.get('/api/csrf', noQuery, (req, res) => {
    req.session.csrfToken ??= newToken();
    res.json({ data: { csrfToken: req.session.csrfToken } });
  });
  app.post('/api/auth/login', csrf, noQuery, async (req, res) => {
    const input = validate(loginSchema, req.body, res);
    if (!input) return;
    const user = store.users.get(input.email);
    const valid = await verifyPassword(input.password, user?.hash ?? store.dummyHash);
    if (!user || !valid) { fail(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password.'); return; }
    await beginSession(req, user.id);
    res.json({ data: { user: { id: user.id, email: user.email } } });
  });
  app.get('/api/auth/me', protectedRoute, noQuery, (req, res) => {
    const user = [...store.users.values()].find(value => value.id === req.session.userId)!;
    res.json({ data: { user: { id: user.id, email: user.email } } });
  });
  app.post('/api/auth/logout', protectedRoute, csrf, noQuery, async (req, res) => {
    if (!validate(emptySchema, req.body, res)) return;
    await endSession(req, res);
    res.status(204).end();
  });
  app.get('/api/tickets', protectedRoute, noQuery, (req, res) => {
    options.testReadFault?.();
    res.json({ data: store.list(req.session.userId!) });
  });
  app.post('/api/tickets', protectedRoute, csrf, noQuery, (req, res) => {
    const input = validate(createSchema, req.body, res);
    if (!input) return;
    const ticket = store.create(req.session.userId!, input);
    res.location(`/api/tickets/${ticket.id}`).status(201).json({ data: ticket });
  });
  app.get('/api/tickets/:id', protectedRoute, (req, res) => {
    const id = String(req.params.id);
    const ticket = uuidSchema.safeParse(id).success ? store.tickets.get(id) : undefined;
    if (!ticket || ticket.ownerId !== req.session.userId) { notFound(res); return; }
    noQuery(req, res, () => res.json({ data: ticket }));
  });
  app.patch('/api/tickets/:id', protectedRoute, csrf, (req, res) => {
    const id = String(req.params.id);
    const ticket = uuidSchema.safeParse(id).success ? store.tickets.get(id) : undefined;
    if (!ticket || ticket.ownerId !== req.session.userId) { notFound(res); return; }
    noQuery(req, res, () => {
      const input = validate(updateSchema, req.body, res);
      if (!input) return;
      const updated = { ...ticket, status: input.status };
      store.tickets.set(id, updated);
      res.json({ data: updated });
    });
  });
  const textField = (body: Record<string, unknown> | undefined, key: string) => typeof body?.[key] === 'string' ? body[key] as string : '';
  app.get('/login', noQuery, (req, res) => res.type('html').send(loginView(pageToken(req))));
  app.post('/login', csrf, stripFormToken, noQuery, async (req, res) => {
    const invalid = () => loginView(pageToken(req), 'Request validation failed.', textField(req.body, 'email'));
    const input = validate(loginSchema, req.body, res, invalid);
    if (!input) return;
    const user = store.users.get(input.email);
    const valid = await verifyPassword(input.password, user?.hash ?? store.dummyHash);
    if (!user || !valid) {
      res.status(401).type('html').send(loginView(pageToken(req), 'Invalid email or password.', input.email)); return;
    }
    await beginSession(req, user.id);
    res.redirect(303, '/tickets');
  });
  app.post('/logout', browserProtected, csrf, stripFormToken, noQuery, async (req, res) => {
    if (!validate(emptySchema, req.body, res)) return;
    await endSession(req, res);
    res.redirect(303, '/login');
  });
  app.get('/tickets', browserProtected, noQuery, (req, res) => {
    options.testReadFault?.();
    res.type('html').send(listView(pageToken(req), store.list(req.session.userId!)));
  });
  app.get('/tickets/new', browserProtected, noQuery, (req, res) => res.type('html').send(createView(pageToken(req))));
  app.post('/tickets', browserProtected, csrf, stripFormToken, noQuery, (req, res) => {
    const invalid = () => createView(pageToken(req), 'Request validation failed.', textField(req.body, 'title'), textField(req.body, 'description'));
    const input = validate(createSchema, req.body, res, invalid);
    if (!input) return;
    const ticket = store.create(req.session.userId!, input);
    res.redirect(303, `/tickets/${ticket.id}`);
  });
  app.get('/tickets/:id', browserProtected, (req, res) => {
    const id = String(req.params.id);
    const ticket = uuidSchema.safeParse(id).success ? store.tickets.get(id) : undefined;
    if (!ticket || ticket.ownerId !== req.session.userId) { notFound(res); return; }
    noQuery(req, res, () => res.type('html').send(detailView(pageToken(req), ticket)));
  });
  app.post('/tickets/:id/status', browserProtected, csrf, stripFormToken, (req, res) => {
    const id = String(req.params.id);
    const ticket = uuidSchema.safeParse(id).success ? store.tickets.get(id) : undefined;
    if (!ticket || ticket.ownerId !== req.session.userId) { notFound(res); return; }
    noQuery(req, res, () => {
      const input = validate(updateSchema, req.body, res, () => detailView(pageToken(req), ticket, 'Request validation failed.'));
      if (!input) return;
      store.tickets.set(id, { ...ticket, status: input.status });
      res.redirect(303, `/tickets/${id}`);
    });
  });
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const type = (error as { type?: string })?.type;
    if (type === 'entity.too.large') { fail(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body too large.'); return; }
    if (type === 'parameters.too.many') { fail(res, 413, 'PAYLOAD_TOO_LARGE', 'Too many form fields.'); return; }
    if (type === 'entity.parse.failed') { fail(res, 400, 'MALFORMED_JSON', 'Malformed JSON.'); return; }
    if (type === 'charset.unsupported' || type === 'encoding.unsupported') {
      fail(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported request encoding.'); return;
    }
    fail(res, 500, 'INTERNAL_ERROR', 'Internal server error.');
  });
  return app;
}
