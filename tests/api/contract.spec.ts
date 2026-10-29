import { randomUUID } from 'node:crypto';
import { test, expect, errorResponse, variants } from '../fixtures.js';
import { DEMO_PASSWORD, IDLE_MS } from '../../src/auth.js';

test('API-01 AUTH-04: bootstrap, rotation, identity, logout and old-cookie replay', async ({ client }) => {
  const alice = await client();
  const bootstrap = await alice.bootstrap();
  const cookie = bootstrap.headers()['set-cookie'] ?? '';
  expect(cookie.includes('HttpOnly')).toBe(true);
  expect(cookie.includes('SameSite=Lax')).toBe(true);
  expect(cookie.includes('Path=/')).toBe(true);
  expect(cookie.includes('Secure')).toBe(false);
  expect(cookie.includes('Domain=')).toBe(false);
  const anonymousState = await alice.api.storageState();
  const oldToken = alice.token;
  const login = await alice.mutate('POST', '/api/auth/login', { email: 'alice@example.test', password: DEMO_PASSWORD });
  expect(login.status()).toBe(200);
  expect(await login.json()).toEqual({ data: { user: { id: 'user-alice', email: 'alice@example.test' } } });
  const authenticatedState = await alice.api.storageState();
  expect(authenticatedState.cookies[0]?.value !== anonymousState.cookies[0]?.value).toBe(true);
  await alice.bootstrap();
  expect(alice.token !== oldToken).toBe(true);
  const replay = await client();
  await replay.api.get('/api/auth/me', { headers: { Cookie: `ticketdesk.sid=${anonymousState.cookies[0]!.value}` } }).then(r => errorResponse(r, 401, 'UNAUTHENTICATED'));
  const me = await alice.api.get('/api/auth/me');
  expect(await me.json()).toEqual(await login.json());
  const logout = await alice.mutate('POST', '/api/auth/logout', {});
  expect(logout.status()).toBe(204);
  expect(await logout.text()).toBe('');
  expect((logout.headers()['set-cookie'] ?? '').includes('ticketdesk.sid=;')).toBe(true);
  await errorResponse(await alice.api.get('/api/auth/me'), 401, 'UNAUTHENTICATED');
  await errorResponse(await replay.api.get('/api/auth/me', { headers: { Cookie: `ticketdesk.sid=${authenticatedState.cookies[0]!.value}` } }), 401, 'UNAUTHENTICATED');
});

test('API-02 ISO-01: empty isolated store, create, list, detail, close, reopen and idempotence', async ({ client }) => {
  const alice = await client('alice');
  expect(await alice.snapshot()).toEqual([]);
  const response = await alice.mutate('POST', '/api/tickets', { title: '  Synthetic ticket  ', description: '  preserved  ' });
  expect(response.status()).toBe(201);
  const ticket = (await response.json()).data;
  expect(ticket).toEqual({ id: expect.any(String), title: 'Synthetic ticket', description: '  preserved  ', status: 'open', ownerId: 'user-alice' });
  expect(response.headers()['location']).toBe(`/api/tickets/${ticket.id}`);
  expect(await alice.snapshot()).toEqual([ticket]);
  await variants('contract-loop-44', ['closed', 'closed', 'open'], async (status) => {
    const update = await alice.mutate('PATCH', `/api/tickets/${ticket.id}`, { status });
    expect(update.status()).toBe(200);
    expect((await update.json()).data).toEqual({ ...ticket, status });
    expect(await alice.snapshot()).toEqual([{ ...ticket, status }]);
  });
});

