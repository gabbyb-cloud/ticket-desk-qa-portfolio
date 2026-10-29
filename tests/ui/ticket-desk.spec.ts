import { randomUUID } from 'node:crypto';
import type { Page, APIResponse } from '@playwright/test';
import { test, expect, variants } from '../fixtures.js';
import { DEMO_PASSWORD, IDLE_MS } from '../../src/auth.js';

async function logIn(page: Page, name = 'alice') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(`${name}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  const posted = page.waitForResponse(response => new URL(response.url()).pathname === '/login' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  expect((await posted).status()).toBe(303);
  await expect(page).toHaveURL(/\/tickets$/);
  await expect(page.getByRole('heading', { name: 'Tickets', exact: true })).toBeVisible();
}
const formToken = (page: Page) => page.locator('input[name="_csrf"]').first().inputValue();
async function htmlFailure(response: APIResponse, status: number, message: string) {
  expect(response.status()).toBe(status);
  expect(response.headers()['content-type']?.startsWith('text/html')).toBe(true);
  expect((await response.text()).includes(message)).toBe(true);
}

test('UI-01 SEC-05: accessible login and logout with protected-page redirects and no-store', async ({ page }) => {
  await logIn(page);
  const response = await page.reload();
  expect(response?.headers()['cache-control']).toBe('no-store');
  const posted = page.waitForResponse(response => new URL(response.url()).pathname === '/logout' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Log out' }).click();
  expect((await posted).status()).toBe(303);
  await expect(page).toHaveURL(/\/login$/);
  const protectedResponse = await page.request.get('/tickets', { maxRedirects: 0 });
  expect(protectedResponse.status()).toBe(303);
  expect(protectedResponse.headers()['location']).toBe('/login');
  await page.goto('/tickets');
  await expect(page).toHaveURL(/\/login$/);
});

test('UI-02 ISO-01: create, list, detail, close, refresh and reopen through accessible forms', async ({ page }) => {
  await logIn(page);
  await expect(page.getByText('No tickets yet.')).toBeVisible();
  await page.getByRole('link', { name: 'Create ticket', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Synthetic UI ticket');
  await page.getByLabel('Description', { exact: true }).fill('Synthetic UI description');
  const posted = page.waitForResponse(response => new URL(response.url()).pathname === '/tickets' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create ticket', exact: true }).click();
  expect((await posted).status()).toBe(303);
  await expect(page.getByRole('heading', { name: 'Synthetic UI ticket', exact: true })).toBeVisible();
  await expect(page.getByTestId('description')).toHaveText('Synthetic UI description');
  await page.getByRole('link', { name: 'Tickets', exact: true }).click();
  await page.getByRole('link', { name: 'Synthetic UI ticket', exact: true }).click();
  await variants('ui-status', ['closed', 'open'], async status => {
    await page.getByLabel('Status', { exact: true }).selectOption(status);
    const saved = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/status') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save status' }).click();
    expect((await saved).status()).toBe(303);
    await expect(page.getByTestId('status')).toHaveText(status);
    await page.reload();
    await expect(page.getByTestId('status')).toHaveText(status);
  });
});

test('UI-03 DATA-01: invalid credentials clear password; invalid title displays an accessible error without creating data', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('alice@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Synthetic-wrong-password');
  const rejected = page.waitForResponse(response => new URL(response.url()).pathname === '/login' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  expect((await rejected).status()).toBe(401);
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password.');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  expect((await page.content()).includes('Synthetic-wrong-password')).toBe(false);
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  await logIn(page);
  const before = (await (await page.request.get('/api/tickets')).json()).data;
  await page.getByRole('link', { name: 'Create ticket', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('   ');
  const invalid = page.waitForResponse(response => new URL(response.url()).pathname === '/tickets' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create ticket', exact: true }).click();
  expect((await invalid).status()).toBe(400);
  await expect(page.getByRole('alert')).toHaveText('Request validation failed.');
  expect((await (await page.request.get('/api/tickets')).json()).data).toEqual(before);
});

test('AUTH-01 AUTH-02 DATA-01: anonymous browser access and cross-user form writes enforce ownership', async ({ page, client, instance }) => {
  const alice = await client('alice');
  const ticket = await alice.create();
  await variants('anonymous-browser-get', ['/tickets', '/tickets/new', `/tickets/${ticket.id}`], async path => {
    const response = await page.request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    expect(response.headers()['location']).toBe('/login');
  });
  await variants('anonymous-browser-post', [
    ['/tickets', { title: 'Forged', description: '' }], [`/tickets/${ticket.id}/status`, { status: 'closed' }], ['/logout', {}],
  ] as const, async ([path, form]) => {
    const before = await alice.snapshot();
    await htmlFailure(await page.request.post(path, { form, headers: { Origin: instance.origin } }), 401, 'Authentication required.');
    expect(await alice.snapshot()).toEqual(before);
  });
  await logIn(page, 'bob');
  await expect(page.getByRole('link', { name: ticket.title })).toHaveCount(0);
  const cross = await page.request.get(`/tickets/${ticket.id}`);
  const absent = await page.request.get(`/tickets/${randomUUID()}`);
  expect(cross.status()).toBe(404);
  expect(absent.status()).toBe(404);
  expect(await cross.text()).toBe(await absent.text());
  const token = await formToken(page);
  const before = await alice.snapshot();
  await htmlFailure(await page.request.post(`/tickets/${ticket.id}/status`, {
    form: { _csrf: token, status: 'closed' }, headers: { Origin: instance.origin },
  }), 404, 'Ticket not found.');
  expect(await alice.snapshot()).toEqual(before);
});

test('AUTH-04 AUTH-01 DATA-01: expired browser sessions redirect reads and reject form writes', async ({ page, client, instance }) => {
  const alice = await client('alice');
  const ticket = await alice.create();
  const before = await alice.snapshot();
  await logIn(page);
  const token = await formToken(page);
  await instance.advance(IDLE_MS);
  await variants('expired-browser-post', [
    ['/tickets', { title: 'Expired', description: '' }], [`/tickets/${ticket.id}/status`, { status: 'closed' }], ['/logout', {}],
  ] as const, async ([path, form]) => {
    const owner = await client('alice');
    const attemptBefore = await owner.snapshot();
    expect(attemptBefore).toEqual(before);
    await htmlFailure(await page.request.post(path, { form: { ...form, _csrf: token }, headers: { Origin: instance.origin } }), 401, 'Authentication required.');
    expect(await owner.snapshot()).toEqual(attemptBefore);
  });
  await page.goto(`/tickets/${ticket.id}`);
  await expect(page).toHaveURL(/\/login$/);
});

test('SEC-01 DATA-01: tampered hidden token blocks real browser form submission', async ({ page }) => {
  await logIn(page);
  const before = (await (await page.request.get('/api/tickets')).json()).data;
  await page.getByRole('link', { name: 'Create ticket', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Rejected browser form');
  await page.locator('form[action="/tickets"] input[name="_csrf"]').evaluate(element => (element as HTMLInputElement).value = 'invalid');
  const rejected = page.waitForResponse(response => new URL(response.url()).pathname === '/tickets' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create ticket', exact: true }).click();
  expect((await rejected).status()).toBe(403);
  await expect(page.getByRole('alert')).toHaveText('CSRF validation failed.');
  expect((await (await page.request.get('/api/tickets')).json()).data).toEqual(before);
});

test('SEC-01 SEC-02 DATA-01: URL-encoded token binding and origin failures preserve tickets and logout session', async ({ page, client, instance }) => {
  await page.goto('/login');
  const stale = await formToken(page);
  await logIn(page);
  const token = await formToken(page);
  const another = await client();
  await another.bootstrap();
  const observer = await client('alice');
  const ticket = await observer.create();
  const cases: { token?: string; headers: Record<string, string> }[] = [
    { headers: { Origin: instance.origin } }, { token: 'wrong', headers: { Origin: instance.origin } },
    { token: another.token, headers: { Origin: instance.origin } }, { token: stale, headers: { Origin: instance.origin } },
    { token, headers: { Origin: 'https://attacker.example' } }, { token, headers: { Origin: 'null' } },
    { token, headers: { Referer: 'https://attacker.example/form' } }, { token, headers: {} },
    { token, headers: { Origin: 'https://attacker.example', Referer: `${instance.origin}/tickets` } },
  ];
  await variants('form-csrf', cases, async variant => {
    await variants('protected-form', [
      ['/tickets', { title: 'Forged', description: '' }], [`/tickets/${ticket.id}/status`, { status: 'closed' }], ['/logout', {}],
    ] as const, async ([path, fields]) => {
      const before = await observer.snapshot();
      const form = variant.token === undefined ? { ...fields } : { ...fields, _csrf: variant.token };
      await htmlFailure(await page.request.post(path, { form, headers: variant.headers, maxRedirects: 0 }), 403, 'CSRF validation failed.');
      expect(await observer.snapshot()).toEqual(before);
      expect((await page.request.get('/api/auth/me')).status()).toBe(200);
    });
  });
  const accepted = await page.request.post('/tickets', {
    form: { title: 'Referer fallback', description: '', _csrf: token }, headers: { Referer: `${instance.origin}/tickets/new` }, maxRedirects: 0,
  });
  expect(accepted.status()).toBe(303);
});

test('SEC-01 SEC-02 AUTH-03: forged login forms never authenticate', async ({ page, client, instance }) => {
  await page.goto('/login');
  const token = await formToken(page);
  const another = await client();
  await another.bootstrap();
  await variants('login-form-csrf', [
    { token: undefined, headers: { Origin: instance.origin } },
    { token: 'wrong', headers: { Origin: instance.origin } },
    { token: another.token, headers: { Origin: instance.origin } },
    { token, headers: { Origin: 'https://attacker.example' } },
    { token, headers: { Origin: 'null' } }, { token, headers: {} },
    { token, headers: { Referer: 'https://attacker.example/form' } },
  ], async variant => {
    const form = { email: 'alice@example.test', password: DEMO_PASSWORD, ...(variant.token === undefined ? {} : { _csrf: variant.token }) };
    await htmlFailure(await page.request.post('/login', { form, headers: variant.headers, maxRedirects: 0 }), 403, 'CSRF validation failed.');
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  });
});

test('SEC-03 DATA-01: script-like content stays inert in list, detail, error text and attributes', async ({ page, instance }) => {
  let dialogs = 0;
  page.on('dialog', async dialog => { dialogs++; await dialog.dismiss(); });
  await logIn(page);
  const payloads = [
    '<script>window.__injected=1;alert(1)</script>',
    '<img src=x onerror="window.__injected=1;alert(1)">',
    '\"><svg onload="window.__injected=1;alert(1)">',
  ];
  await variants('inert-content', payloads, async payload => {
    await page.goto('/tickets/new');
    const token = await formToken(page);
    // An extra field forces an error while preserving the script-like input for redisplay.
    const before = (await (await page.request.get('/api/tickets')).json()).data;
    const response = await page.request.post('/tickets', {
      form: { _csrf: token, title: payload, description: `</textarea>${payload}`, extra: 'invalid' },
      headers: { Origin: instance.origin }, maxRedirects: 0,
    });
    expect(response.status()).toBe(400);
    // Render the actual server error response in the browser through a same-origin navigation.
    await page.route(`${instance.origin}/tickets/new`, async route => route.fulfill({ response }));
    await page.goto('/tickets/new');
    await page.unroute(`${instance.origin}/tickets/new`);
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue(payload);
    await expect(page.getByLabel('Description', { exact: true })).toHaveValue(`</textarea>${payload}`);
    await expect(page.getByRole('alert')).toHaveText('Request validation failed.');
    expect(await page.locator('script, img, svg, [onerror], [onload]').count()).toBe(0);
    expect(await page.evaluate(() => Object.hasOwn(window, '__injected'))).toBe(false);
    expect(dialogs).toBe(0);
    expect((await (await page.request.get('/api/tickets')).json()).data).toEqual(before);
    await page.getByRole('button', { name: 'Create ticket', exact: true }).click();
    await expect(page.getByRole('heading', { name: payload, exact: true })).toBeVisible();
    await expect(page.getByTestId('description')).toHaveText(`</textarea>${payload}`);
    expect(await page.locator('script, img, svg, [onerror], [onload]').count()).toBe(0);
    expect(await page.evaluate(() => Object.hasOwn(window, '__injected'))).toBe(false);
    expect(dialogs).toBe(0);
    await page.getByRole('link', { name: 'Tickets', exact: true }).click();
    await expect(page.getByRole('link', { name: payload, exact: true })).toBeVisible();
    expect(await page.locator('script, img, svg, [onerror], [onload]').count()).toBe(0);
    expect(await page.evaluate(() => Object.hasOwn(window, '__injected'))).toBe(false);
    expect(dialogs).toBe(0);
  });
});

test('VAL-01 VAL-02 VAL-03 SEC-04 DATA-01: form transport bounds and strict schemas reject atomic writes', async ({ page, client, instance }) => {
  await logIn(page);
  const token = await formToken(page);
  const owner = await client('alice');
  const ticket = await owner.create();
  await variants('invalid-form-write', [
    ['/tickets', { title: 'x', description: '', ownerId: 'user-bob' }],
    ['/tickets', { title: 'x'.repeat(121), description: '' }],
    [`/tickets/${ticket.id}/status`, { status: 'closed', ownerId: 'user-bob' }],
    [`/tickets/${ticket.id}/status`, { status: 'invalid' }],
  ] as const, async ([path, fields]) => {
    const before = await owner.snapshot();
    await htmlFailure(await page.request.post(path, { form: { ...fields, _csrf: token }, headers: { Origin: instance.origin } }), 400, 'Request validation failed.');
    expect(await owner.snapshot()).toEqual(before);
  });
  await variants('form-transport', [
    { data: `title=${'x'.repeat(17000)}`, type: 'application/x-www-form-urlencoded', status: 413 },
    { data: Array.from({ length: 21 }, (_, i) => `field${i}=x`).join('&'), type: 'application/x-www-form-urlencoded', status: 413 },
    { data: '{}', type: 'application/json', status: 415 },
  ], async variant => {
    const before = await owner.snapshot();
    const response = await page.request.post('/tickets', { data: Buffer.from(variant.data), headers: { Origin: instance.origin, 'Content-Type': variant.type } });
    expect(response.status()).toBe(variant.status);
    expect(await owner.snapshot()).toEqual(before);
  });
});
