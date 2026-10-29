import { test, expect, errorResponse, variants } from '../fixtures.js';
import { DEMO_PASSWORD } from '../../src/auth.js';

test('SEC-01 DATA-01: token binding protects create, update and logout, including stale login token', async ({ client }) => {
  const alice = await client();
  await alice.bootstrap();
  const stale = alice.token;
  await alice.login('alice');
  const other = await client();
  await other.bootstrap();
  const ticket = await alice.create();
  await variants('security-loop-12', ['', 'wrong', other.token, stale, 'é'.repeat(64)], async (token) => {
    await variants('security-loop-13', [
      ['POST', '/api/tickets', { title: 'Forged', description: '' }],
      ['PATCH', `/api/tickets/${ticket.id}`, { status: 'closed' }], ['POST', '/api/auth/logout', {}],
    ] as const, async ([method, path, data]) => {
      const before = await alice.snapshot();
      await errorResponse(await alice.mutate(method, path, data, { 'X-CSRF-Token': token }), 403, 'CSRF_FAILED');
      expect(await alice.snapshot()).toEqual(before);
      expect((await alice.api.get('/api/auth/me')).status()).toBe(200);
    });
  });
  const before = await alice.snapshot();
  await errorResponse(await alice.api.post('/api/tickets', { data: { title: 'Forged', description: '' }, headers: { Origin: alice.origin } }), 403, 'CSRF_FAILED');
  expect(await alice.snapshot()).toEqual(before);
});

test('SEC-01 AUTH-03: invalid or absent login token leaves session anonymous', async ({ client }) => {
  const anonymous = await client();
  await anonymous.bootstrap();
  await variants('security-loop-31', [{ Origin: anonymous.origin }, { Origin: anonymous.origin, 'X-CSRF-Token': 'wrong' }], async (headers) => {
    await errorResponse(await anonymous.api.post('/api/auth/login', {
      data: { email: 'alice@example.test', password: DEMO_PASSWORD }, headers,
    }), 403, 'CSRF_FAILED');
    await errorResponse(await anonymous.api.get('/api/auth/me'), 401, 'UNAUTHENTICATED');
  });
});

test('SEC-02 DATA-01: origin and Referer checks protect every authenticated mutation', async ({ client }) => {
  const alice = await client('alice');
  const ticket = await alice.create();
  const cases: Record<string, string>[] = [
    { Origin: 'https://attacker.example' }, { Origin: 'null' },
    { Referer: 'https://attacker.example/forged' }, {}, { Origin: 'malformed' },
    { Origin: `${alice.origin}.attacker.example` }, { Origin: `${alice.origin}/path` },
    { Origin: 'https://attacker.example', Referer: `${alice.origin}/trusted` },
    { Referer: 'not-a-url' },
  ];
  await variants('security-loop-49', cases, async (headers) => {
    await variants('security-loop-50', [
      ['POST', '/api/tickets', { title: 'Forged', description: '' }],
      ['PATCH', `/api/tickets/${ticket.id}`, { status: 'closed' }], ['POST', '/api/auth/logout', {}],
    ] as const, async ([method, path, data]) => {
      const before = await alice.snapshot();
      await errorResponse(await alice.api.fetch(path, { method, data, headers: { 'X-CSRF-Token': alice.token, ...headers } }), 403, 'CSRF_FAILED');
      expect(await alice.snapshot()).toEqual(before);
    });
  });
  const fallback = await alice.api.post('/api/tickets', { data: { title: 'Referer accepted', description: '' }, headers: {
    Referer: `${alice.origin}/tickets/new`, 'X-CSRF-Token': alice.token,
  } });
  expect(fallback.status()).toBe(201);
});

test('SEC-02 AUTH-03: hostile and absent origins cannot authenticate, even with correct token', async ({ client }) => {
  const anonymous = await client();
  await anonymous.bootstrap();
  await variants('security-loop-68', [{ Origin: 'https://attacker.example' }, { Origin: 'null' }, {}], async (headers) => {
    await errorResponse(await anonymous.api.post('/api/auth/login', {
      data: { email: 'alice@example.test', password: DEMO_PASSWORD },
      headers: { 'X-CSRF-Token': anonymous.token, ...headers },
    }), 403, 'CSRF_FAILED');
    await errorResponse(await anonymous.api.get('/api/auth/me'), 401, 'UNAUTHENTICATED');
  });
});

test('SEC-05: no-store, restrictive CORS and disclosure-safe errors', async ({ client }) => {
  const alice = await client('alice');
  const ticket = await alice.create();
  await variants('security-loop-80', ['/api/csrf', '/api/auth/me', '/api/tickets', `/api/tickets/${ticket.id}`], async (path) => {
    const response = await alice.api.get(path, { headers: { Origin: 'https://attacker.example' } });
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(response.headers()['access-control-allow-origin']).toBeUndefined();
    expect(response.headers()['x-powered-by']).toBeUndefined();
  });
  const preflight = await alice.api.fetch('/api/tickets', { method: 'OPTIONS', headers: {
    Origin: 'https://attacker.example', 'Access-Control-Request-Method': 'POST',
  } });
  await errorResponse(preflight, 405, 'METHOD_NOT_ALLOWED');
  expect(preflight.headers()['access-control-allow-origin']).toBeUndefined();
  const before = await alice.snapshot();
  const response = await alice.mutate('POST', '/api/tickets', { title: 'x', description: '', 'sensitive-injected-key': 'never echo this' });
  const body = await errorResponse(response, 400, 'VALIDATION_ERROR');
  expect(JSON.stringify(body).includes('sensitive-injected-key')).toBe(false);
  expect(JSON.stringify(body).includes('never echo this')).toBe(false);
  expect(await alice.snapshot()).toEqual(before);
});