test('API-03: route, method and opaque ticket lookup errors', async ({ client }) => {
  const alice = await client('alice');
  await errorResponse(await alice.api.get('/api/unknown'), 404, 'ROUTE_NOT_FOUND');
  const methods: [string, string][] = [
    ['/api/csrf', 'GET'], ['/api/auth/login', 'POST'], ['/api/auth/me', 'GET'],
    ['/api/auth/logout', 'POST'], ['/api/tickets', 'GET, POST'], [`/api/tickets/${randomUUID()}`, 'GET, PATCH'],
  ];
  await variants('contract-loop-59', methods, async ([path, allow]) => {
    const response = await alice.api.delete(path);
    await errorResponse(response, 405, 'METHOD_NOT_ALLOWED');
    expect(response.headers()['allow']).toBe(allow);
  });
  const absent = await errorResponse(await alice.api.get(`/api/tickets/${randomUUID()}`), 404, 'NOT_FOUND');
  expect(await errorResponse(await alice.api.get('/api/tickets/invalid'), 404, 'NOT_FOUND')).toEqual(absent);
});

test('AUTH-01 DATA-01: all protected routes reject missing and invalid sessions without writes', async ({ client }) => {
  const alice = await client('alice');
  const ticket = await alice.create();
  const before = await alice.snapshot();
  const anonymous = await client();
  await variants('contract-loop-73', [{}, { Cookie: 'ticketdesk.sid=invalid' }], async (headers) => {
    await variants('contract-loop-74', ['/api/auth/me', '/api/tickets', `/api/tickets/${ticket.id}`], async (path) => {
      await errorResponse(await anonymous.api.get(path, { headers }), 401, 'UNAUTHENTICATED');
    });
    await variants('contract-loop-77', [
      ['POST', '/api/auth/logout', {}], ['POST', '/api/tickets', { title: 'Unauthorized', description: '' }],
      ['PATCH', `/api/tickets/${ticket.id}`, { status: 'closed' }],
    ] as const, async ([method, path, data]) => {
      await errorResponse(await anonymous.api.fetch(path, { method, data, headers }), 401, 'UNAUTHENTICATED');
      expect(await alice.snapshot()).toEqual(before);
    });
  });
});

test('AUTH-02 DATA-01: cross-user reads and updates match absent records and preserve owner data', async ({ client }) => {
  const alice = await client('alice');
  const bob = await client('bob');
  const ticket = await alice.create();
  const before = await alice.snapshot();
  expect(await bob.snapshot()).toEqual([]);
  const absent = await errorResponse(await bob.api.get(`/api/tickets/${randomUUID()}`), 404, 'NOT_FOUND');
  expect(await errorResponse(await bob.api.get(`/api/tickets/${ticket.id}`), 404, 'NOT_FOUND')).toEqual(absent);
  await variants('contract-loop-95', [{ status: 'closed' }, { status: 'invalid', ownerId: 'user-bob' }], async (data) => {
    expect(await errorResponse(await bob.mutate('PATCH', `/api/tickets/${ticket.id}`, data), 404, 'NOT_FOUND')).toEqual(absent);
    expect(await alice.snapshot()).toEqual(before);
    expect(await bob.snapshot()).toEqual([]);
  });
});

test('AUTH-03 VAL-04: equal credential failures, normalization and password whitespace', async ({ client }) => {
  const alice = await client();
  await alice.bootstrap();
  let expected: unknown;
  await variants('contract-loop-106', [
    ['unknown@example.test', DEMO_PASSWORD], ['alice@example.test', 'wrong'],
    ['alice@example.test', ` ${DEMO_PASSWORD} `],
  ], async ([email, password]) => {
    const body = await errorResponse(await alice.mutate('POST', '/api/auth/login', { email, password }), 401, 'INVALID_CREDENTIALS');
    expected ??= body;
    expect(body).toEqual(expected);
    await errorResponse(await alice.api.get('/api/auth/me'), 401, 'UNAUTHENTICATED');
  });
  expect((await alice.mutate('POST', '/api/auth/login', { email: ' ALICE@EXAMPLE.TEST ', password: DEMO_PASSWORD })).status()).toBe(200);
});

