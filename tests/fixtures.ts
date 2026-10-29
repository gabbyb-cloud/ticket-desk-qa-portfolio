import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { test as base, expect, request, type APIRequestContext, type APIResponse } from '@playwright/test';
import { DEMO_PASSWORD } from '../src/auth.js';

type Instance = { origin: string; advance: (milliseconds: number) => Promise<void>; armReadFault: (detail: string) => Promise<void> };
function suppressSensitiveErrors() {
  // Playwright can generate error-context.md even when tracing is off. Scrub
  // request/assertion errors before context teardown; never retain raw snapshots.
  for (const error of base.info().errors) {
    error.message = 'Failure details suppressed; see named case and source location in sanitized report.';
    delete error.stack;
    delete (error as { snippet?: string }).snippet;
    delete error.value;
    delete (error as { errorContext?: string }).errorContext;
  }
}
class ProcessManager {
  private child: ChildProcess | undefined;
  async start(): Promise<Instance> {
    await this.stop();
    const child = fork(fileURLToPath(new URL('../src/server.ts', import.meta.url)), ['--test-clock'], {
      execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    this.child = child;
    const origin = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Instance startup timed out.')), 20000);
      child.once('error', () => { clearTimeout(timeout); reject(new Error('Instance could not start.')); });
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('Instance exited during startup.')); });
      child.on('message', message => {
        const value = message as { type?: string; origin?: string };
        if (value.type === 'ready' && value.origin) { clearTimeout(timeout); resolve(value.origin); }
      });
    });
    let sequence = 0;
    const control = (type: string, payload: Record<string, unknown>, acknowledgement: string) => new Promise<void>((resolve, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => { child.off('message', listener); reject(new Error('Clock advance timed out.')); }, 5000);
      const listener = (message: unknown) => {
        const value = message as { type?: string; id?: number };
        if (value.type === acknowledgement && value.id === id) { clearTimeout(timeout); child.off('message', listener); resolve(); }
      };
      child.on('message', listener);
      child.send({ type, ...payload, id });
    });
    return {
      origin,
      advance: milliseconds => control('advance', { milliseconds }, 'advanced'),
      armReadFault: detail => control('arm-read-fault', { detail }, 'fault-armed'),
    };
  }
  async stop() {
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const ended = once(child, 'exit');
    child.kill();
    await ended;
  }
}

export class Client {
  token = '';
  constructor(readonly api: APIRequestContext, readonly origin: string) {}
  async bootstrap() {
    const response = await this.api.get('/api/csrf');
    expect(response.status()).toBe(200);
    this.token = (await response.json()).data.csrfToken;
    base.info().annotations.push({ type: 'sensitive-sample', description: this.token });
    return response;
  }
  mutate(method: 'POST' | 'PATCH', path: string, data: unknown, headers: Record<string, string> = {}) {
    return this.api.fetch(path, { method, data, headers: { Origin: this.origin, 'X-CSRF-Token': this.token, ...headers } });
  }
  async login(name = 'alice') {
    await this.bootstrap();
    const response = await this.mutate('POST', '/api/auth/login', { email: `${name}@example.test`, password: DEMO_PASSWORD });
    expect(response.status()).toBe(200);
    const state = await this.api.storageState();
    for (const cookie of state.cookies) base.info().annotations.push({ type: 'sensitive-sample', description: cookie.value });
    await this.bootstrap();
  }
  async create(title = 'Synthetic ticket', description = 'Synthetic description') {
    const response = await this.mutate('POST', '/api/tickets', { title, description });
    expect(response.status()).toBe(201);
    return (await response.json()).data as { id: string; title: string; description: string; status: string; ownerId: string };
  }
  async snapshot() {
    const response = await this.api.get('/api/tickets');
    expect(response.status()).toBe(200);
    const tickets = (await response.json()).data as { id: string }[];
    for (const ticket of tickets) {
      const detail = await this.api.get(`/api/tickets/${ticket.id}`);
      expect(detail.status()).toBe(200);
      expect((await detail.json()).data).toEqual(ticket);
    }
    return tickets.sort((a, b) => a.id.localeCompare(b.id));
  }
}

export async function errorResponse(response: APIResponse, status: number, code: string) {
  expect(response.status()).toBe(status);
  const body = await response.json();
  expect(Object.keys(body)).toEqual(['error']);
  expect(Object.keys(body.error).sort()).toEqual(code === 'VALIDATION_ERROR' ? ['code', 'fields', 'message'] : ['code', 'message']);
  expect(body.error.code).toBe(code);
  expect(typeof body.error.message).toBe('string');
  if (code === 'VALIDATION_ERROR') {
    expect(body.error.fields.length).toBeGreaterThan(0);
    for (const field of body.error.fields) expect(field).toEqual({ field: expect.any(String), code: 'INVALID_VALUE' });
  }
  return body;
}

type Fixtures = { instance: Instance; client: (name?: string) => Promise<Client> };
export const test = base.extend<Fixtures, { manager: ProcessManager }>({
  baseURL: async ({ instance }, use) => { await use(instance.origin); },
  context: async ({ browser, instance }, use) => {
    const context = await browser.newContext({ baseURL: instance.origin });
    await context.route('**/*', route => new URL(route.request().url()).origin === instance.origin ? route.continue() : route.abort());
    base.info().annotations.push({ type: 'browser-version', description: browser.version() });
    try { await use(context); } finally { suppressSensitiveErrors(); await context.close(); }
  },
  manager: [async ({}, use) => {
    const manager = new ProcessManager();
    try { await use(manager); } finally { await manager.stop(); }
  }, { scope: 'worker' }],
  instance: async ({ manager }, use) => {
    try { await use(await manager.start()); } finally { await manager.stop(); }
  },
  client: async ({ instance }, use) => {
    const contexts: APIRequestContext[] = [];
    try {
      await use(async name => {
        const api = await request.newContext({ baseURL: instance.origin, timeout: 10000 });
        contexts.push(api);
        const client = new Client(api, instance.origin);
        if (name) await client.login(name);
        return client;
      });
    } finally { suppressSensitiveErrors(); await Promise.all(contexts.map(context => context.dispose())); }
  },
});
export { expect };

export async function variants<T>(label: string, values: readonly T[], run: (value: T) => Promise<void>): Promise<void> {
  for (const [index, value] of values.entries()) {
    await test.step(`case:${label}/variant-${index + 1}`, () => run(value));
  }
}