test('AUTH-04: controlled idle expiry and renewal; expired cookie cannot be replayed', async ({ client, instance }) => {
  const alice = await client('alice');
  const state = await alice.api.storageState();
  await instance.advance(IDLE_MS - 60000);
  expect((await alice.api.get('/api/auth/me')).status()).toBe(200);
  await instance.advance(120000);
  expect((await alice.api.get('/api/auth/me')).status()).toBe(200);
  await instance.advance(IDLE_MS);
  await errorResponse(await alice.api.get('/api/auth/me'), 401, 'UNAUTHENTICATED');
  const replay = await client();
  await errorResponse(await replay.api.get('/api/auth/me', { headers: { Cookie: `ticketdesk.sid=${state.cookies[0]!.value}` } }), 401, 'UNAUTHENTICATED');
});

test('AUTH-04 DATA-01: expired-session writes preserve tickets visible after a fresh login', async ({ client, instance }) => {
  const alice = await client('alice');
  const ticket = await alice.create();
  const before = await alice.snapshot();
  await instance.advance(IDLE_MS);
  await variants('contract-loop-136', [
    ['POST', '/api/tickets', { title: 'Expired write', description: '' }],
    ['PATCH', `/api/tickets/${ticket.id}`, { status: 'closed' }], ['POST', '/api/auth/logout', {}],
  ] as const, async ([method, path, data]) => {
    // Observe each rejected write immediately, before attempting the next one.
    const observer = await client('alice');
    const attemptBefore = await observer.snapshot();
    expect(attemptBefore).toEqual(before);
    await errorResponse(await alice.mutate(method, path, data), 401, 'UNAUTHENTICATED');
    expect(await observer.snapshot()).toEqual(attemptBefore);
  });
  const owner = await client('alice');
  expect(await owner.snapshot()).toEqual(before);
});

test('VAL-01 DATA-01 SEC-04: rejected creates are strict, bounded and atomic', async ({ client }) => {
  const alice = await client('alice');
  await alice.create();
  const invalid = [
    { title: '', description: '' }, { title: ' \t ', description: '' },
    { title: 'x'.repeat(121), description: '' }, { title: 'x', description: 'x'.repeat(2001) },
    { title: 1, description: '' }, { title: 'x', description: false }, { title: 'x' }, { description: '' },
    { title: 'x', description: '', extra: true }, { title: 'x', description: '', ownerId: 'user-bob' },
    { title: 'x', description: '', id: randomUUID() }, { title: 'x', description: '', status: 'closed' },
    null, [], 42,
  ];
  await variants('contract-loop-160', invalid, async (data) => {
    const before = await alice.snapshot();
    await errorResponse(await alice.mutate('POST', '/api/tickets', data), 400, 'VALIDATION_ERROR');
    expect(await alice.snapshot()).toEqual(before);
  });
});

test('VAL-01: code-point and whitespace boundaries are accepted', async ({ client }) => {
  const alice = await client('alice');
  await variants('contract-loop-169', [['x', ''], ['😀'.repeat(120), '😀'.repeat(2000)]], async ([title, description]) => {
    const ticket = await alice.create(title, description);
    expect(ticket.title).toBe(title);
    expect(ticket.description).toBe(description);
  });
  const before = await alice.snapshot();
  await errorResponse(await alice.mutate('POST', '/api/tickets', { title: '😀'.repeat(121), description: '' }), 400, 'VALIDATION_ERROR');
  expect(await alice.snapshot()).toEqual(before);
});

test('VAL-02 DATA-01 SEC-04: invalid updates never partially change status or ownership', async ({ client }) => {
  const alice = await client('alice');
  const ticket = await alice.create();
  await variants('contract-loop-182', [
    {}, { status: 'invalid' }, { status: null }, { status: 1 }, { status: 'closed', ownerId: 'user-bob' },
    { status: 'closed', id: randomUUID() }, { status: 'closed', title: 'replacement' }, { status: 'closed', extra: true },
  ], async (data) => {
    const before = await alice.snapshot();
    await errorResponse(await alice.mutate('PATCH', `/api/tickets/${ticket.id}`, data), 400, 'VALIDATION_ERROR');
    expect(await alice.snapshot()).toEqual(before);
  });
});

test('VAL-03 DATA-01: malformed, oversized and wrong-type requests fail before writes', async ({ client }) => {
  const alice = await client('alice');
  const ticket = await alice.create();
  await variants('contract-loop-195', [['POST', '/api/tickets'], ['PATCH', `/api/tickets/${ticket.id}`]] as const, async ([method, path]) => {
    await variants('contract-loop-196', [
      ['{', 'application/json', 400, 'MALFORMED_JSON'],
      [JSON.stringify({ title: 'x'.repeat(17000) }), 'application/json', 413, 'PAYLOAD_TOO_LARGE'],
      ['title=x&description=', 'application/x-www-form-urlencoded', 415, 'UNSUPPORTED_MEDIA_TYPE'],
    ] as const, async ([data, contentType, status, code]) => {
      const before = await alice.snapshot();
      await errorResponse(await alice.api.fetch(path, { method, data: Buffer.from(data), headers: {
        Origin: alice.origin, 'X-CSRF-Token': alice.token, 'Content-Type': contentType,
      } }), status, code);
      expect(await alice.snapshot()).toEqual(before);
    });
  });
});

test('VAL-03 DATA-01: queries are rejected on every documented endpoint', async ({ client }) => {
  const alice = await client('alice');
  const ticket = await alice.create();
  await variants('contract-loop-213', ['/api/csrf', '/api/auth/me', '/api/tickets', `/api/tickets/${ticket.id}`], async (path) => {
    await errorResponse(await alice.api.get(`${path}?unexpected=x`), 400, 'VALIDATION_ERROR');
  });
  await variants('contract-loop-216', [
    ['POST', '/api/auth/login', { email: 'alice@example.test', password: DEMO_PASSWORD }],
    ['POST', '/api/auth/logout', {}], ['POST', '/api/tickets', { title: 'x', description: '' }],
    ['PATCH', `/api/tickets/${ticket.id}`, { status: 'closed' }],
  ] as const, async ([method, path, data]) => {
    const before = await alice.snapshot();
    await errorResponse(await alice.mutate(method, `${path}?unexpected=x`, data), 400, 'VALIDATION_ERROR');
    expect(await alice.snapshot()).toEqual(before);
  });
});

test('VAL-04: invalid login schemas fail without authenticating', async ({ client }) => {
  const alice = await client();
  await alice.bootstrap();
  await variants('contract-loop-230', [
    { email: 'invalid', password: DEMO_PASSWORD }, { email: `${'a'.repeat(243)}@example.test`, password: DEMO_PASSWORD },
    { email: 'alice@example.test', password: '' }, { email: 'alice@example.test', password: 'x'.repeat(129) },
    { email: 42, password: DEMO_PASSWORD }, { email: 'alice@example.test', password: 42 },
    { email: 'alice@example.test' }, { password: DEMO_PASSWORD },
    { email: 'alice@example.test', password: DEMO_PASSWORD, extra: true },
  ], async (data) => {
    await errorResponse(await alice.mutate('POST', '/api/auth/login', data), 400, 'VALIDATION_ERROR');
    await errorResponse(await alice.api.get('/api/auth/me'), 401, 'UNAUTHENTICATED');
  });
});

test('VAL-02 API-01: logout rejects invalid bodies without invalidating authentication', async ({ client }) => {
  const alice = await client('alice');
  await variants('contract-loop-244', [{ extra: true }, [], null], async (data) => {
    await errorResponse(await alice.mutate('POST', '/api/auth/logout', data), 400, 'VALIDATION_ERROR');
    expect((await alice.api.get('/api/auth/me')).status()).toBe(200);
  });
});
